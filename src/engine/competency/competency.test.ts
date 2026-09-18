import { describe, expect, it } from "vitest";
import { applyObservations, createEmptyProfile, deriveInsight, levelFromXp, levelProgress, xpForLevel } from "./index";

const now = "2026-01-01T00:00:00.000Z";
const rewards = { baseXp: 100, skills: { negotiation: 1, persuasion: 0.5 } };

describe("levels", () => {
  it("is monotonic and starts at level 1", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(1) - 1)).toBe(1);
    expect(levelFromXp(xpForLevel(1))).toBe(2);
    let prev = 1;
    for (let xp = 0; xp < 20000; xp += 137) {
      const l = levelFromXp(xp);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });
  it("reports progress within a level", () => {
    const p = levelProgress(xpForLevel(1) + 10);
    expect(p.level).toBe(2);
    expect(p.into).toBe(10);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(1);
  });
});

describe("applyObservations", () => {
  it("moves facet estimates toward observed quality with decreasing learning rate", () => {
    let profile = createEmptyProfile();
    const obs = [{ skill: "negotiation" as const, facet: "anchoring", score: 1, evidence: "x" }];
    const r1 = applyObservations({ profile, observations: obs, rewards, difficulty: 3, outcomeMultiplier: 1, now });
    const e1 = r1.profile.negotiation.facets.anchoring.estimate;
    expect(e1).toBeGreaterThan(50);
    const r2 = applyObservations({ profile: r1.profile, observations: obs, rewards, difficulty: 3, outcomeMultiplier: 1, now });
    const e2 = r2.profile.negotiation.facets.anchoring.estimate;
    expect(e2).toBeGreaterThan(e1);
    expect(e2 - e1).toBeLessThan(e1 - 50);
    expect(r2.profile.negotiation.facets.anchoring.samples).toBe(2);
    expect(r2.profile.negotiation.facets.anchoring.confidence).toBeGreaterThan(r1.profile.negotiation.facets.anchoring.confidence);
    profile = r2.profile;
    expect(profile.negotiation.facets.anchoring.estimate).toBeLessThanOrEqual(100);
  });

  it("awards more XP for strong demonstrations than weak ones", () => {
    const strong = applyObservations({
      profile: createEmptyProfile(),
      observations: [{ skill: "negotiation", facet: "anchoring", score: 0.95, evidence: "x" }],
      rewards,
      difficulty: 3,
      outcomeMultiplier: 1,
      now,
    });
    const weak = applyObservations({
      profile: createEmptyProfile(),
      observations: [{ skill: "negotiation", facet: "anchoring", score: 0.2, evidence: "x" }],
      rewards,
      difficulty: 3,
      outcomeMultiplier: 1,
      now,
    });
    const s = strong.xpAwards.find((x) => x.skill === "negotiation")!.xp;
    const w = weak.xpAwards.find((x) => x.skill === "negotiation")!.xp;
    expect(s).toBeGreaterThan(w * 2);
  });

  it("gives consolation XP to reward skills with no observations, scaled by outcome", () => {
    const r = applyObservations({ profile: createEmptyProfile(), observations: [], rewards, difficulty: 1, outcomeMultiplier: 0.5, now });
    const neg = r.xpAwards.find((x) => x.skill === "negotiation")!.xp;
    expect(neg).toBeGreaterThan(0);
    expect(neg).toBeLessThan(40);
  });

  it("discovers a facet the first time it is demonstrated strongly, once", () => {
    const r1 = applyObservations({
      profile: createEmptyProfile(),
      observations: [{ skill: "negotiation", facet: "anchoring", score: 0.8, evidence: "x" }],
      rewards,
      difficulty: 3,
      outcomeMultiplier: 1,
      now,
    });
    expect(r1.discovered).toEqual([{ skill: "negotiation", facet: "anchoring", label: "Anchoring" }]);
    const r2 = applyObservations({ profile: r1.profile, observations: [{ skill: "negotiation", facet: "anchoring", score: 0.9, evidence: "x" }], rewards, difficulty: 3, outcomeMultiplier: 1, now });
    expect(r2.discovered).toEqual([]);
  });

  it("drops observations with unknown facets instead of crashing", () => {
    const r = applyObservations({
      profile: createEmptyProfile(),
      observations: [{ skill: "negotiation", facet: "made_up", score: 0.9, evidence: "x" }],
      rewards,
      difficulty: 3,
      outcomeMultiplier: 1,
      now,
    });
    expect(r.dropped).toHaveLength(1);
    expect(r.profile.negotiation.facets.made_up).toBeUndefined();
  });

  it("levels up when XP crosses the threshold", () => {
    let profile = createEmptyProfile();
    let levelUps = 0;
    for (let i = 0; i < 6; i++) {
      const r = applyObservations({ profile, observations: [{ skill: "negotiation", facet: "anchoring", score: 1, evidence: "x" }], rewards: { baseXp: 150, skills: { negotiation: 1 } }, difficulty: 5, outcomeMultiplier: 1.3, now });
      profile = r.profile;
      if (r.xpAwards[0].levelAfter > r.xpAwards[0].levelBefore) levelUps++;
    }
    expect(levelUps).toBeGreaterThan(0);
    expect(profile.negotiation.level).toBe(levelFromXp(profile.negotiation.xp));
  });
});

describe("deriveInsight", () => {
  it("returns nothing with no confident data", () => {
    expect(deriveInsight(createEmptyProfile()).sentence).toBeNull();
  });
  it("names a strength and a weakness once confident", () => {
    let profile = createEmptyProfile();
    for (let i = 0; i < 4; i++) {
      profile = applyObservations({
        profile,
        observations: [
          { skill: "communication", facet: "clarity", score: 0.9, evidence: "x" },
          { skill: "negotiation", facet: "protecting_leverage", score: 0.1, evidence: "x" },
        ],
        rewards,
        difficulty: 2,
        outcomeMultiplier: 1,
        now,
      }).profile;
    }
    const insight = deriveInsight(profile);
    expect(insight.strengths[0]?.facet).toBe("clarity");
    expect(insight.weaknesses[0]?.facet).toBe("protecting_leverage");
    expect(insight.sentence).toMatch(/clarity/i);
  });
});
