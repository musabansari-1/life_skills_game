"use client";

/**
 * Post-mission debrief. Cinematic, staged reveal: outcome → numbers → XP →
 * discoveries → relationship → evaluation → next quest. Also renders the
 * share-card preview (architecture for sharing; no social integration yet).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Orb } from "@/components/Orb";
import type { Evaluation } from "@/engine/types/evaluation";
import type { QuestResult } from "@/engine/types/quest";

interface Props {
  quest: { id: string; title: string };
  npc: { id: string; name: string; shortName: string; appearance: { hue: number; initials: string } };
  result: QuestResult;
  evaluation: Evaluation;
  objectives: { id: string; label: string; kind: "primary" | "hidden" | "optional" }[];
  skillLabels: Record<string, string>;
  playerTurnTexts: Record<number, string>;
  nextQuest: { id: string; title: string; tagline: string; npcName: string; isFollowUp: boolean } | null;
  /** Player-facing descriptions of what changed in the world. */
  worldChanges: string[];
}

const GRADE_COPY = { success: "Mission complete", partial: "Mission resolved", failure: "Mission failed" } as const;

export function ResultReveal({ quest, npc, result, evaluation, objectives, skillLabels, playerTurnTexts, nextQuest, worldChanges }: Props) {
  const [stage, setStage] = useState(0);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    const timers = [400, 1100, 1800, 2500, 3100].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  const show = (n: number) => (stage >= n ? "fade-up" : "opacity-0");
  const rel = result.rewards.relationshipChanges.find((r) => r.npcId === npc.id);
  const achieved = new Set(result.objectivesAchieved);

  async function share() {
    const text = `${result.shareCard.title}\n${result.shareCard.lines.map((l) => `${l.label}: ${l.before} → ${l.after}`).join("\n")}\n${result.shareCard.levelChanges.map((l) => `${skillLabels[l.skill] ?? l.skill} LVL ${l.before} → ${l.after}`).join("\n")}\n“${result.shareCard.headline}”`;
    try {
      if (navigator.share) await navigator.share({ title: result.shareCard.title, text });
      else await navigator.clipboard.writeText(text);
      setShared(true);
      void fetch("/api/events/share", { method: "POST", body: JSON.stringify({ questId: quest.id }) }).catch(() => {});
    } catch {
      /* cancelled */
    }
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-10 max-w-5xl w-full mx-auto">
      {/* Outcome */}
      <section className={`text-center ${show(1)}`}>
        <p className={`eyebrow ${result.grade === "failure" ? "text-warn" : result.grade === "success" ? "text-success" : "text-brass"}`}>{GRADE_COPY[result.grade]}</p>
        <h1 className="font-display text-4xl sm:text-6xl mt-3 leading-tight">{quest.title}</h1>
        <p className="text-paper-2 mt-3 text-lg">{result.outcomeLabel}</p>
        <p className="text-paper-3 mt-4 max-w-2xl mx-auto leading-relaxed">{result.narrative}</p>
      </section>

      {/* Numbers */}
      {result.shareCard.lines.length > 0 && (
        <section className={`mt-12 grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto ${show(2)}`}>
          {result.shareCard.lines.map((l) => (
            <div key={l.label} className="card p-5 text-center">
              <p className="eyebrow">{l.label}</p>
              <p className="mt-2 font-display text-3xl">
                {l.before !== l.after && l.before !== "—" && <span className="text-paper-3 line-through decoration-paper-3/50 text-xl mr-3">{l.before}</span>}
                <span className={l.before !== l.after ? "text-brass-2" : "text-paper-2"}>{l.after}</span>
                {l.before === l.after && <span className="block text-xs text-paper-3 mt-1 font-body">unchanged</span>}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* XP + discoveries */}
      <section className={`mt-12 grid md:grid-cols-[1fr_1fr] gap-6 ${show(3)}`}>
        <div className="card p-6">
          <p className="eyebrow mb-4">Skills</p>
          <ul className="space-y-3">
            {result.rewards.xp.map((x, i) => (
              <li key={x.skill} className="flex items-center justify-between fade-up" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="text-paper">{skillLabels[x.skill] ?? x.skill}</span>
                <span className="flex items-baseline gap-3">
                  {x.levelAfter > x.levelBefore && (
                    <span className="text-xs text-brass-2">
                      LVL {x.levelBefore} → {x.levelAfter}
                    </span>
                  )}
                  <span className="font-display text-xl text-brass-2">+{x.xp} XP</span>
                </span>
              </li>
            ))}
          </ul>
          {result.rewards.discoveredFacets.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <p className="eyebrow mb-2">Skill discovered</p>
              <div className="flex flex-wrap gap-2">
                {result.rewards.discoveredFacets.map((d) => (
                  <span key={`${d.skill}.${d.facet}`} className="px-3 py-1.5 rounded-full bg-brass-dim border border-brass/40 text-brass-2 text-sm tracking-wide uppercase">
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} size={56} />
            <div>
              <p className="eyebrow">Relationship</p>
              <p className="text-paper">{npc.name}</p>
            </div>
          </div>
          {rel && (
            <ul className="mt-4 space-y-2">
              {(["trust", "respect", "warmth", "familiarity"] as const).map((k) => {
                const d = Math.round(((rel.after[k] ?? 0) - (rel.before[k] ?? 0)) * 10) / 10;
                return (
                  <li key={k} className="flex items-center justify-between text-sm">
                    <span className="text-paper-2 capitalize">{k}</span>
                    <span className={d > 0 ? "text-success" : d < 0 ? "text-warn" : "text-paper-3"}>
                      {d > 0 ? "+" : ""}
                      {d}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-2">Objectives</p>
            <ul className="space-y-1.5 text-sm">
              {objectives.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span className={achieved.has(o.id) ? "text-success" : "text-paper-3"}>{achieved.has(o.id) ? "✓" : "○"}</span>
                  <span className={achieved.has(o.id) ? "text-paper" : "text-paper-3"}>{o.label}</span>
                  {o.kind !== "primary" && <span className="eyebrow">{o.kind}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Evaluation */}
      <section className={`mt-12 ${show(4)}`}>
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="font-display text-3xl">Evaluation</h2>
          <p className="text-paper-3 text-sm">
            Overall <span className="text-paper">{evaluation.overallScore}</span>/100
          </p>
        </div>
        <p className="mt-4 text-paper-2 leading-relaxed max-w-3xl">{evaluation.summary}</p>
        <div className="mt-8 grid md:grid-cols-2 gap-6">
          <div>
            <p className="eyebrow text-success mb-3">Strong</p>
            <ul className="space-y-4">
              {evaluation.strengths.length === 0 && <li className="text-sm text-paper-3">Nothing stood out this time.</li>}
              {evaluation.strengths.map((s) => (
                <li key={s.title}>
                  <p className="text-paper">{s.title}</p>
                  <p className="text-sm text-paper-3 mt-1 leading-relaxed">{s.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow text-warn mb-3">Needs work</p>
            <ul className="space-y-4">
              {evaluation.improvements.map((s) => (
                <li key={s.title}>
                  <p className="text-paper">{s.title}</p>
                  <p className="text-sm text-paper-3 mt-1 leading-relaxed">{s.detail}</p>
                  <p className="text-sm text-paper-2 mt-2 border-l-2 border-brass/50 pl-3 italic">{s.betterMove}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {evaluation.keyMoments.length > 0 && (
          <div className="mt-10">
            <p className="eyebrow mb-3">Key moments</p>
            <ol className="space-y-3">
              {evaluation.keyMoments.map((m, i) => (
                <li key={i} className="card p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={m.impact === "positive" ? "text-success" : m.impact === "negative" ? "text-warn" : "text-paper-3"}>●</span>
                    <span className="text-paper">{m.label}</span>
                  </div>
                  {playerTurnTexts[m.turnIndex] && <p className="text-sm text-paper-3 mt-2 italic">“{playerTurnTexts[m.turnIndex]}”</p>}
                  <p className="text-sm text-paper-2 mt-2">{m.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
        {worldChanges.length > 0 && (
          <div className="mt-10">
            <p className="eyebrow mb-3">What changed in the world</p>
            <ul className="flex flex-wrap gap-2">
              {worldChanges.map((c, i) => (
                <li key={i} className="text-xs px-3 py-1.5 rounded-full border border-line text-paper-2">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Share + next */}
      <section className={`mt-14 grid md:grid-cols-[1fr_1fr] gap-6 ${show(5)}`}>
        <div className="card p-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 60% 60% at 80% 0%, hsl(${npc.appearance.hue} 40% 30% / 0.35), transparent 70%)` }} />
          <p className="eyebrow">Share card</p>
          <p className="font-display text-2xl mt-2">{result.shareCard.title}</p>
          {result.shareCard.lines.map((l) => (
            <p key={l.label} className="font-display text-xl mt-1">
              {l.before !== l.after ? (
                <>
                  {l.before} <span className="text-paper-3">→</span> <span className="text-brass-2">{l.after}</span>
                </>
              ) : (
                <>
                  {l.label} <span className="text-paper-2">{l.after}</span>
                </>
              )}
            </p>
          ))}
          {result.shareCard.levelChanges.map((l) => (
            <p key={l.skill} className="text-sm text-paper-2 mt-1">
              {skillLabels[l.skill] ?? l.skill} LVL {l.before} → {l.after}
            </p>
          ))}
          <p className="mt-4 text-paper italic">“{result.shareCard.headline}”</p>
          <button type="button" onClick={share} className="btn btn-ghost mt-5 text-sm">
            {shared ? "Copied" : "Share"}
          </button>
        </div>
        <div className="card p-6 flex flex-col">
          <p className="eyebrow">{nextQuest?.isFollowUp ? "Unlocked" : "Next"}</p>
          {nextQuest ? (
            <>
              <p className="font-display text-2xl mt-2">{nextQuest.title}</p>
              <p className="text-paper-2 italic mt-1">{nextQuest.tagline}</p>
              <p className="text-sm text-paper-3 mt-2">with {nextQuest.npcName}</p>
              <div className="mt-auto pt-6 flex gap-2 flex-wrap">
                <Link href={`/quests/${nextQuest.id}`} className="btn btn-primary">
                  Continue
                </Link>
                <Link href="/world" className="btn btn-ghost">
                  Back to the map
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-auto pt-6 flex gap-2">
              <Link href="/world" className="btn btn-primary">
                Back to the map
              </Link>
            </div>
          )}
          <Link href={`/quests/${quest.id}`} className="mt-3 text-xs text-paper-3 hover:text-paper-2">
            Replay this scene →
          </Link>
        </div>
      </section>
    </main>
  );
}
