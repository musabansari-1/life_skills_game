import type { AnyQuestDefinition } from "../types/quest";
import type { WorldState } from "../types/world";
import type { PacingProfile } from "./types";

export function pacingFor(q: AnyQuestDefinition): PacingProfile {
  return q.pacing ?? { category: q.boss ? "boss" : q.id === "introduce_yourself" ? "low_pressure" : "progression", intensity: q.difficulty, emotionalPressure: q.difficulty, importance: q.boss ? 5 : 3, urgency: "normal" };
}
export function pacingAdjustment(world: WorldState, q: AnyQuestDefinition): { score: number; reasons: string[] } {
  const p = pacingFor(q), recent = world.campaign.recent.slice(-3);
  let score = 0;
  const reasons: string[] = [];
  if (recent.length >= 2 && recent.slice(-2).every((r) => r.intensity >= 4)) {
    score += p.intensity <= 2 ? 28 : -24;
    reasons.push(p.intensity <= 2 ? "space_after_pressure" : "pressure_cooldown");
  }
  // A boss earns a quieter scene next; two peaks in a row flatten both.
  const last = recent.at(-1);
  if (last && last.intensity >= 4) {
    if (p.intensity <= 2) { score += 20; reasons.push("breathing_room_after_boss"); }
    else if (p.intensity >= 4) { score -= 15; reasons.push("back_to_back_peaks"); }
  }
  const repeated = recent.filter((r) => r.category === p.category).length;
  if (repeated) { score -= repeated * 7; reasons.push("category_recency"); }
  if (!recent.some((r) => r.category === p.category)) score += 5;
  if (p.category === "recovery" && world.campaign.failures.some((f) => !f.recoveredBy && f.recoveryQuestId === q.id)) {
    score += 45; reasons.push("unresolved_failure_recovery");
  }
  if (p.urgency === "consequence") score += 15;
  return { score, reasons };
}

/** Changes the number of assumptions to test, never NPC civility or outcome thresholds. */
export function campaignDifficulty(world: WorldState, observed: number, trust: number): 1 | 2 | 3 | 4 | 5 {
  let target = observed >= 70 ? 4 : observed < 40 ? 2 : 3;
  if (world.campaign.failures.filter((f) => !f.recoveredBy).length >= 2) target--;
  if (trust < 0) target = Math.min(4, target + 1);
  const last = world.campaign.recent.at(-1)?.difficulty ?? 3;
  return Math.max(2, Math.min(4, last + 1, Math.max(last - 1, target))) as 2 | 3 | 4;
}
