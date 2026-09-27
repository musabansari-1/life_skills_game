import { describe, expect, it } from "vitest";
import { createInitialWorldState, WorldStateSchema } from "../types/world";
import { createSceneState } from "../types/scene";
import { addSceneEvidence, hasEvidence, selectFloor, validateSceneRead } from "../scene/ensemble";
import { CRISIS_FEATURES, projectCrisis } from "@/content/quests/project-crisis";
import { communicate, informationFor } from "./information";
import { campaignDifficulty, pacingAdjustment } from "./pacing";
import { milestoneAllowed, reconcileCampaign, resolveEnding } from ".";
import { simulatedProfiles } from "../director/simulations";
import { getQuest } from "@/content/quests";
import { directorCandidates } from "../director";

describe("campaign rules", () => {
  it("upgrades old saves without dropping Director state", () => {
    const world = createInitialWorldState();
    const legacy = { ...world } as Record<string, unknown>; delete legacy.campaign;
    expect(WorldStateSchema.parse(legacy).campaign.ending).toBeNull();
    expect(WorldStateSchema.parse(legacy).director).toEqual(world.director);
  });
  it("rejects unsupported semantic evidence and accepts paraphrases without keyword gates", () => {
    const text = "The earlier estimate was mine, and I should have checked it with the team.";
    const parsed = validateSceneRead({ evidence: [{ feature: "ownership", quote: text, revoked: false }, { feature: "grant_promotion", quote: text, revoked: false }, { feature: "checkpoint", quote: "Tomorrow at noon", revoked: false }], addressedTo: "invented" }, text, CRISIS_FEATURES, ["rohan_mehta"], 1);
    expect(parsed.evidence.map((e) => e.feature)).toEqual(["ownership"]);
    expect(parsed.addressedTo).toBeNull();
    const scene = addSceneEvidence(createSceneState({}), parsed.evidence);
    expect(hasEvidence(scene, "ownership")).toBe(true);
    expect(hasEvidence(addSceneEvidence(scene, [{ ...parsed.evidence[0], revoked: true, turnIndex: 3 }]), "ownership")).toBe(false);
  });
  it("selects one speaker by interests, supports, direct address and safety interjection", () => {
    const profile = projectCrisis.ensemble!;
    const turn = { id: "p", index: 1, speaker: "player" as const, text: "I will ask everyone to work overtime.", modality: "text" as const, moves: null, createdAt: "now" };
    const previous = { ...turn, index: 0, speaker: "npc" as const, identity: { npcId: "rohan_mehta", name: "Rohan", addressedTo: "player", kind: "answer" as const } };
    let scene = addSceneEvidence(createSceneState({}), [{ feature: "unsupported_promise", quote: turn.text, turnIndex: 1, revoked: false }]);
    expect(selectFloor(profile, scene, [previous, turn], null)).toMatchObject({ npcId: "maya_sen", addressedTo: "rohan_mehta", kind: "interjection", pauseForPlayer: true });
    scene = addSceneEvidence(createSceneState({}), [{ feature: "scope_plan", quote: "A smaller reversible trial.", turnIndex: 1, revoked: false }]);
    expect(selectFloor(profile, scene, [previous, turn], null).kind).toBe("support");
    expect(selectFloor(profile, scene, [previous, turn], "nora_shah").npcId).toBe("nora_shah");
    expect(selectFloor(profile, createSceneState({}), [previous, turn], null).npcId).toBe("rohan_mehta"); // silence is allowed for other NPCs
  });
  it("does not propagate private information or permit an uninformed sender", () => {
    let world = createInitialWorldState();
    world.campaign.information.push({ id: "salary", sourceAttemptId: "a", sourceQuestId: "counter_offer", ownerId: "emma_kapoor", audience: [], visibility: "private", summary: "A private salary floor." });
    const event = { id: "e", factId: "salary", from: "emma_kapoor", to: "rohan_mehta", kind: "warning" as const, reason: "An introduction", sourceAttemptId: "a" };
    expect(communicate(world, event)).toEqual(world);
    expect(informationFor(world, "rohan_mehta")).toEqual([]);
    world.campaign.information.push({ ...world.campaign.information[0], id: "summary", visibility: "shared", summary: "A collaborative negotiation." });
    expect(communicate(world, { ...event, factId: "summary", from: "maya_sen" })).toEqual(world);
    world = communicate(world, { ...event, factId: "summary" });
    expect(informationFor(world, "rohan_mehta").map((f) => f.id)).toEqual(["summary"]);
    expect(informationFor(world, "nora_shah")).toEqual([]);
    expect(communicate(world, { ...event, factId: "summary" }).campaign.communications).toHaveLength(1);
  });
  it("team facts still require an explicit audience", () => {
    const world = createInitialWorldState();
    world.campaign.information.push({ id: "team", ownerId: "rohan_mehta", sourceAttemptId: "a", sourceQuestId: "project_crisis", visibility: "team", audience: ["maya_sen"], summary: "The review happened." });
    expect(informationFor(world, "maya_sen")).toHaveLength(1);
    expect(informationFor(world, "emma_kapoor")).toHaveLength(0);
  });
  it("paces high pressure and keeps difficulty changes bounded", () => {
    const world = createInitialWorldState();
    world.campaign.recent = [1, 2].map((i) => ({ questId: `${i}`, category: "challenge", intensity: 5, difficulty: 2 }));
    expect(pacingAdjustment(world, getQuest("introduce_yourself")).score).toBeGreaterThan(pacingAdjustment(world, projectCrisis).score);
    expect(campaignDifficulty(world, 95, 80)).toBe(3);
    expect(campaignDifficulty(world, 5, 80)).toBe(2);
  });
  it("dynamic side events cannot bypass milestone gates; recovery is a distinct resolution", () => {
    const state = simulatedProfiles().D_ready_for_responsibility;
    state.world.completedQuests = state.world.completedQuests.filter((q) => q.questId !== "status_update");
    state.world.completedQuests.push({ questId: "director_checkpoint", attemptId: "side", outcomeId: "plan", at: "now" });
    expect(milestoneAllowed(state.world, "project_crisis")).toBe(false);
    expect(directorCandidates(state).some((c) => c.proposal.questId === "project_crisis")).toBe(false);
    state.world.failedQuests.push({ questId: "status_update", attemptId: "failure", outcomeId: "bad", at: "now" });
    state.world = reconcileCampaign(state.world);
    expect(directorCandidates(state).some((c) => c.proposal.questId === "recovery_status_update")).toBe(true);
    state.world.campaign.failures[0].recoveredBy = "repair";
    expect(milestoneAllowed(state.world, "project_crisis")).toBe(true);
    expect(state.world.failedQuests).toHaveLength(1);
  });
  it("resolves endings deterministically from authoritative dimensions", () => {
    const s = simulatedProfiles().D_ready_for_responsibility;
    s.world.campaign.milestones.project_crisis = { attemptId: "boss", grade: "success", outcomeId: "aligned_recovery" };
    const first = resolveEnding(s.world, s.competencies, s.npcs, "boss");
    expect(first.professional).toBe("Project lead trial");
    expect(resolveEnding(s.world, s.competencies, s.npcs, "boss")).toEqual(first);
    s.world.campaign.milestones.project_crisis.grade = "failure";
    expect(resolveEnding(s.world, s.competencies, s.npcs, "boss").professional).not.toBe(first.professional);
  });
});
