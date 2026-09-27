import { z } from "zod";

export const EncounterCategorySchema = z.enum(["progression", "challenge", "relationship", "recovery", "reflection", "opportunity", "side", "consequence", "boss", "low_pressure"]);
export type EncounterCategory = z.infer<typeof EncounterCategorySchema>;
export interface PacingProfile {
  category: EncounterCategory;
  intensity: 1 | 2 | 3 | 4 | 5;
  emotionalPressure: 1 | 2 | 3 | 4 | 5;
  importance: 1 | 2 | 3 | 4 | 5;
  urgency: "optional" | "normal" | "consequence";
}
export const FailureKindSchema = z.enum(["recoverable_mistake", "relationship_damage", "opportunity_lost", "delayed_opportunity", "reputation_hit", "unresolved_conflict", "commitment_failure", "partial_success", "hard_branch_closure"]);
export type FailureKind = z.infer<typeof FailureKindSchema>;
export const FailureSchema = z.object({
  id: z.string(), questId: z.string(), attemptId: z.string(), npcId: z.string(),
  kind: FailureKindSchema, summary: z.string(),
  recoveryQuestId: z.string().nullable(), recoveredBy: z.string().nullable(),
  recoveryAttempts: z.array(z.string()).default([]),
});
export const InformationSchema = z.object({
  id: z.string(), sourceAttemptId: z.string(), sourceQuestId: z.string(), ownerId: z.string(),
  visibility: z.enum(["private", "shared", "team", "organizational"]),
  audience: z.array(z.string()), summary: z.string(),
});
export type Information = z.infer<typeof InformationSchema>;
export const CommunicationSchema = z.object({
  id: z.string(), factId: z.string(), from: z.string(), to: z.string(),
  kind: z.enum(["recommendation", "warning", "inquiry", "support", "undermine", "introduction", "incident"]),
  reason: z.string(), sourceAttemptId: z.string(),
});
export type Communication = z.infer<typeof CommunicationSchema>;
export const EndingSchema = z.object({
  id: z.string(), resolvedBy: z.string(), professional: z.string(), identity: z.string(),
  path: z.array(z.string()), definingMoments: z.array(z.object({ label: z.string(), attemptId: z.string().nullable() })),
  relationships: z.array(z.object({ npcId: z.string(), outcome: z.string(), evidence: z.array(z.string()) })),
  growth: z.array(z.object({ skill: z.string(), before: z.number(), after: z.number(), delta: z.number() })),
  goals: z.array(z.string()), unresolved: z.array(z.string()), nextChapter: z.string(),
  // Additive (V1 content): grounded in the same authoritative state as the fields above.
  weakness: z.object({ skill: z.string(), label: z.string(), advice: z.string() }).nullable().default(null),
  tease: z.object({ title: z.string(), body: z.string() }).nullable().default(null),
  headline: z.string().default(""),
});
export type CampaignEnding = z.infer<typeof EndingSchema>;
export const CampaignStateSchema = z.object({
  version: z.literal(1).default(1),
  processedAttempts: z.array(z.string()).default([]),
  milestones: z.record(z.string(), z.object({ attemptId: z.string(), grade: z.enum(["success", "partial", "failure"]), outcomeId: z.string() })).default({}),
  branches: z.record(z.string(), z.enum(["locked", "open", "completed", "unresolved", "closed"])).default({}),
  failures: z.array(FailureSchema).default([]),
  information: z.array(InformationSchema).default([]),
  communications: z.array(CommunicationSchema).default([]),
  recent: z.array(z.object({ questId: z.string(), category: EncounterCategorySchema, intensity: z.number(), difficulty: z.number() })).default([]),
  baselineSkills: z.record(z.string(), z.number()).default({}),
  ending: EndingSchema.nullable().default(null),
});
export type CampaignState = z.infer<typeof CampaignStateSchema>;
