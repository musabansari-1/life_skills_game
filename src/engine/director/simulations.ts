/** Reproducible profiles for design review and regression tests, not production player inference. */
import { createEmptyProfile } from "../competency";
import { createInitialWorldState } from "../types/world";
import { createNPCInstanceState } from "../types/npc";
import { SKILL_IDS, type SkillId } from "../types/skills";
import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { planDirector } from ".";
import { characterArc, reconcileThreads, relationshipGameplay, type DirectorContext } from "./continuity";

export function simulatedProfiles(): Record<string, DirectorContext> {
  const profiles: Record<string, DirectorContext> = {};
  const configs: { name: string; skills: Partial<Record<SkillId, number>>; reliable: number; diplomatic: number; trust: number; failure: boolean; rushed: boolean }[] = [
    { name: "A_overcommits", skills: { negotiation: 85, conflict_resolution: 25, communication: 78 }, reliable: -24, diplomatic: 5, trust: 15, failure: false, rushed: true },
    { name: "B_pushes_past_people", skills: { confidence: 85, listening: 18, conflict_resolution: 55 }, reliable: 8, diplomatic: -24, trust: -10, failure: false, rushed: false },
    { name: "C_avoids_the_ask", skills: { listening: 82, conflict_resolution: 75, confidence: 22 }, reliable: 15, diplomatic: 20, trust: 30, failure: true, rushed: false },
    { name: "D_ready_for_responsibility", skills: Object.fromEntries(SKILL_IDS.map((s) => [s, 80])), reliable: 25, diplomatic: 20, trust: 40, failure: false, rushed: false },
  ];
  for (const config of configs) {
    const world = createInitialWorldState();
    world.career = { ...world.career, status: "employed", employer: "Nova Labs", role: "Platform Engineer" };
    world.flags.push("nova_labs.joined", "chapter1.complete", "chapter1.owned_incident");
    if (config.rushed) world.flags.push("nova_labs.rushed_migration", "interview.overpromised");
    const ids = ["recruiter_screening", "hiring_manager_interview", "counter_offer", "first_day_nova_labs", "push_back_on_deadline", "status_update"];
    world.completedQuests = ids.map((questId, i) => ({ questId, attemptId: `${config.name}_${i}`, outcomeId: questId === "push_back_on_deadline" ? config.rushed ? "capitulated" : "plan_agreed" : questId === "status_update" ? "owned_it" : findQuest(questId)!.outcomes.find((o) => o.grade === (config.failure ? "partial" : "success"))!.id, at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z` }));
    // Acts 2-4 beyond the original six milestones, so "ready for responsibility" really is pre-climax.
    const later = ["meet_maya", "nora_requirements", "customer_escalation", "mentor_arjun", "feedback_for_rohan"];
    world.completedQuests.push(...later.map((questId, i) => ({ questId, attemptId: `${config.name}_later_${i}`, outcomeId: findQuest(questId)!.outcomes.find((o) => o.grade === (config.failure ? "partial" : "success"))!.id, at: `2026-09-${String(i + 10).padStart(2, "0")}T10:00:00.000Z` })));
    world.peopleMet = ["emma_kapoor", "rohan_mehta"];
    world.unlockedLocations.push("career_city.nova_labs_platform");
    world.director.reputation.reliable = config.reliable;
    world.director.reputation.diplomatic = config.diplomatic;
    const npcs = Object.fromEntries(world.peopleMet.map((id) => {
      const n = createNPCInstanceState(NPCS[id]); n.timesMet = 3;
      n.relationship = { ...n.relationship, trust: id === "emma_kapoor" ? 35 : config.trust, respect: 35, familiarity: 35, warmth: id === "emma_kapoor" ? 30 : 5 };
      return [id, n];
    }));
    const competencies = createEmptyProfile();
    for (const skill of SKILL_IDS) for (const facet of Object.values(competencies[skill].facets)) Object.assign(facet, { estimate: config.skills[skill] ?? 60, samples: 8, confidence: 0.85, lastObservedAt: "2026-09-06" });
    world.director.recent = ids.slice(-3).map((questId, i) => ({ attemptId: `${config.name}_${i + 3}`, questId, npcId: findQuest(questId)!.npcId, grade: findQuest(questId)!.outcomes.find((o) => o.id === world.completedQuests[i + 3].outcomeId)!.grade, difficulty: 3, variant: null, signals: {}, observations: [] }));
    if (config.rushed) world.decisions.push({ id: "friday_decision", questId: "push_back_on_deadline", description: "Accepted Friday without a rollback path.", at: "2026-09-05" });
    profiles[config.name] = { world: reconcileThreads({ world, competencies, npcs }), competencies, npcs };
  }
  return profiles;
}

export function simulateDirector() {
  return Object.entries(simulatedProfiles()).map(([player, state]) => {
    const plan = planDirector(state);
    const p = plan.selected!;
    return { player, quest: p.title, questId: p.questId, variant: p.variant, event: p.eventType, difficulty: p.difficulty, focus: p.targetSkills, whyNow: p.whyNow, rules: plan.audit.reasons, reaction: relationshipGameplay(state.npcs[p.npcId]!, state.world), arc: characterArc(state, p.npcId)?.stage, threads: state.world.director.threads.map((t) => ({ title: t.title, status: t.status, causedBy: t.sourceAttemptId, result: t.resolution })) };
  });
}
