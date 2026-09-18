import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Your character" };

export default async function OnboardingPage() {
  const { db } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  if (player.onboardingCompleted) redirect("/world");

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full fade-up">
        <p className="eyebrow mb-4">Before you enter</p>
        <h1 className="font-display text-4xl sm:text-5xl font-light leading-tight">What should people call you?</h1>
        <p className="mt-4 text-paper-2 leading-relaxed">
          You have one character in this world. Recruiters, managers and neighbours will use this name — and remember it.
        </p>
        <div className="mt-8">
          <OnboardingForm />
        </div>
        <div className="mt-10 border-t border-line pt-6 text-sm text-paper-3 space-y-2">
          <p>
            <span className="text-paper-2">Where you start:</span> Career City. You have just received a job offer from Nova Labs.
          </p>
          <p>
            <span className="text-paper-2">How you play:</span> speak. Text works too, but the game is built for your voice.
          </p>
        </div>
      </div>
    </main>
  );
}
