import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "@/content/quests/counter-offer";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "../types/npc";
import { NPCMovesSchema, createSceneState, type NPCMoves, type SceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import { endSceneByPlayer, reduceNpcTurn } from "./index";
import { readPlayerUtterance } from "../parsing/player";

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
    const { scene } = fresh();
    const ended = endSceneByPlayer(scene);
    expect(ended.ended?.by).toBe("player");
    expect(endSceneByPlayer(ended)).toBe(ended);
  });
});

describe("counter offer rules", () => {
  const pre = (text: string, scene?: SceneState) => {
    const { hidden, scene: fresh0 } = fresh();
    const sc = scene ?? fresh0;
    const out = counterOffer.scene.preTurn!(ctx(sc, hidden), readPlayerUtterance(text), text);
    return { hidden, out: { ...out, custom: out.custom as CounterOfferScene } };
  };

  it("never exceeds the hidden ceiling and never lowers the offer", () => {
    const { hidden, scene } = fresh();
    const big = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["evidence_provided", "clear_ask"], proposal: { base: 5000000 } }) });
    const base1 = (big.scene.custom as CounterOfferScene).currentBase;
    expect(base1).toBe(hidden.maxBase);
    const lower = reduceNpcTurn({ scene: quest.scene, ctx: ctx(big.scene, hidden), moves: moves({ proposal: { base: 700000 } }) });
    expect((lower.scene.custom as CounterOfferScene).currentBase).toBe(base1);
  });

  it("what Emma says is binding (up to the ceiling), even past the turn cap, and is flagged", () => {
    const { hidden, scene } = fresh();
    const s2 = { ...scene, custom: { ...scene.custom, turnCap: 880000 } };
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(s2, hidden), moves: moves({ proposal: { base: 920000 } }) });
    expect((r.scene.custom as CounterOfferScene).currentBase).toBe(920000);
    expect(r.scene.flags).toContain("npc_exceeded_turn_cap");
  });

  it("evidence unlocks more room than a bare ask; pressure unlocks none", () => {
    const evidence = pre("I led a migration that cut infra spend by 30%, and the market range is ten lakh. I'd like ten lakh.").out.custom!.turnCap!;
    const bare = pre("I'd like ten lakh.").out.custom!.turnCap!;
    const pressure = pre("This is an insult. Ten lakh, take it or leave it.").out;
    expect(evidence).toBeGreaterThan(bare);
    expect(bare).toBeGreaterThanOrEqual(850000);
    expect(pressure.custom!.turnCap).toBe(850000);
    expect(pressure.direction!.join(" ")).toMatch(/no movement/);
  });

  it("a stated floor caps the offer at exactly that floor", () => {
    const { out, hidden } = pre("Honestly the lowest I could accept is nine lakh.");
    expect(out.custom!.playerStatedMinimum).toBe(900000);
    expect(out.custom!.turnCap).toBe(900000);
    expect(out.direction!.join(" ")).toMatch(/offer exactly ₹9L/);
    expect(hidden.maxBase).toBeGreaterThan(900000);
  });

  it("an unrealistic ask gets a plain no and no movement", () => {
    const { out } = pre("I'm going to need twenty lakh base. That's my number.");
    expect(out.custom!.unrealisticAsks).toBe(1);
    expect(out.custom!.turnCap).toBe(850000);
    expect(out.direction!.join(" ")).toMatch(/Say no plainly/);
  });

  it("'what's your best?' gets at most a token move", () => {
    const { out } = pre("So what's the best you can do?");
    expect(out.custom!.turnCap!).toBeLessThanOrEqual(850000 + 20000);
  });

  it("accepting closes the deal on the current terms", () => {
    const { out } = pre("That sounds great, I accept the offer as it is.");
    expect(out.custom!.accepted).toBe(true);
    expect(out.direction!.join(" ")).toMatch(/close/);
  });

  it("bonus is bounded by the real lever, whatever is asked", () => {
    const { hidden, scene } = fresh();
    const over = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ reveal: ["bonus_flexible"], proposal: { signingBonus: 999999 } }) });
    expect((over.scene.custom as CounterOfferScene).currentSigningBonus).toBe(hidden.signingBonusMax);
  });

  it("records a revealed minimum as a scene flag and custom state", () => {
    const { hidden, scene } = fresh();
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["revealed_minimum"], proposal: { playerMinimum: 900000 } }) });
    expect((r.scene.custom as CounterOfferScene).playerStatedMinimum).toBe(900000);
    expect(r.scene.flags).toContain("revealed_minimum");
  });

  it("accepting ends the scene immediately, whatever the turn count", () => {
    const { hidden, scene } = fresh();
    const r = reduceNpcTurn({ scene: quest.scene, ctx: ctx(scene, hidden), moves: moves({ noticed: ["accepted_terms"] }) });
    expect(r.scene.ended?.by).toBe("player");
  });

  it("interview and screening results shape Emma's hidden limits", () => {
    const npc = createNPCInstanceState(emma);
    const w = createInitialWorldState();
    const strong = counterOffer.scene.createHidden({ world: { ...w, vars: { "interview.verdict": "strong" } }, npc }) as CounterOfferHidden;
    const shaky = counterOffer.scene.createHidden({ world: { ...w, vars: { "interview.verdict": "shaky", "screening.stated_expectation": 800000 } }, npc }) as CounterOfferHidden;
    expect(strong.maxBase).toBeGreaterThan(shaky.maxBase);
    expect(shaky.statedExpectation).toBe(800000);
  });
});
