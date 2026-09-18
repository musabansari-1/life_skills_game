/**
 * World model.
 *
 * Static world *content* (worlds, locations) lives in `src/content` and is
 * versioned in code. Per-player *world state* is a single typed document that
 * conversations mutate through Consequences (see `./consequences.ts`).
 */
import { z } from "zod";

// ---------- Static content ----------

export interface WorldDefinition {
  id: string; // "career_city"
  name: string; // "Career City"
  tagline: string;
  description: string;
  /** Locked worlds are shown on the map but cannot be entered. */
  status: "open" | "locked";
  /** Map placement (0-100 percentage coordinates on the world map SVG). */
  map: { x: number; y: number; size?: "sm" | "md" | "lg" };
  accent: string; // CSS colour used for markers
}

export interface LocationDefinition {
  id: string; // "nova_labs_hr"
  worldId: string;
  name: string; // "Nova Labs, HR Wing"
  description: string;
  /** If true, must be unlocked in WorldState before quests here appear. */
  lockedByDefault?: boolean;
}

// ---------- Dynamic per-player state ----------

export const CareerStateSchema = z.object({
  status: z.enum(["exploring", "interviewing", "offer_received", "employed"]).default("interviewing"),
  employer: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  baseSalary: z.number().nullable().default(null),
  signingBonus: z.number().nullable().default(null),
  startDate: z.string().nullable().default(null),
});

export const CommitmentSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** NPC the commitment was made to. */
  toNpcId: z.string(),
  madeInQuestId: z.string(),
  madeAt: z.string(),
  dueBy: z.string().nullable().default(null),
  status: z.enum(["open", "fulfilled", "broken"]).default("open"),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  questId: z.string(),
  description: z.string(),
  at: z.string(),
});
export type PlayerDecision = z.infer<typeof DecisionSchema>;

export const OpportunitySchema = z.object({
  id: z.string(),
  description: z.string(),
  sourceNpcId: z.string().nullable().default(null),
  questId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const QuestRecordSchema = z.object({
  questId: z.string(),
  attemptId: z.string(),
  outcomeId: z.string(),
  at: z.string(),
});

export const WorldStateSchema = z.object({
  version: z.number().int().default(1),
  career: CareerStateSchema.prefault({}),
  /** Reputation per domain, -100..100. e.g. { career_city: 12 } */
  reputation: z.record(z.string(), z.number()).default({}),
  unlockedWorlds: z.array(z.string()).default([]),
  unlockedLocations: z.array(z.string()).default([]),
  unlockedQuests: z.array(z.string()).default([]),
  completedQuests: z.array(QuestRecordSchema).default([]),
  failedQuests: z.array(QuestRecordSchema).default([]),
  /** Free-form boolean facts, e.g. "revealed_minimum_to_emma". Prefer namespaced ids. */
  flags: z.array(z.string()).default([]),
  commitments: z.array(CommitmentSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  peopleMet: z.array(z.string()).default([]),
  opportunities: z.array(OpportunitySchema).default([]),
  /** Arbitrary namespaced values for quest authors: { "nova_labs.team": "Platform" } */
  vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export function createInitialWorldState(): WorldState {
  return WorldStateSchema.parse({
    // The story starts before the job: you've applied to Nova Labs and have a screening call booked.
    career: { status: "interviewing" },
    unlockedQuests: ["recruiter_screening"],
    unlockedWorlds: ["everyday_district", "career_city"],
    unlockedLocations: ["everyday_district.neighbourhood", "career_city.nova_labs_hr"],
  });
}
