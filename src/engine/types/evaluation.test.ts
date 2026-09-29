import { describe, expect, it } from "vitest";
import { EvaluationSchema } from "./evaluation";

describe("EvaluationSchema", () => {
  it("normalizes fractional rubric scores to the game's anchored integer scale", () => {
    const parsed = EvaluationSchema.parse({
      summary: "Specific feedback.",
      headline: "Held the line",
      overallScore: 72.5,
      rubricScores: [{ criterionId: "clarity", score: 2.6, evidence: "I can do Monday.", note: "Clear alternative." }],
      behaviors: [],
      strengths: [],
      improvements: [],
      keyMoments: [],
      objectiveResults: [],
    });
    expect(parsed.rubricScores[0].score).toBe(3);
  });
});
