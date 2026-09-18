/**
 * Full-loop integration test: in-memory DB + fake provider.
 * Exercises start → turns → conclude → persistence → follow-up quest sees memory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/db/client";
import { players, users, worldStates, aiCalls } from "@/db/schema";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { createEmptyProfile } from "@/engine/competency";
import { createInitialWorldState } from "@/engine/types/world";
import { makeTestEnv } from "@/engine/util";
import { MemoryAnalytics } from "./analytics";
import { GameError, GameService } from "./orchestrator";
import { loadPlayerState } from "./player";

let db: Db;
let game: GameService;
let analytics: MemoryAnalytics;
let provider: FakeProvider;
const playerId = "p1";

async function seed() {
  const now = "2026-01-01T00:00:00.000Z";
  await db.insert(users).values({ id: "u1", email: "a@b.c", passwordHash: "x", createdAt: now });
  await db.insert(players).values({ id: playerId, userId: "u1", displayName: "Asha", onboardingCompletedAt: now, competencies: createEmptyProfile(), createdAt: now, updatedAt: now });
  // Most tests here exercise The Counter Offer: start the player at that point of the campaign.
  const world = createInitialWorldState();
  world.career.status = "offer_received";
  world.unlockedQuests.push("counter_offer");
  await db.insert(worldStates).values({ playerId, state: world, version: 1, updatedAt: now });
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seed();
  analytics = new MemoryAnalytics();
  provider = new FakeProvider();
  game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
});

describe("quest loop", () => {
  it("runs The Counter Offer end to end and persists consequences", async () => {
    const attempt = await game.startQuest(playerId, "counter_offer", "voice");
    expect(attempt.status).toBe("active");
    expect(attempt.turns).toHaveLength(1);
    expect(attempt.turns[0].speaker).toBe("npc");
    expect(attempt.visibleStatus[0]).toEqual({ label: "Base on the table", value: "₹8.5L" });
    expect(analytics.events.map((e) => e.type)).toEqual(["quest_started", "voice_conversation_started"]);

    const speech: string[] = [];
    const t1 = await game.submitPlayerTurn(playerId, attempt.id, "Thanks Emma. Based on the market benchmark for this role and the platform I delivered last year, I was hoping for 10 lakh base.", "voice", (s) => speech.push(s));
    expect(speech.length).toBeGreaterThan(0);
    expect(t1.npcText.length).toBeGreaterThan(0);
    expect(t1.attempt.scene.turnCount).toBe(1);
    expect(t1.attempt.scene.signalCounts.evidence_provided).toBe(1);
    const base1 = t1.attempt.scene.custom.currentBase as number;
    expect(base1).toBeGreaterThan(850000);

    const t2 = await game.submitPlayerTurn(playerId, attempt.id, "That helps. Beyond base, is there any flexibility on a joining bonus or the total package?", "text");
    expect(t2.attempt.scene.revealed).toContain("bonus_flexible");
    expect(t2.attempt.scene.custom.currentSigningBonus).toBe(40000);
    expect(t2.attempt.visibleStatus.map((v) => v.label)).toContain("Joining bonus");

    const t3 = await game.submitPlayerTurn(playerId, attempt.id, "I appreciate that. Let's do it — I accept.", "text");
    expect(t3.attempt.turns).toHaveLength(7);

    const done = await game.concludeQuest(playerId, attempt.id);
    expect(done.status).toBe("completed");
    expect(done.result).not.toBeNull();
    expect(done.evaluation).not.toBeNull();
    expect(["strong_deal", "modest_deal"]).toContain(done.result!.outcomeId);
    expect(done.result!.rewards.xp.find((x) => x.skill === "negotiation")!.xp).toBeGreaterThan(0);
    expect(done.result!.rewards.followUpQuestIds).toEqual(["first_day_nova_labs"]);
    expect(done.result!.shareCard.lines[0]).toEqual({ label: "Base", before: "₹8.5L", after: expect.stringMatching(/₹/) });

    // Persistence: world state, competencies, NPC memory & relationship.
    const state = await loadPlayerState(db, playerId);
    expect(state.world.career.status).toBe("employed");
    expect(state.world.career.employer).toBe("Nova Labs");
    expect(state.world.career.baseSalary).toBe(base1);
    expect(state.world.unlockedQuests).toContain("first_day_nova_labs");
    expect(state.world.completedQuests[0].questId).toBe("counter_offer");
    expect(state.world.peopleMet).toContain("emma_kapoor");
    expect(state.competencies.negotiation.xp).toBeGreaterThan(0);
    expect(state.competencies.negotiation.facets.anchoring.samples).toBe(1);
    const emma = state.npcs.emma_kapoor;
    expect(emma.timesMet).toBe(1);
    expect(emma.memory.events.length).toBeGreaterThan(0);
    expect(emma.memory.lastInteractionSummary).toBeTruthy();
    expect(emma.relationship.familiarity).toBeGreaterThan(8);
    // NPC commitment ("send the letter") stays on NPC memory; player commitments would mirror to world.
    expect(emma.memory.commitments[0].by).toBe("npc");

    const types = analytics.events.map((e) => e.type);
    expect(types).toContain("quest_completed");
    expect(types).toContain("player.xp_gained");
    expect(types).toContain("npc.relationship_changed");
    expect(types).toContain("npc.memory_updated");
    expect(types).toContain("world.consequence_applied");
  });

  it("makes the follow-up quest available and feeds Emma's memory into the next prompt", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Given the benchmark data, I'm looking for 9.5 lakh.", "text");
    await game.submitPlayerTurn(playerId, a.id, "Great, I accept.", "text");
    await game.concludeQuest(playerId, a.id);

    await expect(game.startQuest(playerId, "push_back_on_deadline")).rejects.toBeInstanceOf(GameError);

    const b = await game.startQuest(playerId, "first_day_nova_labs");
    expect(b.questId).toBe("first_day_nova_labs");
    const openingCall = provider.calls.find((c) => c.task === "npc_opening" && c.system.includes("first day"));
    expect(openingCall).toBeDefined();
    expect(openingCall!.system).toContain("Last time you spoke");
    expect(openingCall!.system).toContain("Nova Labs offer");
    // Hidden state derived from world state.
    expect(b.hidden.baseSalary).toBe((await loadPlayerState(db, playerId)).world.career.baseSalary);
  });

  it("aggressive play produces a different outcome and a bruised relationship", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    const lines = [
      "This offer is an insult. I demand 12 lakh or I walk.",
      "That's my final offer, take it or leave it. Don't waste my time.",
      "I said 12 lakh. Non-negotiable.",
      "Unacceptable. Final offer.",
      "This is a waste of time. Final offer.",
    ];
    let attempt = a;
    for (const l of lines) {
      if (attempt.scene.ended) break;
      attempt = (await game.submitPlayerTurn(playerId, a.id, l, "text")).attempt;
    }
    expect(attempt.scene.patience).toBeLessThan(30);
    const done = await game.concludeQuest(playerId, a.id);
    expect(["walked_away", "no_change", "hardball_deal"]).toContain(done.result!.outcomeId);
    const state = await loadPlayerState(db, playerId);
    expect(state.npcs.emma_kapoor.relationship.warmth).toBeLessThanOrEqual(10);
    expect(state.npcs.emma_kapoor.memory.beliefs.some((b) => b.valence < 0)).toBe(true);
  });

  it("refuses to start a locked quest, refuses turns after the scene ends, and can abandon", async () => {
    await expect(game.startQuest(playerId, "first_day_nova_labs")).rejects.toMatchObject({ code: "prerequisites" });
    const a = await game.startQuest(playerId, "introduce_yourself");
    await expect(game.concludeQuest(playerId, a.id)).rejects.toMatchObject({ code: "state" });
    await game.abandonQuest(playerId, a.id);
    await expect(game.submitPlayerTurn(playerId, a.id, "hi", "text")).rejects.toMatchObject({ code: "state" });
    expect(analytics.events.some((e) => e.type === "conversation_abandoned")).toBe(true);
    // Starting another quest is fine afterwards, and it's a retry.
    const b = await game.startQuest(playerId, "introduce_yourself");
    expect(b.status).toBe("active");
  });

  it("starting a new quest abandons the previous active one", async () => {
    const a = await game.startQuest(playerId, "introduce_yourself");
    const b = await game.startQuest(playerId, "counter_offer");
    const aView = await game.getAttempt(playerId, a.id);
    expect(aView.status).toBe("abandoned");
    expect((await game.getActiveAttempt(playerId))?.id).toBe(b.id);
  });

  it("rejects other players' attempts", async () => {
    const a = await game.startQuest(playerId, "introduce_yourself");
    await expect(game.getAttempt("someone_else", a.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("invalid AI output", () => {
  it("keeps the game going when the NPC model emits garbage", async () => {
    provider = new FakeProvider({ scripted: { npc_turn: () => "I'm not following the format at all {{{" } });
    game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
    const a = await game.startQuest(playerId, "counter_offer");
    const t = await game.submitPlayerTurn(playerId, a.id, "Hello", "text");
    expect(t.npcText).toContain("not following the format");
    expect(t.attempt.scene.turnCount).toBe(1);
    expect(t.attempt.scene.custom.currentBase).toBe(850000);
  });

  it("retries evaluation once with a correction, then fails cleanly and leaves the attempt resumable", async () => {
    let n = 0;
    const log = new MemoryAILogSink();
    provider = new FakeProvider({ scripted: { evaluate: () => (n++ === 0 ? "not json" : JSON.stringify({ summary: "ok", headline: "h", overallScore: 50, rubricScores: [], behaviors: [], strengths: [], improvements: [], keyMoments: [], objectiveResults: [] })) } });
    game = new GameService({ db, provider, aiLog: log, analytics, env: makeTestEnv() });
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Hello", "text");
    const done = await game.concludeQuest(playerId, a.id);
    expect(done.status).toBe("completed");
    expect(n).toBe(2);
    expect(log.entries.filter((e) => e.task === "evaluate")).toHaveLength(2);
    expect(log.entries.some((e) => e.problems?.some((p) => p.includes("invalid")))).toBe(true);

    // Now a provider that never produces valid JSON.
    provider = new FakeProvider({ scripted: { evaluate: () => "nope" } });
    game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
    const b = await game.startQuest(playerId, "introduce_yourself");
    await game.submitPlayerTurn(playerId, b.id, "Hi, I'm Asha.", "text");
    await expect(game.concludeQuest(playerId, b.id)).rejects.toMatchObject({ code: "ai" });
    expect((await game.getAttempt(playerId, b.id)).status).toBe("active");
  });

  it("does not lose the result if memory extraction fails", async () => {
    provider = new FakeProvider({ scripted: { extract_memory: () => "{{ broken" } });
    game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Based on the market data I'd like 9.5 lakh.", "text");
    const done = await game.concludeQuest(playerId, a.id);
    expect(done.status).toBe("completed");
    const state = await loadPlayerState(db, playerId);
    expect(state.npcs.emma_kapoor.memory.lastInteractionSummary).toBeTruthy();
    expect(state.npcs.emma_kapoor.memory.events.length).toBe(0);
  });

  it("rolls back the player turn when the NPC call throws", async () => {
    provider = new FakeProvider({
      scripted: {
        npc_turn: () => {
          throw new Error("boom");
        },
      },
    });
    game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
    const a = await game.startQuest(playerId, "counter_offer");
    await expect(game.submitPlayerTurn(playerId, a.id, "Hello", "text")).rejects.toMatchObject({ code: "ai" });
    expect((await game.getAttempt(playerId, a.id)).turns).toHaveLength(1);
  });
});

describe("db bookkeeping", () => {
  it("ai call logs can be persisted through the schema", async () => {
    await db.insert(aiCalls).values({ id: "c1", task: "npc_turn", provider: "fake", model: "fake-1", latencyMs: 12, inputTokens: 1, outputTokens: 1, ok: true, error: null, problems: ["x"], attemptId: null, playerId, createdAt: "2026-01-01T00:00:00.000Z" });
    const row = await db.query.aiCalls.findFirst({ where: eq(aiCalls.id, "c1") });
    expect(row?.problems).toEqual(["x"]);
  });
});
