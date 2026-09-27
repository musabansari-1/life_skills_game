import { z } from "zod";
import { SkillIdSchema } from "../types/skills";

export const GoalSchema = z.enum(["negotiation", "confidence", "interviews", "leadership", "conflict", "listening"]);
export type PlayerGoal = z.infer<typeof GoalSchema>;
export const GOAL_LABELS: Record<PlayerGoal, string> = {
  negotiation: "Negotiate better", confidence: "Make the ask", interviews: "Prepare for interviews",
  leadership: "Lead a team", conflict: "Handle disagreement", listening: "Listen under pressure",
};
export const PreferencesSchema = z.object({
  goals: z.array(GoalSchema).max(3).refine((xs) => new Set(xs).size === xs.length, "Choose each goal once"),
  // Deliberately structured: no real names or sensitive situation text goes to the Director.
  upcoming: z.object({ goal: GoalSchema, horizon: z.enum(["soon", "this_week", "someday"]) }).nullable(),
}).strict();

export const VariantSchema = z.enum(["repair", "listen", "ask", "stretch"]);
export type EncounterVariant = z.infer<typeof VariantSchema>;
export const HistoryRefSchema = z.object({
  kind: z.enum(["quest", "decision", "promise", "relationship", "skill", "goal", "thread"]),
  id: z.string().min(1).max(160), label: z.string().min(1).max(500),
}).strict();

/** A closed content grammar. No arbitrary patches, reward amounts, executable predicates or NPC identities. */
export const DirectorProposalSchema = z.object({
  version: z.literal(1), id: z.string().max(160), basedOnVersion: z.number().int().min(1),
  questId: z.string().min(1).max(100), template: z.enum(["curated", "checkpoint", "introduction"]),
  variant: VariantSchema, eventType: z.enum(["next_quest", "consequence", "relationship", "skill_challenge", "boss"]),
  title: z.string().min(1).max(100), summary: z.string().min(1).max(600), whyNow: z.string().min(1).max(700),
  worldId: z.string().max(80), npcId: z.string().max(80),
  targetSkills: z.array(SkillIdSchema).min(1).max(4),
  history: z.array(HistoryRefSchema).min(1).max(8),
  difficulty: z.number().int().min(1).max(5),
  objectiveIds: z.array(z.string().max(80)).min(1).max(8),
  effectPolicy: z.enum(["curated_outcomes", "checkpoint_outcomes", "introduction_outcomes"]),
  urgency: z.enum(["gentle", "normal", "pending_consequence"]),
  repeatability: z.literal("practice_only_after_resolution"),
  category: z.literal("grounded_conversation"),
}).strict();
export type DirectorProposal = z.infer<typeof DirectorProposalSchema>;

export const StoryThreadSchema = z.object({
  id: z.string(), kind: z.enum(["deadline", "introduction"]),
  stage: z.enum(["setup", "tension", "escalation", "decision", "consequence", "resolution"]),
  status: z.enum(["pending", "ready", "resolved"]),
  title: z.string(), explanation: z.string(),
  sourceQuestId: z.string(), sourceAttemptId: z.string(), sourceDecisionId: z.string().nullable(),
  sourceCommitmentIds: z.array(z.string()).default([]),
  dueAfter: z.number().int().min(0), resolvedByAttemptId: z.string().nullable(),
  resolution: z.string().nullable(),
});
export type StoryThread = z.infer<typeof StoryThreadSchema>;

export const CharacterArcSchema = z.object({
  npcId: z.string(), role: z.string(), context: z.string(),
  stage: z.enum(["new_contact", "working_relationship", "strained", "trusted_ally", "advocate"]),
  goals: z.array(z.string()), expectations: z.array(z.string()),
  beliefs: z.array(z.string()), unresolved: z.array(z.string()),
  favors: z.array(z.string()), disappointments: z.array(z.string()),
  milestones: z.array(z.object({ questId: z.string(), attemptId: z.string(), summary: z.string() })),
});
export type CharacterArc = z.infer<typeof CharacterArcSchema>;
export const ReputationSchema = z.object({
  reliable: z.number().min(-100).max(100).default(0),
  assertive: z.number().min(-100).max(100).default(0),
  diplomatic: z.number().min(-100).max(100).default(0),
  credible: z.number().min(-100).max(100).default(0),
  empathetic: z.number().min(-100).max(100).default(0),
}).prefault({});

export const DirectorAuditSchema = z.object({
  basedOnVersion: z.number().int(), source: z.enum(["ai", "rules", "fallback"]),
  selectedQuestId: z.string().nullable(), reasons: z.array(z.string()),
  alternatives: z.array(z.object({ questId: z.string(), variant: VariantSchema, score: z.number(), reasons: z.array(z.string()) })),
  rejected: z.array(z.object({ rule: z.string(), detail: z.string() })),
});
export type DirectorAudit = z.infer<typeof DirectorAuditSchema>;

export const DirectorStateSchema = z.object({
  version: z.literal(1).default(1),
  clock: z.number().int().min(0).default(0),
  preferences: PreferencesSchema.prefault({ goals: [], upcoming: null }),
  reputation: ReputationSchema,
  characters: z.record(z.string(), CharacterArcSchema).default({}),
  threads: z.array(StoryThreadSchema).default([]),
  // Approved offers are retained, including completed ones, for stable briefings and replay.
  offers: z.array(DirectorProposalSchema).default([]),
  recommended: DirectorProposalSchema.nullable().default(null),
  recent: z.array(z.object({
    attemptId: z.string(), questId: z.string(), npcId: z.string(), grade: z.enum(["success", "partial", "failure"]),
    difficulty: z.number().int().min(1).max(5), variant: VariantSchema.nullable(),
    signals: z.record(z.string(), z.number().int().min(0)),
    observations: z.array(z.object({ skill: SkillIdSchema, facet: z.string(), score: z.number().min(0).max(1) })),
  })).default([]),
  audits: z.array(DirectorAuditSchema).default([]),
});
export type DirectorState = z.infer<typeof DirectorStateSchema>;
