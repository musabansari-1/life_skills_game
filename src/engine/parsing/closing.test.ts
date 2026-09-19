import { describe, expect, it } from "vitest";
import { npcEndsConversation } from "./closing";

describe("npcEndsConversation", () => {
  it("recognises a character walking out", () => {
    expect(npcEndsConversation("I hear you. Then we're done here. I wish you the best.")).toBe(true);
    expect(npcEndsConversation("Fine. I'll take it back to the team.")).toBe(true);
    expect(npcEndsConversation("Look, this isn't going to work. The offer is withdrawn.")).toBe(true);
  });
  it("ignores conditional walk-outs, questions and ordinary wrap-ups", () => {
    expect(npcEndsConversation("If twelve is a hard line for you, then we're done.")).toBe(false);
    expect(npcEndsConversation("Are we done here?")).toBe(false);
    expect(npcEndsConversation("Great, I'll send the paperwork over today. Welcome aboard!")).toBe(false);
    expect(npcEndsConversation("I'm done with my questions on the migration. What about you?")).toBe(false);
  });
});
