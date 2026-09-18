import { notFound, redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { getLocation } from "@/content/worlds";
import { getCurrentPlayer } from "@/server/auth";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";
import { Scene } from "./Scene";
import { toClientAttempt } from "./client-types";

export const dynamic = "force-dynamic";

export default async function PlayPage({ params, searchParams }: PageProps<"/play/[attemptId]">) {
  const { attemptId } = await params;
  const sp = await searchParams;
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");

  let attempt;
  try {
    attempt = await game.getAttempt(player.playerId, attemptId);
  } catch (err) {
    if (err instanceof GameError && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  }
  if (attempt.status === "completed") redirect(`/results/${attemptId}`);
  if (attempt.status === "abandoned") redirect(`/quests/${attempt.questId}`);

  const quest = findQuest(attempt.questId);
  const npc = NPCS[attempt.npcId];
  if (!quest || !npc) notFound();
  const location = getLocation(quest.locationId);
  const mode = sp.mode === "text" ? "text" : "voice";

  return (
    <Scene
      initial={toClientAttempt(attempt, quest.scene.maxTurns)}
      quest={{ id: quest.id, title: quest.title, objective: quest.briefing.objective, locationName: location?.name ?? "", minTurns: quest.scene.minTurns }}
      npc={{ id: npc.id, name: npc.name, shortName: npc.shortName, role: npc.role, organisation: npc.organisation, appearance: npc.appearance, voice: npc.voice }}
      playerName={player.displayName}
      initialMode={mode}
    />
  );
}
