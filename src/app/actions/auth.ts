"use server";
/**
 * Web-only auth adapter: server actions that call the shared account service
 * and store the session in an httpOnly cookie. Native clients use
 * /api/v1/auth/* with bearer tokens against the same service.
 */
import { redirect } from "next/navigation";
import { AuthError, loginAccount, onboardPlayer, registerAccount, ValidationError } from "@/server/account";
import { getGame } from "@/server/context";
import { endCurrentSession, getCurrentPlayer, setSessionCookie } from "@/server/session";

export interface AuthFormState {
  error?: string;
}

function formCredentials(form: FormData) {
  return { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
}

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { db } = await getGame();
  try {
    const session = await registerAccount(db, formCredentials(form));
    await setSessionCookie(session.token);
  } catch (err) {
    if (err instanceof AuthError || err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  redirect("/onboarding");
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { db } = await getGame();
  let onboarded = false;
  try {
    const session = await loginAccount(db, formCredentials(form));
    await setSessionCookie(session.token);
    onboarded = session.player.onboardingCompleted;
  } catch (err) {
    if (err instanceof AuthError || err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  redirect(onboarded ? "/world" : "/onboarding");
}

export async function signOutAction() {
  const { db } = await getGame();
  await endCurrentSession(db);
  redirect("/");
}

export async function completeOnboardingAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { db } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  try {
    await onboardPlayer(db, player.playerId, { displayName: String(form.get("displayName") ?? "") });
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  redirect("/world");
}
