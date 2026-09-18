import { notFound, redirect } from "next/navigation";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";
import { debrief } from "@/server/queries";
import { ResultReveal } from "./ResultReveal";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: PageProps<"/results/[attemptId]">) {
  const { attemptId } = await params;
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  // Same payload as GET /api/v1/attempts/:id/result.
  const data = await debrief(game, player.playerId, attemptId).catch((err: unknown) => {
    if (err instanceof GameError && err.code === "state") redirect(`/play/${attemptId}`);
    if (err instanceof GameError) notFound();
    throw err;
  });
  return <ResultReveal debrief={data} />;
}
