import { QUESTS, findQuest } from "@/content/quests";
import { CAREER_MILESTONES, FINAL_MILESTONE, milestoneResolved, reconcileCampaign } from "../campaign";
import { pacingAdjustment } from "../campaign/pacing";
import { NPCS } from "@/content/npcs";
import { getLocation, getWorld } from "@/content/worlds";
import { VARIANT_FOCUS, VARIANT_SKILLS } from "@/content/quests/director-encounters";
import { checkPrerequisites } from "../world";
import { SKILLS, type SkillId } from "../types/skills";
import type { WorldState } from "../types/world";
import { reconcileThreads, relationshipGameplay, skillEstimate, type DirectorContext } from "./continuity";
import { DirectorProposalSchema, type DirectorProposal, type DirectorAudit, type EncounterVariant, type PlayerGoal } from "./types";

export const GOAL_SKILL: Record<PlayerGoal, SkillId> = { negotiation: "negotiation", confidence: "confidence", interviews: "persuasion", leadership: "leadership", conflict: "conflict_resolution", listening: "listening" };
export interface Candidate { proposal: DirectorProposal; score: number; reasons: string[] }
export interface RuleFailure { rule: string; detail: string }
const done = (w: WorldState, id: string) => [...w.completedQuests, ...w.failedQuests].some((q) => q.questId === id);

function variantScore(ctx: DirectorContext, variant: EncounterVariant): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const focus = variant === "repair" ? "conflict_resolution" : variant === "listen" ? "listening" : variant === "ask" ? "confidence" : "leadership";
  const estimate = skillEstimate(ctx, focus);
  if (estimate !== null && estimate < 55) { score += (55 - estimate) * 2; reasons.push(`observed_weakness:${focus}`); }
  const recent = ctx.world.director.recent.slice(-4);
  const mistakes = recent.filter((r) => r.observations.some((o) => o.skill === focus && o.score < 0.45)).length;
  if (mistakes >= 2) { score += 18; reasons.push(`repeated_difficulty:${focus}`); }
  const byFacet = new Map<string, number[]>();
  for (const r of recent) for (const o of r.observations.filter((o) => o.skill === focus)) byFacet.set(o.facet, [...(byFacet.get(o.facet) ?? []), o.score]);
  if ([...byFacet.values()].some((scores) => scores.length >= 2 && scores.at(-1)! - scores[0] >= 0.2)) { score -= 10; reasons.push(`recent_improvement:${focus}`); }
  const goals = ctx.world.director.preferences.goals;
  if (goals.some((g) => GOAL_SKILL[g] === focus)) { score += 16; reasons.push(`player_goal:${focus}`); }
  const upcoming = ctx.world.director.preferences.upcoming;
  if (upcoming && GOAL_SKILL[upcoming.goal] === focus) { score += upcoming.horizon === "soon" ? 25 : 12; reasons.push(`upcoming_need:${focus}`); }
  const r = ctx.world.director.reputation;
  const beliefs = Object.values(ctx.npcs).flatMap((n) => n?.memory.beliefs ?? []).filter((b) => b.strength >= 0.65).map((b) => b.key.toLowerCase());
  // Impressions are a weak hint, never a substitute for an observed decision or a prerequisite.
  if (variant === "repair" && beliefs.some((k) => /overpromis|overcommit|too_agreeable/.test(k))) { score += 7; reasons.push("npc_expects_overcommitment"); }
  if (variant === "listen" && beliefs.some((k) => /pushy|aggressive|poor_listen/.test(k))) { score += 7; reasons.push("npc_expects_pressure"); }
  if (variant === "repair" && (ctx.world.flags.includes("interview.overpromised") || r.reliable < -10)) { score += 22; reasons.push("commitment_pattern"); }
  if (variant === "listen" && r.diplomatic < -10) { score += 25; reasons.push("pressure_without_listening"); }
  if (variant === "stretch" && ["negotiation", "listening", "confidence", "conflict_resolution"].every((s) => (skillEstimate(ctx, s as SkillId) ?? 0) >= 65)) { score += 50; reasons.push("ready_to_combine_skills"); }
  if (recent.at(-1)?.variant === variant) { score -= 28; reasons.push("recent_variant_cooldown"); }
  return { score, reasons };
}

