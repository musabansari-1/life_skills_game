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
import { and, asc, desc, eq, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dialogueTurns, questAttempts, worldStates } from "@/db/schema";
import { getNPC } from "@/content/npcs";
import { getQuest } from "@/content/quests";
import { applyDirectorPlan, planDirector, proposalForQuest } from "@/engine/director";
import { advanceContinuity } from "@/engine/director/continuity";
import { DirectorProposalSchema, PreferencesSchema, type DirectorProposal } from "@/engine/director/types";
import { WorldStateSchema } from "@/engine/types/world";
import { isValidFacet } from "@/engine/types/skills";
import { proposeNextEvent } from "@/ai/tasks/gameDirector";
import { readSceneMeaning } from "@/ai/tasks/sceneRead";
import { addSceneEvidence, selectFloor, participantDirection, scheduleReaction, pendingReaction, type TurnIdentity } from "@/engine/scene/ensemble";
import { advanceCampaign, reconcileCampaign } from "@/engine/campaign";
import { communicate } from "@/engine/campaign/information";
import { evaluateConversation } from "@/ai/tasks/evaluate";
import { extractMemory } from "@/ai/tasks/extractMemory";
import { generateNpcTurn } from "@/ai/tasks/npcTurn";
import { mergeMoves, movesAreEmpty, perceiveMoves } from "@/ai/tasks/perceive";
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
import { NPCMemorySchema, type NPCInstanceState, type Relationship } from "@/engine/types/npc";
import { readPlayerUtterance } from "@/engine/parsing/player";
import { heardPrefix, normalizeSpoken, splitSentences } from "@/engine/parsing/sentences";
import { looksIncomplete } from "@/engine/parsing/utterance";
import { npcEndsConversation } from "@/engine/parsing/closing";
import type { PlayerSignal } from "@/engine/types/scene";
import { difficultyProfile } from "@/engine/scene/difficulty";
import { dropUnspokenFigures, movesForHeardSpeech } from "@/engine/scene/delivery";
import { SpeechGate } from "@/engine/scene/speechGate";
import type { NpcTurnInput, NpcTurnOutput } from "@/ai/tasks/npcTurn";
import type { DeliveryReport } from "@/contracts/api";
import type { AnyQuestDefinition, OutcomeContext, QuestResult, SceneContext } from "@/engine/types/quest";
import { createSceneState, type DialogueTurn, type SceneState } from "@/engine/types/scene";
import { applyConsequences, checkPrerequisites, recordQuestCompletion } from "@/engine/world";
import { defaultEnv, formatINR, textSimilarity, type EngineEnv } from "@/engine/util";
import type { AnalyticsSink } from "./analytics";
import { getOrCreateNpcState, loadPlayerState, saveCompetencies, saveNpcState, saveWorldState, type PlayerState } from "./player";

export interface GameDeps {
  db: Db;
  provider: LLMProvider;
  aiLog: AILogSink;
  analytics: AnalyticsSink;
  env?: EngineEnv;
}

/** An "evaluating" claim older than this is presumed abandoned by a crashed request. */
const EVALUATION_STALE_MS = 5 * 60_000;

/** A player turn with no NPC reply older than this is treated as orphaned (server crashed mid-reply). */
const ORPHAN_TURN_MS = 120_000;

/** Spoken when the speech gate had to remove every sentence of a reply (rare; the model ignored the rules entirely). */
const HOLD_LINE = "Hold on, let me think about that for a second.";

/** A new sentence this similar (word overlap) to one the NPC already said is a repeat. */
const REPEAT_SIMILARITY = 0.8;

/** Hard ceiling on a spoken NPC line; the prompt asks for one to three sentences. */
const MAX_SPOKEN_SENTENCES = 4;

/** A line that trails off mid-thought is hesitation: it never counts as empty, evasive or vague. */
const HESITATION_EXEMPT: PlayerSignal[] = ["silence_or_filler", "deflected", "vague_claim", "rambling"];

/** Drizzle wraps driver errors; the SQLite/Postgres unique-violation text lives somewhere in the cause chain. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { message?: string; code?: string };
    if (/UNIQUE constraint|duplicate key|SQLITE_CONSTRAINT/i.test(`${x.code ?? ""} ${x.message ?? ""}`)) return true;
  }
  return false;
}

export class GameError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "forbidden" | "prerequisites" | "state" | "conflict" | "ai",
  ) {
    super(message);
  }
}

/** first: canonical run. second_chance: replay after a failure (becomes canon). rehearsal: replay of a resolved quest (no world effects). */
export type AttemptMode = "first" | "second_chance" | "rehearsal";

/** Progress stages reported while a conclusion is being computed (for "the UI never feels frozen"). */
export type ConcludeStage = "reviewing" | "remembering" | "evaluated" | "applying" | "done";

const GRADE_RANK = { failure: 0, partial: 1, success: 2 } as const;

export interface AttemptView {
  directorProposal?: DirectorProposal;
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
  mode: AttemptMode;
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

