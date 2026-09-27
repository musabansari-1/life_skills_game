import { describe, it, expect } from "vitest";
import { applyDirectorPlan, directorCandidates, planDirector, validateProposal } from ".";
import { advanceContinuity, reconcileThreads, relationshipGameplay } from "./continuity";
import { simulatedProfiles, simulateDirector } from "./simulations";
import { WorldStateSchema, createInitialWorldState } from "../types/world";
import { createEmptyProfile } from "../competency";
import { findQuest } from "@/content/quests";
import { createSceneState, NPCMovesSchema } from "../types/scene";
import { readPlayerUtterance } from "../parsing/player";

describe("personalized journeys", () => {
  it("four profiles receive different focus, resistance, difficulty and opportunities", () => {
    const [a, b, c, d] = simulateDirector();
    expect(a).toMatchObject({ questId: "director_checkpoint", variant: "repair" });
    expect(b).toMatchObject({ questId: "director_checkpoint", variant: "listen" });
    expect(c).toMatchObject({ questId: "director_introduction", variant: "ask", difficulty: 2 });
    expect(d).toMatchObject({ questId: "director_introduction", variant: "stretch", event: "boss", difficulty: 4 });
    expect(b.reaction.needsProof).toBe(true);
    expect(d.reaction.canIntroduce).toBe(true);
    expect(new Set([a, b, c, d].map((r) => r.variant)).size).toBe(4);
    expect(a.threads[0].result).toContain("production incident");
    expect(d.threads[0].result).not.toContain("production incident");
  });

  it("does not call an unobserved skill a weakness; goals can guide a cold start", () => {
    const state = { world: createInitialWorldState(), competencies: createEmptyProfile(), npcs: {} };
    const plan = planDirector(state);
    expect(plan.selected?.questId).toBe("recruiter_screening");
    expect(plan.audit.reasons.join()).not.toContain("weakness");
  });

  it("goals and an upcoming need change the next focus without advancing the story", () => {
    const state = simulatedProfiles().D_ready_for_responsibility;
    // Balanced but not yet a boss-ready performer, so a real need breaks the tie.
    for (const skill of Object.values(state.competencies)) for (const f of Object.values(skill.facets)) f.estimate = 58;
    state.world.director.preferences = { goals: ["confidence"], upcoming: { goal: "confidence", horizon: "soon" } };
    expect(planDirector(state).selected?.variant).toBe("ask");
    state.world.director.preferences = { goals: ["listening"], upcoming: { goal: "listening", horizon: "soon" } };
    expect(planDirector(state).selected?.variant).toBe("listen");
    expect(state.world.director.clock).toBe(11);
  });

  it("warmth does not buy credibility; respect does not imply warmth", () => {
    const state = simulatedProfiles().D_ready_for_responsibility;
    const npc = state.npcs.rohan_mehta!;
    npc.relationship = { ...npc.relationship, warmth: 50, respect: -10, trust: -10 };
    const friendly = relationshipGameplay(npc, state.world);
    expect(friendly.needsProof).toBe(true);
    expect(friendly.canIntroduce).toBe(false);
    npc.relationship = { ...npc.relationship, warmth: -10, respect: 50, trust: 30 };
    expect(relationshipGameplay(npc, state.world).notes.join()).toContain("personally reserved");
  });
});

describe("Director validation boundary", () => {
  const state = () => simulatedProfiles().A_overcommits;
  it.each([
    ["npcId", "imaginary_manager"], ["difficulty", 99], ["worldId", "founder_valley"],
    ["effectPolicy", "award_million_xp"], ["objectiveIds", ["be_amazing"]],
    ["summary", "Aliens attack the office"], ["history", [{ kind: "quest", id: "fake", label: "A meeting that never happened" }]],
    ["targetSkills", ["storytelling"]],
  ])("rejects manipulated %s and falls back to authored content", (field, value) => {
    const ctx = state(); const good = planDirector(ctx).selected!;
    const raw = { ...good, [field]: value };
    expect(validateProposal(raw, ctx).proposal).toBeNull();
    const fallback = planDirector(ctx, raw, "ai");
    expect(fallback.audit.source).toBe("fallback");
    expect(fallback.selected).toEqual(good);
    expect(fallback.audit.rejected.length).toBeGreaterThan(0);
  });
  it("rejects arbitrary mutations even when every known field is valid", () => {
    const ctx = state();
    expect(validateProposal({ ...planDirector(ctx).selected, proposedWorldChanges: [{ xp: 999999 }] }, ctx).rejected[0].rule).toBe("schema");
  });
  it("rechecks state freshness at application, without mutating the caller", () => {
    const ctx = state(), before = structuredClone(ctx.world), plan = planDirector(ctx);
    const next = applyDirectorPlan(ctx, plan);
    expect(ctx.world).toEqual(before);
    expect(next.unlockedQuests).toContain(plan.selected!.questId);
    ctx.world.version++;
    expect(() => applyDirectorPlan(ctx, plan)).toThrow("no longer valid");
  });
  it("cannot reuse a completed event as a new canonical reward", () => {
    const ctx = state(); const p = planDirector(ctx).selected!;
    ctx.world.failedQuests.push({ questId: p.questId, attemptId: "fail", outcomeId: "not_yet", at: "2026-09-10" });
    expect(validateProposal(p, ctx).rejected.some((r) => r.rule === "duplicate_encounter")).toBe(true);
    expect(directorCandidates(ctx).some((c) => c.proposal.questId === p.questId)).toBe(false);
  });
  it("cannot select a locked world or an unavailable NPC", () => {
    const ctx = state(); ctx.world.unlockedLocations = []; ctx.npcs.rohan_mehta = undefined;
    expect(directorCandidates(ctx).some((c) => c.proposal.questId === "director_checkpoint")).toBe(false);
    for (const c of directorCandidates(ctx)) if (!validateProposal(c.proposal, ctx).proposal) expect(planDirector(ctx).selected?.id).not.toBe(c.proposal.id);
  });
});