function difficulty(ctx: DirectorContext, variant: EncounterVariant): number {
  const recent = ctx.world.director.recent.slice(-3);
  const focus = VARIANT_SKILLS[variant][0];
  let target = variant === "stretch" ? 4 : (skillEstimate(ctx, focus) ?? 50) < 40 ? 2 : 3;
  if (recent.filter((r) => r.grade === "failure").length >= 2) target = 2;
  if ((skillEstimate(ctx, "confidence") ?? 50) < 35) target = Math.min(target, 2);
  const last = recent.at(-1)?.difficulty;
  if (last !== undefined) target = Math.max(last - 1, Math.min(last + 1, target));
  return Math.max(1, Math.min(4, target));
}

/** Grounded assembly: authored stakes + observed focus + a real causal anchor. */
export function directorCandidates(input: DirectorContext): Candidate[] {
  const ctx = { ...input, world: reconcileCampaign(reconcileThreads(input)) };
  const w = ctx.world;
  const candidates: Candidate[] = [];
  // Personalized events belong to the season's middle. After the crisis, only its aftermath is next.
  const beforeClimax = !milestoneResolved(w, "project_crisis");
  const checkpointPossible = beforeClimax && w.career.status === "employed" && done(w, "push_back_on_deadline") && !done(w, "director_checkpoint");
  const introductionPossible = beforeClimax && w.career.status === "employed" && w.flags.includes("chapter1.complete") && done(w, "counter_offer") && !done(w, "director_introduction");
  for (const template of ["checkpoint", "introduction"] as const) {
    if (!(template === "checkpoint" ? checkpointPossible : introductionPossible)) continue;
    const npcId = template === "checkpoint" ? "rohan_mehta" : "emma_kapoor";
    const npc = ctx.npcs[npcId];
    if (!npc || (!w.peopleMet.includes(npcId) && npc.timesMet === 0)) continue;
    const locationId = template === "checkpoint" ? "career_city.nova_labs_platform" : "career_city.nova_labs_hr";
    if (!worldAllows(w, "career_city", locationId)) continue;
    const questId = template === "checkpoint" ? "director_checkpoint" : "director_introduction";
    const thread = w.director.threads.find((t) => t.kind === (template === "checkpoint" ? "deadline" : "introduction") && t.status === "ready");
    for (const variant of ["repair", "listen", "ask", "stretch"] as const) {
      const matched = variantScore(ctx, variant);
      // An introduction is an earned affordance, or a conversation to earn one. Never an automatic reward.
      const trusted = relationshipGameplay(npc, w).canIntroduce;
      if (variant === "stretch" && (!trusted || !w.flags.includes("chapter1.complete") || matched.score < 30)) continue;
      const level = difficulty(ctx, variant);
      const boss = variant === "stretch" && level >= 3;
      const pressure = template === "checkpoint" && !w.flags.includes("chapter1.complete");
      const title = template === "checkpoint"
        ? pressure ? "Before Friday Becomes a Promise" : variant === "listen" ? "Before You Give an Answer" : "The Next Commitment"
        : boss ? "Put My Name Behind It" : variant === "ask" ? "The Ask You Haven't Made" : "A Door Emma Can Open";
      const summary = template === "checkpoint"
        ? pressure ? "Rohan checks in before repeating the migration date to his director. There is still time to change the commitment, if you can give him a plan he can defend." : "After the migration, Rohan wants to agree how the next commitment gets made. His trust in your account will shape how much evidence he needs."
        : trusted ? "Emma remembers how you handled hiring. Now she has a possible internal introduction, but needs a specific ask and a credible limit on what you will take on." : "Emma will hear your case for an internal introduction. You will have to earn her recommendation with a bounded plan before she puts her reputation behind it.";
      const sourceQuest = template === "checkpoint" ? "push_back_on_deadline" : "counter_offer";
      const source = [...w.completedQuests, ...w.failedQuests].find((r) => r.questId === sourceQuest)!;
      const history: DirectorProposal["history"] = [{ kind: "quest", id: source.attemptId, label: `${findQuest(sourceQuest)!.title}: ${findQuest(sourceQuest)!.outcomes.find((o) => o.id === source.outcomeId)?.label ?? source.outcomeId}` }];
      if (thread) history.push({ kind: "thread", id: thread.id, label: thread.explanation });
      const commitment = w.commitments.find((c) => c.toNpcId === npcId && c.status === "open");
      if (commitment) history.push({ kind: "promise", id: commitment.id, label: commitment.description });
      history.push({ kind: "relationship", id: npcId, label: trusted ? `${NPCS[npcId].shortName} trusts you enough to consider a recommendation.` : `${NPCS[npcId].shortName} needs a concrete case before committing.` });
      const focus = VARIANT_SKILLS[variant][0];
      if (skillEstimate(ctx, focus) !== null) history.push({ kind: "skill", id: focus, label: `Your recent conversations give you a chance to work on ${SKILLS[focus].label.toLowerCase()}.` });
      const goal = w.director.preferences.goals.find((g) => VARIANT_SKILLS[variant].includes(GOAL_SKILL[g]));
      if (goal) history.push({ kind: "goal", id: goal, label: `This connects to your chosen focus: ${SKILLS[GOAL_SKILL[goal]].label.toLowerCase()}.` });
      let score = 35 + matched.score + (thread ? 18 : 0) + (pressure ? 22 : 0);
      if (template === "introduction" && (variant === "ask" || variant === "stretch")) score += 18;
      if (template === "checkpoint" && (variant === "repair" || variant === "listen")) score += 35;
      if (template === "introduction" && (variant === "repair" || variant === "listen")) score -= 15;
      if (w.director.recent.at(-1)?.npcId === npcId) score -= 8;
      candidates.push({ score, reasons: [...matched.reasons, thread ? "causal_thread_ready" : "shared_history", pressure ? "time_to_revisit_commitment" : "next_arc_opening"], proposal: {
        version: 1, id: `${questId}:${variant}:v${w.version}`, basedOnVersion: w.version, questId, template, variant,
        eventType: boss ? "boss" : pressure ? "consequence" : template === "introduction" ? "relationship" : "skill_challenge",
        title, summary, whyNow: `${history[0].label}. ${VARIANT_FOCUS[variant]}${thread ? ` ${thread.explanation}` : ""}`.slice(0, 700),
        worldId: "career_city", npcId, targetSkills: VARIANT_SKILLS[variant], history: history.map((h) => ({ ...h, label: h.label.slice(0, 500) })), difficulty: level,
        objectiveIds: ["make_ask", "discover", "ground_plan", "preserve_relationship"],
        effectPolicy: template === "checkpoint" ? "checkpoint_outcomes" : "introduction_outcomes",
        urgency: pressure ? "pending_consequence" : variant === "ask" ? "gentle" : "normal",
        repeatability: "practice_only_after_resolution", category: "grounded_conversation",
      } });
    }
  }
  // Curated arcs coexist with personalized branches; failures remain eligible for the existing second chance.
  for (const q of QUESTS.filter((q) => !q.id.startsWith("director_"))) {
    if (w.completedQuests.some((r) => r.questId === q.id) || (!q.recovery && done(w, q.id)) || !checkPrerequisites(q.prerequisites, ctx).ok) continue;
    if (!worldAllows(w, q.worldId, q.locationId)) continue;
    // Milestones carry the story; side scenes win only when pacing, a consequence or a skill need argues for them.
    const milestone = CAREER_MILESTONES.includes(q.id);
    let score = q.id === "introduce_yourself" ? 8 : milestone || q.recovery ? 40 : 26;
    const reasons = [milestone ? "curated_arc_available" : q.recovery ? "repair_available" : "optional_scene_available"];
    if (q.id === FINAL_MILESTONE && !beforeClimax) { score += 100; reasons.push("season_aftermath"); }
    if (!beforeClimax && q.id !== FINAL_MILESTONE && !q.recovery) score -= 40;
    const pacing = pacingAdjustment(w, q);
    score += pacing.score;
    reasons.push(...pacing.reasons);
    // The Meridian call is the season's first customer-facing boss. For players who
    // already know Priya, her low-pressure bakery scene is an intentional breather
    // before Act IV rather than a map-only curiosity. It remains optional and still
    // has to satisfy its normal prerequisites/world access.
    if (q.id === "priya_interlude" && milestoneResolved(w, "customer_escalation") && beforeClimax) {
      score += 36;
      reasons.push("breathing_room_after_meridian");
    }
    const weak = q.skills.filter((s) => (skillEstimate(ctx, s) ?? 100) < 45);
    if (weak.length) { score += 8; reasons.push(`skill_match:${weak[0]}`); }
    if (w.director.recent.slice(-2).every((r) => r.grade === "failure") && w.director.recent.length >= 2 && q.difficulty <= 2) { score += 12; reasons.push("recovery_space"); }
    candidates.push({ score, reasons, proposal: {
      version: 1, id: `${q.id}:curated:v${w.version}`, basedOnVersion: w.version, questId: q.id, template: "curated", variant: "repair",
      eventType: q.boss ? "boss" : q.recovery ? "consequence" : "next_quest", title: q.title, summary: q.briefing.situation.slice(0, 600), whyNow: q.recovery ? "The earlier outcome remains in your history. This separate repair can change what happens next." : "This part of your story is open. Earlier decisions still shape the conversation.",
      worldId: q.worldId, npcId: q.npcId, targetSkills: q.skills.slice(0, 4), history: [{ kind: "quest", id: q.id, label: "The story prerequisites for this conversation are met." }],
      difficulty: q.difficulty, objectiveIds: q.objectives.map((o) => o.id), effectPolicy: "curated_outcomes", urgency: "normal", repeatability: "practice_only_after_resolution", category: "grounded_conversation",
    } });
  }
  for (const c of candidates.filter((c) => c.proposal.template !== "curated")) {
    const quest = findQuest(c.proposal.questId, c.proposal);
    if (quest) { const rhythm = pacingAdjustment(w, quest); c.score += rhythm.score; c.reasons.push(...rhythm.reasons); }
  }
  return candidates.sort((a, b) => b.score - a.score || a.proposal.id.localeCompare(b.proposal.id));
}

