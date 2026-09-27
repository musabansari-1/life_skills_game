import type { WorldState } from "../types/world";
import type { Communication, Information } from "./types";

/** Even team/organization facts have an authored audience; visibility is not omniscience. */
export function knowsInformation(world: WorldState, npcId: string, fact: Information): boolean {
  return fact.ownerId === npcId || (fact.visibility !== "private" && fact.audience.includes(npcId))
    || world.campaign.communications.some((c) => c.factId === fact.id && c.to === npcId);
}
export function informationFor(world: WorldState, npcId: string): Information[] {
  return world.campaign.information.filter((f) => knowsInformation(world, npcId, f));
}
/** Explicit route, known sender, non-private fact. Never copies another character's memory. */
export function communicate(world: WorldState, event: Communication): WorldState {
  const fact = world.campaign.information.find((f) => f.id === event.factId);
  if (!fact || fact.visibility === "private" || !knowsInformation(world, event.from, fact)
      || event.from === event.to || !event.reason.trim() || !event.sourceAttemptId) return world;
  if (world.campaign.communications.some((c) => c.id === event.id)) return world;
  const next = structuredClone(world);
  next.campaign.communications.push(event);
  return next;
}