  async startQuest(playerId: string, questId: string, modality: "voice" | "text" = "text", playMode: "story" | "practice" = "story"): Promise<AttemptView> {
    const state = await loadPlayerState(this.deps.db, playerId);
    const proposal = proposalForQuest(state.world, questId);
    let quest = getQuest(questId, proposal);
    if (questId.startsWith("director_") && !proposal) throw new GameError("This event has not entered your story yet.", "prerequisites");
    const evaluating = await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), eq(questAttempts.status, "evaluating")) });
    if (evaluating) throw new GameError("Finish the current debrief before starting another conversation.", "conflict");
    const prereq = checkPrerequisites(quest.prerequisites, { world: state.world, competencies: state.competencies, npcs: state.npcs });
    const hasWin = state.world.completedQuests.some((q) => q.questId === questId);
    const hasFailure = state.world.failedQuests.some((q) => q.questId === questId);
    const isReplay = hasWin || (hasFailure && (!quest.recovery || playMode === "practice"));
    if (!prereq.ok && !isReplay) throw new GameError(prereq.unmet.join("; "), "prerequisites");

    // Abandon any other active attempt for this player (one scene at a time).
    const active = await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), eq(questAttempts.status, "active")) });
    if (active) await this.abandonQuest(playerId, active.id);

    const npcDef = getNPC(quest.npcId);
    const liveNpc = getOrCreateNpcState(state, quest.npcId);

    // Replay semantics. A quest resolved before is replayed as a *rehearsal*: it
    // starts from the same point as the canonical run (the NPC as they were then)
    // and never changes the world again. A quest whose canonical run *failed*
    // gets a *second chance* that becomes the new canon.
    const wins = state.world.completedQuests.filter((q) => q.questId === questId);
    const fails = state.world.failedQuests.filter((q) => q.questId === questId);
    const mode: AttemptMode = playMode === "practice" || wins.length || (!quest.recovery && fails.length) ? "rehearsal" : fails.length ? "second_chance" : "first";
    let npc = liveNpc;
    let sceneWorld = state.world;
    let pinnedProposal = proposal;
    let canonAttemptId: string | null = null;
    let pinnedHidden: Record<string, unknown> | undefined;
    let participantSnapshots = Object.fromEntries((quest.ensemble?.participants ?? []).map((p) => [p.npcId, getOrCreateNpcState(state, p.npcId)]));
    if (mode === "rehearsal") {
      canonAttemptId = wins[0]?.attemptId ?? fails[0]?.attemptId ?? null;
      const canon = canonAttemptId ? await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.id, canonAttemptId), eq(questAttempts.playerId, playerId)) }) : undefined;
      if (canon) pinnedHidden = canon.hidden;
      const snap = canon?.snapshotBefore?.npcState as { relationship: Relationship; memory: unknown } | undefined;
      if (snap) npc = { ...liveNpc, relationship: snap.relationship, memory: NPCMemorySchema.parse(snap.memory) };
      if (canon?.snapshotBefore.world) sceneWorld = WorldStateSchema.parse(canon.snapshotBefore.world);
      if (canon?.snapshotBefore.participants) participantSnapshots = canon.snapshotBefore.participants as Record<string, NPCInstanceState>;
      if (canon?.snapshotBefore.directorProposal) {
        pinnedProposal = DirectorProposalSchema.parse(canon.snapshotBefore.directorProposal);
        quest = getQuest(questId, pinnedProposal);
      }
    }
    const hidden = pinnedHidden ?? quest.scene.createHidden({ world: sceneWorld, npc, competencies: state.competencies });
    const custom = quest.scene.createCustom(hidden);
    // Difficulty as behaviour: harder quests start with less patience (see engine/scene/difficulty).
    const patience = (quest.scene.initialPatience ? quest.scene.initialPatience({ hidden, npc }) : 70) + difficultyProfile(quest.difficulty).patienceOffset;
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
        participants: participantSnapshots,
        world: sceneWorld,
        ...(pinnedProposal ? { directorProposal: pinnedProposal } : {}),
        mode,
        canonAttemptId,
        npcState: { relationship: npc.relationship, memory: npc.memory },
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
    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden, scene, world: sceneWorld, npc, playerName: state.displayName, difficulty: quest.difficulty };
    let openingText: string;
    if (quest.scene.opening.scripted) {
      openingText = quest.scene.opening.scripted(sceneCtx);
    } else {
      const turnDirection =
        mode === "second_chance" ? ["This is a second conversation: last time went badly (see what you remember). Acknowledge that briefly and in character, then get on with it. Don't lecture."] : undefined;
      const out = await this.generateGated(playerId, attemptId, quest, sceneCtx, { quest, npcDef, npcState: npc, sceneCtx, turns: [], playerName: state.displayName, opening: true, turnDirection });
      openingText = out.speech;
    }
    await this.appendTurn(attemptId, 0, "npc", openingText, "generated", null, { sceneBefore: scene, ...(quest.ensemble ? { identity: { npcId: npcDef.id, name: npcDef.shortName, addressedTo: "player", kind: "answer" } as TurnIdentity } : {}) });
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
    onSpeech?: (speechSoFar: string, done: boolean, identity?: TurnIdentity) => void,
    opts: { expectedTurnCount?: number; interrupted?: DeliveryReport } = {},
  ): Promise<{ attempt: AttemptView; npcText: string }> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status !== "active") throw new GameError("This conversation has ended.", "state");
    const quest = getQuest(row.questId, this.pinnedProposal(row));
    let npcDef = getNPC(row.npcId);
    const state = await loadPlayerState(this.deps.db, playerId);
    let npc = this.npcForAttempt(row, state);
    const turns = await this.loadTurns(attemptId);
    const cleaned = text.trim().slice(0, 2000);
    if (!cleaned) throw new GameError("Say something first.", "state");

    // Retry/concurrency safety for flaky (mobile) networks and multiple devices:
    // - a client that has seen a different number of turns must resync, not append;
    // - if the last turn is the player's, a reply is still being generated.
    const last = turns.at(-1);
    if (last?.speaker === "player" || last?.speaker === "system") {
      const ageMs = Date.parse(this.env.now()) - Date.parse(last.createdAt);
      if (ageMs < ORPHAN_TURN_MS) throw new GameError(`${npcDef.shortName} is still replying to your last line.`, "conflict");
      // Orphaned by a crash mid-generation: drop it so the scene can continue.
      await this.deps.db.delete(dialogueTurns).where(eq(dialogueTurns.id, last.id));
      turns.pop();
    }
    if (opts.expectedTurnCount !== undefined && opts.expectedTurnCount !== turns.length) {
      throw new GameError("The conversation moved on since you last saw it. Refresh and try again.", "conflict");
    }

    // Canonical transcript: if this line cut the NPC's last line off, keep only
    // what the player heard and re-derive the scene from it BEFORE this line lands.
    let scene = row.scene;
    if (opts.interrupted) scene = (await this.applyDelivery(row, turns, opts.interrupted, state)).scene;
    // A player taking the floor cancels any unspoken NPC reaction.
    if (quest.ensemble) scene = { ...scene, custom: { ...scene.custom, _reaction: null } };

    const playerIdx = turns.length;
    let playerTurn: DialogueTurn;
    try {
      playerTurn = await this.appendTurn(attemptId, playerIdx, "player", cleaned, modality, null);
    } catch (err) {
      // Unique (attempt, idx) violation: another request appended this turn first.
      if (isUniqueViolation(err)) {
        throw new GameError("That line was already sent.", "conflict");
      }
      throw err;
    }
    turns.push(playerTurn);

    let identity: TurnIdentity | undefined;
    let ensembleDirection: string[] = [];
    if (quest.semanticFeatures) {
      const meaning = await readSceneMeaning(this.taskCtx(playerId, attemptId), { text: cleaned, turnIndex: playerIdx, features: quest.semanticFeatures,
        participants: quest.ensemble?.participants.map((p) => p.npcId) ?? [quest.npcId], turns });
      if (meaning.unavailable) {
        await this.deps.db.delete(dialogueTurns).where(eq(dialogueTurns.id, playerTurn.id));
        throw new GameError("The conversation could not be interpreted reliably. Please send that line again.", "ai");
      }
      scene = addSceneEvidence(scene, meaning.evidence);
      if (quest.ensemble) {
        const floor = selectFloor(quest.ensemble, scene, turns, meaning.addressedTo);
        npcDef = getNPC(floor.npcId);
        npc = this.npcForAttempt(row, state, floor.npcId);
        identity = { npcId: npcDef.id, name: npcDef.shortName, addressedTo: floor.addressedTo, kind: floor.kind };
        ensembleDirection = participantDirection(quest.ensemble, floor, scene);
        onSpeech?.("", false, identity);
      }
    }

    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = {
      hidden: row.hidden,
      scene,
      world: this.worldForAttempt(row, state),
      npc,
      playerName: state.displayName,
      difficulty: quest.difficulty,
    };

    // Read the player's words deterministically BEFORE the NPC replies, and let
    // the quest decide what the NPC may do this turn. The NPC is told, so what
    // it says and what the rules allow agree.
    const read = readPlayerUtterance(cleaned);
    let pre: ReturnType<NonNullable<typeof quest.scene.preTurn>> | undefined;
    if (quest.scene.preTurn) {
      try {
        pre = quest.scene.preTurn(sceneCtx, read, cleaned);
        if (pre.custom) sceneCtx.scene = { ...sceneCtx.scene, custom: pre.custom };
      } catch (err) {
        console.error("[orchestrator] preTurn threw", err);
      }
    }
    // Signals ruled out for this line: by the quest's rules, or because the
    // player trailed off mid-thought (hesitation is not an empty or evasive answer).
    const trailedOff = looksIncomplete(cleaned);
    const ruledOut = new Set<PlayerSignal>([...(pre?.dropSignals ?? []), ...(trailedOff ? HESITATION_EXEMPT : [])]);
    read.signals = read.signals.filter((s) => !ruledOut.has(s));
    const direction = [...ensembleDirection, ...(pre?.direction ?? [])];
    if (trailedOff) {
      direction.push(`${state.displayName} trailed off mid-thought. Don't answer a question they haven't finished asking and don't fill in the number for them. A short prompt to go on ("Around what?", "Go on.") is enough.`);
    }
    const cutOff = turns.at(-2);
    if (cutOff?.speaker === "npc" && cutOff.interrupted) {
      direction.push(
        `${state.displayName} cut you off mid-sentence just now; you only got as far as "${cutOff.text || "…"}". Respond to what they said, like someone who was interrupted. Don't repeat the rest of your sentence unless they ask, and don't hold it against them. Anything you were about to offer was NOT offered: the offer on the table is exactly as the director notes say.`,
      );
    }

    let out: NpcTurnOutput;
    try {
      const canonicalSpeech = quest.scene.canonicalSpeech?.(sceneCtx);
      if (canonicalSpeech) {
        out = { speech: canonicalSpeech, raw: canonicalSpeech, moves: { noticed: [], reveal: [], proposal: {}, wantsToEnd: false }, problems: [] };
        onSpeech?.(canonicalSpeech, true, identity);
      } else out = await this.generateGated(
        playerId,
        attemptId,
        quest,
        sceneCtx,
        { quest, npcDef, npcState: npc, sceneCtx, turns, playerName: state.displayName, opening: false, turnDirection: direction },
        onSpeech ? (text, done) => onSpeech(text, done, identity) : undefined,
      );
    } catch (err) {
      // Roll back the player turn so they can retry cleanly.
      await this.deps.db.delete(dialogueTurns).where(eq(dialogueTurns.id, playerTurn.id));
      throw new GameError(err instanceof Error ? err.message : "The character couldn't respond.", "ai");
    }

    // Speech is binding in both directions: a figure in the model's JSON that
    // the character never said out loud is not an offer.
    if (quest.scene.inferMovesFromSpeech) {
      const dropped = dropUnspokenFigures(out.moves, out.speech);
      if (dropped.length) out.problems.push(`unspoken proposals dropped: ${dropped.join(", ")}`);
    }

    // Merge perception: the model's own moves, the deterministic read of the
    // player's words, the quest's pre-turn moves, and what the NPC actually said.
    let moves = mergeMoves(out.moves, { noticed: read.signals, ...(pre?.moves ?? {}), proposal: { ...(pre?.moves?.proposal ?? {}) } });
    if (quest.scene.inferMovesFromSpeech) {
      try {
        const inferred = quest.scene.inferMovesFromSpeech(out.speech, sceneCtx);
        if ((inferred.reveal?.length ?? 0) + Object.keys(inferred.proposal ?? {}).length > 0) out.problems.push(`inferred from speech: ${JSON.stringify(inferred)}`);
        moves = mergeMoves(moves, inferred);
        // What the character said out loud is binding: a figure read from the
        // speech wins over a different figure in the model's structured moves.
        moves = { ...moves, proposal: { ...moves.proposal, ...(inferred.proposal ?? {}) } };
      } catch (err) {
        console.error("[orchestrator] inferMovesFromSpeech threw", err);
      }
    }
    // Last resort for models that under-report AND a line the rules couldn't read.
    if (movesAreEmpty(out.moves) && read.signals.length === 0 && !pre?.moves && cleaned.split(/\s+/).length >= 3) {
      const p = await perceiveMoves(this.taskCtx(playerId, attemptId), { quest, npcDef, sceneCtx, playerText: cleaned, npcSpeech: out.speech, playerName: state.displayName });
      out.problems.push(`perceive fallback used${p.problems.length ? `: ${p.problems.join("; ")}` : ""}`);
      moves = mergeMoves(moves, p.moves);
    }
    // Speech is binding: a character who audibly walks out has ended the conversation.
    if (!moves.wantsToEnd && npcEndsConversation(out.speech)) {
      moves = { ...moves, wantsToEnd: true, endReason: moves.endReason || `${npcDef.shortName} ended the call.` };
      out.problems.push("walk-out inferred from speech");
    }
    // The rules outrank perception: a signal the rules ruled out doesn't count, whoever reported it.
    if (ruledOut.size) moves = { ...moves, noticed: moves.noticed.filter((s) => !ruledOut.has(s)) };
    // Ensemble disclosures are grounded in delivered speech, never the model's reveal claims.
    if (quest.ensemble) moves = { ...moves, reveal: quest.scene.inferMovesFromSpeech?.(out.speech, sceneCtx).reveal ?? [] };
    out.moves = moves;

    const reduced = reduceNpcTurn({ scene: quest.scene, ctx: sceneCtx, moves: out.moves });
    if (quest.ensemble && identity) reduced.scene = scheduleReaction(quest.ensemble, reduced.scene, identity, playerIdx);
    if (reduced.rejectedReveals.length) out.problems.push(`rejected reveals: ${reduced.rejectedReveals.join(",")}`);
    // The scene the reducer ran from is kept with the line, so an interrupted
    // line can be re-reduced on exactly what was heard.
    await this.appendTurn(attemptId, playerIdx + 1, "npc", out.speech, "generated", out.moves, { sceneBefore: sceneCtx.scene, identity });
    await this.deps.db.update(questAttempts).set({ scene: reduced.scene, updatedAt: this.env.now() }).where(eq(questAttempts.id, attemptId));

    const attempt = await this.getAttempt(playerId, attemptId);
    return { attempt, npcText: out.speech };
  }

  /** One optional NPC reaction, requested only after the preceding line was delivered.
   * The player can take the floor instead; no background NPC loop is allowed. */
  async continueEnsemble(playerId: string, attemptId: string, expectedTurnCount: number): Promise<AttemptView> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status !== "active") throw new GameError("The scene has ended.", "state");
    const quest = getQuest(row.questId, this.pinnedProposal(row));
    const turns = await this.loadTurns(attemptId), last = turns.at(-1);
    if (turns.length !== expectedTurnCount || last?.speaker === "system" || last?.speaker === "player") throw new GameError("The conversation moved on.", "conflict");
    const pending = pendingReaction(row.scene);
    if (!quest.ensemble || !pending || last?.index !== pending.sourceTurnIndex || last.interrupted) return this.getAttempt(playerId, attemptId);
    const participant = quest.ensemble.participants.find((p) => p.npcId === pending.npcId);
    if (!participant) throw new GameError("Invalid scene participant.", "state");
    let marker: DialogueTurn;
    try { marker = await this.appendTurn(attemptId, turns.length, "system", "", "generated", null); }
    catch (error) { if (isUniqueViolation(error)) throw new GameError("Someone is already replying.", "conflict"); throw error; }
    try {
      const state = await loadPlayerState(this.deps.db, playerId);
      const npc = this.npcForAttempt(row, state, pending.npcId), npcDef = getNPC(pending.npcId);
      const scene = { ...row.scene, custom: { ...row.scene.custom, _reaction: null } };
      const ctx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene, npc, world: this.worldForAttempt(row, state), playerName: state.displayName, difficulty: quest.difficulty };
      const floor = { npcId: pending.npcId, addressedTo: pending.addressedTo, kind: pending.kind, reason: "Respond briefly to the other participant's last delivered line, then give the player the floor.", pauseForPlayer: true as const };
      const scripted = quest.scene.canonicalSpeech?.(ctx);
      const out = scripted ? { speech: scripted } : await this.generateGated(playerId, attemptId, quest, ctx, { quest, npcDef, npcState: npc, sceneCtx: ctx, turns, playerName: state.displayName, opening: false, turnDirection: participantDirection(quest.ensemble, floor, scene) });
      const moves = { noticed: [], proposal: {}, wantsToEnd: false, reveal: quest.scene.inferMovesFromSpeech?.(out.speech, ctx).reveal ?? [] };
      const reduced = reduceNpcTurn({ scene: quest.scene, ctx, moves }).scene;
      Object.assign(reduced, { turnCount: scene.turnCount, patience: scene.patience, signalCounts: scene.signalCounts, ended: scene.ended });
      const identity: TurnIdentity = { npcId: pending.npcId, name: pending.name, addressedTo: pending.addressedTo, kind: pending.kind, autonomous: true };
      await this.deps.db.transaction(async (tx) => {
        await tx.update(dialogueTurns).set({ speaker: "npc", text: out.speech, moves, identity, sceneBefore: scene }).where(eq(dialogueTurns.id, marker.id));
        await tx.update(questAttempts).set({ scene: reduced, updatedAt: this.env.now() }).where(eq(questAttempts.id, attemptId));
      });
      return this.getAttempt(playerId, attemptId);
    } catch (error) { await this.deps.db.delete(dialogueTurns).where(eq(dialogueTurns.id, marker.id)); throw error; }
  }

  // ---------------------------------------------------------------- speech gate & delivery

  /**
   * Generate an NPC line through the quest's speech gate. Only gated sentences
   * are streamed, spoken and recorded, so the audible line, the caption, the
   * transcript and the scene rules all read the same text.
   */
  private async generateGated(
    playerId: string,
    attemptId: string,
    quest: AnyQuestDefinition,
    sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>,
    input: NpcTurnInput,
    onSpeech?: (speechSoFar: string, done: boolean) => void,
  ): Promise<NpcTurnOutput> {
    // Sentences the character already said in this conversation: saying one again is a
    // chatbot tell ("Hi." → the whole opening again), so the gate drops it.
    const said = input.turns.filter((t) => t.speaker === "npc" && t.text).flatMap((t) => splitSentences(t.text)).filter((x) => x.split(/\s+/).length >= 5);
    let repeats = 0;
    const makeGate = () =>
      new SpeechGate(
        (sentence) => {
          if (sentence.split(/\s+/).length >= 5 && said.some((x) => textSimilarity(x, sentence) >= REPEAT_SIMILARITY)) {
            repeats += 1;
            return { ok: false, reason: "repeated an earlier line", rewrite: null };
          }
          try {
            return quest.scene.speechGate?.(sentence, sceneCtx) ?? { ok: true };
          } catch (err) {
            console.error("[orchestrator] speechGate threw", err);
            return { ok: true };
          }
        },
        // Spoken lines stay short: the prompt asks for one to three sentences; this is the hard stop.
        { maxSentences: MAX_SPOKEN_SENTENCES },
      );
    let gate = makeGate();
    let lastSent = "";
    const emit = (done: boolean) => {
      if (!onSpeech) return;
      if (gate.text !== lastSent || done) {
        lastSent = gate.text;
        onSpeech(gate.text, done);
      }
    };
    const run = async (turnInput: NpcTurnInput) => {
      const o = await generateNpcTurn(this.taskCtx(playerId, attemptId), turnInput, (speechSoFar, done) => {
        gate.push(speechSoFar, done);
        if (!done) emit(false);
      });
      gate.push(o.speech, true);
      return o;
    };
    let out = await run(input);
    const problems = [...out.problems, ...gate.problems];
    // Everything was a repeat: nothing has been sent yet, so ask once more, directly.
    if (!gate.text.trim() && repeats > 0 && !input.opening) {
      const first = gate;
      gate = makeGate();
      out = await run({ ...input, turnDirection: [...(input.turnDirection ?? []), "You were about to repeat something you already said. Don't. Answer their last line directly, in one short sentence, with something new."] });
      problems.push("regenerated: reply only repeated earlier lines", ...gate.problems.filter((p) => !first.problems.includes(p)));
    }
    out.problems = problems;
    if (!gate.text.trim()) out.problems.push("speech gate removed every sentence; using hold line");
    out.speech = gate.text.trim() || HOLD_LINE;
    emit(true);
    if (gate.violations) {
      await this.deps.analytics.track(playerId, "npc_speech_gated", { attemptId, questId: quest.id, violations: gate.violations, reasons: gate.problems.slice(0, 5) });
    }
    return out;
  }

  /**
   * The player cut the NPC's last line off and did not follow with a line of
   * their own. Records the heard prefix as canon. Idempotent; a stale report
   * (a newer line exists) is ignored.
   */
  async reportDelivery(playerId: string, attemptId: string, report: DeliveryReport): Promise<AttemptView> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status === "active") {
      const turns = await this.loadTurns(attemptId);
      await this.applyDelivery(row, turns, report);
    }
    return this.getAttempt(playerId, attemptId);
  }

  /**
   * Truncate the last NPC line to what was actually heard and re-derive the
   * scene from that. Mutates `turns` in place so callers continue with canon.
   */
  private async applyDelivery(
    row: { id: string; playerId: string; questId: string; npcId: string; hidden: Record<string, unknown>; scene: SceneState; snapshotBefore: Record<string, unknown> },
    turns: DialogueTurn[],
    report: DeliveryReport,
    knownState?: PlayerState,
  ): Promise<{ scene: SceneState; applied: boolean }> {
    const last = turns.at(-1);
    if (!last || last.speaker !== "npc" || last.index !== report.turnIndex || last.interrupted) return { scene: row.scene, applied: false };
    const generated = last.text;
    const heard = heardPrefix(generated, report.heardText);
    if (normalizeSpoken(heard) === normalizeSpoken(generated)) return { scene: row.scene, applied: false };

    const quest = getQuest(row.questId, this.pinnedProposal(row));
    const turnRow = await this.deps.db.query.dialogueTurns.findFirst({ where: eq(dialogueTurns.id, last.id) });
    const sceneBefore = turnRow?.sceneBefore ?? null;
    let scene = row.scene;
    let moves = last.moves;
    if (sceneBefore && moves) {
      const state = knownState ?? (await loadPlayerState(this.deps.db, row.playerId));
      const npc = this.npcForAttempt(row, state, last.identity?.npcId);
      const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene: sceneBefore, world: this.worldForAttempt(row, state), npc, playerName: state.displayName, difficulty: quest.difficulty };
      moves = movesForHeardSpeech(moves, heard, quest.scene, sceneCtx);
      if (quest.ensemble) moves = { ...moves, reveal: quest.scene.inferMovesFromSpeech?.(heard, sceneCtx).reveal ?? [] };
      scene = reduceNpcTurn({ scene: quest.scene, ctx: sceneCtx, moves }).scene;
      if (quest.ensemble) scene.custom._reaction = null;
      if (last.identity?.autonomous) Object.assign(scene, { turnCount: sceneBefore.turnCount, patience: sceneBefore.patience, signalCounts: sceneBefore.signalCounts, ended: sceneBefore.ended });
    }
    const now = this.env.now();
    await this.deps.db.transaction(async (tx) => {
      await tx.update(dialogueTurns).set({ text: heard, interrupted: true, generatedText: generated, moves }).where(eq(dialogueTurns.id, last.id));
      await tx.update(questAttempts).set({ scene, updatedAt: now }).where(eq(questAttempts.id, row.id));
    });
    last.text = heard;
    last.interrupted = true;
    last.generatedText = generated;
    last.moves = moves;
    row.scene = scene;
    await this.deps.analytics.track(row.playerId, "npc_interrupted", { attemptId: row.id, turnIndex: last.index, heardChars: heard.length, generatedChars: generated.length });
    return { scene, applied: true };
  }

  // ---------------------------------------------------------------- conclude

  /** End the scene (by the player, or because the scene already ended) and resolve everything. */
  async concludeQuest(playerId: string, attemptId: string, onProgress?: (stage: ConcludeStage) => void): Promise<AttemptView> {
    const row = await this.requireAttempt(playerId, attemptId);
    if (row.status === "completed") return this.getAttempt(playerId, attemptId);
    if (row.status !== "active" && row.status !== "evaluating") throw new GameError("This conversation was abandoned.", "state");
    const quest = getQuest(row.questId, this.pinnedProposal(row));
    const npcDef = getNPC(row.npcId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const mode = ((row.snapshotBefore.mode as AttemptMode | undefined) ?? "first") as AttemptMode;
    const rehearsal = mode === "rehearsal";
    const npc = this.npcForAttempt(row, state);
    const turns = await this.loadTurns(attemptId);
    const playerTurns = turns.filter((t) => t.speaker === "player").length;
    if (turns.at(-1)?.speaker === "system" || turns.at(-1)?.speaker === "player") throw new GameError("Wait for the current reply before concluding.", "conflict");
    if (playerTurns === 0) throw new GameError("Say at least one thing before concluding.", "state");

    const scene = row.scene.ended ? row.scene : endSceneByPlayer(row.scene);

    // Claim the attempt atomically so concurrent or retried concludes (common on
    // mobile: a 60-120 s request times out and the app retries) can't evaluate
    // twice and apply rewards/consequences twice. A claim older than
    // EVALUATION_STALE_MS is presumed dead (server crashed) and may be re-claimed.
    const staleBefore = new Date(Date.parse(this.env.now()) - EVALUATION_STALE_MS).toISOString();
    const evaluationClaimAt = this.env.now();
    const claim = await this.deps.db
      .update(questAttempts)
      .set({ status: "evaluating", scene, updatedAt: evaluationClaimAt })
      .where(and(eq(questAttempts.id, attemptId), or(eq(questAttempts.status, "active"), and(eq(questAttempts.status, "evaluating"), lt(questAttempts.updatedAt, staleBefore)))));
    if (claim.rowsAffected !== 1) {
      throw new GameError("Still weighing how that went. Check back in a moment.", "conflict");
    }

    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene, world: this.worldForAttempt(row, state), npc, playerName: state.displayName, difficulty: quest.difficulty };

    // 1. Evaluation and memory extraction are independent AI tasks: run them in
    //    parallel (the NPC's memory is written from the transcript + final scene,
    //    not from the evaluator's opinion). Rehearsals don't touch memory.
    const safeProgress = (stage: ConcludeStage) => {
      try {
        onProgress?.(stage);
      } catch {
        /* a disconnected listener must not break the conclusion */
      }
    };
    safeProgress("reviewing");
    const memoryPromise = rehearsal
      ? Promise.resolve(null)
      : extractMemory(this.taskCtx(playerId, attemptId), { quest, npcDef, sceneCtx, turns, playerName: state.displayName })
          .then((r) => {
            safeProgress("remembering");
            return r.extraction;
          })
          .catch((err) => {
            console.error("[orchestrator] memory extraction failed; continuing with scripted memory only", err);
            return null;
          });
    let evaluation: Evaluation;
    try {
      evaluation = (await evaluateConversation(this.taskCtx(playerId, attemptId), { quest, npcDef, sceneCtx, turns, playerName: state.displayName })).evaluation;
      safeProgress("evaluated");
    } catch (err) {
      await this.deps.db.update(questAttempts).set({ status: "active", updatedAt: this.env.now() }).where(and(eq(questAttempts.id, attemptId), eq(questAttempts.status, "evaluating"), eq(questAttempts.updatedAt, evaluationClaimAt)));
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
      // Rehearsals are real practice, so skills still move, at half the XP.
      outcomeMultiplier: outcome.rewardMultiplier * (rehearsal ? 0.5 : 1),
      now: this.env.now(),
    });

    // 4. Memory merge (deterministic). Failure of extraction must not lose the result.
    const liveNpc = getOrCreateNpcState(state, row.npcId);
    let memory = liveNpc.memory;
    if (!rehearsal) {
      const extraction = await memoryPromise;
      if (extraction) memory = mergeMemory(memory, extraction, { questId: quest.id, attemptId, env: this.env });
      else memory = { ...memory, lastInteractionSummary: `Our conversation (${quest.title}) ended: ${outcome.label.toLowerCase()}.`, lastInteractionAt: this.env.now() };
    }
    safeProgress("applying");

    // 5. Consequences. Rehearsals change skills only; the world keeps what really happened.
    const consequences: Consequence[] = rehearsal ? [] : [{ type: "world.person.met", npcId: npc.npcId }, ...outcome.consequences(outcomeCtx)];
    // Commitments the NPC memory extracted from the player become world commitments too.
    for (const c of rehearsal ? [] : memory.commitments) {
      if (c.by === "player" && c.status === "open" && c.questId === quest.id && !state.world.commitments.some((w) => w.description === c.description)) {
        consequences.push({ type: "world.commitment.add", description: c.description, toNpcId: npc.npcId, dueBy: c.dueBy });
      }
    }
    let world = state.world;
    const { world: newWorld, applied } = applyConsequences(world, consequences, { questId: quest.id, env: this.env });
    world = rehearsal ? state.world : recordQuestCompletion(newWorld, { questId: quest.id, attemptId, outcomeId: outcome.id, grade: outcome.grade, at: this.env.now() });

    const relationshipBefore = { ...liveNpc.relationship };
    const touchedNpcs: Record<string, NPCInstanceState> = rehearsal ? {} : { [npc.npcId]: { ...liveNpc, memory } };
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
    // Each witness remembers the shared, canonical transcript through their own perspective.
    if (!rehearsal && quest.ensemble) {
      const others = await Promise.all(quest.ensemble.participants.filter((p) => p.npcId !== npc.npcId).map(async (p) => {
        const own = touchedNpcs[p.npcId] ?? { ...getOrCreateNpcState(state, p.npcId) };
        try {
          const extracted = await extractMemory(this.taskCtx(playerId, attemptId), { quest, npcDef: getNPC(p.npcId), sceneCtx: { ...sceneCtx, npc: own }, turns, playerName: state.displayName });
          own.memory = mergeMemory(own.memory, extracted.extraction, { questId: quest.id, attemptId, env: this.env });
        } catch { own.memory = { ...own.memory, lastInteractionSummary: `I witnessed ${quest.title}: ${outcome.label}.`, lastInteractionAt: this.env.now() }; }
        own.timesMet += 1;
        return own;
      }));
      for (const own of others) { touchedNpcs[own.npcId] = own; if (!world.peopleMet.includes(own.npcId)) world.peopleMet.push(own.npcId); }
    }
    if (touchedNpcs[npc.npcId]) touchedNpcs[npc.npcId].timesMet += 1;

    // Narrative state is reduced from canonical evidence, then a proposal is validated.
    // The provider has no reference to the database and cannot supply consequences.
    if (!rehearsal) {
      const signals: Record<string, number> = {};
      for (const turn of turns.filter((t) => t.speaker === "player")) for (const signal of readPlayerUtterance(turn.text).signals) signals[signal] = (signals[signal] ?? 0) + 1;
      const npcs = { ...state.npcs, ...touchedNpcs };
      world = advanceContinuity({ world, competencies: comp.profile, npcs }, {
        attemptId, questId: quest.id, npcId: npc.npcId, grade: outcome.grade, difficulty: quest.difficulty,
        variant: this.pinnedProposal(row)?.variant ?? null, signals,
        observations: evaluation.behaviors.filter((b) => isValidFacet(b.skill, b.facet)).map(({ skill, facet, score }) => ({ skill, facet, score })),
      });
      world = advanceCampaign(world, { quest, attemptId, outcomeId: outcome.id, grade: outcome.grade, label: outcome.label, setback: outcome.setback,
        recoveryTarget: typeof row.hidden.target === "string" ? row.hidden.target : null, beforeSkills: state.competencies, skills: comp.profile, npcs });
      for (const [index, consequence] of consequences.entries()) {
        if (consequence.type !== "npc.memory.event" || consequence.npcId === quest.npcId || quest.ensemble?.participants.some((p) => p.npcId === consequence.npcId)) continue;
        const factId = `authored:${attemptId}:${index}`;
        world.campaign.information.push({ id: factId, ownerId: quest.npcId, visibility: "shared", audience: [], sourceAttemptId: attemptId, sourceQuestId: quest.id, summary: consequence.summary });
        world = communicate(world, { id: `route:${factId}`, factId, from: quest.npcId, to: consequence.npcId, sourceAttemptId: attemptId, kind: consequence.emotionalTone === "positive" ? "recommendation" : "warning", reason: consequence.emotionalTone === "positive" ? `${getNPC(quest.npcId).shortName} spoke well of you to ${getNPC(consequence.npcId).shortName}.` : consequence.emotionalTone === "negative" ? `${getNPC(quest.npcId).shortName} told ${getNPC(consequence.npcId).shortName} it didn't go well.` : `${getNPC(quest.npcId).shortName} told ${getNPC(consequence.npcId).shortName} how it went.` });
      }
      // New communications become a recipient's memory only after an explicit authorized route.
      for (const communication of world.campaign.communications.filter((c) => c.sourceAttemptId === attemptId)) {
        if (communication.id.startsWith("route:authored:")) continue; // already applied as an authored memory consequence above
        const fact = world.campaign.information.find((f) => f.id === communication.factId)!;
        const recipient = touchedNpcs[communication.to] ?? { ...getOrCreateNpcState(state, communication.to) };
        recipient.memory = { ...recipient.memory, events: [...recipient.memory.events, { id: communication.id, questId: quest.id, attemptId, summary: `${getNPC(communication.from).shortName} shared: ${fact.summary}`, importance: 0.7, emotionalTone: communication.kind === "recommendation" ? "positive" : "neutral", at: this.env.now() }] };
        touchedNpcs[communication.to] = recipient;
        npcs[communication.to] = recipient;
      }
      const ctx = { world, competencies: comp.profile, npcs };
      const plan = await proposeNextEvent(this.taskCtx(playerId, attemptId), ctx);
      world = applyDirectorPlan(ctx, plan);
    }

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
      consequencesApplied: applied.filter((a) => a.changed).map((a) => ({ type: a.consequence.type, description: a.description, consequence: a.consequence })),
      aftermath: rehearsal ? [] : safeLines(() => outcome.aftermath?.(outcomeCtx) ?? []),
      mode,
      comparison: null,
      shareCard: buildShareCard(quest, sceneCtx, evaluation, comp.xpAwards, levelsBefore, state.competencies, comp.profile),
    };
    if (!rehearsal && world.director.recommended?.template !== "curated" && world.director.recommended) {
      result.aftermath.push(`${world.director.recommended.title}: ${world.director.recommended.whyNow}`);
      result.rewards.followUpQuestIds = [...new Set([world.director.recommended.questId, ...result.rewards.followUpQuestIds])];
    }
    if (mode !== "first") result.comparison = await this.compareWithPrevious(playerId, quest.id, attemptId, result, evaluation);

    // All persistent effects of the conclusion commit together, or not at all.
    const now = this.env.now();
    try {
      await this.deps.db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const fresh = await t.query.worldStates.findFirst({ where: eq(worldStates.playerId, playerId) });
        const owned = await t.query.questAttempts.findFirst({ where: eq(questAttempts.id, attemptId) });
        if (owned?.status !== "evaluating" || owned.updatedAt !== evaluationClaimAt) throw new GameError("Another request is handling this debrief.", "conflict");
        if (fresh?.version !== state.world.version) throw new GameError("Your story changed while this result was being prepared. Retry the debrief.", "conflict");
        if (!rehearsal) await saveWorldState(t, playerId, world);
        await saveCompetencies(t, playerId, comp.profile);
        for (const n of Object.values(touchedNpcs)) await saveNpcState(t, playerId, n);
        await t.update(questAttempts).set({ status: "completed", scene, evaluation, result, endedAt: now, updatedAt: now }).where(eq(questAttempts.id, attemptId));
      });
    } catch (err) {
      if (err instanceof GameError && err.code === "conflict") await this.deps.db.update(questAttempts).set({ status: "active", updatedAt: this.env.now() }).where(and(eq(questAttempts.id, attemptId), eq(questAttempts.status, "evaluating"), eq(questAttempts.updatedAt, evaluationClaimAt)));
      throw err;
    }

    // 7. Events.
    const a = this.deps.analytics;
    await a.track(playerId, outcome.grade === "failure" ? "quest_failed" : "quest_completed", { questId: quest.id, attemptId, outcomeId: outcome.id, score: evaluation.overallScore, turns: playerTurns, mode });
    for (const x of comp.xpAwards) {
      await a.track(playerId, "player.xp_gained", { skill: x.skill, xp: x.xp });
      if (x.levelAfter > x.levelBefore) await a.track(playerId, "player.level_up", { skill: x.skill, level: x.levelAfter });
    }
    for (const d of comp.discovered) await a.track(playerId, "player.facet_discovered", d);
    for (const n of Object.values(touchedNpcs)) {
      const before = n.npcId === npc.npcId ? relationshipBefore : state.npcs[n.npcId]?.relationship ?? n.relationship;
      await a.track(playerId, "npc.relationship_changed", { npcId: n.npcId, delta: diffRelationship(before, n.relationship) });
    }
    if (!rehearsal) await a.track(playerId, "npc.memory_updated", { npcId: npc.npcId, facts: memory.facts.length, beliefs: memory.beliefs.length, events: memory.events.length });
    for (const ap of applied.filter((x) => x.changed)) await a.track(playerId, "world.consequence_applied", { questId: quest.id, type: ap.consequence.type, description: ap.description });

    safeProgress("done");
    return this.getAttempt(playerId, attemptId);
  }

  /** Compare a replay with the most recent earlier completed run of the same quest. */
  private async compareWithPrevious(playerId: string, questId: string, attemptId: string, result: QuestResult, evaluation: Evaluation): Promise<QuestResult["comparison"]> {
    const prev = await this.deps.db.query.questAttempts.findFirst({
      where: and(eq(questAttempts.playerId, playerId), eq(questAttempts.questId, questId), eq(questAttempts.status, "completed"), ne(questAttempts.id, attemptId)),
      orderBy: desc(questAttempts.endedAt),
    });
    if (!prev?.result || !prev.evaluation) return null;
    const prevLines = new Map(prev.result.shareCard.lines.map((l) => [l.label, l.after]));
    const lines = result.shareCard.lines.map((l) => ({ label: l.label, previous: prevLines.get(l.label) ?? "—", now: l.after }));
    const improved =
      GRADE_RANK[result.grade] > GRADE_RANK[prev.result.grade] ||
      (GRADE_RANK[result.grade] === GRADE_RANK[prev.result.grade] && evaluation.overallScore > prev.evaluation.overallScore);
    return {
      previousOutcomeLabel: prev.result.outcomeLabel,
      previousGrade: prev.result.grade,
      previousScore: prev.evaluation.overallScore,
      score: evaluation.overallScore,
      lines,
      improved,
    };
  }

  /** The NPC as this attempt sees them: rehearsals replay against the NPC as they were at the canonical run. */
  private npcForAttempt(row: { npcId: string; snapshotBefore: Record<string, unknown> }, state: PlayerState, participantId?: string): NPCInstanceState {
    const id = participantId ?? row.npcId;
    const live = getOrCreateNpcState(state, id);
    const participant = (row.snapshotBefore.participants as Record<string, NPCInstanceState> | undefined)?.[id];
    if (row.snapshotBefore.mode === "rehearsal" && participant) return structuredClone(participant);
    if (id !== row.npcId) return live;
    const snap = row.snapshotBefore.npcState as { relationship: Relationship; memory: unknown } | undefined;
    if (row.snapshotBefore.mode === "rehearsal" && snap) return { ...live, relationship: snap.relationship, memory: NPCMemorySchema.parse(snap.memory) };
    return live;
  }

  private pinnedProposal(row: { snapshotBefore: Record<string, unknown> }): DirectorProposal | undefined {
    const raw = row.snapshotBefore.directorProposal;
    return raw ? DirectorProposalSchema.parse(raw) : undefined;
  }

  private worldForAttempt(row: { snapshotBefore: Record<string, unknown> }, state: PlayerState) {
    return row.snapshotBefore.mode === "rehearsal" && row.snapshotBefore.world ? WorldStateSchema.parse(row.snapshotBefore.world) : state.world;
  }

  /** Authenticated commands call this; GET read models never spend tokens or change the story. */
  async refreshDirector(playerId: string, preferences?: unknown) {
    const parsed = preferences === undefined ? undefined : PreferencesSchema.safeParse(preferences);
    if (parsed && !parsed.success) throw new GameError("Choose up to three supported goals and a valid upcoming focus.", "state");
    const state = await loadPlayerState(this.deps.db, playerId);
    const inFlight = await this.deps.db.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), or(eq(questAttempts.status, "active"), eq(questAttempts.status, "evaluating"))) });
    if (inFlight) throw new GameError("Finish or leave the current conversation before changing your next event.", "conflict");
    if (!parsed && state.world.director.recommended) return state.world.director;
    const world = reconcileCampaign(state.world);
    if (parsed?.success) world.director.preferences = parsed.data;
    const ctx = { ...state, world };
    // Preference edits use the immediate deterministic planner; no model cost on every checkbox.
    const plan = parsed ? planDirector(ctx) : await proposeNextEvent(this.taskCtx(playerId), ctx);
    const next = applyDirectorPlan(ctx, plan);
    next.version += 1;
    await this.deps.db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      const fresh = await t.query.worldStates.findFirst({ where: eq(worldStates.playerId, playerId) });
      const active = await t.query.questAttempts.findFirst({ where: and(eq(questAttempts.playerId, playerId), or(eq(questAttempts.status, "active"), eq(questAttempts.status, "evaluating"))) });
      if (fresh?.version !== state.world.version || active) throw new GameError("Your story changed. Try again after the current conversation.", "conflict");
      await saveWorldState(t, playerId, next);
    });
    return next.director;
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
    const quest = getQuest(row.questId, this.pinnedProposal(row));
    const turns = await this.loadTurns(attemptId);
    const state = await loadPlayerState(this.deps.db, playerId);
    const npc = this.npcForAttempt(row, state);
    const sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>> = { hidden: row.hidden, scene: row.scene, world: this.worldForAttempt(row, state), npc, playerName: state.displayName, difficulty: quest.difficulty };
    return {
      directorProposal: this.pinnedProposal(row),
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
      mode: ((row.snapshotBefore.mode as AttemptMode | undefined) ?? "first") as AttemptMode,
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
    return rows.map((r) => ({
      id: r.id,
      index: r.idx,
      speaker: r.speaker,
      ...(r.identity ? { identity: r.identity } : {}),
      text: r.text,
      modality: r.modality,
      moves: r.moves ?? null,
      createdAt: r.createdAt,
      ...(r.interrupted ? { interrupted: true, generatedText: r.generatedText ?? null } : {}),
    }));
  }

  private async appendTurn(
    attemptId: string,
    idx: number,
    speaker: DialogueTurn["speaker"],
    text: string,
    modality: DialogueTurn["modality"],
    moves: DialogueTurn["moves"],
    extra: { sceneBefore?: SceneState | null; identity?: TurnIdentity } = {},
  ): Promise<DialogueTurn> {
    const turn: DialogueTurn = { id: this.env.id(), index: idx, speaker, text, modality, moves, createdAt: this.env.now(), ...(extra.identity ? { identity: extra.identity } : {}) };
    await this.deps.db.insert(dialogueTurns).values({ id: turn.id, attemptId, idx, speaker, text, modality, moves, identity: extra.identity ?? null, createdAt: turn.createdAt, sceneBefore: extra.sceneBefore ?? null });
    return turn;
  }
}

function safeLines(fn: () => string[]): string[] {
  try {
    return fn().filter(Boolean);
  } catch (err) {
    console.error("[orchestrator] aftermath threw", err);
    return [];
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
