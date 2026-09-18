/**
 * AI task: evaluation.
 *
 * Separate from NPC generation. Sees the full transcript, rubric, hidden state
 * and final scene state. Returns structured, evidence-backed judgements that
 * the competency engine and outcome resolver consume.
 */
import { EvaluationSchema, type Evaluation } from "@/engine/types/evaluation";
import type { DialogueTurn } from "@/engine/types/scene";
import type { AnyQuestDefinition, SceneContext } from "@/engine/types/quest";
import type { NPCDefinition } from "@/engine/types/npc";
import { SKILLS } from "@/engine/types/skills";
import { renderTranscript, runStructuredTask, type TaskContext } from "./shared";

export interface EvaluateInput {
  quest: AnyQuestDefinition;
  npcDef: NPCDefinition;
  sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>;
  turns: DialogueTurn[];
  playerName: string;
}

export function buildEvaluationPrompt(input: EvaluateInput): { system: string; user: string } {
  const { quest, npcDef, sceneCtx, turns, playerName } = input;
  const rubric = quest.rubric
    .map(
      (c) =>
        `<criterion id="${c.id}" skill="${c.skill}" facet="${c.facet}" weight="${c.weight}">
${c.label}: ${c.description}
4/4 looks like: ${c.anchors.exemplary}
1/4 looks like: ${c.anchors.weak}
</criterion>`,
    )
    .join("\n");
  const objectives = quest.objectives
    .filter((o) => !o.check)
    .map((o) => `<objective id="${o.id}" kind="${o.kind}">${o.label}: ${o.description}</objective>`)
    .join("\n");
  const facets = quest.skills
    .map((s) => `${s}: ${SKILLS[s].facets.map((f) => `${f.id} (${f.description})`).join("; ")}`)
    .join("\n");
  const playerTurnIndexes = turns.filter((t) => t.speaker === "player").map((t) => t.index);

  const system = `You are the evaluation engine for a conversation-skills game. You assess how ${playerName} (the player) handled a scenario, using the transcript, the scenario rubric, and ground truth the player could not see. You are rigorous, specific and fair. You never invent evidence: every judgement cites the player's actual words.

# Scenario
${quest.title} — ${quest.tagline}
Counterpart: ${npcDef.name}, ${npcDef.role} at ${npcDef.organisation}.
Player objective: ${quest.briefing.objective}
${quest.evaluatorNotes ? `Scenario-specific guidance: ${quest.evaluatorNotes}` : ""}

# Ground truth (hidden from the player)
${quest.scene.hiddenBriefing(sceneCtx)}

# Final scene state
${JSON.stringify({ custom: sceneCtx.scene.custom, revealed: sceneCtx.scene.revealed, patience: sceneCtx.scene.patience, stance: sceneCtx.scene.stance, ended: sceneCtx.scene.ended, signalCounts: sceneCtx.scene.signalCounts }, null, 0)}

# Rubric (score each criterion 0-4)
${rubric}

# Objectives to judge (true/false with evidence)
${objectives || "(none — all objectives are checked deterministically)"}

# Facets you may report in "behaviors" (use exact skill and facet ids)
${facets}

# Feedback quality bar
Bad: "Great job. Be more confident."
Good: "You rejected the deadline clearly, but you didn't offer an alternative. A stronger response would protect quality while proposing a narrower Friday deliverable and a Monday completion date."
Every improvement must include a concrete "betterMove": what the player could literally have said.
Strengths must be real; if the player did poorly, list fewer strengths, not weaker ones.
Only report behaviors you actually observed; score 0.5 means neutral. Include negative behaviors (e.g. protecting_leverage 0.1 if they revealed their minimum).
keyMoments.turnIndex must be one of the player's turn indexes: ${playerTurnIndexes.join(", ")}.

# Output
Return ONLY a JSON object, no prose, no code fences:
{
  "summary": "one paragraph, second person, specific",
  "headline": "3-7 word share-card line, e.g. 'Protected leverage under pressure'",
  "overallScore": 0-100,
  "rubricScores": [{"criterionId": "...", "score": 0-4, "evidence": "quote from player", "note": "why"}],
  "behaviors": [{"skill": "negotiation", "facet": "anchoring", "score": 0.0-1.0, "evidence": "quote", "note": "short"}],
  "strengths": [{"title": "...", "detail": "..."}],
  "improvements": [{"title": "...", "detail": "...", "betterMove": "..."}],
  "keyMoments": [{"turnIndex": n, "label": "...", "impact": "positive|negative|neutral", "detail": "..."}],
  "objectiveResults": [{"objectiveId": "...", "achieved": true, "evidence": "..."}]
}`;

  const user = `# Transcript\n${renderTranscript(turns, playerName, npcDef.shortName)}\n\nEvaluate ${playerName}'s performance now.`;
  return { system, user };
}

export async function evaluateConversation(ctx: TaskContext, input: EvaluateInput): Promise<{ evaluation: Evaluation; problems: string[] }> {
  const { system, user } = buildEvaluationPrompt(input);
  const { value, problems } = await runStructuredTask(
    ctx,
    { task: "evaluate", system, messages: [{ role: "user", content: user }], maxTokens: 4000, temperature: 0.2, effort: "medium", jsonMode: true },
    EvaluationSchema,
  );
  return { evaluation: sanitizeEvaluation(value, input), problems };
}

/** Post-validation hygiene: drop rubric ids / objective ids the quest doesn't define. */
export function sanitizeEvaluation(ev: Evaluation, input: EvaluateInput): Evaluation {
  const criterionIds = new Set(input.quest.rubric.map((c) => c.id));
  const objectiveIds = new Set(input.quest.objectives.map((o) => o.id));
  const playerTurns = new Set(input.turns.filter((t) => t.speaker === "player").map((t) => t.index));
  return {
    ...ev,
    rubricScores: ev.rubricScores.filter((r) => criterionIds.has(r.criterionId)),
    objectiveResults: ev.objectiveResults.filter((o) => objectiveIds.has(o.objectiveId)),
    keyMoments: ev.keyMoments.filter((k) => playerTurns.size === 0 || playerTurns.has(k.turnIndex)),
    overallScore: Math.round(ev.overallScore),
  };
}
