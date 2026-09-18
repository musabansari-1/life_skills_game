/**
 * Conversation & quest orchestrator — the game loop.
 *
 *   startQuest      → prerequisites, hidden state, scene, NPC opening line
 *   submitPlayerTurn→ NPC turn (AI) → scene reducer (deterministic) → persist
 *   concludeQuest   → evaluation (AI) → objectives/outcome (deterministic)
 *                   → competency update → memory extraction (AI) + merge
 *                   → consequences (world, relationship, memory) → events
 *
 * AI tasks are isolated; everything else is deterministic and unit-tested.
 * The orchestrator is written against injected dependencies (`GameDeps`) so
 * the full loop runs in tests on an in-memory DB with the fake provider.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dialogueTurns, questAttempts } from "@/db/schema";
import { getNPC } from "@/content/npcs";
import { getQuest } from "@/content/quests";
import { evaluateConversation } from "@/ai/tasks/evaluate";
import { extractMemory } from "@/ai/tasks/extractMemory";
import { generateNpcTurn } from "@/ai/tasks/npcTurn";
import type { TaskContext } from "@/ai/tasks/shared";
import type { AILogSink } from "@/ai/logger";
import type { LLMProvider } from "@/ai/provider";
import { applyObservations } from "@/engine/competency";
import { mergeMemory } from "@/engine/memory";
import { resolveObjectives, resolveOutcome } from "@/engine/quests/outcomes";
import { applyRelationshipDelta, diffRelationship } from "@/engine/relationships";
import { abandonScene, endSceneByPlayer, reduceNpcTurn } from "@/engine/scene";
import type { Consequence } from "@/engine/types/consequences";
import type { Evaluation } from "@/engine/types/evaluation";
import type { NPCInstanceState } from "@/engine/types/npc";
import type { AnyQuestDefinition, OutcomeContext, QuestResult, SceneContext } from "@/engine/types/quest";
import { createSceneState, type DialogueTurn, type SceneState } from "@/engine/types/scene";
import type { WorldState } from "@/engine/types/world";
import { applyConsequences, checkPrerequisites, recordQuestCompletion } from "@/engine/world";
import { defaultEnv, formatINR, type EngineEnv } from "@/engine/util";
import type { AnalyticsSink } from "./analytics";
import { getOrCreateNpcState, loadPlayerState, saveCompetencies, saveNpcState, saveWorldState, type PlayerState } from "./player";

export interface GameDeps {
  db: Db;
  provider: LLMProvider;
  aiLog: AILogSink;
  analytics: AnalyticsSink;
  env?: EngineEnv;
}

export class GameError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "forbidden" | "prerequisites" | "state" | "ai",
  ) {
    super(message);
  }
}

export interface AttemptView {
  id: string;
  questId: string;
  npcId: string;
  status: "active" | "evaluating" | "completed" | "abandoned";
  scene: SceneState;
  hidden: Record<string, unknown>;
  turns: DialogueTurn[];
  visibleStatus: { label: string; value: string }[];
  evaluation: Evaluation | null;
  result: QuestResult | null;
  snapshotBefore: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
}

export class GameService {
  private env: EngineEnv;
  constructor(private deps: GameDeps) {
    this.env = deps.env ?? defaultEnv;
  }

  private taskCtx(playerId: string, attemptId?: string): TaskContext {
    return { provider: this.deps.provider, log: this.deps.aiLog, playerId, attemptId };
  }

  // ---------------------------------------------------------------- start

  async startQuest(playerId: string, questId: string, modality: "voice" | "text" = "text"): Promise<AttemptView> {
    const quest = getQuest(questId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const prereq = checkPrerequisites(quest.prerequisites, { world: state.world, competencies: state.competencies, npcs: state.npcs });
    if (!prereq.ok) throw new GameError(prereq.unmet.join("; "), "prerequisites");

    // Abandon any other active attempt for this player (one scene at a time).
    const active = await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), eq(questAttempts.status, "active")) });
    if (active) await this.abandonQuest(playerId, active.id);

    const npcDef = getNPC(quest.npcId);
    const npc = getOrCreateNpcState(state, quest.npcId);
    const hidden = quest.scene.createHidden({ world: state.world, npc });
    const custom = quest.scene.createCustom(hidden);
    const patience = quest.scene.initialPatience ? quest.scene.initialPatience({ hidden, npc }) : 70;
    const scene = createSceneState(custom, Math.max(20, Math.min(95, patience)));
    const attemptId = this.env.id();
    const now = this.env.now();
    const isRetry = state.world.completedQuests.some((q) => q.questId === questId) || state.world.failedQuests.some((q) => q.questId === questId);

    await this.deps.db.insert(questAttempts).values({
      id: attemptId,
      playerId,
      questId,
      npcId: quest.npcId,
      status: "active",
      hidden,
      scene,
      evaluation: null,
      result: null,
      snapshotBefore: {
        relationship: npc.relationship,
        levels: Object.fromEntries(Object.values(state.competencies).map((s) => [s.skillId, s.level])),
        career: state.world.career,
      },
      modality,
      startedAt: now,
      endedAt: null,
      updatedAt: now,
    });

    await this.deps.analytics.track(playerId, isRetry ? "quest_retried" : "quest_started", { questId, attemptId, modality });
    if (modality === "voice") await this.deps.analytics.track(playerId, "voice_conversation_started", { questId, attemptId });

    // Opening line: scripted or generated.
    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden, scene, world: state.world, npc, playerName: state.displayName };
    let openingText: string;
    if (quest.scene.opening.scripted) {
      openingText = quest.scene.opening.scripted(sceneCtx);
    } else {
      const out = await generateNpcTurn(this.taskCtx(playerId, attemptId), { quest, npcDef, npcState: npc, sceneCtx, turns: [], playerName: state.displayName, opening: true });
      openingText = out.speech;
    }
    await this.appendTurn(attemptId, 0, "npc", openingText, "generated", null);
    return this.getAttempt(playerId, attemptId);
  }

  // ---------------------------------------------------------------- turn

  /**
   * Submit a player utterance and generate the NPC response. `onSpeech` streams
   * the NPC's speech as it is produced. Returns the updated attempt.
   */
  async submitPlayerTurn(
    playerId: string,
    attemptId: string,
    text: string,
    modality: "voice" | "text",
    onSpeech?: (speechSoFar: string, done: boolean) => void,
  ): Promise<{ attempt: AttemptView; npcText: string }> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status !== "active") throw new GameError("This conversation has ended.", "state");
    const quest = getQuest(row.questId);
    const npcDef = getNPC(row.npcId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const npc = getOrCreateNpcState(state, row.npcId);
    const turns = await this.loadTurns(attemptId);
    const cleaned = text.trim().slice(0, 2000);
    if (!cleaned) throw new GameError("Say something first.", "state");

    const playerIdx = turns.length;
    const playerTurn = await this.appendTurn(attemptId, playerIdx, "player", cleaned, modality, null);
    turns.push(playerTurn);

    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = {
      hidden: row.hidden,
      scene: row.scene,
      world: state.world,
      npc,
      playerName: state.displayName,
    };

    let out;
    try {
      out = await generateNpcTurn(this.taskCtx(playerId, attemptId), { quest, npcDef, npcState: npc, sceneCtx, turns, playerName: state.displayName, opening: false }, onSpeech);
    } catch (err) {
      // Roll back the player turn so they can retry cleanly.
      await this.deps.db.delete(dialogueTurns).where(eq(dialogueTurns.id, playerTurn.id));
      throw new GameError(err instanceof Error ? err.message : "The character couldn't respond.", "ai");
    }

    const reduced = reduceNpcTurn({ scene: quest.scene, ctx: sceneCtx, moves: out.moves });
    if (reduced.rejectedReveals.length) out.problems.push(`rejected reveals: ${reduced.rejectedReveals.join(",")}`);
    await this.appendTurn(attemptId, playerIdx + 1, "npc", out.speech, "generated", out.moves);
    await this.deps.db.update(questAttempts).set({ scene: reduced.scene, updatedAt: this.env.now() }).where(eq(questAttempts.id, attemptId));

    const attempt = await this.getAttempt(playerId, attemptId);
    return { attempt, npcText: out.speech };
  }

  // ---------------------------------------------------------------- conclude

  /** End the scene (by the player, or because the scene already ended) and resolve everything. */
  async concludeQuest(playerId: string, attemptId: string): Promise<AttemptView> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status === "completed") return this.getAttempt(playerId, attemptId);
    if (row.status !== "active" && row.status !== "evaluating") throw new GameError("This conversation was abandoned.", "state");
    const quest = getQuest(row.questId);
    const npcDef = getNPC(row.npcId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const npc = getOrCreateNpcState(state, row.npcId);
    const turns = await this.loadTurns(attemptId);
    const playerTurns = turns.filter((t) => t.speaker === "player").length;
    if (playerTurns === 0) throw new GameError("Say at least one thing before concluding.", "state");

    const scene = row.scene.ended ? row.scene : endSceneByPlayer(row.scene);
    await this.deps.db.update(questAttempts).set({ status: "evaluating", scene, updatedAt: this.env.now() }).where(eq(questAttempts.id, attemptId));

    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene, world: state.world, npc, playerName: state.displayName };

    // 1. Evaluate (AI, separate from NPC).
    let evaluation: Evaluation;
    try {
      evaluation = (await evaluateConversation(this.taskCtx(playerId, attemptId), { quest, npcDef, sceneCtx, turns, playerName: state.displayName })).evaluation;
    } catch (err) {
      await this.deps.db.update(questAttempts).set({ status: "active", updatedAt: this.env.now() }).where(eq(questAttempts.id, attemptId));
      throw new GameError(err instanceof Error ? `Evaluation failed: ${err.message}` : "Evaluation failed", "ai");
    }

    // 2. Objectives + outcome (deterministic).
    const objectivesAchieved = resolveObjectives(quest, sceneCtx, evaluation);
    const outcomeCtx: OutcomeContext<Record<string, unknown>, Record<string, unknown>> = { ...sceneCtx, evaluation, objectivesAchieved };
    const outcome = resolveOutcome(quest, outcomeCtx);

    // 3. Competencies (deterministic).
    const comp = applyObservations({
      profile: state.competencies,
      observations: evaluation.behaviors,
      rewards: quest.rewards,
      difficulty: quest.difficulty,
      outcomeMultiplier: outcome.rewardMultiplier,
      now: this.env.now(),
    });

    // 4. Memory extraction (AI) + merge (deterministic). Failure here must not lose the result.
    let memory = npc.memory;
    try {
      const { extraction } = await extractMemory(this.taskCtx(playerId, attemptId), { quest, npcDef, sceneCtx, turns, playerName: state.displayName, evaluation, outcomeLabel: outcome.label });
      memory = mergeMemory(memory, extraction, { questId: quest.id, attemptId, env: this.env });
    } catch (err) {
      console.error("[orchestrator] memory extraction failed; continuing with scripted memory only", err);
      memory = { ...memory, lastInteractionSummary: evaluation.summary.slice(0, 300), lastInteractionAt: this.env.now() };
    }

    // 5. Consequences.
    const consequences: Consequence[] = [{ type: "world.person.met", npcId: npc.npcId }, ...outcome.consequences(outcomeCtx)];
    // Commitments the NPC memory extracted from the player become world commitments too.
    for (const c of memory.commitments) {
      if (c.by === "player" && c.status === "open" && c.questId === quest.id && !state.world.commitments.some((w) => w.description === c.description)) {
        consequences.push({ type: "world.commitment.add", description: c.description, toNpcId: npc.npcId, dueBy: c.dueBy });
      }
    }
    let world = state.world;
    const { world: newWorld, applied } = applyConsequences(world, consequences, { questId: quest.id, env: this.env });
    world = recordQuestCompletion(newWorld, { questId: quest.id, attemptId, outcomeId: outcome.id, grade: outcome.grade, at: this.env.now() });

    const relationshipBefore = { ...npc.relationship };
    const touchedNpcs: Record<string, NPCInstanceState> = { [npc.npcId]: { ...npc, memory } };
    for (const c of consequences) {
      if (c.type === "relationship.delta") {
        const target = touchedNpcs[c.npcId] ?? { ...getOrCreateNpcState(state, c.npcId) };
        target.relationship = applyRelationshipDelta(target.relationship, c.delta);
        touchedNpcs[c.npcId] = target;
      } else if (c.type === "npc.memory.event") {
        const target = touchedNpcs[c.npcId] ?? { ...getOrCreateNpcState(state, c.npcId) };
        target.memory = { ...target.memory, events: [...target.memory.events, { id: this.env.id(), questId: quest.id, attemptId, summary: c.summary, importance: c.importance, emotionalTone: c.emotionalTone, at: this.env.now() }] };
        touchedNpcs[c.npcId] = target;
      }
    }
    touchedNpcs[npc.npcId].timesMet += 1;

    // 6. Build result & persist everything.
    const levelsBefore = (row.snapshotBefore.levels ?? {}) as Record<string, number>;
    const result: QuestResult = {
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      grade: outcome.grade,
      narrative: outcome.narrative(outcomeCtx),
      objectivesAchieved: [...objectivesAchieved],
      rewards: {
        xp: comp.xpAwards,
        discoveredFacets: comp.discovered,
        relationshipChanges: Object.values(touchedNpcs).map((n) => ({
          npcId: n.npcId,
          before: n.npcId === npc.npcId ? relationshipBefore : state.npcs[n.npcId]?.relationship ?? n.relationship,
          after: n.relationship,
        })),
        unlockedQuestIds: applied.filter((a) => a.consequence.type === "world.unlock.quest" && a.changed).map((a) => (a.consequence as { questId: string }).questId),
        unlockedLocationIds: applied.filter((a) => a.consequence.type === "world.unlock.location" && a.changed).map((a) => (a.consequence as { locationId: string }).locationId),
        followUpQuestIds: outcome.followUpQuestIds ?? [],
      },
      consequencesApplied: applied.filter((a) => a.changed).map((a) => ({ type: a.consequence.type, description: a.description })),
      shareCard: buildShareCard(quest, sceneCtx, evaluation, comp.xpAwards, levelsBefore, state.competencies, comp.profile),
    };

    const now = this.env.now();
    await saveWorldState(this.deps.db, playerId, world);
    await saveCompetencies(this.deps.db, playerId, comp.profile);
    for (const n of Object.values(touchedNpcs)) await saveNpcState(this.deps.db, playerId, n);
    await this.deps.db
      .update(questAttempts)
      .set({ status: "completed", scene, evaluation, result, endedAt: now, updatedAt: now })
      .where(eq(questAttempts.id, attemptId));

    // 7. Events.
    const a = this.deps.analytics;
    await a.track(playerId, outcome.grade === "failure" ? "quest_failed" : "quest_completed", { questId: quest.id, attemptId, outcomeId: outcome.id, score: evaluation.overallScore, turns: playerTurns });
    for (const x of comp.xpAwards) {
      await a.track(playerId, "player.xp_gained", { skill: x.skill, xp: x.xp });
      if (x.levelAfter > x.levelBefore) await a.track(playerId, "player.level_up", { skill: x.skill, level: x.levelAfter });
    }
    for (const d of comp.discovered) await a.track(playerId, "player.facet_discovered", d);
    for (const n of Object.values(touchedNpcs)) {
      const before = n.npcId === npc.npcId ? relationshipBefore : state.npcs[n.npcId]?.relationship ?? n.relationship;
      await a.track(playerId, "npc.relationship_changed", { npcId: n.npcId, delta: diffRelationship(before, n.relationship) });
    }
    await a.track(playerId, "npc.memory_updated", { npcId: npc.npcId, facts: memory.facts.length, beliefs: memory.beliefs.length, events: memory.events.length });
    for (const ap of applied.filter((x) => x.changed)) await a.track(playerId, "world.consequence_applied", { questId: quest.id, type: ap.consequence.type, description: ap.description });

    return this.getAttempt(playerId, attemptId);
  }

  // ---------------------------------------------------------------- abandon

  async abandonQuest(playerId: string, attemptId: string): Promise<void> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status !== "active") return;
    const scene = abandonScene(row.scene);
    const now = this.env.now();
    await this.deps.db.update(questAttempts).set({ status: "abandoned", scene, endedAt: now, updatedAt: now }).where(eq(questAttempts.id, attemptId));
    await this.deps.analytics.track(playerId, "conversation_abandoned", { questId: row.questId, attemptId, turns: row.scene.turnCount });
  }

  // ---------------------------------------------------------------- reads

  async getAttempt(playerId: string, attemptId: string): Promise<AttemptView> {
    const row = await this.requireAttempt(playerId, attemptId);
    const quest = getQuest(row.questId);
    const turns = await this.loadTurns(attemptId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const npc = getOrCreateNpcState(state, row.npcId);
    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene: row.scene, world: state.world, npc, playerName: state.displayName };
    return {
      id: row.id,
      questId: row.questId,
      npcId: row.npcId,
      status: row.status,
      scene: row.scene,
      hidden: row.hidden,
      turns,
      visibleStatus: quest.scene.visibleStatus ? quest.scene.visibleStatus(sceneCtx) : [],
      evaluation: row.evaluation ?? null,
      result: row.result ?? null,
      snapshotBefore: row.snapshotBefore,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  }

  async getActiveAttempt(playerId: string): Promise<AttemptView | null> {
    const row = await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), eq(questAttempts.status, "active")) });
    return row ? this.getAttempt(playerId, row.id) : null;
  }

  async getPlayerState(playerId: string): Promise<PlayerState> {
    return loadPlayerState(this.deps.db, playerId);
  }

  // ---------------------------------------------------------------- internals

  private async requireAttempt(playerId: string, attemptId: string) {
    const row = await this.deps.db.query.questAttempts.findFirst({ where: eq(questAttempts.id, attemptId) });
    if (!row) throw new GameError("Attempt not found", "not_found");
    if (row.playerId !== playerId) throw new GameError("Not your attempt", "forbidden");
    return row;
  }

  private async loadTurns(attemptId: string): Promise<DialogueTurn[]> {
    const rows = await this.deps.db.query.dialogueTurns.findMany({ where: eq(dialogueTurns.attemptId, attemptId), orderBy: asc(dialogueTurns.idx) });
    return rows.map((r) => ({ id: r.id, index: r.idx, speaker: r.speaker, text: r.text, modality: r.modality, moves: r.moves ?? null, createdAt: r.createdAt }));
  }

  private async appendTurn(attemptId: string, idx: number, speaker: DialogueTurn["speaker"], text: string, modality: DialogueTurn["modality"], moves: DialogueTurn["moves"]): Promise<DialogueTurn> {
    const turn: DialogueTurn = { id: this.env.id(), index: idx, speaker, text, modality, moves, createdAt: this.env.now() };
    await this.deps.db.insert(dialogueTurns).values({ id: turn.id, attemptId, idx, speaker, text, modality, moves, createdAt: turn.createdAt });
    return turn;
  }
}

