import type { PlayerIdentity } from "@/contracts/api";
import { errorResponse, ok, requirePlayer } from "../_lib";

/** Who am I? Use on app launch to validate a stored token. */
export async function GET() {
  try {
    const { player } = await requirePlayer();
    const body: PlayerIdentity = { playerId: player.playerId, displayName: player.displayName, onboardingCompleted: player.onboardingCompleted };
    return ok(body);
  } catch (err) {
    return errorResponse(err);
  }
}
