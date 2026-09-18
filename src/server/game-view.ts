/**
 * Read models for the UI. Pure functions over PlayerState + content, so the
 * world map, quest briefings and dossiers stay thin.
 */
import { NPCS } from "@/content/npcs";
import { QUESTS, findQuest } from "@/content/quests";
import { LOCATIONS, WORLDS } from "@/content/worlds";
import { deriveInsight, levelProgress } from "@/engine/competency";
import { relationshipLabel } from "@/engine/relationships";
import type { NPCInstanceState } from "@/engine/types/npc";
import { SKILLS, SKILL_IDS, type SkillId } from "@/engine/types/skills";
import { checkPrerequisites } from "@/engine/world";
import type { PlayerState } from "./player";

export interface QuestCard {
  id: string;
  title: string;
  tagline: string;
  worldId: string;
  locationId: string;
  locationName: string;
  npcId: string;
  npcName: string;
  npcRole: string;
  difficulty: number;
  skills: SkillId[];
  availability: "available" | "locked" | "completed" | "replayable";
  unmet: string[];
  lastOutcomeId: string | null;
  /** True when this quest was unlocked/followed-up by the most recent completion. */
  isNext: boolean;
}

export interface WorldCard {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: "open" | "locked";
  map: { x: number; y: number; size?: "sm" | "md" | "lg" };
  accent: string;
  quests: QuestCard[];
  availableCount: number;
}

export function buildQuestCards(state: PlayerState): QuestCard[] {
  const ctx = { world: state.world, competencies: state.competencies, npcs: state.npcs };
  const last = state.world.completedQuests[state.world.completedQuests.length - 1] ?? state.world.failedQuests[state.world.failedQuests.length - 1];
  const lastQuest = last ? findQuest(last.questId) : undefined;
  const nextIds = new Set<string>();
  if (lastQuest && last) {
    const outcome = lastQuest.outcomes.find((o) => o.id === last.outcomeId);
    for (const id of outcome?.followUpQuestIds ?? []) nextIds.add(id);
  }
  return QUESTS.map((q) => {
    const prereq = checkPrerequisites(q.prerequisites, ctx);
    const completions = state.world.completedQuests.filter((c) => c.questId === q.id);
    const fails = state.world.failedQuests.filter((c) => c.questId === q.id);
    const done = completions.length > 0 || fails.length > 0;
    const npc = NPCS[q.npcId];
    const loc = LOCATIONS.find((l) => l.id === q.locationId);
    const lastRec = [...completions, ...fails].sort((a, b) => b.at.localeCompare(a.at))[0];
    let availability: QuestCard["availability"];
    if (!prereq.ok) availability = "locked";
    else if (done) availability = "replayable";
    else availability = "available";
    // A follow-up quest that was chained by consequences is "available" even if generic prereqs say otherwise.
    return {
      id: q.id,
      title: q.title,
      tagline: q.tagline,
      worldId: q.worldId,
      locationId: q.locationId,
      locationName: loc?.name ?? q.locationId,
      npcId: q.npcId,
      npcName: npc?.name ?? q.npcId,
      npcRole: npc?.role ?? "",
      difficulty: q.difficulty,
      skills: q.skills,
      availability,
      unmet: prereq.unmet,
      lastOutcomeId: lastRec?.outcomeId ?? null,
      isNext: nextIds.has(q.id) && !done,
    };
  });
}

export function buildWorldCards(state: PlayerState): WorldCard[] {
  const quests = buildQuestCards(state);
  return WORLDS.map((w) => {
    const wq = quests.filter((q) => q.worldId === w.id);
    return { ...w, quests: wq, availableCount: wq.filter((q) => q.availability === "available").length };
  });
}

export interface SkillView {
  id: SkillId;
  label: string;
  tagline: string;
  level: number;
  xp: number;
  progress: { into: number; needed: number; pct: number };
  discovered: { id: string; label: string }[];
}

export function buildSkillViews(state: PlayerState): SkillView[] {
  return SKILL_IDS.map((id) => {
    const s = state.competencies[id];
    const p = levelProgress(s.xp);
    return {
      id,
      label: SKILLS[id].label,
      tagline: SKILLS[id].tagline,
      level: s.level,
      xp: s.xp,
      progress: { into: p.into, needed: p.needed, pct: p.pct },
      discovered: s.discovered.map((f) => ({ id: f, label: SKILLS[id].facets.find((x) => x.id === f)?.label ?? f })),
    };
  });
}

export interface NpcDossier {
  id: string;
  name: string;
  shortName: string;
  role: string;
  organisation: string;
  worldId: string;
  publicDossier: string;
  appearance: { hue: number; initials: string };
  met: boolean;
  timesMet: number;
  relationship: NPCInstanceState["relationship"] | null;
  relationshipLabel: string;
  lastInteractionSummary: string | null;
  remembers: string[];
  impressions: { statement: string; valence: number }[];
  openCommitments: { by: "player" | "npc"; description: string }[];
}

export function buildDossier(state: PlayerState, npcId: string): NpcDossier | null {
  const def = NPCS[npcId];
  if (!def) return null;
  const inst = state.npcs[npcId];
  const met = !!inst && (inst.timesMet > 0 || state.world.peopleMet.includes(npcId));
  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    role: def.role,
    organisation: def.organisation,
    worldId: def.worldId,
    publicDossier: def.publicDossier,
    appearance: def.appearance,
    met,
    timesMet: inst?.timesMet ?? 0,
    relationship: inst?.relationship ?? null,
    relationshipLabel: inst ? relationshipLabel(inst.relationship) : "Unknown",
    lastInteractionSummary: inst?.memory.lastInteractionSummary ?? null,
    remembers: (inst?.memory.events ?? []).slice(-4).map((e) => e.summary),
    impressions: (inst?.memory.beliefs ?? []).slice(0, 4).map((b) => ({ statement: b.statement, valence: b.valence })),
    openCommitments: (inst?.memory.commitments ?? []).filter((c) => c.status === "open").map((c) => ({ by: c.by, description: c.description })),
  };
}

export function buildInsight(state: PlayerState) {
  return deriveInsight(state.competencies);
}
