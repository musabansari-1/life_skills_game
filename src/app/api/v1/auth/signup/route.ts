import { registerAccount } from "@/server/account";
import { getGame } from "@/server/context";
import { errorResponse, ok } from "../../_lib";

/** Create an account. Returns { token, expiresAt, player }. Native clients send the token as a Bearer header. */
export async function POST(req: Request) {
  try {
    const { db } = await getGame();
    const body = await req.json().catch(() => ({}));
    return ok(await registerAccount(db, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
