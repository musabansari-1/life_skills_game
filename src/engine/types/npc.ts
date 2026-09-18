/**
 * Persistent NPC model.
 *
 * `NPCDefinition` is static content (who Emma is). `NPCInstanceState` is the
 * per-player persistent state (what Emma thinks of *this* player and what she
 * remembers). NPCs never reset between sessions.
 *
 * Memory is structured, not a transcript dump:
 *   - facts:        durable things the NPC knows about the player
 *   - beliefs:      the NPC's impressions of the player (valence + strength)
 *   - events:       important prior moments, ranked by importance
 *   - commitments:  promises either side made, tracked to resolution
 *   - lastSummary:  a short recap of the most recent interaction
 * Recent conversational context is *never* stored here; it lives in the
 * conversation for the current attempt only.
 */
import { z } from "zod";

export interface NPCVoiceProfile {
  /** BCP-47 language tag preference, e.g. "en-IN". */
  lang: string;
  gender: "female" | "male" | "neutral";
  /** 0.5 - 2. Browser TTS rate. */
  rate: number;
  /** 0 - 2. Browser TTS pitch. */
  pitch: number;
  /** Substrings to prefer when picking a browser voice, in priority order. */
  preferredVoiceHints: string[];
}

export interface NPCPersonality {
  summary: string; // one paragraph, in prose, used verbatim in the prompt
  traits: string[]; // "friendly", "commercially minded"
  values: string[]; // what they appreciate
  dislikes: string[]; // what irritates them
  speakingStyle: string; // "short sentences, warm, occasionally blunt"
  /** Behavioural tells the model should use when patience runs low. */
  underPressure: string;
}

export interface NPCDefinition {
  id: string; // "emma_recruiter"
  name: string; // "Emma Kapoor"
  shortName: string; // "Emma"
  role: string; // "Talent Partner"
  organisation: string; // "Nova Labs"
  worldId: string;
  locationId: string;
  personality: NPCPersonality;
  goals: string[];
  /** What the player can read in the dossier before meeting them. */
  publicDossier: string;
  /** Visual identity for the abstract presence orb / avatar. */
  appearance: { hue: number; initials: string };
  voice: NPCVoiceProfile;
  /** Starting relationship for players who have never met this NPC. */
  baseRelationship: Relationship;
}

// ---------- Relationship ----------

export const RelationshipSchema = z.object({
  /** -100..100: does the NPC believe what the player says? */
  trust: z.number().min(-100).max(100),
  /** -100..100: does the NPC rate the player's competence/strength? */
  respect: z.number().min(-100).max(100),
  /** 0..100: how well do they know each other? Only goes up. */
  familiarity: z.number().min(0).max(100),
  /** -100..100: does the NPC like the player? */
  warmth: z.number().min(-100).max(100),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RelationshipDeltaSchema = z.object({
  trust: z.number().optional(),
  respect: z.number().optional(),
  familiarity: z.number().optional(),
  warmth: z.number().optional(),
});
export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;

// ---------- Memory ----------

export const MemoryFactSchema = z.object({
  id: z.string(),
  /** Stable key used for de-duplication, e.g. "player.current_employer". */
  key: z.string(),
  statement: z.string().max(240),
  confidence: z.number().min(0).max(1),
  sourceQuestId: z.string(),
  firstSeenAt: z.string(),
  lastConfirmedAt: z.string(),
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const NPCBeliefSchema = z.object({
  id: z.string(),
  /** Stable key, e.g. "prepared", "honest", "pushy". */
  key: z.string(),
  statement: z.string().max(240),
  /** -1..1 negative to positive impression. */
  valence: z.number().min(-1).max(1),
  /** 0..1 how strongly held. */
  strength: z.number().min(0).max(1),
  evidence: z.string().max(300),
  sourceQuestId: z.string(),
  updatedAt: z.string(),
});
export type NPCBelief = z.infer<typeof NPCBeliefSchema>;

export const MemoryEventSchema = z.object({
  id: z.string(),
  questId: z.string(),
  attemptId: z.string().nullable(),
  summary: z.string().max(400),
  /** 0..1, used for ranking what to include in prompts and for decay. */
  importance: z.number().min(0).max(1),
  emotionalTone: z.enum(["positive", "negative", "mixed", "neutral"]),
  at: z.string(),
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const NPCCommitmentSchema = z.object({
  id: z.string(),
  /** Who owes the commitment. */
  by: z.enum(["player", "npc"]),
  description: z.string().max(240),
  dueBy: z.string().nullable(),
  status: z.enum(["open", "fulfilled", "broken"]),
  questId: z.string(),
  at: z.string(),
});
export type NPCCommitment = z.infer<typeof NPCCommitmentSchema>;

export const NPCMemorySchema = z.object({
  facts: z.array(MemoryFactSchema).default([]),
  beliefs: z.array(NPCBeliefSchema).default([]),
  events: z.array(MemoryEventSchema).default([]),
  commitments: z.array(NPCCommitmentSchema).default([]),
  lastInteractionSummary: z.string().nullable().default(null),
  lastInteractionAt: z.string().nullable().default(null),
});
export type NPCMemory = z.infer<typeof NPCMemorySchema>;

export const NPCInstanceStateSchema = z.object({
  npcId: z.string(),
  relationship: RelationshipSchema,
  memory: NPCMemorySchema,
  timesMet: z.number().int().min(0).default(0),
});
export type NPCInstanceState = z.infer<typeof NPCInstanceStateSchema>;

export function createNPCInstanceState(def: NPCDefinition): NPCInstanceState {
  return {
    npcId: def.id,
    relationship: { ...def.baseRelationship },
    memory: NPCMemorySchema.parse({}),
    timesMet: 0,
  };
}

/** Output contract for the memory-extraction AI task. Candidate items are merged deterministically. */
export const MemoryExtractionSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().max(80),
        statement: z.string().max(240),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12),
  beliefs: z
    .array(
      z.object({
        key: z.string().max(60),
        statement: z.string().max(240),
        valence: z.number().min(-1).max(1),
        strength: z.number().min(0).max(1),
        evidence: z.string().max(300),
      }),
    )
    .max(10),
  events: z
    .array(
      z.object({
        summary: z.string().max(400),
        importance: z.number().min(0).max(1),
        emotionalTone: z.enum(["positive", "negative", "mixed", "neutral"]),
      }),
    )
    .max(6),
  commitments: z
    .array(
      z.object({
        by: z.enum(["player", "npc"]),
        description: z.string().max(240),
        dueBy: z.string().nullable(),
      }),
    )
    .max(6),
  interactionSummary: z.string().max(500),
});
export type MemoryExtraction = z.infer<typeof MemoryExtractionSchema>;
