import Link from "next/link";
import type { WorldOverview } from "@/contracts/api";
import { NPCS } from "@/content/npcs";
import { SKILLS, type SkillId } from "@/engine/types/skills";
import { levelFromXp } from "@/engine/competency";
import { Orb } from "./Orb";

type Ending = NonNullable<NonNullable<WorldOverview["advancedCampaign"]>["ending"]>;

/** The Career City ending: grounded in real history, read top to bottom like the last page of a story. */
export function SeasonEnding({ ending }: { ending: Ending }) {
  return (
    <section id="career-city-ending" className="card overflow-hidden" aria-label="Career City campaign">
      <div className="p-6 sm:p-8 border-b border-line bg-gradient-to-b from-brass-dim/60 to-transparent">
        <p className="eyebrow text-brass">Career City · Season one complete</p>
        <h2 className="font-display text-3xl sm:text-4xl mt-3 leading-tight">{ending.professional}</h2>
        {ending.headline && <p className="text-paper-2 mt-4 max-w-2xl leading-relaxed">{ending.headline}</p>}
        <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Your path">
          {ending.path.map((step, i) => (
            <li key={`${step}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-paper-3">→</span>}
              <span className={i === ending.path.length - 1 ? "text-brass-2 font-medium" : "text-paper-2"}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="p-6 sm:p-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="eyebrow">Who you became</h3>
          <p className="font-display text-xl mt-2 text-paper">{ending.identity}</p>
          <h3 className="eyebrow mt-8">Defining moments</h3>
          <ol className="mt-3 space-y-3">
            {ending.definingMoments.map((m, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-paper-3 tabular-nums w-4 shrink-0">{i + 1}</span>
                {m.attemptId ? <Link className="text-paper-2 hover:text-brass leading-relaxed" href={`/results/${m.attemptId}`}>{m.label}</Link> : <span className="text-paper-2 leading-relaxed">{m.label}</span>}
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="eyebrow">The people you leave with</h3>
          <ul className="mt-3 space-y-3">
            {ending.relationships.map((r) => {
              const npc = NPCS[r.npcId];
              return (
                <li key={r.npcId}>
                  <Link href={`/characters/${r.npcId}`} className="flex gap-3 items-start rounded-lg -m-1.5 p-1.5 hover:bg-white/5 transition">
                    {npc && <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} size={32} />}
                    <span className="min-w-0">
                      <span className="block text-sm text-paper">{npc?.shortName ?? r.npcId}</span>
                      <span className="block text-sm text-paper-2 leading-snug">{r.outcome}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="px-6 sm:px-8 pb-6 sm:pb-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-4">
          <h3 className="eyebrow">Strongest growth</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {ending.growth.filter((g) => g.delta > 0).map((g) => {
              const before = levelFromXp(g.before), after = levelFromXp(g.after);
              return (
                <li key={g.skill} className="flex items-baseline justify-between gap-3">
                  <span className="text-paper">{SKILLS[g.skill as SkillId]?.label ?? g.skill}</span>
                  <span className="text-brass-2 tabular-nums">{after > before ? `Level ${before} → ${after}` : `+${g.delta} XP`}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {ending.weakness && (
          <div className="rounded-xl border border-line p-4">
            <h3 className="eyebrow">Still working on</h3>
            <p className="text-paper mt-3 text-sm">{ending.weakness.label}</p>
            <p className="text-paper-3 mt-1 text-sm leading-relaxed">{ending.weakness.advice}</p>
          </div>
        )}
      </div>

      {!!ending.unresolved.length && (
        <details className="px-6 sm:px-8 pb-6">
          <summary className="text-sm cursor-pointer text-brass">What you carry into next season ({ending.unresolved.length})</summary>
          <ul className="text-sm text-paper-3 space-y-2 mt-3">{ending.unresolved.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </details>
      )}

      {ending.tease && (
        <div className="border-t border-line p-6 sm:p-8 bg-ink-2/60">
          <p className="eyebrow text-brass">Coming next</p>
          <p className="font-display text-xl mt-2">{ending.tease.title}</p>
          <p className="text-paper-2 mt-2 max-w-2xl leading-relaxed">{ending.tease.body}</p>
        </div>
      )}
    </section>
  );
}
