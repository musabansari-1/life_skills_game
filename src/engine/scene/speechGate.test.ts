import { describe, expect, it } from "vitest";
import { SpeechGate } from "./speechGate";
import type { SpeechCheck } from "../types/quest";

/** Toy rule: any sentence naming "ten lakh" is over the cap and is rewritten to "nine lakh"; "twelve" is dropped. */
const check = (s: string): SpeechCheck => {
  if (/ten lakh/i.test(s)) return { ok: false, reason: "base above cap", rewrite: s.replace(/ten lakh/i, "nine lakh") };
  if (/twelve/i.test(s)) return { ok: false, reason: "invented figure", rewrite: null };
  return { ok: true };
};

describe("SpeechGate", () => {
  it("releases sentences as they complete and rewrites violations before they are emitted", () => {
    const g = new SpeechGate(check);
    expect(g.push("Look, honestly", false)).toBe(false);
    expect(g.text).toBe("");
    expect(g.push("Look, honestly. I can go to ten", false)).toBe(true);
    expect(g.text).toBe("Look, honestly.");
    expect(g.push("Look, honestly. I can go to ten lakh. That's", false)).toBe(true);
    expect(g.text).toBe("Look, honestly. I can go to nine lakh.");
    expect(g.push("Look, honestly. I can go to ten lakh. That's it", true)).toBe(true);
    expect(g.text).toBe("Look, honestly. I can go to nine lakh. That's it");
    expect(g.violations).toBe(1);
    expect(g.problems).toEqual(["speech gate: base above cap"]);
  });

  it("drops a sentence with no rewrite and keeps going", () => {
    const g = new SpeechGate(check);
    g.push("Some people make twelve here. But not at this level.", true);
    expect(g.text).toBe("But not at this level.");
    expect(g.violations).toBe(1);
  });

  it("starts over when a retry replaces the speech entirely", () => {
    const g = new SpeechGate(check);
    g.push("First attempt. ", false);
    expect(g.text).toBe("First attempt.");
    g.push("A different line. Entirely.", true);
    expect(g.text).toBe("A different line. Entirely.");
  });

  it("enforces a hard ceiling on spoken length", () => {
    const g = new SpeechGate(check, { maxSentences: 2 });
    g.push("One. Two. Three. Four.", true);
    expect(g.text).toBe("One. Two.");
    expect(g.violations).toBe(2);
    expect(g.problems).toEqual(["speech gate: over length; dropped sentences after 2"]);
  });

  it("does not split decimals and gates the trailing fragment at the end", () => {
    const g = new SpeechGate(check);
    g.push("I can do 9.2 lakh", false);
    expect(g.text).toBe("");
    g.push("I can do 9.2 lakh", true);
    expect(g.text).toBe("I can do 9.2 lakh");
  });
});
