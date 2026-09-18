/**
 * AI task: memory extraction.
 *
 * After a conversation ends, produce candidate memory items *from the NPC's
 * point of view*. The deterministic merge (engine/memory) decides what sticks.
 */
import { MemoryExtractionSchema, type MemoryExtraction, type NPCDefinition } from "@/engine/types/npc";
import type { Evaluation } from "@/engine/types/evaluation";
import type { DialogueTurn } from "@/engine/types/scene";
import type { AnyQuestDefinition, SceneContext } from "@/engine/types/quest";
import { renderTranscript, runStructuredTask, type TaskContext } from "./shared";

export interface ExtractMemoryInput {
  quest: AnyQuestDefinition;
  npcDef: NPCDefinition;
  sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>;
  turns: DialogueTurn[];
  playerName: string;
  evaluation: Evaluation;
  outcomeLabel: string;
}

export function buildMemoryPrompt(input: ExtractMemoryInput): { system: string; user: string } {
  const { npcDef, playerName, quest, sceneCtx, outcomeLabel } = input;
  const system = `You maintain the long-term memory of ${npcDef.name} (${npcDef.role}, ${npcDef.organisation}), a persistent character in a game. After each conversation with ${playerName}, you extract what ${npcDef.shortName} would genuinely remember. Write from ${npcDef.shortName}'s point of view, in ${npcDef.shortName}'s voice, first person.

Personality (colours what they notice): ${npcDef.personality.summary}

Scenario: ${quest.title}. Outcome: ${outcomeLabel}.
Final state: ${JSON.stringify(sceneCtx.scene.custom)}

Rules:
- facts: durable, checkable things about ${playerName} (current employer, stated goals, claimed offers, agreed numbers). Use stable snake_case keys like "player.current_role". Max 6.
- beliefs: ${npcDef.shortName}'s impressions of ${playerName} as a person and operator (prepared, honest, pushy, evasive, warm...). Keys are short snake_case adjectives. valence -1..1, strength 0..1, with a short evidence quote. Max 5.
- events: 1-3 memorable moments, each one sentence, importance 0..1. Include the outcome itself.
- commitments: promises made by either side, with dueBy as an ISO date or null. Only real commitments.
- interactionSummary: 1-2 sentences ${npcDef.shortName} would say if asked "how did it go with ${playerName}?"

Return ONLY a JSON object:
{"facts":[{"key":"","statement":"","confidence":0.9}],"beliefs":[{"key":"","statement":"","valence":0,"strength":0,"evidence":""}],"events":[{"summary":"","importance":0.8,"emotionalTone":"positive|negative|mixed|neutral"}],"commitments":[{"by":"player|npc","description":"","dueBy":null}],"interactionSummary":""}`;

  const user = `# Transcript\n${renderTranscript(input.turns, playerName, npcDef.shortName)}\n\n# Evaluator's summary (for context only; remember as ${npcDef.shortName}, not as a judge)\n${input.evaluation.summary}\n\nExtract ${npcDef.shortName}'s memory now.`;
  return { system, user };
}

export async function extractMemory(ctx: TaskContext, input: ExtractMemoryInput): Promise<{ extraction: MemoryExtraction; problems: string[] }> {
  const { system, user } = buildMemoryPrompt(input);
  const { value, problems } = await runStructuredTask(
    ctx,
    { task: "extract_memory", system, messages: [{ role: "user", content: user }], maxTokens: 2000, temperature: 0.3, effort: "low", jsonMode: true },
    MemoryExtractionSchema,
  );
  return { extraction: value, problems };
}
