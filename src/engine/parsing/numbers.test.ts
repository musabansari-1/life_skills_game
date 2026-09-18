import { describe, expect, it } from "vitest";
import { counterOffer, type CounterOfferHidden } from "@/content/quests/counter-offer";
import { emma } from "@/content/npcs";
import { createNPCInstanceState } from "../types/npc";
import { createSceneState } from "../types/scene";
import { createInitialWorldState } from "../types/world";
import { extractRupeeAmounts, wordsToNumber } from "./numbers";

describe("wordsToNumber", () => {
  it("handles spoken forms", () => {
    expect(wordsToNumber(["ten"])).toBe(10);
    expect(wordsToNumber(["fifty", "five"])).toBe(55);
    expect(wordsToNumber(["nine", "point", "seven"])).toBe(9.7);
    expect(wordsToNumber(["nine", "seven"])).toBe(97);
    expect(wordsToNumber(["banana"])).toBeNull();
  });
});

describe("extractRupeeAmounts", () => {
  it("parses numeric, spoken and raw forms", () => {
    const a = (s: string) => extractRupeeAmounts(s).map((x) => x.amount);
    expect(a("I can take base to 9.7 lakh")).toEqual([970000]);
    expect(a("ten lakh is above the band")).toEqual([1000000]);
    expect(a("a joining bonus of forty thousand")).toEqual([40000]);
    expect(a("fifty to sixty thousand on top")).toEqual([50000, 60000]);
    expect(a("₹9,70,000 base")).toEqual([970000]);
    expect(a("we could do 40K")).toEqual([40000]);
    expect(a("nine seven base plus the bonus")).toEqual([970000]);
    expect(a("thirty percent cost reduction")).toEqual([]);
    // Unitless figures only count as salary when the context says so.
    expect(a("I can do nine point two five, and a joining bonus.")).toEqual([]);
    const sal = (s: string) => extractRupeeAmounts(s, { salaryContext: true }).map((x) => x.amount);
    expect(sal("I can do nine point two five, and I'll throw in a forty thousand joining bonus.")).toEqual([925000, 40000]);
    expect(sal("How about nine point five?")).toEqual([950000]);
    expect(sal("We're locked at 9.25 with the bonus.")).toEqual([925000]);
    expect(sal("nine seven works")).toEqual([970000]);
    expect(sal("two point five years of experience")).toEqual([]);
  });
});

describe("counter offer inferMovesFromSpeech", () => {
  const npc = createNPCInstanceState(emma);
  const hidden = counterOffer.scene.createHidden({ world: createInitialWorldState(), npc }) as CounterOfferHidden;
  const scene = createSceneState(counterOffer.scene.createCustom(hidden), 65);
  const ctx = { hidden, scene, world: createInitialWorldState(), npc, playerName: "Asha" };
  const infer = (s: string) => counterOffer.scene.inferMovesFromSpeech!(s, ctx);

  it("detects a narrated bonus concession and cap reveal", () => {
    const m = infer("There is some flexibility on a joining bonus — would an extra fifty to sixty thousand as a joining bonus make this work? Base is capped for this level.");
    expect(m.reveal).toEqual(expect.arrayContaining(["bonus_flexible", "base_capped"]));
    expect(m.proposal?.signingBonus).toBe(60000);
    expect(m.proposal?.base).toBeUndefined();
  });

  it("detects a committed base move but not a mere mention", () => {
    expect(infer("Okay — I can take base to nine point seven lakh. That's a real stretch.").proposal?.base).toBe(970000);
    expect(infer("Ten lakh is above where we can land for this level.").proposal?.base).toBeUndefined();
  });

  it("treats 'I can offer the top of the band' as a commitment to the ceiling", () => {
    const m = infer("What I can offer is the top of the band plus a joining bonus.");
    expect(m.proposal?.base).toBe(hidden.maxBase);
    expect(m.reveal).toContain("base_capped");
  });

  it("binds a unitless spoken figure ('I can do nine point two five')", () => {
    const m = infer("That thirty percent cut is solid. Ten feels high though. I can do nine point two five, and I'll throw in a forty thousand joining bonus.");
    expect(m.proposal?.base).toBe(925000);
    expect(m.proposal?.signingBonus).toBe(40000);
  });

  it("is conservative on neutral speech", () => {
    const m = infer("What's driving that number for you?");
    expect(m.reveal).toEqual([]);
    expect(m.proposal).toEqual({});
  });
});
