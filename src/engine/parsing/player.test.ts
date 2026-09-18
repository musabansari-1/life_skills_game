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
