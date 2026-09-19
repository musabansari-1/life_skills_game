import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "@/content/quests/counter-offer";
import { emma } from "@/content/npcs";
import { readPlayerUtterance } from "../parsing/player";
import { createNPCInstanceState } from "../types/npc";
import { NPCMovesSchema, createSceneState, type SceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import { difficultyProfile } from "./difficulty";
import { genericDirectorNotes, reduceNpcTurn } from "./index";

function ctx(difficulty?: 1 | 2 | 3 | 4 | 5) {
  const npc = createNPCInstanceState(emma);
  const hidden = counterOffer.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden;
  const scene = createSceneState(counterOffer.scene.createCustom(hidden), 65) as SceneState & { custom: CounterOfferScene };
  return { hidden, scene, world: createInitialWorldState(), npc, playerName: "Asha", difficulty };
}
const EVIDENCE = "In my current role I led a migration that cut infra spend by 30%, and the market range is ten lakh. I'd like ten lakh.";

describe("difficulty changes behaviour, not just a number", () => {
  it("has monotonic patience, concession and forgiveness profiles", () => {
    const p = [1, 2, 3, 4, 5].map((l) => difficultyProfile(l));
    for (let i = 1; i < p.length; i++) {
      expect(p[i].patienceOffset).toBeLessThanOrEqual(p[i - 1].patienceOffset);
      expect(p[i].concessionScale).toBeLessThanOrEqual(p[i - 1].concessionScale);
      expect(p[i].weakTurnCost).toBeGreaterThanOrEqual(p[i - 1].weakTurnCost);
    }
    expect(difficultyProfile(undefined).level).toBe(3);
    expect(difficultyProfile(9).level).toBe(5);
  });

  it("the same evidence unlocks less of the band for a hard Emma than an easy one", () => {
    const read = readPlayerUtterance(EVIDENCE);
    const caps = ([1, 3, 5] as const).map((d) => {
      const c = ctx(d);
      const pre = counterOffer.scene.preTurn!(c as never, read, EVIDENCE);
      return (pre.custom as CounterOfferScene).turnCap!;
    });
    expect(caps[0]).toBeGreaterThan(caps[1]);
    expect(caps[1]).toBeGreaterThan(caps[2]);
    expect(caps[0]).toBeLessThanOrEqual(1000000);
  });

  it("a vague, rambling line costs more patience at expert than at easy", () => {
    const moves = NPCMovesSchema.parse({ noticed: ["vague_claim", "deflected"] });
    const easy = reduceNpcTurn({ scene: counterOffer.scene as never, ctx: ctx(1) as never, moves });
    const expert = reduceNpcTurn({ scene: counterOffer.scene as never, ctx: ctx(5) as never, moves });
    expect(expert.scene.patience).toBeLessThan(easy.scene.patience);
    // Good behaviour is rewarded the same regardless of difficulty.
    const good = NPCMovesSchema.parse({ noticed: ["evidence_provided"] });
    expect(reduceNpcTurn({ scene: counterOffer.scene as never, ctx: ctx(1) as never, moves: good }).scene.patience).toBe(reduceNpcTurn({ scene: counterOffer.scene as never, ctx: ctx(5) as never, moves: good }).scene.patience);
  });

  it("director notes tell the model how to resist at each level, without rudeness", () => {
    const scene = createSceneState({}, 65);
    const easy = genericDirectorNotes(scene, 4, 12, 1).join(" ");
    const expert = genericDirectorNotes(scene, 4, 12, 5).join(" ");
    expect(easy).toMatch(/Difficulty: easy/);
    expect(easy).toMatch(/recover/);
    expect(expert).toMatch(/Difficulty: expert/);
    expect(expert).toMatch(/Do not rescue them/);
    expect(expert).toMatch(/never contemptuous/);
  });
});