function worldAllows(w: WorldState, worldId: string, locationId: string) {
  const area = getWorld(worldId), location = getLocation(locationId);
  return !!area && !!location && location.worldId === worldId && w.unlockedWorlds.includes(worldId)
    && (!location.lockedByDefault || w.unlockedLocations.includes(locationId));
}

/** Only the exact assembled grammar is valid. All prose and effect policies are checked, not merely types. */
export function validateProposal(raw: unknown, ctx: DirectorContext, candidates = directorCandidates(ctx)): { proposal: DirectorProposal | null; rejected: RuleFailure[] } {
  const parsed = DirectorProposalSchema.safeParse(raw);
  if (!parsed.success) return { proposal: null, rejected: [{ rule: "schema", detail: parsed.error.issues.map((i) => i.path.join(".") || "proposal").slice(0, 6).join(", ") }] };
  const p = parsed.data;
  const rejected: RuleFailure[] = [];
  const fail = (rule: string, detail: string) => rejected.push({ rule, detail });
  if (p.basedOnVersion !== ctx.world.version) fail("stale_state", "Proposal was made for a different world version.");
  const q = findQuest(p.questId);
  if (!q || !NPCS[p.npcId] || q.npcId !== p.npcId) fail("npc_availability", "Unknown or incompatible character.");
  if (!q || q.worldId !== p.worldId || !worldAllows(ctx.world, p.worldId, q.locationId)) fail("world_access", "World or location is unavailable.");
  if (p.template !== "curated" && done(ctx.world, p.questId)) fail("duplicate_encounter", "This canonical encounter already happened; practice is separate.");
  const matching = candidates.find((c) => c.proposal.id === p.id);
  if (!matching) fail("continuity", "No currently eligible authored branch has this identity.");
  else {
    for (const key of Object.keys(matching.proposal) as (keyof DirectorProposal)[]) {
      if (JSON.stringify(p[key]) !== JSON.stringify(matching.proposal[key])) fail(`grammar:${key}`, "Field differs from the grounded, evaluable encounter grammar.");
    }
    if (matching.score < (candidates[0]?.score ?? 0) - 18) fail("meaningful_priority", "A much more relevant story thread or skill need is available.");
  }
  return { proposal: rejected.length ? null : p, rejected };
}

