import { dossier } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../../_lib";

export const dynamic = "force-dynamic";

/** What this character remembers about the player, standing, history. */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/characters/[id]">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    return ok(await dossier(game, player.playerId, id));
  } catch (err) {
    return errorResponse(err);
  }
}
