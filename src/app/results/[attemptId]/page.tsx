import { notFound, redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";
import { debrief } from "@/server/queries";
import { ResultReveal } from "./ResultReveal";
import { Waiting } from "./Waiting";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: PageProps<"/results/[attemptId]">) {
  const { attemptId } = await params;
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  const attempt = await game.getAttempt(player.playerId, attemptId).catch((err: unknown) => {
    if (err instanceof GameError) notFound();
    throw err;
  });
  if (attempt.status === "evaluating") return <Waiting attemptId={attemptId} npcName={NPCS[attempt.npcId]?.shortName ?? "They"} />;
  if (attempt.status !== "completed") redirect(`/play/${attemptId}`);
  // Same payload as GET /api/v1/attempts/:id/result.
  const data = await debrief(game, player.playerId, attemptId);
  return <ResultReveal debrief={data} />;
}
