/**
 * Competency engine (deterministic).
 *
 * - Facet estimates update with an adaptive learning rate: early observations
 *   move the estimate a lot, later ones less (confidence-weighted EMA).
 * - XP is earned from *demonstrated* facet quality, weighted by quest reward
 *   profile, difficulty and outcome multiplier. Neutral/absent behaviour earns
 *   little; strong behaviour earns a lot. This keeps XP meaningful.
 * - Levels are a concave curve over cumulative XP.
 * - "Discovery" fires the first time a facet is demonstrated at >= 0.7.
 */
import {
  SKILLS,
  SKILL_IDS,
  getFacet,
  type CompetencyProfile,
  type FacetEstimate,
  type FacetObservation,
  type PlayerSkill,
  type SkillId,
} from "../types/skills";
import type { RewardProfile } from "../types/quest";
import { clamp, round } from "../util";

// ---------- Levels ----------

/** XP required to go from level L to L+1. */
export function xpForLevel(level: number): number {
  return Math.round(80 * Math.pow(level, 1.45));
}

/** Cumulative XP needed to *reach* `level` (level 1 = 0). */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(l);
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    if (level > 99) break;
  }
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; needed: number; pct: number } {
  const level = levelFromXp(xp);
  const into = xp - cumulativeXpForLevel(level);
  const needed = xpForLevel(level);
  return { level, into, needed, pct: clamp(into / needed, 0, 1) };
}

// ---------- Profile ----------

export function createEmptySkill(skillId: SkillId): PlayerSkill {
  const facets: Record<string, FacetEstimate> = {};
  for (const f of SKILLS[skillId].facets) {
    facets[f.id] = { estimate: 50, confidence: 0, samples: 0, lastObservedAt: null };
  }
  return { skillId, xp: 0, level: 1, facets, discovered: [] };
}

export function createEmptyProfile(): CompetencyProfile {
  const out = {} as CompetencyProfile;
  for (const id of SKILL_IDS) out[id] = createEmptySkill(id);
  return out;
}

// ---------- Updates ----------

export interface CompetencyUpdateInput {
  profile: CompetencyProfile;
  observations: FacetObservation[];
  rewards: RewardProfile;
  difficulty: number; // 1-5
  outcomeMultiplier: number;
  now: string;
}

export interface CompetencyUpdateResult {
  profile: CompetencyProfile;
  xpAwards: { skill: SkillId; xp: number; levelBefore: number; levelAfter: number }[];
  discovered: { skill: SkillId; facet: string; label: string }[];
  /** Observations that referenced unknown skills/facets and were dropped. */
  dropped: FacetObservation[];
}

const DISCOVERY_THRESHOLD = 0.7;

/**
 * Apply evaluator observations to a competency profile.
 * Pure: returns a new profile. Safe against invalid facet ids.
 */
export function applyObservations(input: CompetencyUpdateInput): CompetencyUpdateResult {
  const profile = structuredClone(input.profile);
  const dropped: FacetObservation[] = [];
  const discovered: CompetencyUpdateResult["discovered"] = [];

  // Per-skill quality aggregate used for XP.
  const skillQuality: Partial<Record<SkillId, { sum: number; n: number }>> = {};

  for (const obs of input.observations) {
    const facetDef = getFacet(obs.skill, obs.facet);
    if (!facetDef) {
      dropped.push(obs);
      continue;
    }
    const skill = profile[obs.skill];
    const facet = skill.facets[obs.facet] ?? { estimate: 50, confidence: 0, samples: 0, lastObservedAt: null };

    // Adaptive learning rate: 0.5 for first sample, decays toward 0.12.
    const k = 0.12 + 0.38 / (1 + facet.samples * 0.6);
    const target = obs.score * 100;
    const estimate = clamp(facet.estimate + k * (target - facet.estimate), 0, 100);
    const confidence = clamp(1 - Math.exp(-(facet.samples + 1) / 4), 0, 1);
    skill.facets[obs.facet] = {
      estimate: round(estimate, 1),
      confidence: round(confidence, 3),
      samples: facet.samples + 1,
      lastObservedAt: input.now,
    };

    if (obs.score >= DISCOVERY_THRESHOLD && !skill.discovered.includes(obs.facet)) {
      skill.discovered.push(obs.facet);
      discovered.push({ skill: obs.skill, facet: obs.facet, label: facetDef.label });
    }

    const q = (skillQuality[obs.skill] ??= { sum: 0, n: 0 });
    q.sum += obs.score;
    q.n += 1;
  }

  // XP: baseXp * weight * qualityFactor * difficultyFactor * outcomeMultiplier
  const xpAwards: CompetencyUpdateResult["xpAwards"] = [];
  const difficultyFactor = 0.8 + 0.15 * clamp(input.difficulty, 1, 5); // 0.95 .. 1.55
  for (const [skillIdRaw, weight] of Object.entries(input.rewards.skills)) {
    const skillId = skillIdRaw as SkillId;
    if (!weight || !profile[skillId]) continue;
    const q = skillQuality[skillId];
    const avg = q && q.n > 0 ? q.sum / q.n : 0.35; // no evidence → small consolation XP
    // Quality factor: 0.2 at score 0, 1.0 at 0.6, 1.6 at 1.0 (rewards strong play disproportionately)
    const qualityFactor = avg <= 0.6 ? 0.2 + (avg / 0.6) * 0.8 : 1 + ((avg - 0.6) / 0.4) * 0.6;
    const xp = Math.max(0, Math.round(input.rewards.baseXp * weight * qualityFactor * difficultyFactor * input.outcomeMultiplier));
    if (xp <= 0) continue;
    const skill = profile[skillId];
    const levelBefore = skill.level;
    skill.xp += xp;
    skill.level = levelFromXp(skill.xp);
    xpAwards.push({ skill: skillId, xp, levelBefore, levelAfter: skill.level });
  }

  xpAwards.sort((a, b) => b.xp - a.xp);
  return { profile, xpAwards, discovered, dropped };
}

// ---------- Insight ----------

export interface CompetencyInsight {
  strengths: { skill: SkillId; facet: string; label: string; estimate: number }[];
  weaknesses: { skill: SkillId; facet: string; label: string; estimate: number }[];
  /** "Communicates clearly but gives away leverage too early." style sentence, if enough data. */
  sentence: string | null;
}

/** Derive a compact, honest summary of the player's demonstrated profile. */
export function deriveInsight(profile: CompetencyProfile, minConfidence = 0.35): CompetencyInsight {
  const all: { skill: SkillId; facet: string; label: string; estimate: number; confidence: number }[] = [];
  for (const id of SKILL_IDS) {
    for (const [facetId, est] of Object.entries(profile[id].facets)) {
      if (est.confidence < minConfidence) continue;
      const def = getFacet(id, facetId);
      if (!def) continue;
      all.push({ skill: id, facet: facetId, label: def.label, estimate: est.estimate, confidence: est.confidence });
    }
  }
  const sorted = [...all].sort((a, b) => b.estimate - a.estimate);
  const strengths = sorted.filter((x) => x.estimate >= 65).slice(0, 3);
  const weaknesses = sorted
    .filter((x) => x.estimate <= 45)
    .reverse()
    .slice(0, 3);
  let sentence: string | null = null;
  if (strengths[0] && weaknesses[0]) {
    sentence = `Strong at ${strengths[0].label.toLowerCase()}; weakest at ${weaknesses[0].label.toLowerCase()}.`;
  } else if (strengths[0]) {
    sentence = `Strong at ${strengths[0].label.toLowerCase()}. Not enough evidence yet to find a weakness.`;
  }
  return { strengths, weaknesses, sentence };
}
