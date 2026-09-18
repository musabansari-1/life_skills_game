/**
 * Shared machinery for AI tasks: logging, structured-output retries and
 * transcript rendering. Each task file composes these.
 */
import type { z } from "zod";
import type { DialogueTurn } from "@/engine/types/scene";
import { parseJsonWithSchema } from "../json";
import type { AICallLog, AILogSink } from "../logger";
import { AIProviderError, type AITaskName, type CompletionRequest, type LLMProvider } from "../provider";

export interface TaskContext {
  provider: LLMProvider;
  log: AILogSink;
  attemptId?: string;
  playerId?: string;
}

export async function logged<T extends { model: string; usage: { inputTokens: number; outputTokens: number } }>(
  ctx: TaskContext,
  task: AITaskName,
  fn: () => Promise<T>,
  problems?: () => string[] | undefined,
): Promise<T> {
  const started = Date.now();
  const base: Omit<AICallLog, "ok" | "latencyMs" | "model" | "inputTokens" | "outputTokens"> = {
    task,
    provider: ctx.provider.name,
    attemptId: ctx.attemptId,
    playerId: ctx.playerId,
    at: new Date().toISOString(),
  };
  try {
    const res = await fn();
    await ctx.log.log({
      ...base,
      ok: true,
      latencyMs: Date.now() - started,
      model: res.model,
      inputTokens: Math.round(res.usage.inputTokens),
      outputTokens: Math.round(res.usage.outputTokens),
      problems: problems?.(),
    });
    return res;
  } catch (err) {
    await ctx.log.log({
      ...base,
      ok: false,
      latencyMs: Date.now() - started,
      model: "?",
      inputTokens: 0,
      outputTokens: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Run a JSON-producing task with validation and one corrective retry.
 * On the retry, the model sees its own invalid output and the validation error.
 */
export async function runStructuredTask<S extends z.ZodTypeAny>(
  ctx: TaskContext,
  req: CompletionRequest,
  schema: S,
  opts: { maxAttempts?: number } = {},
): Promise<{ value: z.infer<S>; problems: string[] }> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const problems: string[] = [];
  let messages = req.messages;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await logged(ctx, req.task, () => ctx.provider.complete({ ...req, messages }), () => problems);
    if (res.stopReason === "refusal") throw new AIProviderError("Model refused the request", ctx.provider.name, false);
    const parsed = parseJsonWithSchema(res.text, schema);
    if (parsed.ok) {
      if (parsed.repaired) problems.push("json repaired");
      return { value: parsed.value, problems };
    }
    lastError = parsed.error;
    problems.push(`attempt ${attempt} invalid: ${parsed.error}`);
    messages = [
      ...req.messages,
      { role: "assistant", content: res.text.slice(0, 6000) },
      {
        role: "user",
        content: `Your previous output was not valid. Error: ${parsed.error}\nReturn ONLY a single JSON object that matches the schema exactly. No prose, no code fences.`,
      },
    ];
  }
  throw new AIProviderError(`Structured output failed after ${maxAttempts} attempts: ${lastError}`, ctx.provider.name, true);
}

export function renderTranscript(turns: DialogueTurn[], playerName: string, npcName: string): string {
  return turns
    .filter((t) => t.speaker !== "system")
    .map((t) => `[${t.index}] ${t.speaker === "player" ? playerName : npcName}: ${t.text}`)
    .join("\n");
}

/** Last N turns as chat messages for the NPC model (player = user, npc = assistant). */
export function recentTurnsAsMessages(turns: DialogueTurn[], window = 14): CompletionRequest["messages"] {
  const recent = turns.filter((t) => t.speaker !== "system").slice(-window);
  return recent.map((t) => ({ role: t.speaker === "player" ? "user" : "assistant", content: t.text }));
}
