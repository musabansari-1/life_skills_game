/**
 * The Counter Offer speech gate: what Emma is about to say is checked against
 * what the rules allow THIS turn, before it is streamed, spoken or recorded.
 */
import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden, type CounterOfferScene } from "./counter-offer";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "@/engine/types/npc";
import { createSceneState, type SceneState } from "@/engine/types/scene";
import { createInitialWorldState } from "@/engine/types/world";
import { SpeechGate } from "@/engine/scene/speechGate";
import type { SceneContext } from "@/engine/types/quest";

type Ctx = SceneContext<CounterOfferHidden, CounterOfferScene>;

function ctxWith(patch: Partial<CounterOfferScene> = {}, hiddenPatch: Partial<CounterOfferHidden> = {}): Ctx {
  const npc = createNPCInstanceState(emma);
  const hidden = { ...(counterOffer.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden), ...hiddenPatch };
  const scene = createSceneState(counterOffer.scene.createCustom(hidden), 65) as SceneState & { custom: CounterOfferScene };
  scene.custom = { ...scene.custom, ...patch };
  return { hidden, scene, world: createInitialWorldState(), npc, playerName: "Asha" };
}
const gate = (s: string, ctx: Ctx) => counterOffer.scene.speechGate!(s, ctx as never);

describe("Counter Offer speech gate", () => {
  it("lowers a committed base above this turn's cap to the cap, in the same style", () => {
    const ctx = ctxWith({ turnCap: 920000, highestAsk: 1000000 }, { maxBase: 970000 });
    const words = gate("Look, I can take base to nine point five lakh.", ctx);
    expect(words.ok).toBe(false);
    if (!words.ok) expect(words.rewrite).toBe("Look, I can take base to nine point two lakh.");
    const digits = gate("I can do 9.5 lakh, but that's the top.", ctx);
    if (!digits.ok) expect(digits.rewrite).toBe("I can do 9.2 lakh, but that's the top.");
    const unitless = gate("Honestly, we can go to nine point five.", ctx);
    if (!unitless.ok) expect(unitless.rewrite).toBe("Honestly, we can go to nine point two.");
    const rupees = gate("I could stretch to ₹9,50,000.", ctx);
    if (!rupees.ok) expect(rupees.rewrite).toBe("I could stretch to ₹920000.");
  });

  it("lets Emma repeat the player's own figure and figures already on the table", () => {
    const ctx = ctxWith({ turnCap: 920000, highestAsk: 1000000 });
    expect(gate("You asked for ten lakh, and I can't get there.", ctx)).toEqual({ ok: true });
    expect(gate("The offer is eight point five lakh base.", ctx)).toEqual({ ok: true });
    expect(gate("Ten lakh isn't going to work at this level.", ctx)).toEqual({ ok: true });
  });

  it("catches agreement to a figure without an offer verb, and a leaked ceiling", () => {
    const ctx = ctxWith({ turnCap: 920000, highestAsk: 1000000 }, { maxBase: 970000 });
    const agree = gate("Okay. Ten lakh works.", ctx);
    expect(agree.ok).toBe(false);
    if (!agree.ok) expect(agree.rewrite).toBe("Okay. nine point two lakh works.".replace("nine point two lakh works", "nine point two lakh works"));
    const ceiling = gate("My ceiling is nine point seven, honestly.", ctx);
    expect(ceiling.ok).toBe(false);
    if (!ceiling.ok) expect(ceiling.rewrite).toBe("My ceiling is nine point two, honestly.");
  });

  it("holds the current base when the rules allow no movement this turn", () => {
    const ctx = ctxWith({ turnCap: 850000, highestAsk: 1000000 });
    const r = gate("Fine, I'll go to nine lakh.", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rewrite).toBe("Fine, I'll go to eight point five lakh.");
  });

  it("caps a joining bonus at the hidden maximum", () => {
    const ctx = ctxWith({ turnCap: 850000 }, { signingBonusMax: 60000 });
    const r = gate("I can add a joining bonus of eighty thousand.", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rewrite).toBe("I can add a joining bonus of sixty thousand.");
    expect(gate("I can add a joining bonus of fifty thousand.", ctx)).toEqual({ ok: true });
  });

  it("gate and speech inference agree: the rewritten sentence records exactly the cap", () => {
    const ctx = ctxWith({ turnCap: 920000, highestAsk: 1000000 }, { maxBase: 970000 });
    const g = new SpeechGate((s) => gate(s, ctx));
    g.push("Right. I can take base to nine point five lakh. Nothing more on base.", true);
    expect(g.text).toBe("Right. I can take base to nine point two lakh. Nothing more on base.");
    const inferred = counterOffer.scene.inferMovesFromSpeech!(g.text, ctx as never);
    expect(inferred.proposal).toEqual({ base: 920000 });
    expect(inferred.reveal).toEqual([]);
  });
});

