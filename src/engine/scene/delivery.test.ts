import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "@/content/quests/counter-offer";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "../types/npc";
import { NPCMovesSchema, createSceneState, type SceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import { reduceNpcTurn } from "./index";
import { dropUnspokenFigures, movesForHeardSpeech } from "./delivery";

function fresh() {
  const npc = createNPCInstanceState(emma);
  const hidden = counterOffer.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden;
  const scene = createSceneState(counterOffer.scene.createCustom(hidden), 65) as SceneState & { custom: CounterOfferScene };
  return { hidden, scene, world: createInitialWorldState(), npc, playerName: "Asha" };
}
const quest = counterOffer.scene;

describe("movesForHeardSpeech", () => {
  const full = NPCMovesSchema.parse({ noticed: ["evidence_provided", "clear_ask"], reveal: ["bonus_flexible"], proposal: { base: 920000, signingBonus: 50000, playerMinimum: 900000 }, wantsToEnd: true, patienceDelta: 3 });

  it("keeps the player-side perception but drops everything the player never heard", () => {
    const ctx = fresh();
    const heard = "Okay, the specifics help.";
    const m = movesForHeardSpeech(full, heard, quest as never, ctx as never);
    expect(m.noticed).toEqual(["evidence_provided", "clear_ask"]);
    expect(m.patienceDelta).toBe(3);
    expect(m.wantsToEnd).toBe(false);
    expect(m.reveal).toEqual([]);
    expect(m.proposal).toEqual({ playerMinimum: 900000 });
    // Re-reducing from the pre-turn scene: the offer did not move.
    const r = reduceNpcTurn({ scene: quest as never, ctx: ctx as never, moves: m });
    expect(r.scene.custom.currentBase).toBe(ctx.scene.custom.currentBase);
    expect(r.scene.ended).toBeNull();
  });

  it("keeps a figure the player did hear", () => {
    const ctx = fresh();
    const heard = "Okay, the specifics help. I can take base to nine point two lakh, and";
    const m = movesForHeardSpeech(full, heard, quest as never, ctx as never);
    expect(m.proposal.base).toBe(920000);
    expect(m.proposal.signingBonus).toBeUndefined();
    const r = reduceNpcTurn({ scene: quest as never, ctx: ctx as never, moves: m });
    expect(r.scene.custom.currentBase).toBe(920000);
    expect(r.scene.custom.currentSigningBonus).toBe(0);
  });

  it("with nothing heard, records nothing", () => {
    const ctx = fresh();
    const m = movesForHeardSpeech(full, "", quest as never, ctx as never);
    expect(m.proposal).toEqual({ playerMinimum: 900000 });
    expect(m.reveal).toEqual([]);
  });
});

describe("dropUnspokenFigures", () => {
  it("removes numeric offers the speech never voiced and keeps the rest", () => {
    const moves = NPCMovesSchema.parse({ proposal: { base: 950000, signingBonus: 40000, playerMinimum: 900000, flexibleStart: true } });
    const dropped = dropUnspokenFigures(moves, "Where I do have room is a joining bonus, say forty thousand.");
    expect(dropped).toEqual(["base=950000"]);
    expect(moves.proposal).toEqual({ signingBonus: 40000, playerMinimum: 900000, flexibleStart: true });
  });
});
