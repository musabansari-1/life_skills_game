/**
 * Account use-cases shared by web server actions and the /api/v1 JSON routes.
 * Validation uses the public contract schemas so every client gets the same rules and messages.
 */
import { CredentialsSchema, OnboardingRequestSchema, type AuthSession } from "@/contracts/api";
import type { Db } from "@/db/client";
import { DbAnalytics } from "./analytics";
import { AuthError, createSession, resolvePlayerFromToken, signIn, signUp } from "./auth";
import { GameError } from "./orchestrator";
import { completeOnboarding } from "./player";

export class ValidationError extends Error {}

function parseCredentials(input: unknown) {
  const parsed = CredentialsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  return parsed.data;
}

async function toAuthSession(db: Db, userId: string): Promise<AuthSession> {
  const issued = await createSession(db, userId);
  const player = await resolvePlayerFromToken(db, issued.token);
  if (!player) throw new GameError("Session could not be created", "state");
  return { token: issued.token, expiresAt: issued.expiresAt, player: { playerId: player.playerId, displayName: player.displayName, onboardingCompleted: player.onboardingCompleted } };
}

/** Create an account + player + world, and issue a session. */
export async function registerAccount(db: Db, input: unknown): Promise<AuthSession> {
  const { email, password } = parseCredentials(input);
  const { userId } = await signUp(db, email, password, "");
  return toAuthSession(db, userId);
}

/** Verify credentials and issue a session. Throws AuthError on bad credentials. */
export async function loginAccount(db: Db, input: unknown): Promise<AuthSession> {
  const { email, password } = parseCredentials(input);
  const { userId } = await signIn(db, email, password);
  return toAuthSession(db, userId);
}

/** Name the character and mark onboarding complete. Idempotent. */
export async function onboardPlayer(db: Db, playerId: string, input: unknown): Promise<{ displayName: string }> {
  const parsed = OnboardingRequestSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  await completeOnboarding(db, playerId, parsed.data.displayName);
  await new DbAnalytics(db).track(playerId, "onboarding_completed", { displayName: parsed.data.displayName });
  return { displayName: parsed.data.displayName };
}

export { AuthError };
