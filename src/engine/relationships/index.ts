/**
 * Relationship engine (deterministic).
 * Deltas are clamped per-application so a single conversation cannot swing a
 * relationship from enemy to best friend; familiarity only increases.
 */
import type { Relationship, RelationshipDelta } from "../types/npc";
import { clamp, round } from "../util";

export const MAX_DELTA_PER_EVENT = 25;

export function applyRelationshipDelta(rel: Relationship, delta: RelationshipDelta): Relationship {
  const d = (n: number | undefined) => clamp(n ?? 0, -MAX_DELTA_PER_EVENT, MAX_DELTA_PER_EVENT);
  return {
    trust: round(clamp(rel.trust + d(delta.trust), -100, 100), 1),
    respect: round(clamp(rel.respect + d(delta.respect), -100, 100), 1),
    familiarity: round(clamp(rel.familiarity + Math.max(0, delta.familiarity ?? 0), 0, 100), 1),
    warmth: round(clamp(rel.warmth + d(delta.warmth), -100, 100), 1),
  };
}

export function diffRelationship(before: Relationship, after: Relationship): RelationshipDelta {
  return {
    trust: round(after.trust - before.trust, 1),
    respect: round(after.respect - before.respect, 1),
    familiarity: round(after.familiarity - before.familiarity, 1),
    warmth: round(after.warmth - before.warmth, 1),
  };
}

function band(v: number, bands: [number, string][]): string {
  for (const [min, label] of bands) if (v >= min) return label;
  return bands[bands.length - 1][1];
}

/**
 * Turn numbers into prose the NPC model can act on. Numbers alone are ignored
 * by language models; short qualitative statements are not.
 */
export function describeRelationship(rel: Relationship, playerName: string): string {
  const trust = band(rel.trust, [
    [40, `you trust ${playerName}'s word`],
    [10, `you mostly take ${playerName} at their word`],
    [-10, `you neither trust nor distrust ${playerName} yet`],
    [-40, `you are a little sceptical of what ${playerName} says`],
    [-100, `you do not trust ${playerName}; verify everything they claim`],
  ]);
  const respect = band(rel.respect, [
    [40, `you rate them highly as an operator`],
    [10, `you think they are competent`],
    [-10, `you have no strong view of their competence`],
    [-40, `you are unimpressed by them so far`],
    [-100, `you consider them weak or naive`],
  ]);
  const familiarity = band(rel.familiarity, [
    [60, `you know each other well`],
    [25, `you have dealt with each other a few times`],
    [5, `you have met once before`],
    [0, `you have never spoken before`],
  ]);
  const warmth = band(rel.warmth, [
    [40, `you genuinely like them`],
    [10, `you are warm toward them`],
    [-10, `you are professionally neutral toward them`],
    [-40, `you find them tiresome`],
    [-100, `you actively dislike them`],
  ]);
  return `${capitalize(familiarity)}; ${trust}; ${respect}; ${warmth}.`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function relationshipLabel(rel: Relationship): string {
  const score = (rel.trust + rel.respect + rel.warmth) / 3;
  if (rel.familiarity < 5) return "Unknown";
  if (score >= 45) return "Ally";
  if (score >= 20) return "Favourable";
  if (score >= -10) return "Neutral";
  if (score >= -40) return "Strained";
  return "Hostile";
}
