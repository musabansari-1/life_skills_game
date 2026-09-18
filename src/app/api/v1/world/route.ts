import { worldOverview } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../_lib";

export const dynamic = "force-dynamic";

/** Home/map screen: worlds, quests, skills, people, commitments, active attempt. */
export async function GET() {
  try {
    const { game, player } = await requirePlayer();
    return ok(await worldOverview(game, player.playerId));
  } catch (err) {
    return errorResponse(err);
  }
}
