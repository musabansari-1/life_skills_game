/**
 * The connected campaign: "this world remembers me".
 *
 * Plays Acts 1 and 2 of Career City twice with different choices (fake AI
 * provider, in-memory DB) and asserts that earlier choices change later
 * chapters: hidden NPC limits, what NPCs are told, what the briefing shows,
 * which situation the finale is in, and how relationships end up.
 * Also covers replay semantics (rehearsal vs. second chance).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { SPEECH_CLOSE, SPEECH_OPEN, MOVES_CLOSE, MOVES_OPEN } from "@/ai/format";
import { campaignProgress } from "@/content/campaign";
import { makeTestEnv } from "@/engine/util";
import { MemoryAnalytics } from "./analytics";
import { onboardPlayer, registerAccount } from "./account";
import { GameService } from "./orchestrator";
import { loadPlayerState } from "./player";
import { questBriefing } from "./queries";

let db: Db;
let playerId: string;
let fake: FakeProvider;
let game: GameService;

function service(provider: FakeProvider) {
  return new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
}

/** Fake NPC that always says the given line (used when a branch depends on what the NPC agrees). */
function sayer(line: string) {
  return new FakeProvider({ scripted: { npc_turn: () => `${SPEECH_OPEN}${line}${SPEECH_CLOSE}${MOVES_OPEN}{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}${MOVES_CLOSE}` } });
}

async function play(g: GameService, questId: string, lines: string[]) {
  let a = await g.startQuest(playerId, questId);
  for (const l of lines) {
    if (a.scene.ended) break;
    a = (await g.submitPlayerTurn(playerId, a.id, l, "text")).attempt;
  }
  return g.concludeQuest(playerId, a.id);
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  const s = await registerAccount(db, { email: `c${Math.random()}@t.local`, password: "password123" });
  playerId = s.player.playerId;
  await onboardPlayer(db, playerId, { displayName: "Asha" });
  fake = new FakeProvider();
  game = service(fake);
});

