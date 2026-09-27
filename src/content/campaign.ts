/**
 * The Career City season as players see it: acts and their milestone chapters,
 * derived from `CAREER_ACTS` (engine/campaign) so there is one source of truth.
 * Side scenes and Director-selected events live outside this list; they are
 * offered between chapters and never substitute for one.
 */
import type { WorldState } from "@/engine/types/world";
import { CAREER_ACTS, CONTINUES_ON_FAILURE, milestoneResolved, reconcileCampaign } from "@/engine/campaign";

export interface Chapter {
  questId: string;
  label: string;
  actId: string;
}

const LABELS: Record<string, string> = {
  recruiter_screening: "Screening",
  hiring_manager_interview: "Interview",
  counter_offer: "The Offer",
  first_day_nova_labs: "First Day",
  meet_maya: "Maya",
  push_back_on_deadline: "The Deadline",
  nora_requirements: "The Request",
  status_update: "The Update",
  customer_escalation: "Meridian",
  mentor_arjun: "The New Hire",
  feedback_for_rohan: "Feedback",
  project_crisis: "The Crisis",
  the_review: "The Review",
};

export const CAMPAIGN = {
  id: "career_city",
  title: "Career City · Season One",
  chapters: CAREER_ACTS.flatMap((a) => a.milestones.map((questId) => ({ questId, label: LABELS[questId] ?? questId, actId: a.id }))) as Chapter[],
};

export interface CampaignProgress {
  title: string;
  chapters: { questId: string; label: string; actId: string; state: "done" | "current" | "locked" }[];
  acts: { id: string; title: string; subtitle: string; state: "done" | "current" | "locked"; completed: number; total: number }[];
  completed: number;
  total: number;
  currentQuestId: string | null;
  currentAct: { id: string; title: string; subtitle: string; index: number } | null;
  finished: boolean;
}

/** Where the player is in the story. A chapter is done after a canonical resolution (or a repair, or an authored failure that continues). */
export function campaignProgress(world: WorldState): CampaignProgress {
  const reconciled = reconcileCampaign(world);
  const done = new Set(CAMPAIGN.chapters.filter((q) => milestoneResolved(reconciled, q.questId)).map((q) => q.questId));
  let current: string | null = null;
  const chapters = CAMPAIGN.chapters.map((c) => {
    if (done.has(c.questId)) return { ...c, state: "done" as const };
    if (!current) {
      current = c.questId;
      return { ...c, state: "current" as const };
    }
    return { ...c, state: "locked" as const };
  });
  const completed = chapters.filter((c) => c.state === "done").length;
  const recovery = reconciled.campaign.failures.find((f) => f.questId === current && !f.recoveredBy && !CONTINUES_ON_FAILURE.includes(f.questId))?.recoveryQuestId;
  const acts = CAREER_ACTS.map((a) => {
    const own = chapters.filter((c) => c.actId === a.id);
    return { id: a.id, title: a.title, subtitle: a.subtitle, completed: own.filter((c) => c.state === "done").length, total: own.length,
      state: own.every((c) => c.state === "done") ? "done" as const : own.some((c) => c.state === "current") ? "current" as const : "locked" as const };
  });
  const actIndex = acts.findIndex((a) => a.state === "current");
  return {
    title: CAMPAIGN.title, chapters, acts, completed, total: chapters.length, currentQuestId: recovery ?? current,
    currentAct: actIndex >= 0 ? { id: acts[actIndex].id, title: acts[actIndex].title, subtitle: acts[actIndex].subtitle, index: actIndex + 1 } : null,
    finished: completed === chapters.length,
  };
}

export function chapterIndex(questId: string): number | null {
  const i = CAMPAIGN.chapters.findIndex((c) => c.questId === questId);
  return i >= 0 ? i + 1 : null;
}

/** "Act II · Prove yourself" for a milestone, or null for side scenes. */
export function actLabel(questId: string): { index: number; title: string } | null {
  const i = CAREER_ACTS.findIndex((a) => (a.milestones as readonly string[]).includes(questId));
  return i >= 0 ? { index: i + 1, title: CAREER_ACTS[i].title } : null;
}
