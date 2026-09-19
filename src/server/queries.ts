/**
 * Read-side service: builds the public API DTOs (src/contracts/api.ts) from
 * persistent game state. Used by BOTH the web server components and the
 * /api/v1 JSON routes, so web and native clients see identical data.
 *
 * Nothing here may leak hidden NPC state.
 */
import { NPCS } from "@/content/npcs";
import { CAMPAIGN, campaignProgress, chapterIndex } from "@/content/campaign";
import { QUESTS, findQuest } from "@/content/quests";
import { getLocation, getWorld } from "@/content/worlds";
import { relationshipLabel } from "@/engine/relationships";
import type { Consequence } from "@/engine/types/consequences";
import { SKILLS, type SkillId } from "@/engine/types/skills";
import { formatINR } from "@/engine/util";
import { checkPrerequisites } from "@/engine/world";
import type {
  ActiveAttemptRefSchema,
  AttemptEnvelope,
  ClientAttempt,
  Debrief,
  Dossier,
  QuestBriefingView,
  SceneInfo,
  WorldOverview,
} from "@/contracts/api";
import type { z } from "zod";
import { buildDossier, buildInsight, buildQuestCards, buildSkillViews, buildWorldCards, describeConsequenceForPlayer } from "./game-view";
import { GameError, type AttemptView, type GameService } from "./orchestrator";
import type { PlayerState } from "./player";

// ---------------------------------------------------------------- attempt

export function toClientAttempt(a: AttemptView): ClientAttempt {
  const quest = findQuest(a.questId);
  return {
    id: a.id,
    questId: a.questId,
    npcId: a.npcId,
    status: a.status,
    turns: a.turns.map((t) => ({ id: t.id, index: t.index, speaker: t.speaker, text: t.text, ...(t.interrupted ? { interrupted: true } : {}) })),
    visibleStatus: a.visibleStatus,
    mood: a.scene.stance,
    ended: a.scene.ended,
    turnCount: a.scene.turnCount,
    maxTurns: quest?.scene.maxTurns ?? 12,
    mode: a.mode,
  };
}

export function sceneInfo(questId: string, npcId: string): SceneInfo {
  const quest = findQuest(questId);
  const npc = NPCS[npcId];
  if (!quest || !npc) throw new GameError("Unknown quest or character", "not_found");
  return {
    quest: { id: quest.id, title: quest.title, objective: quest.briefing.objective, locationName: getLocation(quest.locationId)?.name ?? "", minTurns: quest.scene.minTurns },
    npc: { id: npc.id, name: npc.name, shortName: npc.shortName, role: npc.role, organisation: npc.organisation, appearance: npc.appearance, voice: npc.voice },
  };
}

export function attemptEnvelope(a: AttemptView): AttemptEnvelope {
  return { attempt: toClientAttempt(a), scene: sceneInfo(a.questId, a.npcId) };
}

// ---------------------------------------------------------------- world

function careerLabel(state: PlayerState): string {
  const c = state.world.career;
  if (c.status === "employed" && c.employer) return `${c.role ?? "Working"} at ${c.employer}${c.baseSalary ? ` · ${formatINR(c.baseSalary)}` : ""}`;
  if (c.status === "offer_received") return "Offer on the table from Nova Labs";
  if (c.status === "interviewing") return "Interviewing with Nova Labs";
  if (state.world.flags.includes("nova_labs.offer_withdrawn")) return "Nova Labs withdrew the offer";
  return "Between things";
}

export async function worldOverview(game: GameService, playerId: string): Promise<WorldOverview> {
  const state = await game.getPlayerState(playerId);
  const active = await game.getActiveAttempt(playerId);
  let activeAttempt: z.infer<typeof ActiveAttemptRefSchema> | null = null;
  if (active) {
    activeAttempt = { attemptId: active.id, questId: active.questId, questTitle: findQuest(active.questId)?.title ?? active.questId, npcShortName: NPCS[active.npcId]?.shortName ?? active.npcId };
  }
  const c = state.world.career;
  return {
    player: { playerId: state.playerId, displayName: state.displayName, onboardingCompleted: state.onboardingCompleted },
    career: { status: c.status, employer: c.employer, role: c.role, baseSalary: c.baseSalary, signingBonus: c.signingBonus, label: careerLabel(state) },
    worlds: buildWorldCards(state),
    skills: buildSkillViews(state),
    insight: buildInsight(state).sentence,
    people: Object.values(state.npcs)
      .filter((n) => n.timesMet > 0 || state.world.peopleMet.includes(n.npcId))
      .filter((n) => !!NPCS[n.npcId])
      .map((n) => ({ npcId: n.npcId, name: NPCS[n.npcId].name, role: NPCS[n.npcId].role, appearance: NPCS[n.npcId].appearance, standing: relationshipLabel(n.relationship) })),
    openCommitments: state.world.commitments
      .filter((x) => x.status === "open")
      .map((x) => ({ id: x.id, description: x.description, toNpcName: NPCS[x.toNpcId]?.shortName ?? x.toNpcId })),
    activeAttempt,
    campaign: campaignProgress(state.world),
    story: [...state.world.decisions].reverse().slice(0, 5).map((d) => d.description),
    stateVersion: state.world.version,
  };
}

// ---------------------------------------------------------------- dossier

