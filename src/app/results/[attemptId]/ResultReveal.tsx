"use client";

/**
 * Post-mission debrief. Answers, in order:
 *   What happened? → What changed? → What does it mean? → What did I gain? →
 *   What did I learn? → What happens next?
 * Concrete outcomes first; abstract scores last and collapsed.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Orb } from "@/components/Orb";
import type { Debrief } from "@/contracts/api";
import { createGameClient } from "@/client/gameClient";

interface Props {
  /** Same payload a native client gets from GET /api/v1/attempts/:id/result. */
  debrief: Debrief;
}

const GRADE_COPY = { success: "Mission complete", partial: "Mission resolved", failure: "Mission failed" } as const;
const REL_LABEL: Record<string, string> = { trust: "Trust", respect: "Respect", warmth: "Warmth", familiarity: "Familiarity" };

export function ResultReveal({ debrief }: Props) {
  const d = debrief;
  const { quest, npc, evaluation, skillLabels, playerTurnTexts, nextQuest } = d;
  const [stage, setStage] = useState(0);
  const [xpShown, setXpShown] = useState(false);
  const [shared, setShared] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const timers = [250, 900, 1500, 2100, 2700, 3200].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    const xp = setTimeout(() => setXpShown(true), 2300);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(xp);
    };
  }, []);
  const show = (n: number) => (stage >= n ? "fade-up" : "opacity-0");

  const rel = d.rewards.relationshipChanges.find((r) => r.npcId === npc.id);
  const relDeltas = rel
    ? (["respect", "trust", "warmth", "familiarity"] as const)
        .map((k) => ({ k, d: Math.round(((rel.after[k] ?? 0) - (rel.before[k] ?? 0)) * 10) / 10 }))
        .filter((x) => x.d !== 0 && (x.k !== "familiarity" || Math.abs(x.d) >= 1))
    : [];
  const otherRel = d.rewards.relationshipChanges.filter((r) => r.npcId !== npc.id);
  const maxXp = Math.max(1, ...d.rewards.xp.map((x) => x.xp));

  async function share() {
    const lines = d.shareCard.lines.filter((l) => l.before !== l.after).map((l) => `${l.label}: ${l.before} → ${l.after}`);
    const text = [d.shareCard.title, ...lines, ...d.shareCard.levelChanges.map((l) => `${skillLabels[l.skill] ?? l.skill} LVL ${l.before} → ${l.after}`), `“${d.shareCard.headline}”`].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: d.shareCard.title, text });
      else await navigator.clipboard.writeText(text);
      setShared(true);
      void createGameClient({ baseUrl: "" }).trackShare(quest.id).catch(() => {});
    } catch {
      /* cancelled */
    }
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-8 sm:py-12 max-w-3xl w-full mx-auto">
      {/* 1. What happened */}
      <section className={`text-center ${show(1)}`}>
        <p className="eyebrow">
          {d.chapter ? `Chapter ${d.chapter.index} of ${d.chapter.total} · ` : ""}
          <span className={d.grade === "failure" ? "text-warn" : d.grade === "success" ? "text-success" : "text-brass"}>{GRADE_COPY[d.grade]}</span>
        </p>
        <h1 className="font-display text-4xl sm:text-6xl mt-3 leading-tight">{d.outcomeLabel}</h1>
        <p className="text-paper-3 mt-1 text-sm">{quest.title}</p>
        <p className="text-paper-2 mt-5 max-w-xl mx-auto leading-relaxed">{d.narrative}</p>
        {d.mode !== "first" && (
          <p className="mt-4 inline-block text-xs px-3 py-1.5 rounded-full border border-brass/40 text-brass-2">
            {d.mode === "rehearsal" ? "Rehearsal: your skills improved; the world keeps what really happened." : "Second chance: this is now what happened."}
          </p>
        )}
      </section>

      {/* Replay comparison */}
      {d.comparison && (
        <section className={`mt-8 card p-5 ${show(2)}`}>
          <p className="eyebrow mb-3">Compared with last time</p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div>
              <p className="text-paper-3 text-xs">Last time</p>
              <p className="text-paper-2">{d.comparison.previousOutcomeLabel}</p>
            </div>
            <span className="text-paper-3">→</span>
            <div>
              <p className="text-paper-3 text-xs">This time</p>
              <p className={d.comparison.improved ? "text-success" : "text-paper"}>{d.outcomeLabel}</p>
            </div>
          </div>
          {d.comparison.lines.map((l) => (
            <p key={l.label} className="text-center text-sm mt-2 text-paper-2">
              {l.label}: {l.previous} <span className="text-paper-3">→</span> <span className={l.now !== l.previous ? "text-brass-2" : ""}>{l.now}</span>
            </p>
          ))}
          <p className="text-center text-xs mt-3 text-paper-3">{d.comparison.improved ? "Better than last time." : d.comparison.score < d.comparison.previousScore ? "Not better than last time. Try a different approach." : "About the same as last time."}</p>
        </section>
      )}

      {/* 2. What changed */}
      <section className={`mt-10 ${show(2)}`}>
        <p className="eyebrow mb-3 text-center">What changed</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {d.shareCard.lines.map((l) => (
            <div key={l.label} className="card p-5 text-center">
              <p className="eyebrow">{l.label}</p>
              <p className="mt-2 font-display text-3xl">
                {l.before !== l.after && l.before !== "—" && <span className="text-paper-3 line-through decoration-paper-3/50 text-xl mr-3">{l.before}</span>}
                <span className={l.before !== l.after ? "text-brass-2" : "text-paper-2"}>{l.after}</span>
              </p>
              {l.before === l.after && <p className="text-xs text-paper-3 mt-1">unchanged</p>}
            </div>
          ))}
          {rel && (
            <div className={`card p-5 flex items-center gap-4 ${d.shareCard.lines.length % 2 === 0 ? "sm:col-span-2" : ""}`}>
              <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} size={48} />
              <div className="min-w-0">
                <p className="text-paper">{npc.name}</p>
                <p className="text-sm mt-0.5">
                  {relDeltas.length === 0 && <span className="text-paper-3">No change</span>}
                  {relDeltas.map((x, i) => (
                    <span key={x.k} className={x.d > 0 ? "text-success" : "text-warn"}>
                      {i > 0 && <span className="text-paper-3"> · </span>}
                      {REL_LABEL[x.k]} {x.d > 0 ? "+" : ""}
                      {x.d}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          )}
        </div>
        {(otherRel.length > 0 || d.worldChanges.length > 0) && (
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {d.worldChanges.map((c, i) => (
              <li key={i} className="text-xs px-3 py-1.5 rounded-full border border-line text-paper-2">
                {c}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. What it means */}
      {d.aftermath.length > 0 && (
        <section className={`mt-10 text-center ${show(3)}`}>
          <p className="eyebrow mb-3">What this means</p>
          <ul className="space-y-2">
            {d.aftermath.map((a, i) => (
              <li key={i} className="font-display text-lg sm:text-xl text-paper leading-snug">
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. Skills */}
      <section className={`mt-10 card p-5 sm:p-6 ${show(4)}`}>
        <p className="eyebrow mb-4">Skills</p>
        <ul className="space-y-3">
          {d.rewards.xp.map((x, i) => (
            <li key={x.skill}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-paper">{skillLabels[x.skill] ?? x.skill}</span>
                <span className="flex items-baseline gap-3">
                  {x.levelAfter > x.levelBefore && (
                    <span className="text-[11px] tracking-widest uppercase text-ink-0 bg-brass px-2 py-0.5 rounded-full">
                      Level {x.levelAfter}
                    </span>
                  )}
                  <span className="font-display text-lg text-brass-2 tabular-nums">+{x.xp} XP</span>
                </span>
              </div>
              <div className="mt-1.5 h-[3px] rounded-full bg-ink-4 overflow-hidden">
                <div className="h-full rounded-full bg-brass transition-all ease-out" style={{ width: xpShown ? `${(x.xp / maxXp) * 100}%` : "0%", transitionDuration: `${900 + i * 150}ms` }} />
              </div>
            </li>
          ))}
        </ul>
        {d.rewards.discoveredFacets.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-2">New technique{d.rewards.discoveredFacets.length > 1 ? "s" : ""} discovered</p>
            <div className="flex flex-wrap gap-2">
              {d.rewards.discoveredFacets.map((f) => (
                <span key={`${f.skill}.${f.facet}`} className="px-3 py-1.5 rounded-full bg-brass-dim border border-brass/40 text-brass-2 text-xs tracking-widest uppercase">
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 5. What you learned */}
      <section className={`mt-10 ${show(5)}`}>
        <p className="eyebrow mb-3">What you learned</p>
        <p className="text-paper-2 leading-relaxed">{evaluation.summary}</p>
        <div className="mt-6 grid sm:grid-cols-2 gap-5">
          {evaluation.strengths.length > 0 && (
            <div>
              <p className="eyebrow text-success mb-2">Worked</p>
              <ul className="space-y-3">
                {evaluation.strengths.slice(0, 2).map((s) => (
                  <li key={s.title}>
                    <p className="text-paper">{s.title}</p>
                    <p className="text-sm text-paper-3 mt-0.5 leading-relaxed">{s.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={evaluation.strengths.length === 0 ? "sm:col-span-2" : ""}>
            <p className="eyebrow text-warn mb-2">Next time</p>
            <ul className="space-y-4">
              {evaluation.improvements.slice(0, 2).map((s) => (
                <li key={s.title}>
                  <p className="text-paper">{s.title}</p>
                  <p className="text-sm text-paper-3 mt-0.5 leading-relaxed">{s.detail}</p>
                  <p className="text-sm text-paper mt-2 border-l-2 border-brass/60 pl-3 italic">Try: “{s.betterMove.replace(/^["“]|["”]$/g, "")}”</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <button type="button" onClick={() => setDetails((v) => !v)} className="mt-6 text-xs text-paper-3 hover:text-paper-2">
          {details ? "Hide the breakdown" : "Show the full breakdown"}
        </button>
        {details && (
          <div className="mt-4 space-y-6 fade-up">
            <div>
              <p className="eyebrow mb-2">Objectives</p>
              <ul className="space-y-1.5 text-sm">
                {d.objectives.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className={o.achieved ? "text-success" : "text-paper-3"}>{o.achieved ? "✓" : "○"}</span>
                    <span className={o.achieved ? "text-paper" : "text-paper-3"}>{o.label}</span>
                    {o.kind !== "primary" && <span className="eyebrow">{o.kind}</span>}
                  </li>
                ))}
              </ul>
            </div>
            {evaluation.keyMoments.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Key moments</p>
                <ol className="space-y-3">
                  {evaluation.keyMoments.map((m, i) => (
                    <li key={i} className="card p-4">
                      <p className="text-sm flex items-center gap-2">
                        <span className={m.impact === "positive" ? "text-success" : m.impact === "negative" ? "text-warn" : "text-paper-3"}>●</span>
                        <span className="text-paper">{m.label}</span>
                      </p>
                      {playerTurnTexts[String(m.turnIndex)] && <p className="text-sm text-paper-3 mt-2 italic">“{playerTurnTexts[String(m.turnIndex)]}”</p>}
                      <p className="text-sm text-paper-2 mt-2">{m.detail}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-xs text-paper-3">Overall {evaluation.overallScore}/100</p>
          </div>
        )}
      </section>

      {/* 6. What happens next */}
      <section className={`mt-12 ${show(6)}`}>
        <div className="card p-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 60% 80% at 100% 0%, hsl(${npc.appearance.hue} 40% 30% / 0.3), transparent 70%)` }} />
          {d.chapter?.finished ? (
            <>
              <p className="eyebrow text-brass">{d.chapter.title}</p>
              <p className="font-display text-3xl mt-2">Chapter complete.</p>
              <p className="text-paper-2 mt-2">Everyone at Nova Labs will remember how you got here. More districts open in the next chapter.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/world" className="btn btn-primary">
                  Back to the city
                </Link>
              </div>
            </>
          ) : nextQuest ? (
            <>
              <p className="eyebrow text-brass">{nextQuest.isFollowUp ? "Next in your story" : "Up next"}</p>
              <p className="font-display text-3xl mt-2">{nextQuest.title}</p>
              <p className="text-paper-2 italic mt-1">{nextQuest.tagline}</p>
              <p className="text-sm text-paper-3 mt-1">with {nextQuest.npcName}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href={`/quests/${nextQuest.id}`} className="btn btn-primary">
                  Continue
                </Link>
                <Link href="/world" className="btn btn-ghost">
                  Map
                </Link>
              </div>
            </>
          ) : (
            <Link href="/world" className="btn btn-primary">
              Back to the map
            </Link>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href={`/quests/${quest.id}`} className="text-paper-3 hover:text-paper-2">
            {d.grade === "failure" ? "Ask for a second chance →" : "Rehearse this scene with a different approach →"}
          </Link>
          <button type="button" onClick={share} className="text-paper-3 hover:text-paper-2">
            {shared ? "Copied" : "Share result"}
          </button>
        </div>
      </section>
    </main>
  );
}
