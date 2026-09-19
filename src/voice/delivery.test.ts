import { describe, expect, it } from "vitest";
import { DeliveryTracker } from "./delivery";

describe("DeliveryTracker", () => {
  it("reports only completed sentences plus the delivered prefix of the current one", () => {
    const t = new DeliveryTracker(1);
    const a = t.enqueue("The base can't move beyond nine point two.");
    const b = t.enqueue("But there is a joining bonus of forty thousand.");
    t.start(a, 0);
    t.progress(a, 9);
    expect(t.heardText(500)).toBe("The base");
    t.complete(a);
    expect(t.heardText(3000)).toBe("The base can't move beyond nine point two.");
    t.start(b, 3000);
    t.progress(b, 18);
    expect(t.heardText(3500)).toBe("The base can't move beyond nine point two. But there is a");
    expect(t.allDone).toBe(false);
    t.complete(b);
    expect(t.allDone).toBe(true);
    expect(t.heardText(9000)).toBe(t.fullText());
  });

  it("falls back to a rate-based estimate rounded down to a word when no boundary events arrive", () => {
    const t = new DeliveryTracker(1, 0.01); // 10 chars per second for easy arithmetic
    const a = t.enqueue("What about a signing bonus instead of base?");
    t.start(a, 1000);
    expect(t.heardText(1000)).toBe("");
    // 1.5 s → 15 chars → "What about a si" → rounded down to "What about a"
    expect(t.heardText(2500)).toBe("What about a");
    // Well past the end → whole sentence.
    expect(t.heardText(20000)).toBe("What about a signing bonus instead of base?");
  });

  it("never claims a partial word and never claims the unplayed tail", () => {
    const t = new DeliveryTracker(1);
    const a = t.enqueue("Honestly, nine point five is not possible.");
    t.enqueue("Nine point two is.");
    t.start(a, 0);
    t.progress(a, 12); // "Honestly, ni"
    expect(t.heardText(100)).toBe("Honestly,");
    const heard = t.cancel(100);
    expect(heard).toBe("Honestly,");
    expect(t.segments.map((s) => s.status)).toEqual(["cancelled", "cancelled"]);
    // After cancel, nothing more is ever reported as heard.
    expect(t.heardText(99999)).toBe("");
  });

  it("recentText includes the sentence currently playing, for echo detection", () => {
    const t = new DeliveryTracker(1);
    const a = t.enqueue("Look, honestly.");
    const b = t.enqueue("The band is fixed at this level.");
    t.start(a, 0);
    t.complete(a);
    t.start(b, 1000);
    expect(t.recentText(1000)).toBe("Look, honestly. The band is fixed at this level.");
  });
});
