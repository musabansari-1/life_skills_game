/**
 * Live scene state for a quest attempt, and the NPC turn contract.
 *
 * The NPC model *perceives* (what did the player just do?) and *proposes*
 * (I want to move the offer to X). The deterministic scene reducer *decides*
 * (clamp to hidden constraints, adjust patience, shift stance). This split is
 * what makes "different strategies produce different outcomes" testable.
 */
import { z } from "zod";
import { TurnIdentitySchema } from "../scene/ensemble";

/**
 * Shared vocabulary of things an NPC can notice about a player's turn.
 * Quests reuse this; the scene reducer maps signals to patience/stance changes.
 * Keep this list small and behavioural. Add a signal only if a reducer or
 * evaluator will act on it.
 */
export const PLAYER_SIGNALS = [
  "evidence_provided", // player backed a claim with specifics
  "good_question", // open question that surfaced information
  "acknowledged_npc", // reflected or acknowledged the NPC's point
  "rapport", // warmth, humour, courtesy that lands
  "clear_ask", // a specific, unambiguous request or number
  "proposed_alternative", // offered a trade or creative option
  "empathy", // showed understanding of NPC's position
  "owned_mistake", // admitted an error
  "aggressive_tone", // demanding, threatening, or hostile
  "ultimatum", // take-it-or-leave-it framing
  "vague_claim", // unsupported or fuzzy assertion
  "contradiction", // conflicts with something said earlier
  "rambling", // long, unfocused turn
  "revealed_minimum", // player disclosed their floor / walk-away point
  "conceded_for_free", // gave something up without asking for anything
  "mentioned_competing_offer", // claimed another offer
  "asked_about_total_comp", // asked about bonus / equity / non-base components
  "deflected", // dodged a direct question
  "accepted_terms", // agreed to what is currently on the table
  "silence_or_filler", // empty turn / no content
] as const;
export const PlayerSignalSchema = z.enum(PLAYER_SIGNALS);
export type PlayerSignal = z.infer<typeof PlayerSignalSchema>;

export const STANCES = ["warm", "neutral", "guarded", "defensive", "done"] as const;
export const StanceSchema = z.enum(STANCES);
export type Stance = z.infer<typeof StanceSchema>;

/** Generic scene state present in every quest. Quest-specific fields go in `custom`. */
export const SceneStateSchema = z.object({
  turnCount: z.number().int().min(0),
  /** 0..100. NPC's remaining patience. Drives stance and endings. */
  patience: z.number().min(0).max(100),
  stance: StanceSchema,
  /** Hidden-information keys the NPC has revealed so far. */
  revealed: z.array(z.string()),
  /** Running counts of signals across the conversation. */
  signalCounts: z.record(z.string(), z.number().int()),
  /** Quest-defined flags raised during play. */
  flags: z.array(z.string()),
  /** Whether the scene has ended and why. */
  ended: z
    .object({
      by: z.enum(["player", "npc", "turn_limit", "abandoned"]),
      reason: z.string(),
    })
    .nullable(),
  /** Quest-specific state (e.g. current offer on the table). */
  custom: z.record(z.string(), z.unknown()),
});
export type SceneState = z.infer<typeof SceneStateSchema>;

export function createSceneState(custom: Record<string, unknown>, patience = 70): SceneState {
  return {
    turnCount: 0,
    patience,
    stance: "neutral",
    revealed: [],
    signalCounts: {},
    flags: [],
    ended: null,
    custom,
  };
}

/** Structured half of the NPC's turn (the other half is the spoken text). */
export const NPCMovesSchema = z.object({
  noticed: z.array(PlayerSignalSchema).max(6).default([]),
  /** Optional explicit stance the NPC feels it has moved to. Reducer may override. */
  stance: StanceSchema.optional(),
  /** Suggested patience change; reducer clamps to [-25, +10]. */
  patienceDelta: z.number().optional(),
  /** Hidden-information keys the NPC chose to reveal in this speech. */
  reveal: z.array(z.string()).max(4).default([]),
  /** Quest-specific proposals (e.g. { base: 900000 }). Reducer validates against hidden constraints. */
  proposal: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  wantsToEnd: z.boolean().default(false),
  endReason: z.string().max(200).optional(),
});
export type NPCMoves = z.infer<typeof NPCMovesSchema>;

export const NPCTurnSchema = z.object({
  speech: z.string().min(1),
  moves: NPCMovesSchema,
});
export type NPCTurn = z.infer<typeof NPCTurnSchema>;

// ---------- Dialogue ----------

export const DialogueTurnSchema = z.object({
  identity: TurnIdentitySchema.optional(),
  id: z.string(),
  index: z.number().int().min(0),
  speaker: z.enum(["player", "npc", "system"]),
  text: z.string(),
  /** Input modality for player turns. */
  modality: z.enum(["voice", "text", "generated"]).default("text"),
  /** NPC moves for npc turns; null otherwise. */
  moves: NPCMovesSchema.nullable().default(null),
  createdAt: z.string(),
  /**
   * Canonical-transcript fields. `text` is always what was actually delivered
   * to the player. If the player cut the NPC off, `interrupted` is true and
   * `generatedText` keeps the full line the model produced (diagnostics only:
   * never shown to the player, never fed to evaluation or memory).
   */
  interrupted: z.boolean().optional(),
  generatedText: z.string().nullable().optional(),
});
export type DialogueTurn = z.infer<typeof DialogueTurnSchema>;
