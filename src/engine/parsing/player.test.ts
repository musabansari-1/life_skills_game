import { describe, expect, it } from "vitest";
import { isGroundedInPlayerText } from "@/ai/tasks/evaluate";
import { readPlayerUtterance } from "./player";

const sig = (t: string) => readPlayerUtterance(t).signals;

describe("readPlayerUtterance", () => {
  it("reads a salary ask, a floor, and a bonus ask", () => {
    expect(readPlayerUtterance("I'd like to be at ten lakh.").ask).toBe(1000000);
    const floor = readPlayerUtterance("Honestly the lowest I could accept is nine lakh.");
    expect(floor.minimum).toBe(900000);
    expect(floor.ask).toBeNull();
    expect(floor.signals).toContain("revealed_minimum");
    expect(readPlayerUtterance("Could you do a joining bonus of sixty thousand?").bonusAsk).toBe(60000);
  });

  it("only counts evidence with real content", () => {
    expect(sig("I led a migration that cut infra spend by 30%.")).toContain("evidence_provided");
    expect(sig("The market range for this profile is around ten lakh.")).toContain("evidence_provided");
    expect(sig("I have lots of data that says I'm worth more.")).not.toContain("evidence_provided");
    expect(sig("My friends make twenty lakh at big tech.")).toContain("vague_claim");
  });

  it("detects pressure and ultimatums", () => {
    expect(sig("This offer is an insult.")).toContain("aggressive_tone");
    expect(sig("Twelve lakh, take it or leave it.")).toContain("ultimatum");
    expect(sig("It's non-negotiable.")).toContain("ultimatum");
  });

  it("distinguishes a real yes from a conditional one", () => {
    expect(sig("That sounds great, I accept the offer as it is.")).toContain("accepted_terms");
    expect(sig("That works for me. I accept.")).toContain("accepted_terms");
    // Floors and conditions are not acceptances:
    expect(sig("The lowest I could accept is nine lakh — anything above that and I'm in.")).not.toContain("accepted_terms");
    expect(sig("If you can do sixty thousand, I can sign today.")).not.toContain("accepted_terms");
    expect(sig("I'd accept only if the bonus is there.")).not.toContain("accepted_terms");
  });

  it("recognises questions about the package", () => {
    expect(sig("Can you walk me through the whole package, bonus and review cycle?")).toContain("asked_about_total_comp");
    expect(sig("Bonus.")).not.toContain("asked_about_total_comp");
  });

  it("takes the corrected version when the player corrects themselves mid-line", () => {
    const r = readPlayerUtterance("I was hoping for twelve lakh... no wait, I mean nine point five lakh.");
    expect(r.ask).toBe(950000);
    expect(r.signals).toContain("owned_mistake");
    expect(readPlayerUtterance("Ten lakh. Actually, make that ten point five lakh.").ask).toBe(1050000);
    expect(readPlayerUtterance("I accept. No wait, that's not what I meant, can you do ten lakh?").signals).not.toContain("accepted_terms");
    // A trailing "I mean" with nothing after it corrects nothing.
    expect(readPlayerUtterance("Ten lakh, I mean").ask).toBe(1000000);
  });

  it("a conditional yes is an ask about the condition, not an acceptance", () => {
    expect(sig("Yes, if you can get the bonus to sixty thousand.")).not.toContain("accepted_terms");
    expect(sig("I'll take it, but only with a sixty thousand joining bonus.")).not.toContain("accepted_terms");
    expect(sig("Deal, on the condition that the review is in six months.")).not.toContain("accepted_terms");
    expect(sig("Okay. Deal.")).toContain("accepted_terms");
  });
});

describe("evaluation grounding", () => {
  const said = "In my current role I led a migration that cut infra spend by thirty percent.";
  it("accepts evidence quoted from the player's words", () => {
    expect(isGroundedInPlayerText("led a migration that cut infra spend", said)).toBe(true);
  });
  it("rejects evidence the player never said", () => {
    expect(isGroundedInPlayerText("asked thoughtful questions about the band and bonus", said)).toBe(false);
    expect(isGroundedInPlayerText("(fake)", said)).toBe(false);
  });
});
