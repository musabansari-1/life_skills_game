import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import type { NPCInstanceState } from "../types/npc";
import type { CompetencyProfile, SkillId } from "../types/skills";
import type { WorldState } from "../types/world";
import type { CharacterArc, DirectorState } from "./types";

export interface DirectorContext {
  world: WorldState;
  competencies: CompetencyProfile;
  npcs: Record<string, NPCInstanceState | undefined>;
}
export type CanonicalEvidence = DirectorState["recent"][number];
const clamp = (n: number) => Math.max(-100, Math.min(100, n));

/** Unknown is not weakness. At least two observations are needed to steer pressure. */
export function skillEstimate(ctx: DirectorContext, skill: SkillId): number | null {
  const facets = Object.values(ctx.competencies[skill].facets).filter((f) => f.samples >= 2 && f.confidence >= 0.3);
  if (!facets.length) return null;
  return facets.reduce((n, f) => n + f.estimate * f.confidence, 0) / facets.reduce((n, f) => n + f.confidence, 0);
}

/** Behavioural affordances, kept independent: warmth is not credibility. */
export function relationshipGameplay(npc: NPCInstanceState, world: WorldState) {
  const r = npc.relationship;
  const needsProof = r.trust < 0 || world.director.reputation.reliable < -10;
  return {
    needsProof,
    candidAdvice: r.trust >= 20,
    canIntroduce: r.trust >= 20 && r.respect >= 10,
    patienceOffset: Math.round(r.warmth / 15),
    notes: [
      needsProof ? "Past commitments need checking. Ask for concrete evidence or a bounded trial; do not assume dishonesty." : r.trust >= 20 ? "You trust their account enough to share a useful constraint when they ask. Trust does not remove the actual constraint." : "Hear them out; test claims on their merits.",
      r.respect >= 20 && r.warmth < 10 ? "You rate their competence but are personally reserved. Be direct and professional, without false warmth." : r.warmth >= 20 && r.respect < 10 ? "You like them, but still need evidence they can deliver. Be warm without granting unsupported requests." : "Keep your established personal tone.",
      world.director.reputation.diplomatic < -10 ? "They have sometimes pressed past other people's concerns. Expect a real acknowledgement, not just a forceful case." : "",
    ].filter(Boolean),
  };
}

export function characterArc(ctx: DirectorContext, npcId: string): CharacterArc | null {
  const def = NPCS[npcId], npc = ctx.npcs[npcId];
  if (!def || !npc || (!npc.timesMet && !ctx.world.peopleMet.includes(npcId))) return null;
  const previous = ctx.world.director.characters[npcId];
  const r = npc.relationship;
  const advocate = npcId === "emma_kapoor" && ctx.world.flags.includes("director.introduction_earned");
  const stage: CharacterArc["stage"] = advocate ? "advocate" : r.trust < 0 ? "strained" : r.trust >= 20 && r.respect >= 10 ? "trusted_ally" : npc.timesMet >= 2 ? "working_relationship" : "new_contact";
  const records = [...ctx.world.completedQuests, ...ctx.world.failedQuests].filter((q) => findQuest(q.questId)?.npcId === npcId || findQuest(q.questId)?.ensemble?.participants.some((p) => p.npcId === npcId)).sort((a, b) => a.at.localeCompare(b.at));
  return {
    npcId, role: def.role,
    context: advocate ? "Recommending a bounded internal pilot; her credibility travels with the introduction."
      : ctx.world.career.status === "employed" ? `${def.organisation}: the relationship now extends beyond hiring.` : `${def.organisation}: deciding whether to work together.`,
    stage, goals: [...def.goals.slice(0, 2), stage === "strained" ? "Re-establish what a reliable commitment looks like." : advocate ? "Help the introduction lead to a useful first meeting." : "Understand what this person can take on next."],
    expectations: relationshipGameplay(npc, ctx.world).notes.slice(0, 2),
    beliefs: npc.memory.beliefs.slice(-3).map((b) => b.statement),
    unresolved: [...ctx.world.commitments.filter((c) => c.toNpcId === npcId && c.status === "open").map((c) => c.description), ...npc.memory.commitments.filter((c) => c.by === "npc" && c.status === "open").map((c) => c.description)].slice(-6),
    favors: advocate ? ["Put their own reputation behind an internal introduction."] : previous?.favors ?? [],
    disappointments: npc.memory.events.filter((e) => e.emotionalTone === "negative").slice(-3).map((e) => e.summary),
    milestones: records.slice(-8).map((q) => ({ questId: q.questId, attemptId: q.attemptId, summary: `${findQuest(q.questId)?.title ?? q.questId}: ${findQuest(q.questId)?.outcomes.find((o) => o.id === q.outcomeId)?.label ?? q.outcomeId}` })),
  };
}

