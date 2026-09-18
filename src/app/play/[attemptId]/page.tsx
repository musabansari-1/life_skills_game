import { notFound, redirect } from "next/navigation";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";
import { attemptEnvelope } from "@/server/queries";
import { Scene } from "./Scene";

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

  // Same envelope the native API returns from GET /api/v1/attempts/:id.
  const { attempt: initial, scene } = attemptEnvelope(attempt);
  return <Scene initial={initial} quest={scene.quest} npc={scene.npc} playerName={player.displayName} initialMode={sp.mode === "text" ? "text" : "voice"} />;
}
