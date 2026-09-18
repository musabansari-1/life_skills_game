/**
 * Minimal, real authentication: email + password (scrypt), DB-backed sessions,
 * httpOnly cookie. Enough for persistent progression; account management
 * screens can be added later without touching this.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "@/db/client";
import { players, sessions, users } from "@/db/schema";
import { defaultEnv } from "@/engine/util";
import { createEmptyProfile } from "@/engine/competency";
import { createInitialWorldState } from "@/engine/types/world";
import { worldStates } from "@/db/schema";
import { env } from "@/lib/env";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "lsg_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token + env.SESSION_SECRET).digest("hex");
}

export class AuthError extends Error {}

export async function signUp(db: Db, email: string, password: string, displayName: string) {
  const normalized = email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, normalized) });
  if (existing) throw new AuthError("An account with that email already exists.");
  const now = defaultEnv.now();
  const userId = defaultEnv.id();
  const playerId = defaultEnv.id();
  await db.insert(users).values({ id: userId, email: normalized, passwordHash: await hashPassword(password), createdAt: now });
  await db.insert(players).values({
    id: playerId,
    userId,
    displayName: displayName.trim() || "Player",
    onboardingCompletedAt: null,
    competencies: createEmptyProfile(),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(worldStates).values({ playerId, state: createInitialWorldState(), version: 1, updatedAt: now });
  return { userId, playerId };
}

export async function signIn(db: Db, email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AuthError("Email or password is incorrect.");
  return { userId: user.id };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: expires.toISOString(), createdAt: now.toISOString() });
  return token;
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

export async function clearSession(db: Db) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

export interface CurrentPlayer {
  userId: string;
  playerId: string;
  displayName: string;
  onboardingCompleted: boolean;
}

/** Resolve the current player from the session cookie, or null. */
export async function getCurrentPlayer(db: Db): Promise<CurrentPlayer | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, hashToken(token)) });
  if (!session || session.expiresAt < new Date().toISOString()) return null;
  const player = await db.query.players.findFirst({ where: eq(players.userId, session.userId) });
  if (!player) return null;
  return { userId: session.userId, playerId: player.id, displayName: player.displayName, onboardingCompleted: !!player.onboardingCompletedAt };
}
