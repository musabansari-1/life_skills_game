import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { simulatedProfiles } from "@/engine/director/simulations";
import { makeTestEnv } from "@/engine/util";
import { WorldOverviewSchema, QuestBriefingSchema, AttemptEnvelopeSchema, DebriefSchema } from "@/contracts/api";
import { GameService } from "./orchestrator";
import { MemoryAnalytics } from "./analytics";
import { registerAccount } from "./account";
import { saveCompetencies, saveNpcState, saveWorldState } from "./player";
import { attemptEnvelope, debrief, questBriefing, worldOverview } from "./queries";
import type { Client } from "@libsql/client";

let db: Db, client: Client, game: GameService, playerId: string, provider: FakeProvider;
beforeEach(async () => {
  ({ db, client } = await createTestDb());
  provider = new FakeProvider();
  game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv(Date.UTC(2026, 8, 10)) });
  playerId = (await registerAccount(db, { email: "story@test.local", password: "password123" })).player.playerId;
});
afterEach(() => client.close());

async function seed(profile = "C_avoids_the_ask") {
  const state = simulatedProfiles()[profile];
  await saveWorldState(db, playerId, state.world);
  await saveCompetencies(db, playerId, state.competencies);
  for (const npc of Object.values(state.npcs)) if (npc) await saveNpcState(db, playerId, npc);
  return state;
}
async function succeed(questId: string, mode: "story" | "practice" = "story") {
  const a = await game.startQuest(playerId, questId, "text", mode);
  for (const line of [
    "What support and capacity would make this work for the team?",
    "I understand your reputation is at risk if the plan goes wrong.",
    "I delivered a migration for 3000 accounts last month.",
    "I reduced the backup time by 30 percent.",
    "I propose a smaller two-week pilot with a written checkpoint.",
  ]) await game.submitPlayerTurn(playerId, a.id, line, "text");
  return game.concludeQuest(playerId, a.id);
}

