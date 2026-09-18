/**
 * The public API contract is what native clients will build against. These
 * tests pin it: every read model validates against its zod schema, hidden
 * state never leaks, and bearer-token auth + turn concurrency behave.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { dialogueTurns, questAttempts } from "@/db/schema";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { makeTestEnv } from "@/engine/util";
import {
  AttemptEnvelopeSchema,
  AuthSessionSchema,
  DebriefSchema,
  DossierSchema,
  QuestBriefingSchema,
  WorldOverviewSchema,
} from "@/contracts/api";
import { MemoryAnalytics } from "./analytics";
import { loginAccount, onboardPlayer, registerAccount, ValidationError } from "./account";
import { AuthError, resolvePlayerFromToken, revokeSession } from "./auth";
import { GameError, GameService } from "./orchestrator";
import { attemptEnvelope, debrief, dossier, questBriefing, toClientAttempt, worldOverview } from "./queries";
import { eq } from "drizzle-orm";

let db: Db;
let game: GameService;
let playerId: string;
let token: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  game = new GameService({ db, provider: new FakeProvider(), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
  const session = await registerAccount(db, { email: `p${Math.random()}@t.local`, password: "password123" });
  playerId = session.player.playerId;
  token = session.token;
  await onboardPlayer(db, playerId, { displayName: "Asha" });
});

describe("auth for native clients (bearer tokens)", () => {
  it("issues a contract-shaped session whose token resolves to the player", async () => {
    const email = `n${Math.random()}@t.local`;
    const s = await registerAccount(db, { email, password: "password123" });
    expect(AuthSessionSchema.parse(s)).toEqual(s);
    expect(s.player.onboardingCompleted).toBe(false);
    expect((await resolvePlayerFromToken(db, s.token))?.playerId).toBe(s.player.playerId);

    const again = await loginAccount(db, { email, password: "password123" });
    expect(again.token).not.toBe(s.token);
    expect((await resolvePlayerFromToken(db, again.token))?.playerId).toBe(s.player.playerId);
  });

  it("rejects bad credentials, invalid input, and revoked or unknown tokens", async () => {
    await expect(loginAccount(db, { email: "nobody@t.local", password: "password123" })).rejects.toBeInstanceOf(AuthError);
    await expect(registerAccount(db, { email: "not-an-email", password: "password123" })).rejects.toBeInstanceOf(ValidationError);
    await expect(onboardPlayer(db, playerId, { displayName: "A" })).rejects.toBeInstanceOf(ValidationError);
    expect(await resolvePlayerFromToken(db, "garbage")).toBeNull();
    expect(await resolvePlayerFromToken(db, null)).toBeNull();
    await revokeSession(db, token);
    expect(await resolvePlayerFromToken(db, token)).toBeNull();
  });
});

describe("read models conform to the public contract", () => {
  it("world overview, briefing and dossier validate before and after a quest", async () => {
    const before = WorldOverviewSchema.parse(await worldOverview(game, playerId));
    expect(before.player.displayName).toBe("Asha");
    expect(before.activeAttempt).toBeNull();
    expect(before.worlds.find((w) => w.id === "career_city")?.quests.find((q) => q.id === "counter_offer")?.availability).toBe("available");

    const locked = QuestBriefingSchema.parse(await questBriefing(game, playerId, "first_day_nova_labs"));
    expect(locked.canStart).toBe(false);
    expect(locked.unmet[0]).toContain("The Counter Offer"); // titles, not ids

    const a = await game.startQuest(playerId, "counter_offer");
    expect((await worldOverview(game, playerId)).activeAttempt?.attemptId).toBe(a.id);
    await game.submitPlayerTurn(playerId, a.id, "Given the market benchmark data I'd like 9.5 lakh.", "text");
    await game.submitPlayerTurn(playerId, a.id, "Great, I accept.", "text");
    await game.concludeQuest(playerId, a.id);

    const after = WorldOverviewSchema.parse(await worldOverview(game, playerId));
    expect(after.stateVersion).toBeGreaterThan(before.stateVersion);
    expect(after.career.status).toBe("employed");
    expect(after.people.map((p) => p.npcId)).toContain("emma_kapoor");

    const d = DossierSchema.parse(await dossier(game, playerId, "emma_kapoor"));
    expect(d.met).toBe(true);
    expect(d.history[0].questTitle).toBe("The Counter Offer");

    const next = QuestBriefingSchema.parse(await questBriefing(game, playerId, "first_day_nova_labs"));
    expect(next.canStart).toBe(true);
  });

  it("debrief validates and is only available once concluded", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Based on market data I'd like ten lakh.", "text");
    await expect(debrief(game, playerId, a.id)).rejects.toMatchObject({ code: "state" });
    await game.concludeQuest(playerId, a.id);
    const r = DebriefSchema.parse(await debrief(game, playerId, a.id));
    expect(r.objectives.find((o) => o.id === "improve_offer")).toBeDefined();
    expect(r.worldChanges.some((w) => w.includes("Nova Labs"))).toBe(true);
    expect(r.worldChanges.every((w) => !w.includes("nova_labs."))).toBe(true); // no internal flags
  });

  it("never exposes hidden NPC state and reports the quest's real turn limit", async () => {
    const a = await game.startQuest(playerId, "introduce_yourself");
    const env = AttemptEnvelopeSchema.parse(attemptEnvelope(a));
    const json = JSON.stringify(env);
    expect(json).not.toContain("hidden");
    expect(json).not.toContain("priyaInAHurry");
    expect(json).not.toContain("patience");
    expect(env.attempt.maxTurns).toBe(5); // introduce_yourself.maxTurns, not a default
    expect(toClientAttempt(await game.startQuest(playerId, "counter_offer")).maxTurns).toBe(12);
    expect(env.scene.npc.voice.lang).toBeTruthy();
  });
});

describe("concluding is exactly-once under retries and concurrency", () => {
  it("two concurrent concludes apply rewards and consequences once", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Given the market benchmark data I'd like 9.5 lakh.", "text");
    const results = await Promise.allSettled([game.concludeQuest(playerId, a.id), game.concludeQuest(playerId, a.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
    const state = await game.getPlayerState(playerId);
    expect(state.world.completedQuests.filter((q) => q.questId === "counter_offer")).toHaveLength(1);
    expect(state.npcs.emma_kapoor.timesMet).toBe(1);
    // A retry after completion is a no-op that returns the result.
    const xp = state.competencies.negotiation.xp;
    expect((await game.concludeQuest(playerId, a.id)).status).toBe("completed");
    expect((await game.getPlayerState(playerId)).competencies.negotiation.xp).toBe(xp);
  });

  it("a crashed evaluation (stale 'evaluating' claim) can be concluded again", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    await game.submitPlayerTurn(playerId, a.id, "Hello there, thanks for the call.", "text");
    await db.update(questAttempts).set({ status: "evaluating", updatedAt: "2000-01-01T00:00:00.000Z" }).where(eq(questAttempts.id, a.id));
    expect((await game.concludeQuest(playerId, a.id)).status).toBe("completed");
  });
});

describe("turn submission is safe under retries and concurrency", () => {
  it("rejects a stale expectedTurnCount with a conflict and appends nothing", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    await expect(game.submitPlayerTurn(playerId, a.id, "Hello", "text", undefined, { expectedTurnCount: 5 })).rejects.toMatchObject({ code: "conflict" });
    expect((await game.getAttempt(playerId, a.id)).turns).toHaveLength(1);
    const ok = await game.submitPlayerTurn(playerId, a.id, "Hello", "text", undefined, { expectedTurnCount: 1 });
    expect(ok.attempt.turns).toHaveLength(3);
    // A retry of the same request (client didn't see the reply) is now stale → conflict, not a duplicate.
    await expect(game.submitPlayerTurn(playerId, a.id, "Hello", "text", undefined, { expectedTurnCount: 1 })).rejects.toBeInstanceOf(GameError);
    expect((await game.getAttempt(playerId, a.id)).turns).toHaveLength(3);
  });

  it("rejects a second turn while a reply is in flight", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    const results = await Promise.allSettled([
      game.submitPlayerTurn(playerId, a.id, "First line", "text"),
      game.submitPlayerTurn(playerId, a.id, "Second line", "text"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "conflict" });
    const turns = (await game.getAttempt(playerId, a.id)).turns;
    expect(turns.map((t) => t.speaker)).toEqual(["npc", "player", "npc"]);
  });

  it("recovers from a player turn orphaned by a crash", async () => {
    const a = await game.startQuest(playerId, "counter_offer");
    // Simulate a crash mid-reply: a player turn with no NPC reply, created long ago.
    await db.insert(dialogueTurns).values({ id: "orphan", attemptId: a.id, idx: 1, speaker: "player", text: "lost", modality: "text", moves: null, createdAt: "2000-01-01T00:00:00.000Z" });
    const r = await game.submitPlayerTurn(playerId, a.id, "Hello again", "text");
    expect(r.attempt.turns.map((t) => t.text)).not.toContain("lost");
    expect(await db.query.dialogueTurns.findFirst({ where: eq(dialogueTurns.id, "orphan") })).toBeUndefined();
  });
});
