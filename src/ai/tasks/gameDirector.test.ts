import { describe, it, expect } from "vitest";
import { proposeNextEvent } from "./gameDirector";
import { FakeProvider } from "../providers/fake";
import { MemoryAILogSink } from "../logger";
import { simulatedProfiles } from "@/engine/director/simulations";

describe("bounded narrative planning", () => {
  it("cancels slow planning and returns a validated authored event", async () => {
    const provider = new FakeProvider({ latencyMs: 1000 });
    const log = new MemoryAILogSink();
    const state = simulatedProfiles().C_avoids_the_ask;
    const result = await proposeNextEvent({ provider, log }, state, { timeoutMs: 10 });
    expect(result.selected?.questId).toBe("director_introduction");
    expect(result.audit.source).toBe("fallback");
    expect(result.audit.rejected[0].rule).toBe("planning_timeout");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal?.aborted).toBe(true);
  });
});
