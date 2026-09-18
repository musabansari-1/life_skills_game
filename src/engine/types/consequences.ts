/**
 * Consequences & events.
 *
 * A Consequence is a *typed intent* to change persistent state, produced by
 * quest outcome branches (deterministic) and, in a constrained form, by the
 * memory extractor (commitments). Consequences are applied by reducers in
 * `src/engine/world` and `src/engine/relationships`; every applied consequence
 * produces an Event, which is the append-only history used for analytics,
 * debugging and future "what happened previously" features.
 */
import { z } from "zod";
import { RelationshipDeltaSchema } from "./npc";

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ConsequenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("world.career.set"), patch: z.record(z.string(), ScalarSchema) }),
  z.object({ type: z.literal("world.var.set"), key: z.string(), value: ScalarSchema }),
  z.object({ type: z.literal("world.flag.add"), flag: z.string() }),
  z.object({ type: z.literal("world.flag.remove"), flag: z.string() }),
  z.object({ type: z.literal("world.reputation.delta"), domain: z.string(), delta: z.number() }),
  z.object({ type: z.literal("world.unlock.world"), worldId: z.string() }),
  z.object({ type: z.literal("world.unlock.location"), locationId: z.string() }),
  z.object({ type: z.literal("world.unlock.quest"), questId: z.string() }),
  z.object({
    type: z.literal("world.commitment.add"),
    description: z.string(),
    toNpcId: z.string(),
    dueBy: z.string().nullable(),
  }),
  z.object({
    type: z.literal("world.commitment.resolve"),
    commitmentId: z.string(),
    status: z.enum(["fulfilled", "broken"]),
  }),
  z.object({ type: z.literal("world.decision.add"), description: z.string() }),
  z.object({
    type: z.literal("world.opportunity.add"),
    description: z.string(),
    sourceNpcId: z.string().nullable(),
    questId: z.string().nullable(),
  }),
  z.object({ type: z.literal("world.person.met"), npcId: z.string() }),
  z.object({ type: z.literal("relationship.delta"), npcId: z.string(), delta: RelationshipDeltaSchema }),
  z.object({
    type: z.literal("npc.memory.event"),
    npcId: z.string(),
    summary: z.string(),
    importance: z.number().min(0).max(1),
    emotionalTone: z.enum(["positive", "negative", "mixed", "neutral"]),
  }),
]);
export type Consequence = z.infer<typeof ConsequenceSchema>;

/**
 * Product analytics + game history events. Analytics are *instrumentation only*
 * in this phase: they are appended to the `events` table and logged.
 */
export const GAME_EVENT_TYPES = [
  "onboarding_completed",
  "quest_started",
  "voice_conversation_started",
  "conversation_abandoned",
  "quest_completed",
  "quest_failed",
  "quest_retried",
  "result_shared",
  "next_quest_started",
  // engine / history
  "world.consequence_applied",
  "npc.relationship_changed",
  "npc.memory_updated",
  "player.xp_gained",
  "player.level_up",
  "player.facet_discovered",
  "ai.call",
] as const;
export const GameEventTypeSchema = z.enum(GAME_EVENT_TYPES);
export type GameEventType = z.infer<typeof GameEventTypeSchema>;

export interface GameEvent {
  id: string;
  playerId: string;
  type: GameEventType;
  payload: Record<string, unknown>;
  at: string;
}
