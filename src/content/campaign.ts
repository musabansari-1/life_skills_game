/**
 * The connected campaign: one short story in which every chapter reads what
 * earlier chapters left in the world. Side quests (e.g. Introduce Yourself)
 * live outside it.
 */
import type { WorldState } from "@/engine/types/world";

export interface Chapter {
  questId: string;
  label: string;
}

export const CAMPAIGN = {
  id: "nova_labs",
  title: "Chapter One: Nova Labs",
  chapters: [
    { questId: "recruiter_screening", label: "Screening" },
    { questId: "hiring_manager_interview", label: "Interview" },
    { questId: "counter_offer", label: "The Offer" },
    { questId: "first_day_nova_labs", label: "First Day" },
    { questId: "push_back_on_deadline", label: "The Deadline" },
    { questId: "status_update", label: "The Update" },
  ] as Chapter[],
};

export interface CampaignProgress {
  title: string;
  chapters: { questId: string; label: string; state: "done" | "current" | "locked" }[];
  completed: number;
  total: number;
  currentQuestId: string | null;
  finished: boolean;
}

/** Where the player is in the story. A chapter counts as done once it has a canonical (non-failed) completion. */
export function campaignProgress(world: WorldState): CampaignProgress {
  const done = new Set(world.completedQuests.map((q) => q.questId));
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
  return { title: CAMPAIGN.title, chapters, completed, total: chapters.length, currentQuestId: current, finished: completed === chapters.length };
}

export function chapterIndex(questId: string): number | null {
  const i = CAMPAIGN.chapters.findIndex((c) => c.questId === questId);
  return i >= 0 ? i + 1 : null;
}
