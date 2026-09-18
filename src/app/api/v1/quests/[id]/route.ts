import { questBriefing } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../../_lib";

export const dynamic = "force-dynamic";

/** Quest briefing + NPC dossier + whether it can be started now. */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/quests/[id]">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    return ok(await questBriefing(game, player.playerId, id));
  } catch (err) {
    return errorResponse(err);
  }
}
