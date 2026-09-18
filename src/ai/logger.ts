/**
 * AI call logging. Every model call goes through `withAILog` so latency,
 * tokens, failures and output problems are observable. The sink is injectable
 * (DB in production, in-memory in tests).
 */
import type { AITaskName } from "./provider";

export interface AICallLog {
  task: AITaskName;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
  error?: string;
  problems?: string[];
  attemptId?: string;
  playerId?: string;
  at: string;
}

export interface AILogSink {
  log(entry: AICallLog): Promise<void> | void;
}

export const consoleAILogSink: AILogSink = {
  log(e) {
    const status = e.ok ? "ok" : "FAIL";
    const extra = e.problems?.length ? ` problems=[${e.problems.join(" | ")}]` : "";
    const err = e.error ? ` error=${e.error}` : "";
    console.log(`[ai] ${e.task} ${status} ${e.provider}/${e.model} ${e.latencyMs}ms in=${e.inputTokens} out=${e.outputTokens}${extra}${err}`);
  },
};

export class MemoryAILogSink implements AILogSink {
  entries: AICallLog[] = [];
  log(e: AICallLog) {
    this.entries.push(e);
  }
}

export class CompositeAILogSink implements AILogSink {
  constructor(private sinks: AILogSink[]) {}
  async log(e: AICallLog) {
    await Promise.all(this.sinks.map((s) => s.log(e)));
  }
}
