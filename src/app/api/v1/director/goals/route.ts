import { PreferencesSchema } from "@/engine/director/types";
import { narrativeView } from "@/server/director-view";
import { errorResponse, ok, parseBody, requirePlayer } from "../../_lib";

export async function PUT(req: Request) {
  try {
    const { game, player } = await requirePlayer();
    const preferences = await parseBody(req, PreferencesSchema);
    await game.refreshDirector(player.playerId, preferences);
    return ok(narrativeView(await game.getPlayerState(player.playerId)));
  } catch (err) { return errorResponse(err); }
}
