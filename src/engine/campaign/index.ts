import type { AnyQuestDefinition } from "../types/quest";
import type { WorldState } from "../types/world";
import type { CompetencyProfile } from "../types/skills";
import type { NPCInstanceState } from "../types/npc";
import type { CampaignEnding, FailureKind } from "./types";
import { communicate } from "./information";
import { pacingFor } from "./pacing";
import { CHARACTER_OUTCOMES, MAJOR_NPCS, WEAKNESS_ADVICE, shortProfessional, stageOf, storyMoments } from "@/content/ending";
import { SKILLS } from "../types/skills";
import { formatINR } from "../util";

export const CAREER_ACTS = [
  { id: "get_in", title: "Get in", subtitle: "Land the job at Nova Labs.", milestones: ["recruiter_screening", "hiring_manager_interview", "counter_offer", "first_day_nova_labs"] },
  { id: "prove_yourself", title: "Prove yourself", subtitle: "Earn a place on the platform team.", milestones: ["meet_maya", "push_back_on_deadline", "nora_requirements", "status_update"] },
  { id: "consequences", title: "Consequences", subtitle: "What you said starts coming back.", milestones: ["customer_escalation"] },
  { id: "step_up", title: "Step up", subtitle: "Responsibility for other people.", milestones: ["mentor_arjun", "feedback_for_rohan"] },
  { id: "climax", title: "The crisis", subtitle: "Everything you built, in one room.", milestones: ["project_crisis"] },
  { id: "resolution", title: "Resolution", subtitle: "What it all added up to.", milestones: ["the_review"] },
] as const;
export const CAREER_MILESTONES: string[] = CAREER_ACTS.flatMap((a) => [...a.milestones]);
/** The conversation whose conclusion freezes the season ending. */
export const FINAL_MILESTONE = "the_review";
/**
 * Milestones whose failure is itself an authored continuation: the story moves
 * on, changed (Nora takes the account, Rohan takes the rollout). Earlier
 * milestones block on failure and offer a separate recovery conversation.
 */
export const CONTINUES_ON_FAILURE: string[] = ["customer_escalation", "mentor_arjun", "feedback_for_rohan", "project_crisis", "the_review"];
export const recoveryId = (questId: string) => `recovery_${questId}`;
export function milestoneResolved(world: WorldState, id: string): boolean {
  return world.completedQuests.some((r) => r.questId === id)
    || world.campaign.failures.some((f) => f.questId === id && !!f.recoveredBy)
    || (CONTINUES_ON_FAILURE.includes(id) && world.failedQuests.some((r) => r.questId === id));
}
export function milestoneAllowed(world: WorldState, id: string): boolean {
  const index = CAREER_MILESTONES.indexOf(id);
  return index <= 0 || CAREER_MILESTONES.slice(0, index).every((q) => milestoneResolved(world, q));
}
export function actOf(questId: string) {
  return CAREER_ACTS.find((a) => (a.milestones as readonly string[]).includes(questId)) ?? null;
}
export function campaignActs(world: WorldState) {
  return CAREER_ACTS.map((a) => ({ id: a.id, title: a.title, subtitle: a.subtitle,
    completed: a.milestones.filter((q) => milestoneResolved(world, q)).length, total: a.milestones.length,
    state: a.milestones.every((q) => milestoneResolved(world, q)) ? "completed" : milestoneAllowed(world, a.milestones[0]) ? "open" : "locked",
  }));
}

/** Additive migration for old saves. An inferred failure is still tied to its real attempt. */
export function reconcileCampaign(world: WorldState): WorldState {
  const next = structuredClone(world);
  for (const r of world.failedQuests) {
    if (!CAREER_MILESTONES.includes(r.questId) || next.campaign.failures.some((f) => f.attemptId === r.attemptId)) continue;
    next.campaign.failures.push({ id: `failure:${r.attemptId}`, questId: r.questId, attemptId: r.attemptId,
      npcId: ["recruiter_screening", "counter_offer"].includes(r.questId) ? "emma_kapoor" : "rohan_mehta",
      kind: "recoverable_mistake", summary: `The ${r.questId.replaceAll("_", " ")} conversation ended without agreement.`,
      recoveryQuestId: CONTINUES_ON_FAILURE.includes(r.questId) ? null : recoveryId(r.questId), recoveredBy: null, recoveryAttempts: [] });
  }
  for (const a of campaignActs(next)) next.campaign.branches[a.id] = a.state as "completed" | "open" | "locked";
  for (const f of next.campaign.failures) next.campaign.branches[f.id] = f.recoveredBy ? "completed" : f.kind === "hard_branch_closure" ? "closed" : "unresolved";
  return next;
}

