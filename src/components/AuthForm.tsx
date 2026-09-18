"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [signInState, signIn, signInPending] = useActionState<AuthFormState, FormData>(signInAction, {});
  const [signUpState, signUp, signUpPending] = useActionState<AuthFormState, FormData>(signUpAction, {});
  const state = mode === "signin" ? signInState : signUpState;
  const pending = signInPending || signUpPending;

  return (
    <div className="card p-6 sm:p-7 w-full max-w-sm">
      <div className="flex gap-1 mb-6 p-1 rounded-full bg-ink-2 border border-line">
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full py-2 text-sm transition ${mode === m ? "bg-ink-4 text-paper" : "text-paper-3 hover:text-paper-2"}`}
          >
            {m === "signup" ? "New character" : "Return"}
          </button>
        ))}
      </div>
      <form action={mode === "signin" ? signIn : signUp} className="space-y-3">
        <label className="block">
          <span className="eyebrow block mb-1.5">Email</span>
          <input name="email" type="email" autoComplete="email" required className="input" placeholder="you@example.com" />
        </label>
        <label className="block">
          <span className="eyebrow block mb-1.5">Password</span>
          <input name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} className="input" placeholder="8+ characters" />
        </label>
        {state.error && (
          <p role="alert" className="text-warn text-sm">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full mt-2">
          {pending ? "One moment…" : mode === "signin" ? "Continue" : "Create character"}
        </button>
      </form>
    </div>
  );
}