describe("saved personalized stories", () => {
  it("approves, plays, evaluates and persists an earned introduction through the shared API", async () => {
    await seed();
    await game.refreshDirector(playerId);
    const overview = WorldOverviewSchema.parse(await worldOverview(game, playerId));
    expect(overview.narrative?.recommendation).toMatchObject({ questId: "director_introduction", approved: true });
    const briefing = QuestBriefingSchema.parse(await questBriefing(game, playerId, "director_introduction"));
    expect(briefing.title).toBe("The Ask You Haven't Made");
    expect(briefing.difficulty).toBe(2);
    expect(JSON.stringify(briefing)).not.toContain("evidenceRequired");
    const done = await succeed("director_introduction");
    expect(done.result?.grade).toBe("success");
    const envelope = AttemptEnvelopeSchema.parse(attemptEnvelope(done));
    expect(envelope.scene.quest.title).toBe(briefing.title);
    expect(JSON.stringify(envelope)).not.toMatch(/AGREEMENT_ALLOWED|evidenceFacts|evidenceRequired|hiddenBriefing/);
    const result = DebriefSchema.parse(await debrief(game, playerId, done.id));
    expect(result.worldChanges.join()).toContain("internal pilot");
    const state = await game.getPlayerState(playerId);
    expect(state.world.opportunities).toHaveLength(1);
    expect(state.world.director.characters.emma_kapoor.stage).toBe("advocate");
    expect(state.world.director.threads.find((t) => t.id === "emma_returns")).toMatchObject({ status: "resolved", resolvedByAttemptId: done.id });
    const again = await game.concludeQuest(playerId, done.id);
    expect(again.result).toEqual(done.result);
    expect((await game.getPlayerState(playerId)).world).toEqual(state.world);
  });

  it("practice before the first story run changes skills but no canonical state", async () => {
    await seed(); await game.refreshDirector(playerId);
    const before = await game.getPlayerState(playerId);
    const result = await succeed("director_introduction", "practice");
    expect(result.mode).toBe("rehearsal");
    expect(result.result?.grade).toBe("success");
    const after = await game.getPlayerState(playerId);
    expect(after.world).toEqual(before.world);
    expect(after.npcs).toEqual(before.npcs);
    expect(after.competencies).not.toEqual(before.competencies);
    const canon = await game.startQuest(playerId, "director_introduction");
    expect(canon.mode).toBe("first");
  });

  it("a failed personalized meeting stays canonical even after a successful rehearsal", async () => {
    await seed(); await game.refreshDirector(playerId);
    const failed = await game.startQuest(playerId, "director_introduction");
    await game.submitPlayerTurn(playerId, failed.id, "I just think I deserve it. It should be obvious.", "text");
    await game.concludeQuest(playerId, failed.id);
    const before = await game.getPlayerState(playerId);
    expect(before.world.failedQuests.some((q) => q.attemptId === failed.id)).toBe(true);
    const replay = await succeed("director_introduction");
    expect(replay.mode).toBe("rehearsal");
    expect(replay.result?.grade).toBe("success");
    expect(replay.directorProposal).toEqual(failed.directorProposal);
    expect((await game.getPlayerState(playerId)).world).toEqual(before.world);
    expect((await game.getPlayerState(playerId)).npcs).toEqual(before.npcs);
  });

  it("replays retain the original difficulty and NPC limits after the world changes", async () => {
    await seed(); await game.refreshDirector(playerId);
    const original = await succeed("director_introduction");
    const current = await game.getPlayerState(playerId);
    current.world.director.reputation.reliable = -90;
    current.npcs.emma_kapoor.relationship.trust = -90;
    await saveWorldState(db, playerId, current.world);
    await saveNpcState(db, playerId, current.npcs.emma_kapoor);
    const replay = await game.startQuest(playerId, "director_introduction");
    expect(replay.hidden).toEqual(original.hidden);
    expect(replay.directorProposal?.difficulty).toBe(original.directorProposal?.difficulty);
  });

  it("malformed model proposals fall back and keep structured rejection reasons", async () => {
    await seed();
    const malicious = new FakeProvider({ scripted: { recommend: () => JSON.stringify({ questId: "director_introduction", xp: 9999999 }) } });
    game = new GameService({ db, provider: malicious, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
    const result = await game.refreshDirector(playerId);
    expect(result.recommended?.questId).toBe("director_introduction");
    expect(result.audits.at(-1)?.source).toBe("fallback");
    expect(result.audits.at(-1)?.rejected[0].rule).toBe("provider_or_schema");
    expect((await game.getPlayerState(playerId)).world.opportunities).toHaveLength(0);
  });

  it("reads are pure, refresh is repeat-safe, and goals cannot replace an active setup", async () => {
    await seed();
    const original = await game.getPlayerState(playerId);
    await worldOverview(game, playerId);
    expect((await game.getPlayerState(playerId)).world).toEqual(original.world);
    const first = await game.refreshDirector(playerId);
    const callCount = provider.calls.length;
    expect(await game.refreshDirector(playerId)).toEqual(first);
    expect(provider.calls.length).toBe(callCount);
    const a = await game.startQuest(playerId, "director_introduction");
    await expect(game.refreshDirector(playerId, { goals: ["leadership"], upcoming: null })).rejects.toThrow("Finish or leave");
    expect((await game.getAttempt(playerId, a.id)).directorProposal).toEqual(a.directorProposal);
  });

  it("rejects a delayed plan when another request changed the world", async () => {
    await seed();
    let resume!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const delayed = {
      name: "delayed-fixture",
      complete: async (req: Parameters<FakeProvider["complete"]>[0]) => { if (req.task === "recommend") { entered(); await held; } return provider.complete(req); },
      stream: provider.stream.bind(provider),
    };
    const slowGame = new GameService({ db, provider: delayed, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
    const pending = slowGame.refreshDirector(playerId);
    const rejected = expect(pending).rejects.toThrow("Your story changed");
    await waiting;
    const state = await game.getPlayerState(playerId);
    state.world.version++;
    state.world.director.preferences = { goals: ["listening"], upcoming: null };
    await saveWorldState(db, playerId, state.world);
    resume();
    await rejected;
    expect((await game.getPlayerState(playerId)).world.director.preferences.goals).toEqual(["listening"]);
    expect((await game.getPlayerState(playerId)).world.director.offers).toHaveLength(0);
  });

  it("the Thursday checkpoint changes the later incident without deleting its source decision", async () => {
    const state = await seed("A_overcommits");
    // Mid Act 2: the migration has been promised, the status update hasn't happened yet.
    state.world.completedQuests = state.world.completedQuests.filter((r) => !["status_update", "customer_escalation", "mentor_arjun", "feedback_for_rohan"].includes(r.questId));
    state.world.flags = state.world.flags.filter((f) => f !== "chapter1.complete" && f !== "chapter1.owned_incident");
    state.world.director.threads = []; state.world.director.clock = 5;
    state.world.unlockedQuests.push("status_update");
    state.world.commitments.push({ id: "friday", description: "Ship Friday without rollback.", toNpcId: "rohan_mehta", madeInQuestId: "push_back_on_deadline", madeAt: "2026-09-05", dueBy: null, status: "open" });
    await saveWorldState(db, playerId, state.world);
    await game.refreshDirector(playerId);
    const a = await game.startQuest(playerId, "director_checkpoint");
    for (const line of [
      "What does your director need for Friday?",
      "I understand the pressure from your director and the risk to your credibility.",
      "The rollback test failed, so the full migration risks losing accounts.",
      "I delivered the read-only prototype for 3000 accounts yesterday.",
      "I propose a smaller read-only demonstration Friday instead, with a rollback checkpoint Monday.",
    ]) await game.submitPlayerTurn(playerId, a.id, line, "text");
    expect((await game.concludeQuest(playerId, a.id)).result?.grade).toBe("success");
    const later = await game.startQuest(playerId, "status_update");
    expect(later.hidden.situation).toBe("slip");
    const after = await game.getPlayerState(playerId);
    expect(after.world.flags).toContain("nova_labs.rushed_migration");
    expect(after.world.commitments.find((c) => c.id === "friday")?.status).toBe("superseded");
    expect(after.world.decisions.some((d) => d.id === "friday_decision")).toBe(true);
    expect(after.world.director.threads.find((t) => t.id === "deadline_echo")?.sourceDecisionId).toBe("friday_decision");
  });
});
