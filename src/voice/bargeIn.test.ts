import { describe, expect, it } from "vitest";
import { BargeInDetector, isBargeIn, isLikelyEcho, stripLeadingEcho } from "./bargeIn";

const npc = "Look, honestly. The base can't move beyond nine point two at this level.";

describe("barge-in detection", () => {
  it("treats the NPC's own words coming back through the mic as echo", () => {
    expect(isLikelyEcho("the base can't move", npc)).toBe(true);
    expect(isLikelyEcho("beyond nine point", npc)).toBe(true);
    expect(isLikelyEcho("", npc)).toBe(true);
    expect(isBargeIn("the base can't move beyond", npc)).toBe(false);
  });

  it("recognises the player cutting in with their own words", () => {
    expect(isLikelyEcho("what about a signing bonus", npc)).toBe(false);
    expect(isBargeIn("what about a signing bonus", npc)).toBe(true);
    expect(isBargeIn("what", npc)).toBe(false); // one word is not enough
    expect(isBargeIn("hang on", npc)).toBe(true);
  });

  it("strips a leading echoed run from the final transcript but keeps genuine speech", () => {
    expect(stripLeadingEcho("the base can't move what about a signing bonus", npc)).toBe("what about a signing bonus");
    expect(stripLeadingEcho("what about a signing bonus", npc)).toBe("what about a signing bonus");
    // A single shared word at the start is not an echo run.
    expect(stripLeadingEcho("look I need more than that", npc)).toBe("look I need more than that");
    // If everything would be stripped, keep the original.
    expect(stripLeadingEcho("the base can't move", npc)).toBe("the base can't move");
  });
});

describe("speaker echo that the recognizer mis-hears", () => {
  const line = "Four years on platform infrastructure, that's solid. What's the most interesting problem you've owned?";
  it("treats near-miss recognitions of the NPC's own words as echo", () => {
    expect(isLikelyEcho("platfrom infrastructur thats solid", line)).toBe(true);
    expect(isLikelyEcho("interesting problems youve owned", line)).toBe(true);
    expect(isBargeIn("most interesting problem you owned", line)).toBe(false);
  });
  it("a single stray result never confirms a barge-in; persistent own words do", () => {
    const d = new BargeInDetector();
    expect(d.observe("sorry can I stop you", line, 0)).toBe(false);
    expect(d.observe("four years on", line, 100)).toBe(false); // back to echo → reset
    expect(d.observe("sorry can I stop you", line, 200)).toBe(false);
    expect(d.observe("sorry can I stop you there", line, 400)).toBe(false); // only 200 ms
    expect(d.observe("sorry can I stop you there quickly", line, 600)).toBe(true);
  });
});
