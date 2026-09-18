import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../competency";
import { createInitialWorldState } from "../types/world";
import { makeTestEnv } from "../util";
import { applyConsequences, checkPrerequisites, recordQuestCompletion } from "./index";

const env = makeTestEnv();
const ctx = { questId: "counter_offer", env };

describe("applyConsequences", () => {
  it("applies career, flags, unlocks and reputation with idempotent no-ops", () => {
    const w0 = createInitialWorldState();
    const { world: w1, applied } = applyConsequences(
      w0,
      [
        { type: "world.career.set", patch: { status: "employed", employer: "Nova Labs", baseSalary: 970000 } },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.unlock.quest", questId: "first_day_nova_labs" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_platform" },
        { type: "world.reputation.delta", domain: "career_city", delta: 6 },
        { type: "world.reputation.delta", domain: "career_city", delta: 200 },
      ],
      ctx,
    );
    expect(w1.career.employer).toBe("Nova Labs");
    expect(w1.career.baseSalary).toBe(970000);
    expect(w1.career.role).toBeNull();
    expect(w1.flags).toEqual(["nova_labs.joined"]);
    expect(applied[1].changed).toBe(true);
    expect(applied[2].changed).toBe(false);
    expect(w1.unlockedQuests).toContain("first_day_nova_labs");
    expect(w1.unlockedLocations).toContain("career_city.nova_labs_platform");
    expect(w1.reputation.career_city).toBe(100);
    expect(w1.version).toBe(w0.version + 1);
    // Original is untouched.
    expect(w0.flags).toEqual([]);
  });

  it("tracks commitments, decisions and opportunities", () => {
    const { world } = applyConsequences(
      createInitialWorldState(),
      [
        { type: "world.commitment.add", description: "Send the portfolio by Friday", toNpcId: "emma_kapoor", dueBy: "2026-01-09" },
        { type: "world.commitment.add", description: "Send the portfolio by Friday", toNpcId: "emma_kapoor", dueBy: "2026-01-09" },
        { type: "world.decision.add", description: "Accepted the offer" },
        { type: "world.opportunity.add", description: "Coffee with Priya", sourceNpcId: "priya_nair", questId: null },
        { type: "world.person.met", npcId: "emma_kapoor" },
      ],
      ctx,
    );
    expect(world.commitments).toHaveLength(1);
    expect(world.commitments[0].status).toBe("open");
    expect(world.commitments[0].madeInQuestId).toBe("counter_offer");
    const { world: w2 } = applyConsequences(world, [{ type: "world.commitment.resolve", commitmentId: world.commitments[0].id, status: "broken" }], ctx);
    expect(w2.commitments[0].status).toBe("broken");
    expect(world.decisions).toHaveLength(1);
    expect(world.opportunities[0].sourceNpcId).toBe("priya_nair");
    expect(world.peopleMet).toEqual(["emma_kapoor"]);
  });

  it("ignores relationship/memory consequences (routed elsewhere)", () => {
    const { world, applied } = applyConsequences(createInitialWorldState(), [{ type: "relationship.delta", npcId: "x", delta: { trust: 5 } }], ctx);
    expect(applied).toHaveLength(0);
    expect(world.version).toBe(2);
  });
});

describe("checkPrerequisites", () => {
  const base = { world: createInitialWorldState(), competencies: createEmptyProfile(), npcs: {} };

  it("passes with no prerequisites", () => {
    expect(checkPrerequisites([], base).ok).toBe(true);
  });

  it("requires quest completion, optionally with specific outcomes", () => {
    expect(checkPrerequisites([{ type: "quest_completed", questId: "counter_offer" }], base).ok).toBe(false);
    const world = recordQuestCompletion(base.world, { questId: "counter_offer", attemptId: "a", outcomeId: "strong_deal", grade: "success", at: env.now() });
    expect(checkPrerequisites([{ type: "quest_completed", questId: "counter_offer" }], { ...base, world }).ok).toBe(true);
    expect(checkPrerequisites([{ type: "quest_completed", questId: "counter_offer", outcomeIds: ["hardball_deal"] }], { ...base, world }).ok).toBe(false);
  });

  it("records failures separately from completions", () => {
    const world = recordQuestCompletion(base.world, { questId: "counter_offer", attemptId: "a", outcomeId: "walked_away", grade: "failure", at: env.now() });
    expect(world.failedQuests).toHaveLength(1);
    expect(world.completedQuests).toHaveLength(0);
    expect(checkPrerequisites([{ type: "quest_completed", questId: "counter_offer" }], { ...base, world }).ok).toBe(false);
  });

  it("checks flags, career status, skill level and relationships", () => {
    const r = checkPrerequisites(
      [
        { type: "world_flag", flag: "nova_labs.joined" },
        { type: "career_status", status: "employed" },
        { type: "skill_level", skill: "negotiation", min: 3 },
        { type: "relationship", npcId: "emma_kapoor", dimension: "trust", min: 10 },
        { type: "custom", label: "Must be Tuesday", check: () => false },
      ],
      base,
    );
    expect(r.ok).toBe(false);
    expect(r.unmet).toHaveLength(5);
    expect(checkPrerequisites([{ type: "career_status", status: "interviewing" }], base).ok).toBe(true);
  });
});
