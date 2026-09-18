import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "@/content/quests/counter-offer";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "../types/npc";
import { NPCMovesSchema, createSceneState, type NPCMoves, type SceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import { endSceneByPlayer, reduceNpcTurn } from "./index";

function ctx(scene: SceneState, hidden: CounterOfferHidden) {
  return { hidden, scene: scene as SceneState & { custom: CounterOfferScene }, world: createInitialWorldState(), npc: createNPCInstanceState(emma), playerName: "Asha" };
}
const quest = counterOffer;
const moves = (m: Partial<NPCMoves>): NPCMoves => NPCMovesSchema.parse(m);

function fresh() {
  const npc = createNPCInstanceState(emma);
  const hidden = quest.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden;
  const scene = createSceneState(quest.scene.createCustom(hidden), 65);
  return { hidden, scene };
}

describe("generic scene reducer", () => {
  it("drops patience and hardens stance on aggression; rewards evidence", () => {
    const { hidden, scene } = fresh();
    const hostile = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["aggressive_tone", "ultimatum"] }) });
    expect(hostile.scene.patience).toBeLessThan(scene.patience - 20);
    expect(["guarded", "defensive"]).toContain(hostile.scene.stance);
    const kind = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["evidence_provided", "rapport"] }) });
    expect(kind.scene.patience).toBeGreaterThan(scene.patience);
    expect(kind.scene.signalCounts.evidence_provided).toBe(1);
  });

  it("clamps the model's patience suggestion and rejects unknown reveals", () => {
    const { hidden, scene } = fresh();
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ patienceDelta: -500, reveal: ["bonus_flexible", "the_meaning_of_life"] }) });
    expect(r.scene.patience).toBeGreaterThanOrEqual(scene.patience - 30);
    expect(r.scene.revealed).toEqual(["bonus_flexible"]);
    expect(r.rejectedReveals).toEqual(["the_meaning_of_life"]);
  });

  it("ends the scene when patience hits zero or the NPC wants to end after minTurns", () => {
    const { hidden } = fresh();
    let scene = createSceneState(quest.scene.createCustom(hidden), 12);
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["ultimatum", "aggressive_tone"] }) });
    expect(r.scene.ended?.by).toBe("npc");
    expect(r.scene.stance).toBe("done");

    scene = createSceneState(quest.scene.createCustom(hidden), 80);
    const early = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ wantsToEnd: true }) });
    expect(early.scene.ended).toBeNull(); // below minTurns, ignored
    scene = { ...scene, turnCount: quest.scene.minTurns };
    const late = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ wantsToEnd: true, endReason: "Deal done" }) });
    expect(late.scene.ended?.by).toBe("npc");
  });

  it("ends the scene at the turn limit", () => {
    const { hidden } = fresh();
    const scene = { ...createSceneState(quest.scene.createCustom(hidden), 80), turnCount: quest.scene.maxTurns - 1 };
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({}) });
    expect(r.scene.ended?.by).toBe("turn_limit");
  });

  it("player can end a scene; ending is idempotent", () => {
    const { hidden, scene } = fresh();
    const ended = endSceneByPlayer(scene);
    expect(ended.ended?.by).toBe("player");
    expect(endSceneByPlayer(ended)).toBe(ended);
  });
});

describe("counter offer proposal reducer", () => {
  it("never exceeds the hidden ceiling and never lowers the offer", () => {
    const { hidden, scene } = fresh();
    const big = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["evidence_provided", "clear_ask"], proposal: { base: 5000000 } }) });
    const base1 = (big.scene.custom as CounterOfferScene).currentBase;
    expect(base1).toBeGreaterThan(hidden.originalBase);
    expect(base1).toBeLessThanOrEqual(hidden.maxBase);
    const lower = reduceNpcTurn({ scene: quest.scene, ctx: ctx(big.scene, hidden), moves: moves({ proposal: { base: 700000 } }) });
    expect((lower.scene.custom as CounterOfferScene).currentBase).toBe(base1);
  });

  it("moves more with evidence than without, and less under aggression", () => {
    const { hidden, scene } = fresh();
    const withEvidence = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["evidence_provided", "clear_ask"], proposal: { base: 970000 } }) });
    const without = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["clear_ask"], proposal: { base: 970000 } }) });
    const aggressive = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["aggressive_tone", "clear_ask"], proposal: { base: 970000 } }) });
    const e = (withEvidence.scene.custom as CounterOfferScene).currentBase;
    const n = (without.scene.custom as CounterOfferScene).currentBase;
    const a = (aggressive.scene.custom as CounterOfferScene).currentBase;
    expect(e).toBeGreaterThan(n);
    expect(n).toBeGreaterThanOrEqual(a);
  });

  it("caps the bonus lower until the lever has been revealed", () => {
    const { hidden, scene } = fresh();
    const hidden2 = { ...hidden };
    const blind = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden2), moves: moves({ proposal: { signingBonus: 60000 } }) });
    expect((blind.scene.custom as CounterOfferScene).currentSigningBonus).toBeLessThanOrEqual(25000);
    const revealed = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden2), moves: moves({ reveal: ["bonus_flexible"], proposal: { signingBonus: 60000 } }) });
    expect((revealed.scene.custom as CounterOfferScene).currentSigningBonus).toBe(60000);
    const over = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden2), moves: moves({ reveal: ["bonus_flexible"], proposal: { signingBonus: 999999 } }) });
    expect((over.scene.custom as CounterOfferScene).currentSigningBonus).toBe(hidden.signingBonusMax);
  });

  it("records a revealed minimum as a scene flag and custom state", () => {
    const { hidden, scene } = fresh();
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["revealed_minimum"], proposal: { playerMinimum: 900000 } }) });
    expect((r.scene.custom as CounterOfferScene).playerStatedMinimum).toBe(900000);
    expect(r.scene.flags).toContain("revealed_minimum");
  });
});
