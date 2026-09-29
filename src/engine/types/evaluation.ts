/**
 * Evaluation contract.
 *
 * The evaluator is a separate AI task from NPC generation. It sees the full
 * transcript, the quest rubric, the hidden state and the final scene state,
 * and returns structured, evidence-backed judgements. It never generates
 * dialogue and the NPC never grades itself.
 */
import { z } from "zod";
import { FacetObservationSchema, SkillIdSchema } from "./skills";

export const RubricScoreSchema = z.object({
  criterionId: z.string(),
  /** 0-4 anchored scale: 0 absent/harmful, 1 weak, 2 adequate, 3 strong, 4 exemplary. */
  score: z.number().min(0).max(4).transform((value) => Math.round(value)),
  evidence: z.string().max(600),
  note: z.string().max(400),
});

export const KeyMomentSchema = z.object({
  /** Index of the player turn (DialogueTurn.index) this refers to. */
  turnIndex: z.number().int().min(0),
  label: z.string().max(80),
  impact: z.enum(["positive", "negative", "neutral"]),
  detail: z.string().max(400),
});

export const EvaluationSchema = z.object({
  /** One paragraph, second person, specific. */
  summary: z.string().max(1200),
  /** Short punchy line for the share card, e.g. "Protected leverage under pressure". */
  headline: z.string().max(80),
  overallScore: z.number().min(0).max(100),
  rubricScores: z.array(RubricScoreSchema),
  behaviors: z.array(FacetObservationSchema).max(24),
  strengths: z
    .array(
      z.object({
        title: z.string().max(80),
        detail: z.string().max(400),
      }),
    )
    .max(5),
  improvements: z
    .array(
      z.object({
        title: z.string().max(80),
        detail: z.string().max(400),
        /** Concrete rewrite: "A stronger response would ..." */
        betterMove: z.string().max(400),
      }),
    )
    .max(5),
  keyMoments: z.array(KeyMomentSchema).max(6),
  objectiveResults: z.array(
    z.object({
      objectiveId: z.string(),
      achieved: z.boolean(),
      evidence: z.string().max(300),
    }),
  ),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/** A rubric criterion authored on a quest; the evaluator scores each one. */
export interface RubricCriterion {
  id: string;
  skill: z.infer<typeof SkillIdSchema>;
  /** Facet id within the skill that this criterion primarily evidences. */
  facet: string;
  label: string;
  description: string;
  /** What a 4/4 looks like vs a 1/4, to anchor the model. */
  anchors: { exemplary: string; weak: string };
  weight: number; // relative weight for overallScore guidance
}
