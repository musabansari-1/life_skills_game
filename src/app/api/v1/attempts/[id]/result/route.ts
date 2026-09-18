import { debrief } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../../../_lib";

export const dynamic = "force-dynamic";

/** The debrief for a completed scene. 409 until concluded. */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/result">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    return ok(await debrief(game, player.playerId, id));
  } catch (err) {
    return errorResponse(err);
  }
}
