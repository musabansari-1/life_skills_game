/**
 * Next.js adapter for sessions: the only place that reads cookies/headers.
 *
 * Token resolution order: `Authorization: Bearer <token>` (native clients),
 * then the httpOnly session cookie (web). Both map to the same sessions table.
 */
import { cookies, headers } from "next/headers";
import type { Db } from "@/db/client";
import { env } from "@/lib/env";
import { resolvePlayerFromToken, revokeSession, SESSION_COOKIE, SESSION_DAYS, type CurrentPlayer } from "./auth";

export async function getRequestToken(): Promise<string | null> {
  const h = await headers();
  const auth = h.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim() || null;
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Current player for this request (bearer token or cookie), or null. */
export async function getCurrentPlayer(db: Db): Promise<CurrentPlayer | null> {
  return resolvePlayerFromToken(db, await getRequestToken());
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

/** Revoke the current session (whichever transport it came from) and clear the cookie. */
export async function endCurrentSession(db: Db) {
  const token = await getRequestToken();
  if (token) await revokeSession(db, token);
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
