import { errorResponse, ok, requirePlayer } from "../../../_lib";

/** Walk out of a scene. Nothing is evaluated. */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/abandon">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    await game.abandonQuest(player.playerId, id);
    return ok({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