describe("Nova Labs campaign", () => {
  it("starts at the screening call with the rest of the story locked", async () => {
    const state = await loadPlayerState(db, playerId);
    const p = campaignProgress(state.world);
    expect(p.currentQuestId).toBe("recruiter_screening");
    expect(p.completed).toBe(0);
    expect((await questBriefing(game, playerId, "counter_offer")).canStart).toBe(false);
  });

  it("path A — naming a low number, overpromising, caving and playing it down all come back", async () => {
    // 1. Screening: give away a number.
    const s1 = await play(game, "recruiter_screening", [
      "I led a migration at my current company that cut infra spend by 30% last year.",
      "Honestly I'd be happy with eight lakh.",
      "What is the team working on right now?",
    ]);
    expect(s1.result!.aftermath.join(" ")).toMatch(/₹8L/);
    let world = (await loadPlayerState(db, playerId)).world;
    expect(world.vars["screening.stated_expectation"]).toBe(800000);

    // 2. Interview: overpromise on ramp-up.
    const s2 = await play(game, "hiring_manager_interview", [
      "Last year I shipped a migration late because I underestimated testing; I missed it and now I plan buffers and flag risk early.",
      "I'll be shipping real work in my first week, no ramp-up needed.",
      "What's the hardest thing the team is dealing with right now?",
    ]);
    world = (await loadPlayerState(db, playerId)).world;
    expect(world.flags).toContain("interview.overpromised");
    expect(world.commitments.some((c) => c.toNpcId === "rohan_mehta" && /first week/.test(c.description))).toBe(true);
    expect(s2.result!.aftermath.join(" ")).toMatch(/week one/);

    // 3. Counter offer: the screening number follows you in.
    const brief = await questBriefing(game, playerId, "counter_offer");
    expect(brief.canStart).toBe(true);
    const offer = await game.startQuest(playerId, "counter_offer");
    expect(offer.hidden.statedExpectation).toBe(800000);
    await game.submitPlayerTurn(playerId, offer.id, "I'd like ten lakh.", "text");
    const lastCall = fake.calls.filter((c) => c.task === "npc_turn").at(-1)!;
    // The turn direction is per-turn (volatile) prompt text, kept out of the cacheable system prefix.
    expect(`${lastCall.system}\n${lastCall.systemVolatile ?? ""}`).toMatch(/In screening they told you ₹8L would work/);
    await game.submitPlayerTurn(playerId, offer.id, "Okay, I accept.", "text");
    await game.concludeQuest(playerId, offer.id);

    // 4. First day.
    await play(game, "first_day_nova_labs", ["Morning Emma! Who will I be reporting to?", "What's the team struggling with right now?"]);

    // 4b. Asking Maya to do the work gets a link and a closed door, remembered later.
    const m = await play(game, "meet_maya", ["Can you just do my migration ticket? I don't get any of it.", "Could you just finish it for me?"]);
    expect(m.result!.outcomeId).toBe("brushed_off");
    expect((await questBriefing(game, playerId, "push_back_on_deadline")).carryOver.join(" ")).toMatch(/Maya didn't offer/);

    // 5. Deadline: cave to Friday. Rohan remembers the week-one promise.
    const deadline = await game.startQuest(playerId, "push_back_on_deadline");
    expect(deadline.hidden.overpromised).toBe(true);
    const opening = fake.calls.filter((c) => c.task === "npc_opening").at(-1)!;
    expect(opening.system).toMatch(/promised they'd be shipping in week one/);
    await game.submitPlayerTurn(playerId, deadline.id, "Sure, Friday is fine.", "text");
    const d = await game.concludeQuest(playerId, deadline.id);
    expect(d.result!.outcomeId).toBe("capitulated");
    world = (await loadPlayerState(db, playerId)).world;
    expect(world.flags).toContain("nova_labs.rushed_migration");

    // 5b. Nora: a confident dashboard estimate before asking why becomes a commitment.
    expect((await questBriefing(game, playerId, "status_update")).canStart).toBe(false);
    const n = await play(game, "nora_requirements", ["Yes, we can build the real-time dashboard by Friday, no problem.", "Two weeks, tops."]);
    expect(n.result!.outcomeId).toBe("promised_dashboard");
    world = (await loadPlayerState(db, playerId)).world;
    expect(world.commitments.some((c) => c.toNpcId === "nora_shah" && /dashboards/.test(c.description))).toBe(true);

    // 6. Status update: caving produced a production incident; playing it down costs Rohan's trust.
    const upd = await questBriefing(game, playerId, "status_update");
    expect(upd.canStart).toBe(true);
    const trustBefore = (await loadPlayerState(db, playerId)).npcs.rohan_mehta.relationship.trust;
    const final = await game.startQuest(playerId, "status_update");
    expect(final.hidden.situation).toBe("incident");
    await game.submitPlayerTurn(playerId, final.id, "There was a minor issue with the migration, nothing serious, should be fine.", "text");
    const f = await game.concludeQuest(playerId, final.id);
    expect(f.result!.outcomeId).toBe("covered_up");
    const end = await loadPlayerState(db, playerId);
    expect(end.npcs.rohan_mehta.relationship.trust).toBeLessThan(trustBefore);
    expect(end.npcs.rohan_mehta.memory.events.some((e) => /minor\. It wasn't/.test(e.summary))).toBe(true);
    expect(end.world.flags).toContain("chapter1.complete");
    const progress = campaignProgress(end.world);
    expect(progress.finished).toBe(false);
    expect(progress.currentQuestId).toBe("customer_escalation");
    // Act 3 reads Act 2: the Meridian call knows about the hidden incident and the dashboard.
    const call = await questBriefing(game, playerId, "customer_escalation");
    expect(call.carryOver.join(" ")).toMatch(/found the broken records before anyone at Nova told him/);
    expect(call.carryOver.join(" ")).toMatch(/dashboard is coming/);
    expect(call.boss?.stakes).toMatch(/renewal/);
  });

  it("path B — keeping your number, a plan, and owning the slip lead somewhere else", async () => {
    await play(game, "recruiter_screening", [
      "I led a migration that cut infra spend by 30% last year.",
      "I'd rather understand the role first. What range do you have budgeted?",
      "What is the team working on right now?",
    ]);
    let world = (await loadPlayerState(db, playerId)).world;
    expect(world.vars["screening.stated_expectation"]).toBeNull();
    expect((await questBriefing(game, playerId, "counter_offer")).unmet.length).toBeGreaterThan(0); // interview first

    await play(game, "hiring_manager_interview", [
      "Last year I shipped a migration late because I underestimated testing; I missed it and now I plan buffers and flag risk early.",
      "Realistically, a month to be properly productive, with a small fix shipped in week two.",
    ]);
    const offerBrief = await questBriefing(game, playerId, "counter_offer");
    expect(offerBrief.canStart).toBe(true);
    const offer = await game.startQuest(playerId, "counter_offer");
    expect(offer.hidden.statedExpectation).toBeNull();
    await game.submitPlayerTurn(playerId, offer.id, "Okay, I accept.", "text");
    await game.concludeQuest(playerId, offer.id);
    await play(game, "first_day_nova_labs", ["Morning Emma! Who will I be reporting to?"]);
    const m = await play(game, "meet_maya", ["I've read the runner README and traced one batch. I'm stuck on exactly where rollback is triggered. Do you have ten minutes after your run?", "Has the rollback been tested on real data?"]);
    expect(m.result!.outcomeId).toBe("ally");
    expect((await loadPlayerState(db, playerId)).world.flags).toContain("knows.rollback_untested");
    expect((await questBriefing(game, playerId, "push_back_on_deadline")).carryOver.join(" ")).toMatch(/never run against production-sized data/);

    // Deadline: propose a plan; Rohan (scripted) agrees Monday.
    const agreeing = service(sayer("Fine, Monday it is, with the partial on Friday. Don't make me regret it."));
    const dl = await agreeing.startQuest(playerId, "push_back_on_deadline");
    expect(dl.hidden.overpromised).toBe(false);
    await agreeing.submitPlayerTurn(playerId, dl.id, "Friday isn't safe without a rollback. By Friday I can ship the schema changes, and the full migration with rollback by Monday.", "text");
    const d = await agreeing.concludeQuest(playerId, dl.id);
    expect(d.result!.outcomeId).toBe("plan_agreed");
    world = (await loadPlayerState(db, playerId)).world;
    expect(world.flags).not.toContain("nova_labs.rushed_migration");
    const n = await play(game, "nora_requirements", ["Before I estimate, what problem are they trying to solve? Who uses it?", "So their real problem is the manual export at month-end. A scheduled export refresh before the thirtieth, instead of a dashboard?"]);
    expect(n.result!.outcomeId).toBe("found_the_need");
    expect((await loadPlayerState(db, playerId)).npcs.vikram_rao.memory.events.some((e) => /asked what my team actually needed/.test(e.summary))).toBe(true);

    // Status update: a different situation, owned properly.
    const brief = await questBriefing(game, playerId, "status_update");
    expect(brief.carryOver?.join(" ")).toMatch(/edge case/);
    const trustBefore = (await loadPlayerState(db, playerId)).npcs.rohan_mehta.relationship.trust;
    const final = await game.startQuest(playerId, "status_update");
    expect(final.hidden.situation).toBe("slip");
    await game.submitPlayerTurn(playerId, final.id, "That's on me: an edge case in the rollback means the full migration lands 24 hours late. Here's the plan: I'll have it done by Thursday noon.", "text");
    const f = await game.concludeQuest(playerId, final.id);
    expect(f.result!.outcomeId).toBe("owned_it");
    const end = await loadPlayerState(db, playerId);
    expect(end.npcs.rohan_mehta.relationship.trust).toBeGreaterThan(trustBefore);
    expect(end.world.flags).toContain("chapter1.owned_incident");
  });
});

describe("replays", () => {
  async function atOffer() {
    const st = await loadPlayerState(db, playerId);
    st.world.career.status = "offer_received";
    st.world.unlockedQuests.push("counter_offer");
    const { saveWorldState } = await import("./player");
    await saveWorldState(db, playerId, st.world);
  }

  it("a rehearsal of a resolved quest improves skills but never changes the world again", async () => {
    await atOffer();
    await play(game, "counter_offer", ["Given the market benchmark data I'd like 9.5 lakh.", "Great, I accept."]);
    const canon = await loadPlayerState(db, playerId);
    const xpAfterCanon = canon.competencies.negotiation.xp;

    const replay = await game.startQuest(playerId, "counter_offer");
    expect(replay.mode).toBe("rehearsal");
    // Emma is as she was at the canonical run, not as she is now.
    expect(fake.calls.filter((c) => c.task === "npc_opening").at(-1)!.system).not.toMatch(/Last time you spoke/);
    await game.submitPlayerTurn(playerId, replay.id, "In my current role I led a migration that cut infra spend by 30%; the market range is ten lakh. I'd like ten.", "text");
    await game.submitPlayerTurn(playerId, replay.id, "Beyond base, is there any flexibility on a joining bonus?", "text");
    const done = await game.concludeQuest(playerId, replay.id);

    expect(done.result!.mode).toBe("rehearsal");
    expect(done.result!.comparison).not.toBeNull();
    expect(done.result!.comparison!.lines[0].label).toBe("Base");
    expect(done.result!.rewards.relationshipChanges).toEqual([]);

    const after = await loadPlayerState(db, playerId);
    expect(after.world).toEqual(canon.world); // the world keeps what really happened
    expect(after.npcs.emma_kapoor.relationship).toEqual(canon.npcs.emma_kapoor.relationship);
    expect(after.npcs.emma_kapoor.memory.events.length).toBe(canon.npcs.emma_kapoor.memory.events.length);
    expect(after.competencies.negotiation.xp).toBeGreaterThan(xpAfterCanon); // practice still counts
  });

  it("after a failure, replay is practice; a separate recovery changes the future without rewriting failure", async () => {
    await atOffer();
    const insults = ["This offer is an insult, take it or leave it.", "Unacceptable. Non-negotiable. Final offer.", "You're wasting my time. Final offer.", "Take it or leave it."];
    const first = await play(game, "counter_offer", insults);
    expect(first.result!.outcomeId).toBe("walked_away");
    let st = await loadPlayerState(db, playerId);
    expect(st.world.career.status).toBe("exploring");

    const again = await game.startQuest(playerId, "counter_offer");
    const failedWorld = structuredClone(st.world);
    expect(again.mode).toBe("rehearsal");
    await game.submitPlayerTurn(playerId, again.id, "I'm sorry about last time. Okay, I accept.", "text");
    const done = await game.concludeQuest(playerId, again.id);
    expect(done.result!.mode).toBe("rehearsal");
    expect(done.result!.comparison!.previousOutcomeLabel).toBe("Offer withdrawn");
    st = await loadPlayerState(db, playerId);
    expect(st.world).toEqual(failedWorld);
    const recovery = await play(game, "recovery_counter_offer", ["I own my mistake in how I handled that conversation.", "I'll send a revised plan and review it tomorrow at noon. I will accept the original terms."]);
    expect(recovery.result!.grade).toBe("success");
    st = await loadPlayerState(db, playerId);
    expect(st.world.career.status).toBe("employed");
    expect(st.world.completedQuests.some((q) => q.questId === "counter_offer")).toBe(false);
    expect(st.world.failedQuests.some((q) => q.attemptId === first.id)).toBe(true);
    expect(st.world.campaign.failures.find((f) => f.attemptId === first.id)?.recoveredBy).toBe(recovery.id);
  });
});
