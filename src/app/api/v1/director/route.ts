import { errorResponse, ok, requirePlayer } from "../_lib";
import { narrativeView } from "@/server/director-view";

export async function POST() {
  try {
    const { game, player } = await requirePlayer();
    await game.refreshDirector(player.playerId);
    return ok(narrativeView(await game.getPlayerState(player.playerId)));
  } catch (err) { return errorResponse(err); }
}