export interface CampaignCompletion {
  quest: AnyQuestDefinition; attemptId: string; outcomeId: string; grade: "success" | "partial" | "failure";
  label: string; recoveryTarget?: string | null;
  /** The outcome's authored setback policy (see OutcomeBranch.setback). */
  setback?: FailureKind | false;
  beforeSkills: CompetencyProfile; skills: CompetencyProfile;
  npcs: Record<string, NPCInstanceState | undefined>;
}
export function advanceCampaign(input: WorldState, completion: CampaignCompletion): WorldState {
  if (input.campaign.processedAttempts.includes(completion.attemptId)) return input;
  let world = reconcileCampaign(input);
  const c = completion, q = c.quest, campaign = world.campaign;
  campaign.processedAttempts.push(c.attemptId);
  if (!Object.keys(campaign.baselineSkills).length) campaign.baselineSkills = Object.fromEntries(Object.values(c.beforeSkills).map((s) => [s.skillId, s.xp]));
  const pacing = pacingFor(q);
  campaign.recent = [...campaign.recent, { questId: q.id, category: pacing.category, intensity: pacing.intensity, difficulty: q.difficulty }].slice(-16);
  if (CAREER_MILESTONES.includes(q.id)) campaign.milestones[q.id] = { attemptId: c.attemptId, grade: c.grade, outcomeId: c.outcomeId };
  const failure = campaign.failures.find((f) => f.attemptId === c.attemptId);
  if (failure) { failure.kind = q.failure?.kind ?? failure.kind; failure.summary = c.label; failure.recoveryQuestId = q.failure?.recoveryQuestId ?? failure.recoveryQuestId; }
  // A failure is always a setback. A partial is one only when authored as such:
  // an awkward first day is texture, an unsafe Friday promise is a commitment failure.
  const setback = c.grade === "failure" || (c.grade === "partial" && (c.setback !== undefined ? c.setback !== false : !!q.failure));
  if (setback && !q.recovery && !failure) campaign.failures.push({
    id: `failure:${c.attemptId}`, questId: q.id, attemptId: c.attemptId, npcId: q.npcId,
    kind: (c.setback || undefined) ?? q.failure?.kind ?? (c.grade === "partial" ? "partial_success" : "recoverable_mistake"), summary: c.label,
    recoveryQuestId: q.failure?.recoveryQuestId ?? (c.grade === "failure" && CAREER_MILESTONES.includes(q.id) && !CONTINUES_ON_FAILURE.includes(q.id) ? recoveryId(q.id) : null),
    recoveredBy: null, recoveryAttempts: [],
  });
  if (q.recovery && c.recoveryTarget) {
    const target = campaign.failures.find((f) => f.id === c.recoveryTarget);
    if (target && !target.recoveredBy) {
      target.recoveryAttempts.push(c.attemptId);
      if (c.grade === "success") target.recoveredBy = c.attemptId;
      // A failed repair remains history. The authored recovery outcome controls the next branch.
      else campaign.branches[`recovery:${target.id}`] = "unresolved";
    }
  }
  const participants = q.ensemble?.participants.map((p) => p.npcId) ?? [q.npcId];
  const factId = `encounter:${c.attemptId}`;
  campaign.information.push({ id: factId, ownerId: q.npcId, sourceAttemptId: c.attemptId, sourceQuestId: q.id,
    visibility: participants.length > 1 ? "team" : "private", audience: participants,
    summary: `${q.title}: ${c.label}.` });
  // Only an authored professional summary leaves this room, never private negotiation text.
  if (q.id === "project_crisis") {
    const summaryId = `review:${c.attemptId}`;
    campaign.information.push({ id: summaryId, ownerId: "rohan_mehta", sourceAttemptId: c.attemptId, sourceQuestId: q.id,
      visibility: "shared", audience: [], summary: c.grade === "success" ? "The player aligned a viable crisis plan." : c.grade === "partial" ? "The crisis was contained with supervision." : "Rohan took over the crisis after the plan remained unresolved." });
    const trust = c.npcs.rohan_mehta?.relationship.trust ?? 0;
    world = communicate(world, { id: `rohan-emma:${c.attemptId}`, factId: summaryId, from: "rohan_mehta", to: "emma_kapoor",
      kind: c.grade === "success" && trust >= 15 ? "recommendation" : "incident", sourceAttemptId: c.attemptId,
      reason: c.grade === "success" && trust >= 15 ? "After the crisis room, Rohan recommended you to Emma." : "Rohan sent Emma a short account of the crisis. What was said in the room stayed there." });
  }
  world = reconcileCampaign(world);
  // The season ends after the aftermath conversation, not the instant the crisis room empties.
  if (q.id === FINAL_MILESTONE && !world.campaign.ending && milestoneAllowed(world, q.id)) {
    world.flags = [...new Set([...world.flags, "season1.complete"])];
    world.campaign.ending = resolveEnding(world, c.skills, c.npcs, c.attemptId);
  }
  return world;
}

