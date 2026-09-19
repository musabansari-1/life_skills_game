import { describe, expect, it } from "vitest";
import { heardPrefix, splitSentences, takeCompleteSentences } from "./sentences";

describe("takeCompleteSentences", () => {
  it("releases only complete sentences until done", () => {
    let consumed = 0;
    let r = takeCompleteSentences("Look, honestly. The band is", consumed, false);
    expect(r.chunks).toEqual(["Look, honestly."]);
    consumed = r.consumed;
    r = takeCompleteSentences("Look, honestly. The band is fixed. What else?", consumed, false);
    expect(r.chunks).toEqual(["The band is fixed.", "What else?"]);
    consumed = r.consumed;
    r = takeCompleteSentences("Look, honestly. The band is fixed. What else? Okay", consumed, true);
    expect(r.chunks).toEqual(["Okay"]);
  });

  it("does not split on decimals inside figures", () => {
    expect(splitSentences("I can go to 9.2 lakh. That's the top.")).toEqual(["I can go to 9.2 lakh.", "That's the top."]);
    const r = takeCompleteSentences("I can go to 9.2", 0, false);
    expect(r.chunks).toEqual([]);
  });

  it("keeps closing quotes and ellipses with their sentence", () => {
    expect(splitSentences('She said "no." Then she left… Right?')).toEqual(['She said "no."', "Then she left…", "Right?"]);
  });
});

describe("heardPrefix", () => {
  const gen = "The base can't move beyond nine point two. But there is a joining bonus.";
  it("accepts an exact prefix regardless of whitespace", () => {
    expect(heardPrefix(gen, "The base  can't move")).toBe("The base can't move");
  });
  it("falls back to the longest common word prefix", () => {
    expect(heardPrefix(gen, "The base can't mov")).toBe("The base can't");
    expect(heardPrefix(gen, "Something else entirely")).toBe("");
  });
  it("drops dangling punctuation where the voice stopped", () => {
    expect(heardPrefix("Got it — ten is a lot.", "Got it —")).toBe("Got it");
    expect(heardPrefix("Look, honestly, no.", "Look,")).toBe("Look");
  });
  it("returns empty for nothing heard", () => {
    expect(heardPrefix(gen, "   ")).toBe("");
  });
});