export function dossierView(state: PlayerState, npcId: string): Dossier {
  const d = buildDossier(state, npcId);
  if (!d) throw new GameError("Unknown character", "not_found");
  const world = getWorld(d.worldId);
  const history = [...state.world.completedQuests, ...state.world.failedQuests]
    .filter((h) => findQuest(h.questId)?.npcId === npcId)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((h) => {
      const q = findQuest(h.questId);
      return { attemptId: h.attemptId, questId: h.questId, questTitle: q?.title ?? h.questId, outcomeLabel: q?.outcomes.find((o) => o.id === h.outcomeId)?.label ?? h.outcomeId };
    });
  return { ...d, worldName: world?.name ?? null, worldAccent: world?.accent ?? null, history };
}

export async function dossier(game: GameService, playerId: string, npcId: string): Promise<Dossier> {
  return dossierView(await game.getPlayerState(playerId), npcId);
}

// ---------------------------------------------------------------- briefing

export async function questBriefing(game: GameService, playerId: string, questId: string): Promise<QuestBriefingView> {
  const quest = findQuest(questId);
  if (!quest) throw new GameError("Unknown quest", "not_found");
  const state = await game.getPlayerState(playerId);
  const card = buildQuestCards(state).find((c) => c.id === questId)!;
  const prereq = checkPrerequisites(quest.prerequisites, { world: state.world, competencies: state.competencies, npcs: state.npcs });
  const previous = [...state.world.completedQuests, ...state.world.failedQuests].filter((q) => q.questId === quest.id).sort((a, b) => a.at.localeCompare(b.at));
  const last = previous.at(-1);
  const world = getWorld(quest.worldId);
  return {
    id: quest.id,
    title: quest.title,
    tagline: quest.tagline,
    worldName: world?.name ?? null,
    worldAccent: world?.accent ?? null,
    locationName: getLocation(quest.locationId)?.name ?? null,
    difficulty: quest.difficulty,
    skills: quest.skills.map((s) => ({ id: s, label: SKILLS[s].label })),
    briefing: quest.briefing,
    canStart: prereq.ok,
    unmet: card.unmet,
    lastOutcomeLabel: last ? (quest.outcomes.find((o) => o.id === last.outcomeId)?.label ?? null) : null,
    npc: dossierView(state, quest.npcId),
    carryOver: safeCarryOver(quest, state),
    replayMode: state.world.completedQuests.some((q) => q.questId === quest.id) ? "rehearsal" : state.world.failedQuests.some((q) => q.questId === quest.id) ? "second_chance" : "first",
    chapter: chapterIndex(quest.id) ? { index: chapterIndex(quest.id)!, total: CAMPAIGN.chapters.length, title: CAMPAIGN.title } : null,
  };
}

// ---------------------------------------------------------------- debrief

export async function debrief(game: GameService, playerId: string, attemptId: string): Promise<Debrief> {
  const attempt = await game.getAttempt(playerId, attemptId);
  if (attempt.status !== "completed" || !attempt.result || !attempt.evaluation) throw new GameError("This conversation hasn't been concluded yet.", "state");
  const quest = findQuest(attempt.questId);
  const npc = NPCS[attempt.npcId];
  if (!quest || !npc) throw new GameError("Unknown quest or character", "not_found");
  const state = await game.getPlayerState(playerId);
  const cards = buildQuestCards(state);
  const result = attempt.result;
  const followUps = result.rewards.followUpQuestIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const next = followUps[0] ?? cards.find((c) => c.isNext) ?? cards.find((c) => c.availability === "available") ?? null;
  const achieved = new Set(result.objectivesAchieved);
  const worldChanges = (result.consequencesApplied as { consequence?: Consequence; description: string }[])
    .map((c) => (c.consequence ? describeConsequenceForPlayer(c.consequence) : c.description))
    .filter((s): s is string => !!s);
  return {
    attemptId: attempt.id,
    quest: { id: quest.id, title: quest.title },
    npc: { id: npc.id, name: npc.name, shortName: npc.shortName, appearance: npc.appearance },
    outcomeId: result.outcomeId,
    outcomeLabel: result.outcomeLabel,
    grade: result.grade,
    narrative: result.narrative,
    objectives: quest.objectives.map((o) => ({ id: o.id, label: o.label, kind: o.kind, achieved: achieved.has(o.id) })),
    rewards: result.rewards,
    evaluation: attempt.evaluation,
    worldChanges,
    shareCard: result.shareCard,
    skillLabels: Object.fromEntries((Object.keys(SKILLS) as SkillId[]).map((k) => [k, SKILLS[k].label])),
    playerTurnTexts: Object.fromEntries(attempt.turns.filter((t) => t.speaker === "player").map((t) => [String(t.index), t.text])),
    nextQuest: next ? { id: next.id, title: next.title, tagline: next.tagline, npcName: next.npcName, isFollowUp: followUps.length > 0 } : null,
    aftermath: result.aftermath ?? [],
    mode: result.mode ?? "first",
    comparison: result.comparison ?? null,
    chapter: chapterIndex(quest.id)
      ? { index: chapterIndex(quest.id)!, total: CAMPAIGN.chapters.length, title: CAMPAIGN.title, finished: campaignProgress(state.world).finished }
      : null,
  };
}

function safeCarryOver(quest: NonNullable<ReturnType<typeof findQuest>>, state: PlayerState): string[] {
  try {
    return quest.carryOver?.({ world: state.world, competencies: state.competencies, npcs: state.npcs }) ?? [];
  } catch (err) {
    console.error("[queries] carryOver threw", err);
    return [];
  }
}

/** Quest ids in display order, for clients that want a flat list. */
export function questIds(): string[] {
  return QUESTS.map((q) => q.id);
}
