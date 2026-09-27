import type { SkillId } from "../types/skills";
import type { SceneState } from "../types/scene";
import { hasEvidence, sceneEvidence } from "./ensemble";

/** Reusable authored resistance, never a model-authored rule or a reward table. */
export interface BossEncounterProfile {
  id: string;
  stakes: string;
  combinedSkills: SkillId[];
  approaches: string[];
  resistance: { opening: string; probing: string; decision: string };
  phases?: BossPhase[];
}
export interface BossPhase {
  id: string; label: string; stakes: string; requires: string[];
  checkpoint: (scene: SceneState) => boolean;
  direction: string;
}
export function bossProgress(profile: BossEncounterProfile, scene: SceneState) {
  const completed: string[] = [];
  for (const phase of profile.phases ?? []) if (phase.requires.every((id) => completed.includes(id)) && phase.checkpoint(scene)) completed.push(phase.id);
  const active = profile.phases?.find((p) => !completed.includes(p.id) && p.requires.every((id) => completed.includes(id)));
  return { completed, active, ready: !!profile.phases?.length && completed.length === profile.phases.length };
}
export const CRISIS_BOSS: BossEncounterProfile = {
  id: "project_crisis", stakes: "A customer rollout is at risk. Protect the customer, the team, and the credibility of your next commitment.",
  combinedSkills: ["communication", "listening", "leadership", "conflict_resolution", "negotiation"],
  approaches: ["Reduce scope to a reversible customer pilot with a named owner and a review point.", "Negotiate a delay, protect existing service, and give the customer a credible interim plan."],
  resistance: { opening: "Ask what they will take responsibility for.", probing: "Challenge one unresolved assumption. Constraints stay fixed once disclosed.", decision: "State only the approved plan; no promotion or automatic forgiveness." },
  phases: [
    { id: "account", label: "Face the history", stakes: "Your earlier commitments affect how much evidence Rohan needs.", requires: [], checkpoint: (s) => hasEvidence(s, "ownership"), direction: "Ask for an honest account of their part. Owning uncertainty counts; self-blame for others' errors is unnecessary." },
    { id: "interests", label: "Hear the room", stakes: "Product needs continuity; Maya needs safe capacity.", requires: ["account"], checkpoint: (s) => s.revealed.includes("customer_constraint") && s.revealed.includes("capacity_constraint"), direction: "Make the competing customer and team constraints discoverable. Ask one focused question." },
    { id: "tradeoff", label: "Choose the tradeoff", stakes: "Full scope cannot safely ship now. Someone must accept a cost.", requires: ["interests"], checkpoint: (s) => (hasEvidence(s, "scope_plan") || hasEvidence(s, "delay_plan")) && hasEvidence(s, "tradeoff") && !hasEvidence(s, "unsupported_promise"), direction: "Test a smaller rollout OR a delayed rollout with interim protection. A reasoned disagreement is acceptable." },
    { id: "commit", label: "Make a credible commitment", stakes: "A plan needs ownership, a checkpoint and protection for both concerns.", requires: ["tradeoff"], checkpoint: (s) => ["owner", "checkpoint", "customer_care", "team_care"].every((f) => hasEvidence(s, f)) && new Set(sceneEvidence(s).filter((e) => !e.revoked).map((e) => e.turnIndex)).size >= 3 && s.turnCount >= 3, direction: "Test who owns the next action and when the team can stop or revise it. Do not request another concession once these are clear." },
  ],
};
export const SPONSORSHIP_BOSS: BossEncounterProfile = {
  id: "sponsorship",
  stakes: "Emma is deciding whether to put her name behind your next opportunity. A weak case closes this introduction for now.",
  combinedSkills: ["leadership", "negotiation", "persuasion", "listening"],
  approaches: ["Build a case with specific evidence and a bounded proposal.", "Discover the capacity constraint and shape a smaller trial around it."],
  resistance: {
    opening: "Start by testing what they actually want. An ambitious title is not a useful ask.",
    probing: "Test the weakest assumption: evidence, capacity or the review point. Ask one focused follow-up; do not invent new obstacles after they answer it.",
    decision: "The agreed constraints have been met. Give a clear decision within your authority. Do not move the goalposts or imply a promotion.",
  },
};
export function bossDirection(profile: BossEncounterProfile, progress: { asked: boolean; ready: boolean }): string {
  return progress.ready ? profile.resistance.decision : progress.asked ? profile.resistance.probing : profile.resistance.opening;
}
