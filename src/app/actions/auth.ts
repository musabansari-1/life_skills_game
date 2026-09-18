"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, clearSession, createSession, getCurrentPlayer, setSessionCookie, signIn, signUp } from "@/server/auth";
import { getGame } from "@/server/context";
import { completeOnboarding } from "@/server/player";

export interface AuthFormState {
  error?: string;
}

const Credentials = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { db } = await getGame();
  try {
    const { userId } = await signUp(db, parsed.data.email, parsed.data.password, "");
    await setSessionCookie(await createSession(db, userId));
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
  redirect("/onboarding");
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { db } = await getGame();
  try {
    const { userId } = await signIn(db, parsed.data.email, parsed.data.password);
    await setSessionCookie(await createSession(db, userId));
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
  const player = await getCurrentPlayer(db);
  redirect(player?.onboardingCompleted ? "/world" : "/onboarding");
}

export async function signOutAction() {
  const { db } = await getGame();
  await clearSession(db);
  redirect("/");
}

export async function completeOnboardingAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const name = String(form.get("displayName") ?? "").trim();
  if (name.length < 2) return { error: "Give your character a name (2+ characters)." };
  if (name.length > 24) return { error: "Keep it under 24 characters." };
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  await completeOnboarding(db, player.playerId, name);
  const { DbAnalytics } = await import("@/server/analytics");
  await new DbAnalytics(db).track(player.playerId, "onboarding_completed", { displayName: name });
  void game;
  redirect("/world");
}
