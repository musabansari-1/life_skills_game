import { onboardPlayer } from "@/server/account";
import { errorResponse, ok, requirePlayer } from "../../_lib";

/** Name the character. Body: { displayName }. */
export async function POST(req: Request) {
  try {
    const { db, player } = await requirePlayer();
    const body = await req.json().catch(() => ({}));
    return ok(await onboardPlayer(db, player.playerId, body));
  } catch (err) {
    return errorResponse(err);
  }
}
