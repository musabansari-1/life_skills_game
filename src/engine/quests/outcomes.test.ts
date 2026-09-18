import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "@/content/quests/counter-offer";
import { QUESTS, validateContent } from "@/content/quests";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "../types/npc";
import { createSceneState, type SceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import type { Evaluation } from "../types/evaluation";
import { resolveObjectives, resolveOutcome } from "./outcomes";

const evaluation: Evaluation = {
  summary: "s",
  headline: "h",
  overallScore: 70,
  rubricScores: [],
  behaviors: [],
  strengths: [],
  improvements: [],
  keyMoments: [],
  objectiveResults: [{ objectiveId: "justify_with_evidence", achieved: true, evidence: "x" }],
};

function make(custom: Partial<CounterOfferScene>, patience = 70, ended: SceneState["ended"] = null) {
  const npc = createNPCInstanceState(emma);
  const hidden = counterOffer.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden;
  const scene = { ...createSceneState({ ...counterOffer.scene.createCustom(hidden), ...custom }, patience), ended };
  const ctx = { hidden, scene, world: createInitialWorldState(), npc, playerName: "Asha" };
  const objectivesAchieved = resolveObjectives(counterOffer, ctx, evaluation);
  return { ctx: { ...ctx, evaluation, objectivesAchieved }, objectivesAchieved };
}

describe("content", () => {
  it("is internally consistent", () => {
    expect(validateContent()).toEqual([]);
    expect(QUESTS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("counter offer outcomes", () => {
  it("strong deal when total is up 10%+ and rapport kept", () => {
    const { ctx, objectivesAchieved } = make({ currentBase: 970000, currentSigningBonus: 40000 }, 60);
    expect(resolveOutcome(counterOffer, ctx).id).toBe("strong_deal");
    expect(objectivesAchieved.has("improve_offer")).toBe(true);
    expect(objectivesAchieved.has("keep_rapport")).toBe(true);
    expect(objectivesAchieved.has("justify_with_evidence")).toBe(true); // from evaluator
    expect(objectivesAchieved.has("protect_minimum")).toBe(true);
  });

  it("hardball when the number moved but patience is low", () => {
    const { ctx } = make({ currentBase: 950000 }, 25);
    expect(resolveOutcome(counterOffer, ctx).id).toBe("hardball_deal");
  });

  it("modest when small improvement", () => {
    const { ctx } = make({ currentBase: 880000 }, 60);
    expect(resolveOutcome(counterOffer, ctx).id).toBe("modest_deal");
  });

  it("no change falls through to the catch-all", () => {
    const { ctx } = make({}, 60);
    expect(resolveOutcome(counterOffer, ctx).id).toBe("no_change");
  });

  it("walked away when the NPC ended the scene with zero patience", () => {
    const { ctx } = make({ currentBase: 950000 }, 0, { by: "npc", reason: "done" });
    const o = resolveOutcome(counterOffer, ctx);
    expect(o.id).toBe("walked_away");
    expect(o.grade).toBe("failure");
    const cons = o.consequences(ctx);
    expect(cons.some((c) => c.type === "world.career.set")).toBe(true);
  });

  it("scene-state objective checks override evaluator opinions", () => {
    const { objectivesAchieved } = make({ playerStatedMinimum: 900000 }, 60);
    expect(objectivesAchieved.has("protect_minimum")).toBe(false);
  });

  it("consequences of a strong deal unlock the follow-up and set career", () => {
    const { ctx } = make({ currentBase: 970000, currentSigningBonus: 40000 }, 60);
    const o = resolveOutcome(counterOffer, ctx);
    const cons = o.consequences(ctx);
    expect(cons).toContainEqual({ type: "world.unlock.quest", questId: "first_day_nova_labs" });
    const career = cons.find((c) => c.type === "world.career.set");
    expect(career && "patch" in career && career.patch.baseSalary).toBe(970000);
  });
});
