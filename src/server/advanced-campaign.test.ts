import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, type Db } from "@/db/client";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { simulatedProfiles } from "@/engine/director/simulations";
import { makeTestEnv } from "@/engine/util";
import { GameService } from "./orchestrator";
import { MemoryAnalytics } from "./analytics";
import { registerAccount } from "./account";
import { saveCompetencies, saveNpcState, saveWorldState } from "./player";
import { attemptEnvelope, debrief, worldOverview } from "./queries";
import { AttemptEnvelopeSchema, WorldOverviewSchema } from "@/contracts/api";
import { informationFor } from "@/engine/campaign/information";
import { renderTranscript } from "@/ai/tasks/shared";

let db: Db, client: Client, game: GameService, provider: FakeProvider, playerId: string;
export const crisisPlan = [
  "Rohan, I own my responsibility for the earlier estimate. I should have checked the assumptions.",
  "Nora, which customer reports matter most?",
  "Maya, what verification capacity and checks do you need?",
  "I propose a smaller read-only pilot instead of the full rollout. Keep the existing reports available; the new dashboard can wait. No overtime: protect the rollback checks.",
  "I'll own the customer message and coordinate the pilot. We will review it tomorrow at noon and stop if the rollback checks fail.",
];
beforeEach(async () => {
  ({ db, client } = await createTestDb()); provider = new FakeProvider();
  game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
  playerId = (await registerAccount(db, { email: "advanced@test.local", password: "password123" })).player.playerId;
  const seed = simulatedProfiles().D_ready_for_responsibility;
  await saveWorldState(db, playerId, seed.world); await saveCompetencies(db, playerId, seed.competencies);
  for (const n of Object.values(seed.npcs)) if (n) await saveNpcState(db, playerId, n);
});
afterEach(() => client.close());
describe("real multi-NPC campaign loop", () => {
  it("allows one autonomous NPC interjection, then returns the floor without charging another player turn", async () => {
    const a = await game.startQuest(playerId, "project_crisis");
    const primary = (await game.submitPlayerTurn(playerId, a.id, "Rohan, I own this. I promise the full migration today and everyone can do overtime.", "text")).attempt;
    expect(primary.turns.at(-1)?.identity?.npcId).toBe("rohan_mehta");
    expect(attemptEnvelope(primary).attempt.reactionAvailable).toBe(true);
    const reaction = await game.continueEnsemble(playerId, a.id, primary.turns.length);
    expect(reaction.turns.at(-1)?.identity).toMatchObject({ npcId: "maya_sen", addressedTo: "rohan_mehta", kind: "interjection", autonomous: true });
    expect(reaction.scene.turnCount).toBe(primary.scene.turnCount);
    expect(attemptEnvelope(reaction).attempt.reactionAvailable).toBe(false);
    expect((await game.continueEnsemble(playerId, a.id, reaction.turns.length)).turns).toEqual(reaction.turns);
    const cut = await game.reportDelivery(playerId, a.id, { turnIndex: reaction.turns.at(-1)!.index, heardText: "I can verify" });
    expect(cut.scene.revealed).not.toContain("capacity_constraint");
    expect(cut.scene.turnCount).toBe(primary.scene.turnCount);
    expect(cut.turns.at(-1)?.text).toBe("I can verify");
  });
  it("cancels an unspoken NPC reaction when the player interrupts or takes the floor", async () => {
    const a = await game.startQuest(playerId, "project_crisis");
    const primary = (await game.submitPlayerTurn(playerId, a.id, "Rohan, I promise the full migration today and everyone can do overtime.", "voice")).attempt;
    const cut = await game.reportDelivery(playerId, a.id, { turnIndex: primary.turns.at(-1)!.index, heardText: "" });
    expect(attemptEnvelope(cut).attempt.reactionAvailable).toBe(false);
    expect((await game.continueEnsemble(playerId, a.id, cut.turns.length)).turns).toHaveLength(cut.turns.length);
  });
  it("streams speaker identity, saves individual memories, resolves and awards exactly once", async () => {
    let a = await game.startQuest(playerId, "project_crisis", "voice");
    const streamed: string[] = [];
    for (const line of crisisPlan) a = (await game.submitPlayerTurn(playerId, a.id, line, "voice", (_, __, id) => { if (id) streamed.push(id.npcId); })).attempt;
    expect(new Set(streamed)).toEqual(new Set(["rohan_mehta", "nora_shah", "maya_sen"]));
    expect(a.scene.revealed).toEqual(expect.arrayContaining(["customer_constraint", "capacity_constraint"]));
    const result = await game.concludeQuest(playerId, a.id);
    expect(result.result?.grade).toBe("success");
    const feedback = (await debrief(game, playerId, a.id)).evaluation;
    expect(feedback.summary).toContain("concrete review point");
    expect(feedback.improvements[0].detail).toContain("continuity and capacity");
    const saved = await game.getPlayerState(playerId);
    for (const id of ["rohan_mehta", "nora_shah", "maya_sen"]) expect(saved.npcs[id].memory.lastInteractionSummary).toContain(id.split("_")[0][0].toUpperCase() + id.split("_")[0].slice(1));
    expect(saved.npcs.maya_sen.memory).not.toEqual(saved.npcs.nora_shah.memory);
    // The season doesn't end in the crisis room: its aftermath conversation is next.
    expect(saved.world.campaign.ending).toBeNull();
    expect(saved.world.director.recommended?.questId).toBe("the_review");
    expect(result.result?.rewards.followUpQuestIds).toContain("the_review");
    expect(saved.world.campaign.communications.at(-1)?.to).toBe("emma_kapoor");
    expect(informationFor(saved.world, "emma_kapoor").map((f) => f.id)).not.toContain(`encounter:${a.id}`);
    const envelope = AttemptEnvelopeSchema.parse(attemptEnvelope(await game.getAttempt(playerId, a.id)));
    expect(envelope.scene.participants).toHaveLength(3);
    expect(JSON.stringify(envelope)).not.toMatch(/privateConstraint|_evidence|resistance/);
    expect(envelope.attempt.turns.find((t) => t.identity?.npcId === "maya_sen")?.text).toContain("rollback checks");
    expect(WorldOverviewSchema.parse(await worldOverview(game, playerId)).advancedCampaign?.ending).toEqual(saved.world.campaign.ending);
    await game.concludeQuest(playerId, a.id);
    expect(await game.getPlayerState(playerId)).toEqual(saved);
    // The Review freezes the ending, exactly once.
    let review = await game.startQuest(playerId, "the_review");
    for (const line of ["I'd like to lead the next Meridian phase. In the crisis I owned the estimate and aligned the room.", "I'd need Maya's verification time agreed up front and a review at the end of the quarter."]) review = (await game.submitPlayerTurn(playerId, review.id, line, "text")).attempt;
    expect(review.scene.revealed).toContain("review_terms");
    const reviewed = await game.concludeQuest(playerId, review.id);
    expect(reviewed.result?.outcomeId).toBe("lead_trial");
    const ended = await game.getPlayerState(playerId);
    expect(ended.world.campaign.ending?.professional).toBe("Project lead trial");
    expect(ended.world.campaign.ending?.resolvedBy).toBe(review.id);
    expect(ended.world.flags).toContain("season1.complete");
    expect(ended.world.campaign.ending?.tease?.title).toContain("Leadership Tower");
    expect((await debrief(game, playerId, review.id)).campaignEnding).toEqual(ended.world.campaign.ending);
    expect(WorldOverviewSchema.parse(await worldOverview(game, playerId)).advancedCampaign?.ending).toEqual(ended.world.campaign.ending);
    await game.concludeQuest(playerId, review.id);
    expect(await game.getPlayerState(playerId)).toEqual(ended);
  });
  it("an interrupted second character only contributes delivered facts, in transcript, state and memory", async () => {
    const a = await game.startQuest(playerId, "project_crisis", "voice");
    await game.submitPlayerTurn(playerId, a.id, crisisPlan[0], "voice");
    const response = await game.submitPlayerTurn(playerId, a.id, crisisPlan[1], "voice");
    const last = response.attempt.turns.at(-1)!;
    expect(last.identity?.npcId).toBe("nora_shah");
    const report = { turnIndex: last.index, heardText: "The customer needs" };
    const cut = await game.reportDelivery(playerId, a.id, report);
    expect(cut.scene.revealed).not.toContain("customer_constraint");
    expect(cut.turns.at(-1)?.identity?.npcId).toBe("nora_shah");
    const canonical = renderTranscript(cut.turns, "Asha", "Rohan");
    expect(canonical).toContain("Nora: The customer needs");
    expect(canonical).not.toContain("dashboard can wait");
    expect((await game.reportDelivery(playerId, a.id, report)).turns).toEqual(cut.turns);
    await game.concludeQuest(playerId, a.id);
    const memoryCalls = provider.calls.filter((c) => c.task === "extract_memory");
    expect(memoryCalls).toHaveLength(3);
    for (const call of memoryCalls) expect(call.messages.map((m) => m.content).join()).not.toContain("dashboard can wait");
  });
  it("accepts a delayed rollout strategy too, while a shallow plan stays partial", async () => {
    const a = await game.startQuest(playerId, "project_crisis");
    const lines = [...crisisPlan];
    lines[3] = "Delay the rollout instead of rushing it. Keep the existing reports running for customer continuity, without overtime, and protect the rollback checks. The cost is another day.";
    for (const line of lines) await game.submitPlayerTurn(playerId, a.id, line, "text");
    expect((await game.concludeQuest(playerId, a.id)).result?.grade).toBe("success");
    const before = await game.getPlayerState(playerId);
    const practice = await game.startQuest(playerId, "project_crisis", "text", "practice");
    await game.submitPlayerTurn(playerId, practice.id, "I own my mistake. Let's try a smaller read-only pilot.", "text");
    const result = await game.concludeQuest(playerId, practice.id);
    expect(result.result?.grade).toBe("partial");
    expect((await game.getPlayerState(playerId)).world).toEqual(before.world);
    expect((await game.getPlayerState(playerId)).npcs).toEqual(before.npcs);
  });
  it("rejects duplicate/stale client turns across changing speakers", async () => {
    const a = await game.startQuest(playerId, "project_crisis");
    await game.submitPlayerTurn(playerId, a.id, crisisPlan[1], "text", undefined, { expectedTurnCount: 1 });
    await expect(game.submitPlayerTurn(playerId, a.id, crisisPlan[2], "text", undefined, { expectedTurnCount: 1 })).rejects.toMatchObject({ code: "conflict" });
    expect((await game.getAttempt(playerId, a.id)).turns).toHaveLength(3);
  });
  it("malformed semantic output rolls back the pending turn and cannot award success", async () => {
    const broken = new GameService({ db, provider: new FakeProvider({ scripted: { perceive: () => '{"unlock":"promotion"}' } }), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
    const a = await broken.startQuest(playerId, "project_crisis");
    await expect(broken.submitPlayerTurn(playerId, a.id, crisisPlan[0], "text")).rejects.toMatchObject({ code: "ai" });
    expect((await broken.getAttempt(playerId, a.id)).turns).toHaveLength(1);
  });
});
