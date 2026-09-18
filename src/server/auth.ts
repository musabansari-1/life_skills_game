/**
 * Authentication service — transport-agnostic.
 *
 * Email + password (scrypt) and DB-backed opaque session tokens (stored
 * hashed). The same session is usable two ways:
 *   - web: httpOnly cookie (set by server actions via ./session.ts)
 *   - native: `Authorization: Bearer <token>` (issued by /api/v1/auth/*)
 * Nothing in this file touches cookies, headers or Next.js.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, sessions, users, worldStates } from "@/db/schema";
import { defaultEnv } from "@/engine/util";
import { createEmptyProfile } from "@/engine/competency";
import { createInitialWorldState } from "@/engine/types/world";
import { env } from "@/lib/env";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "lsg_session";
export const SESSION_DAYS = 30;

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

export interface IssuedSession {
  token: string;
  expiresAt: string;
}

export async function createSession(db: Db, userId: string): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString();
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, createdAt: now.toISOString() });
  return { token, expiresAt };
}

export async function revokeSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export interface CurrentPlayer {
  userId: string;
  playerId: string;
  displayName: string;
  onboardingCompleted: boolean;
}

/** Resolve a player from a raw session token (cookie value or bearer token). */
export async function resolvePlayerFromToken(db: Db, token: string | null | undefined): Promise<CurrentPlayer | null> {
  if (!token) return null;
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, hashToken(token)) });
  if (!session || session.expiresAt < new Date().toISOString()) return null;
  const player = await db.query.players.findFirst({ where: eq(players.userId, session.userId) });
  if (!player) return null;
  return { userId: session.userId, playerId: player.id, displayName: player.displayName, onboardingCompleted: !!player.onboardingCompletedAt };
}
