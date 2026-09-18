import { attemptEnvelope } from "@/server/queries";
import { errorResponse, ok, requirePlayer } from "../../_lib";

export const dynamic = "force-dynamic";

/** The player's in-progress scene, if any (resume after app restart / on another device). */
export async function GET() {
  try {
    const { game, player } = await requirePlayer();
    const active = await game.getActiveAttempt(player.playerId);
    return ok({ active: active ? attemptEnvelope(active) : null });
  } catch (err) {
    return errorResponse(err);
  }
}
