/**
 * Quest registry. Adding a quest = author a file with `defineQuest` and list it
 * here. Validation at load time catches common content mistakes early.
 */
import type { AnyQuestDefinition } from "@/engine/types/quest";
import { NPCS } from "../npcs";
import { getLocation, getWorld } from "../worlds";
import { counterOffer } from "./counter-offer";
import { firstDayNovaLabs } from "./first-day-nova-labs";
import { introduceYourself } from "./introduce-yourself";
import { pushBackOnDeadline } from "./push-back-on-deadline";
import { recruiterScreening } from "./recruiter-screening";
import { hiringManagerInterview } from "./hiring-manager-interview";
import { statusUpdate } from "./status-update";
import { createDirectorEncounter, ENCOUNTER_IDS } from "./director-encounters";
import type { DirectorProposal } from "@/engine/director/types";
import { projectCrisis } from "./project-crisis";
import { CAREER_MILESTONES } from "@/engine/campaign";
import { createRecovery } from "./recovery";
import { isValidFacet } from "@/engine/types/skills";
import { meetMaya } from "./meet-maya";
import { noraRequirements } from "./nora-requirements";
import { customerEscalation } from "./customer-escalation";
import { mayaCheckin } from "./maya-checkin";
import { emmaCheckIn } from "./emma-check-in";
import { priyaInterlude } from "./priya-interlude";
import { mentorArjun } from "./mentor-arjun";
import { feedbackForRohan } from "./feedback-for-rohan";
import { theReview } from "./the-review";

export const QUESTS: AnyQuestDefinition[] = [
  introduceYourself,
  recruiterScreening,
  hiringManagerInterview,
  counterOffer,
  firstDayNovaLabs,
  pushBackOnDeadline,
  statusUpdate,
  meetMaya,
  noraRequirements,
  customerEscalation,
  mayaCheckin,
  emmaCheckIn,
  priyaInterlude,
  mentorArjun,
  feedbackForRohan,
  projectCrisis,
  theReview,
  ...[recruiterScreening, hiringManagerInterview, counterOffer, firstDayNovaLabs, pushBackOnDeadline, statusUpdate, customerEscalation].map(createRecovery),
  ...ENCOUNTER_IDS.map((id) => createDirectorEncounter(id)),
].sort((a, b) => a.order - b.order);

const byId = new Map(QUESTS.map((q) => [q.id, q]));

export function getQuest(id: string, proposal?: DirectorProposal | null): AnyQuestDefinition {
  const q = findQuest(id, proposal);
  if (!q) throw new Error(`Unknown quest: ${id}`);
  return q;
}

export function findQuest(id: string, proposal?: DirectorProposal | null): AnyQuestDefinition | undefined {
  if (proposal && proposal.questId === id && (ENCOUNTER_IDS as readonly string[]).includes(id)) return createDirectorEncounter(id, proposal);
  return byId.get(id);
}

/** Throws with a readable message when content references something that doesn't exist. */
export function validateContent(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const q of QUESTS) {
    if (ids.has(q.id)) errors.push(`Duplicate quest id ${q.id}`);
    ids.add(q.id);
    if (!NPCS[q.npcId]) errors.push(`${q.id}: unknown npc ${q.npcId}`);
    if (q.ensemble) {
      if (!q.ensemble.participants.some((p) => p.npcId === q.ensemble!.leadId)) errors.push(`${q.id}: ensemble lead is not a participant`);
      if (new Set(q.ensemble.participants.map((p) => p.npcId)).size !== q.ensemble.participants.length) errors.push(`${q.id}: duplicate participant`);
      for (const p of q.ensemble.participants) if (!NPCS[p.npcId]) errors.push(`${q.id}: unknown participant ${p.npcId}`);
    }
    if (q.failure?.recoveryQuestId && !byId.has(q.failure.recoveryQuestId)) errors.push(`${q.id}: unknown recovery quest`);
    if (!getWorld(q.worldId)) errors.push(`${q.id}: unknown world ${q.worldId}`);
    if (!getLocation(q.locationId)) errors.push(`${q.id}: unknown location ${q.locationId}`);
    if (q.outcomes.length === 0) errors.push(`${q.id}: no outcomes`);
    const rubricIds = new Set<string>();
    for (const c of q.rubric) {
      if (!isValidFacet(c.skill, c.facet)) errors.push(`${q.id}: unknown rubric facet ${c.skill}.${c.facet}`);
      if (rubricIds.has(c.id)) errors.push(`${q.id}: duplicate rubric id ${c.id}`);
      rubricIds.add(c.id);
    }
    for (const o of q.outcomes) for (const f of o.followUpQuestIds ?? []) if (!byId.has(f)) errors.push(`${q.id}/${o.id}: unknown follow-up quest ${f}`);
    for (const p of q.prerequisites) if (p.type === "quest_completed" && !byId.has(p.questId)) errors.push(`${q.id}: prerequisite references unknown quest ${p.questId}`);
    if (q.semanticFeatures && new Set(q.semanticFeatures.map((f) => f.id)).size !== q.semanticFeatures.length) errors.push(`${q.id}: duplicate semantic feature`);
    if (q.ensemble) for (const p of q.ensemble.participants) for (const f of [...p.interests, ...p.supports, ...p.challenges]) if (!q.semanticFeatures?.some((x) => x.id === f)) errors.push(`${q.id}: participant ${p.npcId} references unknown feature ${f}`);
    if (!q.outcomes.length || !q.outcomes.at(-1)!.when.toString().includes("true")) errors.push(`${q.id}: last outcome should be a catch-all`);
  }
  for (const id of CAREER_MILESTONES) if (!byId.has(id)) errors.push(`campaign milestone ${id} is not a registered quest`);
  return errors;
}