export function resolveEnding(world: WorldState, skills: CompetencyProfile, npcs: Record<string, NPCInstanceState | undefined>, attemptId: string): CampaignEnding {
  const campaign = world.campaign, rep = world.director.reputation, flags = new Set(world.flags);
  const boss = campaign.milestones.project_crisis;
  const recovered = campaign.failures.filter((f) => f.recoveredBy);
  const trust = npcs.rohan_mehta?.relationship.trust ?? 0;
  const demonstrated = (id: keyof CompetencyProfile) => { const observed = Object.values(skills[id].facets).filter((f) => f.samples >= 2 && f.confidence >= 0.3); return observed.length ? observed.reduce((sum, f) => sum + f.estimate, 0) / observed.length : 0; };
  const reviewed = ["review.lead_trial", "review.path_agreed", "review.rebuild_agreed", "review.stalled"].some((f) => flags.has(f));
  // Professional outcome: the crisis sets the ceiling; the review decides whether the player reached for it.
  const professional = boss?.grade === "failure" ? flags.has("review.rebuild_agreed") ? "A narrower remit, with an agreed way back" : "A narrower remit, with trust to rebuild"
    : recovered.length >= 2 && boss?.grade === "success" ? "A second chance earned: trusted contributor"
    : boss?.grade === "success" && (flags.has("review.lead_trial") || (!reviewed && trust >= 25 && rep.diplomatic >= 10 && demonstrated("leadership") >= 60)) ? "Project lead trial"
    : rep.assertive >= 15 && rep.diplomatic < 5 ? "Specialist path, without a people mandate"
    : boss?.grade === "success" && flags.has("review.stalled") ? "Trusted contributor; the lead role is still open"
    : boss?.grade === "partial" ? flags.has("review.path_agreed") ? "Trusted contributor with a path to lead" : "Trusted contributor with shared oversight"
    : "Lateral growth through a scoped project";
  // Identity: ordered, each label needs the evidence behind it. No flattering default.
  // Overcommitment is a pattern, not one yes: count the unsupported promises actually made.
  const overcommits = ["interview.overpromised", "nova_labs.rushed_migration", "nora.dashboard_promised"].filter((f) => flags.has(f)).length >= 2;
  const identity = recovered.length >= 2 && boss?.grade !== "failure" ? "Accountability earned through recovery"
    : flags.has("chapter1.hid_incident") && !flags.has("status.repaired") ? "Still learning to bring bad news early"
    : rep.assertive >= 15 && rep.diplomatic < 5 ? "A strong negotiator still learning to listen"
    : rep.empathetic >= 15 && rep.reliable < 5 ? "A thoughtful collaborator learning boundaries"
    : overcommits ? "Warm, willing, and overcommitted"
    : boss?.grade === "success" && trust >= 25 && demonstrated("leadership") >= 65 && (flags.has("arjun.mentored") || flags.has("rohan.took_feedback")) ? "An emerging leader people bring the hard problems to"
    : trust >= 25 && rep.credible >= 10 && demonstrated("communication") >= 60 ? "A trusted communicator and emerging leader"
    : demonstrated("listening") >= 70 ? "A thoughtful listener building a professional voice"
    : rep.diplomatic >= 10 && demonstrated("conflict_resolution") >= 60 ? "A diplomatic problem solver"
    : demonstrated("confidence") > 0 && demonstrated("confidence") < 45 && boss?.grade !== "failure" ? "Careful and trusted, still finding the nerve to ask"
    : "A developing professional with unfinished work";
  // The seven heaviest real moments, told in the order they happened.
  const definingMoments = storyMoments(world).map((m, order) => ({ ...m, order })).sort((a, b) => b.weight - a.weight || a.order - b.order).slice(0, 7).sort((a, b) => a.order - b.order).map(({ label, attemptId: id }) => ({ label, attemptId: id }));
  if (!definingMoments.length) definingMoments.push({ label: `Project Crisis: ${boss?.outcomeId.replaceAll("_", " ") ?? "unresolved"}`, attemptId });
  const middle = flags.has("chapter1.hid_incident") ? "Under Scrutiny" : flags.has("chapter1.owned_incident") && trust >= 10 ? "Trusted Contributor" : "Team Member";
  const joined = world.career.status === "employed" || flags.has("nova_labs.joined");
  const path = joined ? ["Candidate", "Platform Engineer", middle, shortProfessional(professional)] : ["Candidate", professional];
  const met = Object.values(npcs).filter((n): n is NPCInstanceState => !!n && (n.timesMet > 0 || world.peopleMet.includes(n.npcId)));
  const rank = (id: string) => { const i = MAJOR_NPCS.indexOf(id); return i < 0 ? 99 : i; };
  const relationships = met.sort((a, b) => rank(a.npcId) - rank(b.npcId) || a.npcId.localeCompare(b.npcId)).map((n) => ({ npcId: n.npcId,
    outcome: CHARACTER_OUTCOMES[n.npcId]?.[stageOf(n)] ?? (n.relationship.trust < 0 ? "Trust remains strained" : n.relationship.trust >= 25 && n.relationship.respect >= 15 ? "Would back your judgment" : n.relationship.warmth >= 15 ? "Values your care; still needs evidence" : "A working relationship, still developing"),
    evidence: [...world.director.characters[n.npcId]?.milestones.map((m) => m.summary) ?? [], ...campaign.communications.filter((c) => c.to === n.npcId || c.from === n.npcId).map((c) => c.reason)].slice(-3) }));
  const growth = Object.values(skills).map((s) => ({ skill: s.skillId, before: campaign.baselineSkills[s.skillId] ?? s.xp, after: s.xp, delta: s.xp - (campaign.baselineSkills[s.skillId] ?? s.xp) })).sort((a, b) => b.delta - a.delta || a.skill.localeCompare(b.skill)).slice(0, 3);
  // The weakest facet that was actually measured, twice or more. Unknown is not weakness.
  const measured = Object.values(skills).flatMap((s) => Object.entries(s.facets).filter(([, f]) => f.samples >= 2 && f.confidence >= 0.3).map(([facet, f]) => ({ skill: s.skillId as string, facet, estimate: f.estimate })));
  const weakest = measured.sort((a, b) => a.estimate - b.estimate || a.facet.localeCompare(b.facet))[0];
  const weakness = weakest && weakest.estimate < 70 ? { skill: weakest.skill, label: SKILLS[weakest.skill as keyof typeof SKILLS]?.facets.find((f) => f.id === weakest.facet)?.label ?? weakest.facet, advice: WEAKNESS_ADVICE[weakest.facet] ?? "Keep practising this one." } : null;
  const emmaTrust = npcs.emma_kapoor?.relationship.trust ?? 0;
  const tease = professional === "Project lead trial" ? { title: "Leadership Tower is opening", body: "Your trial starts next quarter, with a team that didn't choose you. The people there have already heard about the crisis room." }
    : emmaTrust >= 20 ? { title: "Emma has another opportunity for you", body: flags.has("director.introduction_earned") ? "The pilot she introduced you to wants a second phase. She'd like to talk before anyone else does." : "She's heard how the crisis went. There's a role she thinks you should hear about." }
    : boss?.grade === "failure" ? { title: "Career City isn't finished with you", body: "Rohan agreed a way back. The next project will remember this one, and so will you." }
    : { title: "The Negotiation Arena is taking shape", body: "Meridian's renewal is coming, and Nora wants someone in the room who can hold a number." };
  const unresolved = [...world.commitments.filter((p) => p.status === "open").map((p) => p.description), ...campaign.failures.filter((f) => !f.recoveredBy && f.kind !== "partial_success").map((f) => f.summary), ...world.director.threads.filter((t) => t.status !== "resolved").map((t) => t.title)];
  const opening = joined ? `You joined Nova Labs${world.career.baseSalary ? ` at ${formatINR(world.career.baseSalary)}` : ""}` : "You never quite got in";
  const middleBeat = flags.has("chapter1.owned_incident") ? ", owned what went wrong," : flags.has("chapter1.hid_incident") ? ", played an incident down," : "";
  const close = boss?.grade === "success" ? " and walked out of the crisis room with a plan everyone could stand behind." : boss?.grade === "partial" ? " and contained the crisis, with Rohan watching." : boss ? " and watched Rohan take the crisis back." : ".";
  const headline = `${opening}${middleBeat}${close}`;
  return {
    id: "career_city:season_1", resolvedBy: attemptId, professional, identity, path, definingMoments, relationships, growth,
    goals: world.director.preferences.goals, unresolved,
    nextChapter: professional === "Project lead trial" ? "A leadership trial is on the horizon." : "Your next chapter starts with the relationships and commitments you carry forward.",
    weakness, tease, headline,
  };
}

export function failureKindForOutcome(grade: "success" | "partial" | "failure", kind?: FailureKind): FailureKind | null {
  return grade === "success" ? null : grade === "partial" ? "partial_success" : kind ?? "recoverable_mistake";
}
