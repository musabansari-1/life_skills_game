/**
 * Quest registry. Adding a quest = author a file with `defineQuest` and list it
 * here. Validation at load time catches common content mistakes early.
 */
import type { AnyQuestDefinition } from "@/engine/types/quest";
import { NPCS } from "../npcs";
import { getLocation, getWorld } from "../worlds";
import { counterOffer } from "./counter-offer";
import { firstDayNovaLabs } from "./first-day-nova-labs";
import { introduceYourself } from "./introduce-yourself";
import { pushBackOnDeadline } from "./push-back-on-deadline";

export const QUESTS: AnyQuestDefinition[] = [introduceYourself, counterOffer, firstDayNovaLabs, pushBackOnDeadline].sort((a, b) => a.order - b.order);

const byId = new Map(QUESTS.map((q) => [q.id, q]));

export function getQuest(id: string): AnyQuestDefinition {
  const q = byId.get(id);
  if (!q) throw new Error(`Unknown quest: ${id}`);
  return q;
}

export function findQuest(id: string): AnyQuestDefinition | undefined {
  return byId.get(id);
}

/** Throws with a readable message when content references something that doesn't exist. */
export function validateContent(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const q of QUESTS) {
    if (ids.has(q.id)) errors.push(`Duplicate quest id ${q.id}`);
    ids.add(q.id);
    if (!NPCS[q.npcId]) errors.push(`${q.id}: unknown npc ${q.npcId}`);
    if (!getWorld(q.worldId)) errors.push(`${q.id}: unknown world ${q.worldId}`);
    if (!getLocation(q.locationId)) errors.push(`${q.id}: unknown location ${q.locationId}`);
    if (q.outcomes.length === 0) errors.push(`${q.id}: no outcomes`);
    const rubricIds = new Set<string>();
    for (const c of q.rubric) {
      if (rubricIds.has(c.id)) errors.push(`${q.id}: duplicate rubric id ${c.id}`);
      rubricIds.add(c.id);
    }
    for (const o of q.outcomes) for (const f of o.followUpQuestIds ?? []) if (!byId.has(f)) errors.push(`${q.id}/${o.id}: unknown follow-up quest ${f}`);
    for (const p of q.prerequisites) if (p.type === "quest_completed" && !byId.has(p.questId)) errors.push(`${q.id}: prerequisite references unknown quest ${p.questId}`);
  }
  return errors;
}