export function planDirector(ctx: DirectorContext, raw?: unknown, source: DirectorAudit["source"] = "rules") {
  const candidates = directorCandidates(ctx);
  let rejected: RuleFailure[] = [];
  let selected: DirectorProposal | null = null;
  if (raw !== undefined) {
    const result = validateProposal(raw, ctx, candidates); selected = result.proposal; rejected = result.rejected;
  }
  if (!selected) {
    for (const c of candidates) {
      const result = validateProposal(c.proposal, ctx, candidates);
      if (result.proposal) { selected = result.proposal; break; }
      rejected.push(...result.rejected);
    }
  }
  const chosen = candidates.find((c) => c.proposal.id === selected?.id);
  const audit: DirectorAudit = {
    basedOnVersion: ctx.world.version, source: rejected.length ? "fallback" : source,
    selectedQuestId: selected?.questId ?? null, reasons: chosen?.reasons ?? ["no_eligible_content"],
    alternatives: candidates.slice(0, 6).map((c) => ({ questId: c.proposal.questId, variant: c.proposal.variant, score: Math.round(c.score), reasons: c.reasons })), rejected: rejected.slice(0, 20),
  };
  return { selected, audit };
}

/** AI is never a writer. This is the deterministic approval/application boundary. */
export function applyDirectorPlan(ctx: DirectorContext, plan: ReturnType<typeof planDirector>): WorldState {
  const world = reconcileCampaign(reconcileThreads(ctx));
  const selected = plan.selected;
  if (selected && !validateProposal(selected, ctx).proposal) throw new Error("Director plan is no longer valid");
  const eligible = directorCandidates(ctx);
  world.director.offers = world.director.offers.flatMap((offer) => {
    if (done(world, offer.questId)) return [offer];
    const refreshed = eligible.find((c) => c.proposal.questId === offer.questId && c.proposal.variant === offer.variant)
      ?? eligible.find((c) => c.proposal.questId === offer.questId);
    return refreshed ? [refreshed.proposal] : [];
  });
  world.director.recommended = selected;
  if (selected && selected.template !== "curated") {
    // Unstarted offers can be re-aimed when goals change; attempts pin their own definition.
    world.director.offers = [...world.director.offers.filter((o) => o.questId !== selected.questId), selected];
    if (!world.unlockedQuests.includes(selected.questId)) world.unlockedQuests.push(selected.questId);
  }
  world.director.audits = [...world.director.audits, plan.audit].slice(-12);
  return world;
}

export function proposalForQuest(world: WorldState, questId: string) {
  return world.director.offers.find((p) => p.questId === questId);
}
