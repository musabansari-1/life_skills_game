import { errorResponse, ok, requirePlayer } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** End the scene and resolve evaluation, outcome, rewards and consequences. Idempotent once completed. */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/conclude">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    const attempt = await game.concludeQuest(player.playerId, id);
    return ok({ attemptId: attempt.id, status: attempt.status });
  } catch (err) {
    return errorResponse(err);
  }
}
