import { notFound, redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { SKILLS, type SkillId } from "@/engine/types/skills";
import { getCurrentPlayer } from "@/server/auth";
import { getGame } from "@/server/context";
import { buildQuestCards, describeConsequenceForPlayer } from "@/server/game-view";
import type { Consequence } from "@/engine/types/consequences";
import { GameError } from "@/server/orchestrator";
import { ResultReveal } from "./ResultReveal";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: PageProps<"/results/[attemptId]">) {
  const { attemptId } = await params;
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  let attempt;
  try {
    attempt = await game.getAttempt(player.playerId, attemptId);
  } catch (err) {
    if (err instanceof GameError) notFound();
    throw err;
  }
  if (attempt.status !== "completed" || !attempt.result || !attempt.evaluation) redirect(`/play/${attemptId}`);
  const quest = findQuest(attempt.questId);
  const npc = NPCS[attempt.npcId];
  if (!quest || !npc) notFound();

  const state = await game.getPlayerState(player.playerId);
  const cards = buildQuestCards(state);
  const followUps = attempt.result.rewards.followUpQuestIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const nextQuest = followUps[0] ?? cards.find((c) => c.isNext) ?? cards.find((c) => c.availability === "available") ?? null;
  const playerTurnTexts = Object.fromEntries(attempt.turns.filter((t) => t.speaker === "player").map((t) => [t.index, t.text]));
  const worldChanges = (attempt.result.consequencesApplied as { consequence?: Consequence; description: string }[])
    .map((c) => (c.consequence ? describeConsequenceForPlayer(c.consequence) : c.description))
    .filter((s): s is string => !!s);

  return (
    <ResultReveal
      quest={{ id: quest.id, title: quest.title }}
      npc={{ id: npc.id, name: npc.name, shortName: npc.shortName, appearance: npc.appearance }}
      result={attempt.result}
      evaluation={attempt.evaluation}
      objectives={quest.objectives.map((o) => ({ id: o.id, label: o.label, kind: o.kind }))}
      skillLabels={Object.fromEntries((Object.keys(SKILLS) as SkillId[]).map((k) => [k, SKILLS[k].label]))}
      playerTurnTexts={playerTurnTexts}
      nextQuest={nextQuest ? { id: nextQuest.id, title: nextQuest.title, tagline: nextQuest.tagline, npcName: nextQuest.npcName, isFollowUp: followUps.length > 0 } : null}
      worldChanges={worldChanges}
    />
  );
}
