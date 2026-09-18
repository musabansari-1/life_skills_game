import { getGame } from "@/server/context";
import { endCurrentSession } from "@/server/session";
import { errorResponse, ok } from "../../_lib";

/** Revoke the calling session (bearer token or cookie). */
export async function POST() {
  try {
    const { db } = await getGame();
    await endCurrentSession(db);
    return ok({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
