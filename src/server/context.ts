/**
 * Composition root for the server: wires DB, AI provider, logging and analytics
 * into a GameService. Route handlers and server components call `getGame()`.
 */
import { getDb, type Db } from "@/db/client";
import { aiCalls } from "@/db/schema";
import { getLLMProvider } from "@/ai/registry";
import { CompositeAILogSink, consoleAILogSink, type AICallLog, type AILogSink } from "@/ai/logger";
import { env } from "@/lib/env";
import { defaultEnv } from "@/engine/util";
import { DbAnalytics } from "./analytics";
import { GameService } from "./orchestrator";

class DbAILogSink implements AILogSink {
  constructor(private db: Db) {}
  async log(e: AICallLog) {
    await this.db.insert(aiCalls).values({
      id: defaultEnv.id(),
      task: e.task,
      provider: e.provider,
      model: e.model,
      latencyMs: e.latencyMs,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      ok: e.ok,
      error: e.error ?? null,
      problems: e.problems?.length ? e.problems : null,
      attemptId: e.attemptId ?? null,
      playerId: e.playerId ?? null,
      createdAt: e.at,
    });
  }
}

let gamePromise: Promise<{ game: GameService; db: Db }> | null = null;

export function getGame(): Promise<{ game: GameService; db: Db }> {
  if (!gamePromise) {
    gamePromise = (async () => {
      const db = await getDb();
      const sinks: AILogSink[] = [new DbAILogSink(db)];
      if (env.LOG_AI_CALLS) sinks.push(consoleAILogSink);
      const game = new GameService({ db, provider: getLLMProvider(), aiLog: new CompositeAILogSink(sinks), analytics: new DbAnalytics(db) });
      return { game, db };
    })();
  }
  return gamePromise;
}
