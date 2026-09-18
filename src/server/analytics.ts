/**
 * Analytics + event log. Instrumentation only — no dashboard.
 * Every event is appended to the `events` table; the console sink mirrors it
 * in development. Swap in PostHog/Segment by adding a sink.
 */
import type { Db } from "@/db/client";
import { events } from "@/db/schema";
import type { GameEventType } from "@/engine/types/consequences";
import { env } from "@/lib/env";
import { defaultEnv } from "@/engine/util";

export interface AnalyticsSink {
  track(playerId: string, type: GameEventType, payload?: Record<string, unknown>): Promise<void>;
}

export class DbAnalytics implements AnalyticsSink {
  constructor(private db: Db) {}
  async track(playerId: string, type: GameEventType, payload: Record<string, unknown> = {}) {
    const at = defaultEnv.now();
    await this.db.insert(events).values({ id: defaultEnv.id(), playerId, type, payload, createdAt: at });
    if (env.ANALYTICS_SINK === "console") console.log(`[event] ${type} player=${playerId.slice(0, 8)} ${JSON.stringify(payload)}`);
  }
}

export class MemoryAnalytics implements AnalyticsSink {
  events: { playerId: string; type: GameEventType; payload: Record<string, unknown> }[] = [];
  async track(playerId: string, type: GameEventType, payload: Record<string, unknown> = {}) {
    this.events.push({ playerId, type, payload });
  }
}
