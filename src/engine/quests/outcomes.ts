/**
 * Outcome resolution (deterministic).
 *
 * Given final scene state + evaluation, decide which objectives were achieved
 * and which outcome branch fires. Scene-state checks override evaluator
 * judgement for objectives that define a `check`, because scene state is ground
 * truth (e.g. "final base >= X" is a fact, not an opinion).
 */
import type { Evaluation } from "../types/evaluation";
import type { AnyQuestDefinition, OutcomeBranch, OutcomeContext, SceneContext } from "../types/quest";

export function resolveObjectives(
  quest: AnyQuestDefinition,
  ctx: SceneContext<Record<string, unknown>, Record<string, unknown>>,
  evaluation: Evaluation,
): Set<string> {
  const achieved = new Set<string>();
  for (const obj of quest.objectives) {
    if (obj.check) {
      if (obj.check(ctx.scene, ctx.hidden)) achieved.add(obj.id);
    } else {
      const r = evaluation.objectiveResults.find((o) => o.objectiveId === obj.id);
      if (r?.achieved) achieved.add(obj.id);
    }
  }
  return achieved;
}

export function resolveOutcome(
  quest: AnyQuestDefinition,
  ctx: OutcomeContext<Record<string, unknown>, Record<string, unknown>>,
): OutcomeBranch<Record<string, unknown>, Record<string, unknown>> {
  for (const branch of quest.outcomes) {
    let matched = false;
    try {
      matched = branch.when(ctx);
    } catch (err) {
      // A buggy predicate must not take the whole game down; log and skip.
      console.error(`[outcomes] predicate for ${quest.id}/${branch.id} threw`, err);
    }
    if (matched) return branch;
  }
  // Content error: quests must end with a catch-all. Synthesize a safe fallback.
  return {
    id: "unresolved",
    label: "Unresolved",
    grade: "partial",
    when: () => true,
    narrative: () => "The conversation ended without a clear resolution.",
    consequences: () => [],
    rewardMultiplier: 0.6,
  };
}