function buildShareCard(
  quest: AnyQuestDefinition,
  sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>,
  evaluation: Evaluation,
  xp: { skill: string; levelBefore: number; levelAfter: number }[],
  levelsBefore: Record<string, number>,
  before: PlayerState["competencies"],
  after: PlayerState["competencies"],
): QuestResult["shareCard"] {
  const lines: QuestResult["shareCard"]["lines"] = [];
  const c = sceneCtx.scene.custom as Record<string, unknown>;
  const h = sceneCtx.hidden as Record<string, unknown>;
  if (typeof c.currentBase === "number" && typeof h.originalBase === "number") {
    lines.push({ label: "Base", before: formatINR(h.originalBase), after: formatINR(c.currentBase) });
    if (typeof c.currentSigningBonus === "number" && c.currentSigningBonus > 0) lines.push({ label: "Joining bonus", before: "—", after: formatINR(c.currentSigningBonus) });
  }
  const levelChanges = xp
    .filter((x) => x.levelAfter > x.levelBefore)
    .map((x) => ({ skill: x.skill, before: levelsBefore[x.skill] ?? before[x.skill as keyof typeof before]?.level ?? x.levelBefore, after: after[x.skill as keyof typeof after]?.level ?? x.levelAfter }));
  return { title: quest.title, headline: evaluation.headline, lines, levelChanges };
}