/** Backfill old saves using existing canonical records; never fabricate a past interaction. */
export function reconcileThreads(input: DirectorContext): WorldState {
  const world = structuredClone(input.world);
  const d = world.director;
  const records = [...world.completedQuests, ...world.failedQuests].sort((a, b) => a.at.localeCompare(b.at));
  d.clock = Math.max(d.clock, new Set(records.map((r) => r.questId)).size);
  const deadline = records.find((r) => r.questId === "push_back_on_deadline");
  if (deadline && !d.threads.some((t) => t.id === "deadline_echo")) {
    const decision = world.decisions.find((r) => r.questId === deadline.questId);
    d.threads.push({
      id: "deadline_echo", kind: "deadline", stage: "tension", status: "ready",
      title: world.flags.includes("nova_labs.rushed_migration") ? "The date you put your name to" : "A promise is still a plan",
      explanation: decision?.description ?? "Your migration deadline decision still needs to hold up when the work gets difficult.",
      sourceQuestId: deadline.questId, sourceAttemptId: deadline.attemptId, sourceDecisionId: decision?.id ?? null,
      sourceCommitmentIds: world.commitments.filter((c) => c.madeInQuestId === deadline.questId).map((c) => c.id),
      dueAfter: d.clock, resolvedByAttemptId: null, resolution: null,
    });
  }
  const offer = records.find((r) => r.questId === "counter_offer");
  if (offer && input.npcs.emma_kapoor && relationshipGameplay(input.npcs.emma_kapoor, world).canIntroduce && !d.threads.some((t) => t.id === "emma_returns")) {
    const index = records.findIndex((r) => r.attemptId === offer.attemptId);
    d.threads.push({
      id: "emma_returns", kind: "introduction", stage: "setup", status: "pending", title: "Someone Emma could introduce you to",
      explanation: "The trust you built with Emma during hiring may become an introduction once you have experience inside Nova Labs.",
      sourceQuestId: offer.questId, sourceAttemptId: offer.attemptId, sourceDecisionId: null, sourceCommitmentIds: [],
      dueAfter: index + 1 + 2, resolvedByAttemptId: null, resolution: null,
    });
  }
  for (const t of d.threads) {
    if (t.status === "resolved") continue;
    if (t.kind === "deadline") {
      const status = records.find((r) => r.questId === "status_update");
      if (status) {
        t.status = "resolved"; t.stage = "resolution"; t.resolvedByAttemptId = status.attemptId;
        t.resolution = world.flags.includes("director.deadline_replanned") ? "You corrected the plan before shipping. The incident was avoided; the later edge case still needed an honest update." : world.flags.includes("nova_labs.rushed_migration") ? "Shipping without rollback led to the production incident. Your status update determined whether Rohan could still trust your account." : "Your status update dealt with the cost of the deadline decision.";
      } else if (world.flags.includes("director.checkpoint_resolved")) {
        t.stage = "decision"; t.explanation = "You revisited the earlier promise and agreed a safer plan. The next status update will test how you communicate its remaining risk.";
      }
    } else if (records.some((r) => r.questId === "director_introduction")) {
      const rec = records.find((r) => r.questId === "director_introduction")!;
      t.status = "resolved"; t.stage = "resolution"; t.resolvedByAttemptId = rec.attemptId;
      t.resolution = world.flags.includes("director.introduction_earned") ? "Emma put her name behind your bounded pilot." : "Emma kept the introduction on hold after this conversation.";
    } else if (d.clock >= t.dueAfter && world.flags.includes("chapter1.complete")) {
      t.status = "ready"; t.stage = "escalation";
    }
  }
  for (const npcId of Object.keys(input.npcs)) {
    const arc = characterArc({ ...input, world }, npcId);
    if (arc) d.characters[npcId] = arc;
  }
  return world;
}

/** Called only inside canonical conclusion. Practice never enters this reducer. */
export function advanceContinuity(ctx: DirectorContext, evidence: CanonicalEvidence): WorldState {
  if (ctx.world.director.recent.some((r) => r.attemptId === evidence.attemptId)) return ctx.world;
  const world = structuredClone(ctx.world);
  const d = world.director;
  const s = evidence.signals, r = d.reputation;
  const changed = (key: keyof typeof r, delta: number) => { r[key] = clamp(r[key] + delta); };
  // Bounded per encounter. Repeated words cannot farm reputation.
  if ((s.clear_ask ?? 0) > 0) changed("assertive", 3);
  if ((s.evidence_provided ?? 0) > 0) changed("credible", 3);
  if ((s.empathy ?? 0) + (s.acknowledged_npc ?? 0) > 0) changed("empathetic", 3);
  if ((s.aggressive_tone ?? 0) + (s.ultimatum ?? 0) > 0) changed("diplomatic", -6);
  else if ((s.empathy ?? 0) > 0) changed("diplomatic", 3);
  if (evidence.questId === "push_back_on_deadline" && world.flags.includes("nova_labs.rushed_migration")) changed("reliable", -12);
  if (evidence.questId === "status_update") changed("reliable", world.flags.includes("chapter1.hid_incident") ? -10 : world.flags.includes("chapter1.owned_incident") ? 6 : 0);
  if (evidence.questId === "director_checkpoint" && evidence.grade === "success") changed("reliable", 8);
  d.recent = [...d.recent, evidence].slice(-16);
  // A selected encounter stays archived, but no longer occupies the next slot.
  d.recommended = null;
  return reconcileThreads({ ...ctx, world });
}
