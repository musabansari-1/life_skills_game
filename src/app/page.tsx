import { AuthForm } from "@/components/AuthForm";

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <span className="font-display text-lg tracking-wide">Counterpart</span>
        <span className="eyebrow hidden sm:inline">Season one · Career City</span>
      </header>

      <section className="flex-1 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center px-6 pb-16 max-w-6xl w-full mx-auto">
        <div className="fade-up">
          <p className="eyebrow mb-5">A voice-first RPG</p>
          <h1 className="font-display text-[2.6rem] leading-[1.05] sm:text-6xl lg:text-7xl font-light">
            The conversations
            <br />
            <span className="text-brass-2">are the game.</span>
          </h1>
          <p className="mt-6 text-paper-2 max-w-lg text-lg leading-relaxed">
            One character. A city of people who remember you. Negotiate an offer, push back on a deadline, own a mistake — out loud. What you say changes what happens next.
          </p>
          <ul className="mt-8 grid sm:grid-cols-3 gap-4 max-w-xl text-sm">
            {[
              ["Persistent people", "Emma remembers how you negotiated. So does her boss."],
              ["Real consequences", "A promise made on Tuesday is a problem on Friday."],
              ["Honest progression", "Levels rise only when you actually demonstrate the skill."],
            ].map(([t, d]) => (
              <li key={t} className="border-t border-line pt-3">
                <p className="text-paper">{t}</p>
                <p className="text-paper-3 mt-1">{d}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center lg:justify-end fade-up" style={{ animationDelay: "120ms" }}>
          <AuthForm />
        </div>
      </section>
    </main>
  );
}