describe("continuity and delayed effects", () => {
  it("loads an existing save without schema migration or fictional character history", () => {
    const initial = createInitialWorldState();
    const { director: unused, ...oldSave } = initial;
    void unused;
    const restored = WorldStateSchema.parse(oldSave);
    expect(restored.director.clock).toBe(0);
    expect(restored.completedQuests).toEqual(initial.completedQuests);
    expect(reconcileThreads({ world: restored, competencies: createEmptyProfile(), npcs: {} }).director.characters).toEqual({});
  });
  it("an introduction waits for progression and retains its causal origin", () => {
    const ctx = simulatedProfiles().D_ready_for_responsibility;
    ctx.world.completedQuests = ctx.world.completedQuests.slice(0, 3);
    ctx.world.flags = ["nova_labs.joined"];
    ctx.world.director.threads = []; ctx.world.director.clock = 0;
    const early = reconcileThreads(ctx);
    const thread = early.director.threads.find((t) => t.id === "emma_returns")!;
    expect(thread.status).toBe("pending");
    expect(thread.dueAfter).toBe(5);
    expect(thread.sourceAttemptId).toBe("D_ready_for_responsibility_2");
    expect(planDirector({ ...ctx, world: early }).selected?.questId).not.toBe("director_introduction");
  });
  it("canonical evidence is idempotent and bounded", () => {
    const ctx = simulatedProfiles().B_pushes_past_people;
    const evidence = { attemptId: "new", questId: "director_checkpoint", npcId: "rohan_mehta", grade: "failure" as const, difficulty: 2, variant: "listen" as const, signals: { aggressive_tone: 1000 }, observations: [] };
    const first = advanceContinuity(ctx, evidence);
    expect(first.director.reputation.diplomatic - ctx.world.director.reputation.diplomatic).toBe(-6);
    expect(advanceContinuity({ ...ctx, world: first }, evidence)).toEqual(first);
  });
});

describe("encounters have playable, deterministic strategies", () => {
  function run(profile: string, lines: string[]) {
    const ctx = simulatedProfiles()[profile]; const p = planDirector(ctx).selected!;
    const q = findQuest(p.questId, p)!;
    const npc = ctx.npcs[p.npcId]!;
    const hidden = q.scene.createHidden({ world: ctx.world, npc });
    const scene = createSceneState(q.scene.createCustom(hidden));
    const sctx = { world: ctx.world, npc, hidden, scene, playerName: "Asha" };
    for (const text of lines) {
      const r = q.scene.preTurn!(sctx, readPlayerUtterance(text), text);
      if (r.custom) scene.custom = r.custom;
      scene.turnCount++;
    }
    return { q, sctx, scene };
  }
  it("a listening player can uncover the constraint and negotiate a reversible pilot", () => {
    const { scene } = run("C_avoids_the_ask", [
      "What capacity can the lead give to support this?",
      "I understand your reputation is at risk if the plan goes wrong.",
      "I delivered a migration for 3000 accounts last month.",
      "I would like an introduction for a smaller two-week pilot with a written checkpoint.",
    ]);
    expect(scene.custom.ready).toBe(true);
  });
  it("a boss accepts an evidence-led bounded case, but generic confidence is not enough", () => {
    const { scene } = run("D_ready_for_responsibility", [
      "What support would make this work for the team?",
      "I delivered the migration for 3000 accounts.",
      "I reduced the backup time by 30 percent.",
      "I propose a smaller two-week pilot with a written checkpoint.",
    ]);
    expect(scene.custom.ready).toBe(true);
    expect(run("D_ready_for_responsibility", ["I am amazing. Just trust me."]).scene.custom.ready).toBe(false);
  });
  it("NPC proposals cannot grant rewards or override the readiness gate", () => {
    const { q, sctx, scene } = run("A_overcommits", ["I don't want a pilot or a checkpoint."]);
    const moves = NPCMovesSchema.parse({ proposal: { promoted: true, xp: 9000 } });
    expect(q.scene.reduceProposal?.(sctx, moves)?.custom.ready ?? scene.custom.ready).toBe(false);
    expect(q.scene.speechGate!("You're promoted.", sctx).ok).toBe(false);
    expect(q.scene.speechGate!("Agreed, I'll introduce you.", sctx).ok).toBe(false);
  });
  it("a withdrawn proposal no longer earns an introduction", () => {
    const { scene } = run("C_avoids_the_ask", [
      "I delivered a migration for 3000 accounts last month.",
      "I would like an introduction for a smaller two-week pilot with a written checkpoint.",
      "I withdraw that proposal. I don't want an introduction.",
    ]);
    expect(scene.custom.ready).toBe(false);
  });
});
