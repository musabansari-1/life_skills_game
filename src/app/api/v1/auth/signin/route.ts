import { loginAccount } from "@/server/account";
import { getGame } from "@/server/context";
import { errorResponse, ok } from "../../_lib";

/** Exchange credentials for a session token. Returns { token, expiresAt, player }. */
export async function POST(req: Request) {
  try {
    const { db } = await getGame();
    const body = await req.json().catch(() => ({}));
    return ok(await loginAccount(db, body));
  } catch (err) {
    return errorResponse(err);
  }
}
