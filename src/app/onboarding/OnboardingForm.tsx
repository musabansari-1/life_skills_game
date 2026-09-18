"use client";

import { useActionState } from "react";
import { completeOnboardingAction, type AuthFormState } from "@/app/actions/auth";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(completeOnboardingAction, {});
  return (
    <form action={action} className="space-y-4">
      <input name="displayName" autoFocus required maxLength={24} className="input text-lg py-4" placeholder="e.g. Asha" />
      {state.error && (
        <p role="alert" className="text-warn text-sm">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Entering…" : "Enter Career City"}
      </button>
    </form>
  );
}
