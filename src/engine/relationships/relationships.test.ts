import { describe, expect, it } from "vitest";
import { MAX_DELTA_PER_EVENT, applyRelationshipDelta, describeRelationship, diffRelationship, relationshipLabel } from "./index";

const base = { trust: 0, respect: 0, familiarity: 0, warmth: 0 };

describe("relationships", () => {
  it("clamps per-event deltas and overall range", () => {
    const r = applyRelationshipDelta(base, { trust: 100, respect: -100, warmth: 3 });
    expect(r.trust).toBe(MAX_DELTA_PER_EVENT);
    expect(r.respect).toBe(-MAX_DELTA_PER_EVENT);
    expect(r.warmth).toBe(3);
    const high = applyRelationshipDelta({ ...base, trust: 90 }, { trust: 25 });
    expect(high.trust).toBe(100);
  });

  it("familiarity only increases", () => {
    const r = applyRelationshipDelta({ ...base, familiarity: 20 }, { familiarity: -50 });
    expect(r.familiarity).toBe(20);
  });

  it("diffs and labels", () => {
    const after = applyRelationshipDelta(base, { trust: 10, respect: 5, familiarity: 15 });
    expect(diffRelationship(base, after)).toEqual({ trust: 10, respect: 5, familiarity: 15, warmth: 0 });
    expect(relationshipLabel(base)).toBe("Unknown");
    expect(relationshipLabel({ trust: 50, respect: 50, familiarity: 30, warmth: 50 })).toBe("Ally");
    expect(relationshipLabel({ trust: -50, respect: -50, familiarity: 30, warmth: -50 })).toBe("Hostile");
  });

  it("describes relationships in prose the model can act on", () => {
    const d = describeRelationship({ trust: -50, respect: 45, familiarity: 30, warmth: 0 }, "Asha");
    expect(d).toMatch(/do not trust Asha/);
    expect(d).toMatch(/rate them highly/);
    expect(d).toMatch(/dealt with each other a few times/);
  });
});
