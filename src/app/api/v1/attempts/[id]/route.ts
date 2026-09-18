import { attemptEnvelope } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../../_lib";

export const dynamic = "force-dynamic";

/** Current state of a scene. Use to resync after a 409 or a dropped connection. */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/attempts/[id]">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    return ok(attemptEnvelope(await game.getAttempt(player.playerId, id)));
  } catch (err) {
    return errorResponse(err);
  }
}
