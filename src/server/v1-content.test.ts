/**
 * V1 Career City content: every new encounter's success / partial / failure
 * branch, the Review's three situations, recovery windows, and the Director's
 * season rules. Real GameService, fake provider, in-memory DB.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { makeTestEnv } from "@/engine/util";
import { findQuest } from "@/content/quests";
import { CAREER_MILESTONES, milestoneAllowed } from "@/engine/campaign";
import { directorCandidates } from "@/engine/director";
import { mayaSituation } from "@/content/quests/maya-checkin";
import { GameService } from "./orchestrator";
import { MemoryAnalytics } from "./analytics";
import { registerAccount } from "./account";
import { loadPlayerState, saveWorldState } from "./player";
import { buildQuestCards } from "./game-view";
import { questBriefing } from "./queries";

let db: Db, game: GameService, playerId: string;
beforeEach(async () => {
  ({ db } = await createTestDb());
  game = new GameService({ db, provider: new FakeProvider(), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env: makeTestEnv() });
  playerId = (await registerAccount(db, { email: `v1${Math.random()}@t.local`, password: "password123" })).player.playerId;
});

/** Every milestone before `questId` resolved with a plausible outcome; employed at Nova Labs. */
async function seedBefore(questId: string, extra: { flags?: string[]; outcomes?: Record<string, string>; grades?: Record<string, "success" | "partial" | "failure"> } = {}) {
  const state = await loadPlayerState(db, playerId);
  const w = state.world;
  w.career = { ...w.career, status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: 900000, signingBonus: 0 };
  w.flags.push("nova_labs.joined", ...(extra.flags ?? []));
  w.unlockedLocations.push("career_city.nova_labs_platform", "career_city.nova_labs_product", "career_city.meridian_room");
  w.unlockedQuests.push("push_back_on_deadline", "status_update");
  w.peopleMet.push("emma_kapoor", "rohan_mehta");
  const before = CAREER_MILESTONES.slice(0, CAREER_MILESTONES.indexOf(questId));
  before.forEach((id, i) => {
    const q = findQuest(id)!;
    const outcomeId = extra.outcomes?.[id] ?? q.outcomes.find((o) => o.grade === (extra.grades?.[id] ?? "success"))!.id;
    const grade = q.outcomes.find((o) => o.id === outcomeId)!.grade;
    const rec = { questId: id, attemptId: `seed_${id}`, outcomeId, at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z` };
    (grade === "failure" ? w.failedQuests : w.completedQuests).push(rec);
    w.campaign.milestones[id] = { attemptId: rec.attemptId, grade, outcomeId };
  });
  await saveWorldState(db, playerId, w);
  return w;
}
async function play(questId: string, lines: string[]) {
  let a = await game.startQuest(playerId, questId);
  for (const l of lines) { if (a.scene.ended) break; a = (await game.submitPlayerTurn(playerId, a.id, l, "text")).attempt; }
  const done = await game.concludeQuest(playerId, a.id);
  return { attempt: a, result: done.result!, state: await loadPlayerState(db, playerId) };
}

describe("Act 2: Maya and Nora", () => {
  it("asking Maya well earns an ally and a fact that matters later; dumping work closes a door without a setback record", async () => {
    await seedBefore("meet_maya");
    const good = await play("meet_maya", ["I've read the runner README and traced one batch. I'm stuck on exactly where rollback is triggered. Do you have ten minutes after your run?", "Has the rollback been tested on real data?"]);
    expect(good.result.outcomeId).toBe("ally");
    expect(good.attempt.turns.some((t) => /never run against production-sized data/.test(t.text))).toBe(true);
    expect(good.state.world.flags).toEqual(expect.arrayContaining(["maya.collaborator", "knows.rollback_untested"]));
    expect(good.state.world.unlockedLocations).toContain("career_city.nova_labs_product");
    expect(milestoneAllowed(good.state.world, "push_back_on_deadline")).toBe(true);
  });
  it("brushing Maya off is remembered but is not a campaign failure", async () => {
    await seedBefore("meet_maya");
    const bad = await play("meet_maya", ["Can you just do my migration ticket? I don't get any of it.", "Could you just finish it for me?"]);
    expect(bad.result.outcomeId).toBe("brushed_off");
    expect(bad.state.world.flags).toContain("maya.distant");
    expect(bad.state.world.campaign.failures).toEqual([]);
    expect(bad.state.npcs.maya_sen.relationship.warmth).toBeLessThan(0);
  });
  it("Nora: discovery beats estimation; a blind yes becomes a commitment and a setback", async () => {
    await seedBefore("nora_requirements");
    const blind = await play("nora_requirements", ["Yes, we can build the real-time dashboard by Friday, no problem.", "Two weeks, tops."]);
    expect(blind.result.outcomeId).toBe("promised_dashboard");
    expect(blind.state.world.campaign.failures.map((f) => f.kind)).toEqual(["commitment_failure"]);
    expect(blind.state.world.commitments.some((c) => c.toNpcId === "nora_shah" && c.status === "open")).toBe(true);
    // The status update is now reachable: Act 2 goes on, carrying the promise.
    expect(milestoneAllowed(blind.state.world, "status_update")).toBe(true);
  });
});

describe("Act 3: the Meridian call (Boss 2)", () => {
  const good = ["Vikram, what happened is we missed: the migration went wrong on our side, and I own that.", "Vikram, what does your team need at month-end?", "Here's the protection: a change freeze in close week and a verified export on the 28th, with a go/no-go call. The dashboard isn't coming this quarter; you get the verified export instead."];
  it("reads Act 2: a hidden incident and a promised dashboard shape the call; a straight plan wins it and supersedes the promise", async () => {
    const w = await seedBefore("customer_escalation", { flags: ["nova_labs.rushed_migration", "chapter1.hid_incident", "nora.dashboard_promised", "chapter1.complete"] });
    w.commitments.push({ id: "dash", description: "Deliver real-time dashboards for Meridian.", toNpcId: "nora_shah", madeInQuestId: "nora_requirements", madeAt: "now", dueBy: null, status: "open" });
    await saveWorldState(db, playerId, w);
    const brief = await questBriefing(game, playerId, "customer_escalation");
    expect(brief.kind).toBe("boss");
    expect(brief.transition?.when).toBe("Ten days later");
    expect(brief.carryOver.join(" ")).toMatch(/found the broken records/);
    const r = await play("customer_escalation", good);
    expect(r.attempt.turns[0].text).toMatch(/found the problem before we told you/);
    expect(r.attempt.turns.some((t) => t.identity?.npcId === "vikram_rao" && /thirtieth/.test(t.text))).toBe(true);
    expect(r.result.outcomeId).toBe("trust_restored");
    expect(r.state.world.commitments.find((c) => c.id === "dash")?.status).toBe("superseded");
    expect(r.state.world.peopleMet).toContain("vikram_rao");
    expect(r.state.npcs.rohan_mehta.memory.events.some((e) => /Meridian call went well/.test(e.summary))).toBe(true);
  });
  it("promising the dashboard again doesn't clear the phase while it was promised", async () => {
    await seedBefore("customer_escalation", { flags: ["nora.dashboard_promised", "chapter1.complete"] });
    const r = await play("customer_escalation", [good[0], good[1], "Here's the protection: a change freeze in close week and a verified export on the 28th, with a go/no-go call."]);
    expect(r.result.outcomeId).toBe("holding_pattern");
  });
  it("blame loses the call; the story continues with Nora owning the account and a debrief on offer", async () => {
    await seedBefore("customer_escalation", { flags: ["chapter1.complete"] });
    const r = await play("customer_escalation", ["That was the other team's fault, honestly, not my problem.", "You people need to test your own reports."]);
    expect(r.result.grade).toBe("failure");
    expect(r.state.world.flags).toContain("meridian.nora_owns");
    expect(milestoneAllowed(r.state.world, "mentor_arjun")).toBe(true);
    const cards = buildQuestCards(r.state);
    expect(cards.find((c) => c.id === "recovery_customer_escalation")).toMatchObject({ availability: "available", kind: "recovery" });
    expect(cards.find((c) => c.id === "mentor_arjun")?.availability).toBe("available");
  });
});

describe("Act 4: step up", () => {
  it("Arjun tells the truth only when it's safe, and owning the fix is the win", async () => {
    await seedBefore("mentor_arjun");
    const r = await play("mentor_arjun", ["How's it going with the ticket? What's been hard?", "Honestly, I broke staging in my second week too. It happens to everyone.", "What would you try first?", "I'll pair with you for an hour at four, and we can check in tomorrow."]);
    expect(r.result.outcomeId).toBe("unstuck");
    expect(r.state.npcs.maya_sen.memory.events.some((e) => /Arjun came to me himself/.test(e.summary))).toBe(true);
  });
  it("taking over ships the ticket and teaches nothing; lecturing gets 'it's fine'", async () => {
    await seedBefore("mentor_arjun");
    const over = await play("mentor_arjun", ["You should have asked days ago. Why didn't you?", "Leave it with me, I'll just fix it."]);
    expect(over.attempt.scene.revealed).not.toContain("staging_broken");
    expect(over.result.outcomeId).toBe("fixed_it_for_him");
  });
  it("feedback for Rohan: specific + request lands; flattery glosses; an attack bruises", async () => {
    await seedBefore("feedback_for_rohan");
    const r = await play("feedback_for_rohan", ["When you agreed the Friday deadline upstairs, Maya lost her weekend to the restore.", "I know your director puts pressure on you.", "Could you check capacity with the team before committing a date? I'll give you a real number in time."]);
    expect(r.result.outcomeId).toBe("landed");
    expect(r.attempt.turns.some((t) => /counts dates, not evenings/.test(t.text))).toBe(true);
    expect(r.state.world.commitments.some((c) => /capacity-checked estimates/.test(c.description))).toBe(true);
  });
  it("an attack is a relationship setback", async () => {
    await seedBefore("feedback_for_rohan");
    const r = await play("feedback_for_rohan", ["You always volunteer us. Everyone thinks you're a bad manager."]);
    expect(r.result.outcomeId).toBe("bruised");
    expect(r.state.world.campaign.failures.map((f) => f.kind)).toEqual(["relationship_damage"]);
  });
});

describe("Resolution: the Review freezes the ending", () => {
  it.each([
    ["success", "put_forward", ["I'd like to lead the next Meridian phase. In the crisis I owned the estimate and aligned the room.", "I'd need Maya's verification time agreed up front and a review at the end of the quarter."], "lead_trial", /lead trial/i],
    ["partial", "not_yet", ["That's fair. What would ready look like to you?", "Let's revisit it in a quarter, with a checkpoint."], "path_to_ready", /path to lead/i],
    ["failure", "way_back", ["That's fair. What would ready look like to you?", "Let's revisit it in a quarter, with a checkpoint."], "way_back_agreed", /agreed way back/i],
  ] as const)("after a crisis %s, the Review is %s", async (grade, situation, lines, outcome, professional) => {
    await seedBefore("the_review", { grades: { project_crisis: grade } });
    const a = await game.startQuest(playerId, "the_review");
    expect(a.hidden.situation).toBe(situation);
    const r = await play("the_review", [...lines]);
    expect(r.result.outcomeId).toBe(outcome);
    expect(r.state.world.campaign.ending?.professional).toMatch(professional);
    expect(r.state.world.campaign.ending?.resolvedBy).toBe(r.attempt.id);
  });
  it("a title demand stalls the Review and the ending says so", async () => {
    await seedBefore("the_review");
    const r = await play("the_review", ["That wasn't my fault, Rohan made the call. Promote me or I'll leave."]);
    expect(r.result.outcomeId).toBe("review_stalled");
    expect(r.attempt.turns.every((t) => !/you're promoted|new title/i.test(t.text))).toBe(true);
    expect(r.state.world.campaign.ending?.professional).toBe("Trusted contributor; the lead role is still open");
  });
});

describe("season rules", () => {
  it("after the crisis only the Review is next: no personalized events, no side scenes", async () => {
    const w = await seedBefore("the_review");
    const state = await loadPlayerState(db, playerId);
    const candidates = directorCandidates({ ...state, world: w });
    expect(candidates[0].proposal.questId).toBe("the_review");
    expect(candidates.some((c) => c.proposal.questId.startsWith("director_"))).toBe(false);
  });
  it("after the Meridian boss, Priya can surface as an intentional breathing-room Director pick for players who know her", async () => {
    const w = await seedBefore("mentor_arjun", { flags: ["chapter1.complete"] });
    w.completedQuests.push({ questId: "introduce_yourself", attemptId: "seed_priya_intro", outcomeId: "connected", at: "2026-09-19T09:00:00.000Z" });
    w.peopleMet.push("priya_nair");
    await saveWorldState(db, playerId, w);
    const state = await loadPlayerState(db, playerId);
    const candidates = directorCandidates(state);
    expect(candidates[0].proposal.questId).toBe("priya_interlude");
    expect(candidates[0].reasons).toContain("breathing_room_after_meridian");
  });
  it("optional scenes open in their window and never substitute for a milestone", async () => {
    const w = await seedBefore("customer_escalation", { flags: ["nova_labs.rushed_migration", "chapter1.complete"] });
    expect(mayaSituation(w)).toBe("strained");
    const state = await loadPlayerState(db, playerId);
    expect(buildQuestCards(state).find((c) => c.id === "maya_checkin")).toMatchObject({ availability: "available", kind: "event" });
    const r = await play("maya_checkin", ["What do you need from me? I know it cost you your weekend. That's on me.", "I'll ask you before I commit any date that touches verification."]);
    expect(r.result.outcomeId).toBe("repaired");
    expect(milestoneAllowed(r.state.world, "mentor_arjun")).toBe(false);
    expect(r.state.world.campaign.milestones.customer_escalation).toBeUndefined();
  });
  it("a repair's window closes once the story has moved on; the setback stays in history", async () => {
    const w = await seedBefore("customer_escalation", { outcomes: { status_update: "covered_up" }, flags: ["chapter1.hid_incident", "chapter1.complete"] });
    w.campaign.failures.push({ id: "failure:seed_status_update", questId: "status_update", attemptId: "seed_status_update", npcId: "rohan_mehta", kind: "relationship_damage", summary: "Covered it up", recoveryQuestId: "recovery_status_update", recoveredBy: null, recoveryAttempts: [] });
    await saveWorldState(db, playerId, w);
    expect(buildQuestCards(await loadPlayerState(db, playerId)).find((c) => c.id === "recovery_status_update")?.availability).toBe("available");
    w.completedQuests.push({ questId: "customer_escalation", attemptId: "meridian", outcomeId: "trust_restored", at: "2026-09-20T10:00:00.000Z" });
    await saveWorldState(db, playerId, w);
    const later = await loadPlayerState(db, playerId);
    expect(buildQuestCards(later).find((c) => c.id === "recovery_status_update")).toBeUndefined();
    expect(later.world.campaign.failures.some((f) => f.questId === "status_update" && !f.recoveredBy)).toBe(true);
  });
  it("every milestone briefing has a narrative transition and a map kind", async () => {
    await seedBefore("the_review");
    for (const id of CAREER_MILESTONES) {
      const q = findQuest(id)!;
      expect(q.transition, id).toBeDefined();
    }
    const cards = buildQuestCards(await loadPlayerState(db, playerId));
    expect(cards.find((c) => c.id === "counter_offer")?.kind).toBe("boss");
    expect(cards.find((c) => c.id === "project_crisis")?.kind).toBe("boss");
    expect(cards.find((c) => c.id === "priya_interlude")?.kind).toBe("optional");
  });
});