/**
 * Lines the real model produced in live play. Each one exposed a gap between
 * what Emma audibly said and what the game recorded; they must stay closed.
 */
describe("live lines: what Emma says is what is recorded", () => {
  const infer = (s: string, ctx: Ctx) => counterOffer.scene.inferMovesFromSpeech!(s, ctx as never).proposal ?? {};

  it("her own figure is an offer whatever the phrasing", () => {
    const ctx = ctxWith({ turnCap: 950000, highestAsk: 950000 }, { maxBase: 970000 });
    expect(infer("I can meet you partway — nine point two.", ctx)).toEqual({ base: 920000 });
    expect(infer("Nine point seven is the most I can put on base for this level, and that's already over what I'd normally do.", ctx)).toEqual({ base: 970000 });
    expect(infer("Nine point three is the most I can stretch to today.", ctx)).toEqual({ base: 930000 });
    expect(infer("I can do nine point two, not nine point five.", ctx)).toEqual({ base: 920000 });
  });

  it("talking about a number is not offering it", () => {
    const ctx = ctxWith({ turnCap: 950000, highestAsk: 1000000 }, { maxBase: 970000 });
    for (const line of [
      "Ten lakh is a healthy step up from where we've landed you.",
      "Ten feels high for this level, though.",
      "Ten lakh is above where I can take the base today.",
      "Ten lakh, that's past what I can do.",
      "Nine point two is what you told me before ten came up.",
      "Could you live with nine point two?",
      "I can't do nine point five.",
    ]) expect(infer(line, ctx), line).toEqual({});
  });

  it("the player's own number needs explicit agreement", () => {
    const ctx = ctxWith({ turnCap: 950000, highestAsk: 920000 }, { maxBase: 970000 });
    expect(infer("Great, nine point two it is, Asha.", ctx)).toEqual({ base: 920000 });
    expect(infer("Nine point two works.", ctx)).toEqual({ base: 920000 });
    expect(infer("Nine point two, that's the number you gave me.", ctx)).toEqual({});
  });

  it("the gate caps the offer she would otherwise make, and the recorder then agrees", () => {
    const ctx = ctxWith({ turnCap: 900000, highestAsk: 1000000 }, { maxBase: 970000 });
    const g = new SpeechGate((s) => gate(s, ctx));
    g.push("That's a real result. I can meet you partway — nine point two. Nine point seven is the most I could ever do.", true);
    expect(g.text).toBe("That's a real result. I can meet you partway — nine lakh. Nine lakh is the most I could ever do.");
    expect(infer(g.text, ctx)).toEqual({ base: 900000 });
  });

  it("never speaks the hidden ceiling above the cap, even in a refusal", () => {
    const ctx = ctxWith({ turnCap: 900000, highestAsk: 1000000 }, { maxBase: 970000 });
    const r = gate("I can't go past nine point seven, honestly.", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rewrite).toBe("I can't go past nine lakh, honestly.");
  });
});

describe("live lines: confirming a deal", () => {
  it("after acceptance, a confirmation names exactly what's on the table", () => {
    const ctx = ctxWith({ currentBase: 970000, accepted: true, turnCap: 970000, highestAsk: 1000000, playerStatedMinimum: 1000000 }, { maxBase: 970000 });
    const r = gate("Nine point two it is, then.", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rewrite).toBe("Nine point seven it is, then.");
    expect(gate("Great, nine point seven lakh base it is.", ctx)).toEqual({ ok: true });
    // Referring to what the player said is fine.
    expect(gate("You said nine point two, but you're getting nine point seven.", ctx)).toEqual({ ok: true });
  });
});

describe("live lines: sealing the deal", () => {
  it("after acceptance a bonus that wasn't agreed is not added in the confirmation", () => {
    const ctx = ctxWith({ currentBase: 925000, currentSigningBonus: 0, accepted: true, turnCap: 925000 });
    const g = new SpeechGate((s) => gate(s, ctx));
    g.push("Great, that's the move. Let me lock in nine point two five base plus a sixty thousand joining bonus, and I'll send the paperwork over today.", true);
    expect(g.text).toBe("Great, that's the move.");
    expect(counterOffer.scene.inferMovesFromSpeech!(g.text, ctx as never).proposal).toEqual({});
  });
  it("an agreed bonus is confirmed at its agreed amount", () => {
    const ctx = ctxWith({ currentBase: 925000, currentSigningBonus: 40000, accepted: true, turnCap: 925000 }, { signingBonusMax: 60000 });
    const r = gate("Nine point two five base plus a sixty thousand joining bonus.", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rewrite).toBe("Nine point two five base plus a forty thousand joining bonus.");
  });
});
