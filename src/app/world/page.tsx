import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { worldOverview } from "@/server/queries";
import { SkillList } from "@/components/SkillList";
import { TopBar } from "@/components/TopBar";
import { WorldMap } from "@/components/WorldMap";
import { findQuest } from "@/content/quests";
import { PlayerGoals, StoryPanel } from "@/components/StoryPanel";
import { ActTrack, ConsequencesCard, toRoman } from "@/components/CampaignPanel";
import { SeasonEnding } from "@/components/SeasonEnding";

export const metadata = { title: "Career City" };
export const dynamic = "force-dynamic";

export default async function WorldPage() {
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  if (!player.onboardingCompleted) redirect("/onboarding");

  // Same payload as GET /api/v1/world.
  const view = await worldOverview(game, player.playerId);
  const { worlds, skills, people, openCommitments, activeAttempt: active } = view;
  const campaign = view.campaign;
  const ending = view.advancedCampaign?.ending ?? null;
  const next = view.nextUp ?? null;
  const rec = view.narrative?.recommendation ?? null;
  // One "next" card: the Director's pick if it is the chapter, otherwise the chapter plus the pick as "also waiting".
  const recIsChapter = !!rec && rec.questId === next?.questId;
  const focusWorldId = findQuest(rec?.questId ?? "")?.worldId ?? findQuest(next?.questId ?? "")?.worldId ?? worlds.find((w) => w.availableCount > 0)?.id;
  const recap = view.recap ?? [];

  return (
    <main className="flex-1 flex flex-col">
      <TopBar playerName={view.player.displayName} />
      <div className="px-4 sm:px-6 py-6 max-w-7xl w-full mx-auto grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
        <section className="fade-up space-y-4 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">{campaign?.title ?? "Career City"}</p>
              <h1 className="font-display text-3xl sm:text-4xl mt-1">{ending ? `Season one, ${view.player.displayName}.` : campaign?.currentAct ? `Act ${toRoman(campaign.currentAct.index)}: ${campaign.currentAct.title}` : `Where to next, ${view.player.displayName}?`}</h1>
              {!ending && campaign?.currentAct && <p className="text-paper-3 text-sm mt-1">{campaign.currentAct.subtitle}</p>}
            </div>
            <p className="text-sm text-paper-3">{view.career.label}</p>
          </div>

          {active && (
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-brass/40">
              <div>
                <p className="eyebrow text-brass">In progress</p>
                <p className="text-paper mt-0.5">{active.questTitle}</p>
                <p className="text-xs text-paper-3">You left mid-conversation with {active.npcShortName}.</p>
              </div>
              <Link href={`/play/${active.attemptId}`} className="btn btn-primary">Return to the scene</Link>
            </div>
          )}

          {ending && <SeasonEnding ending={ending} />}

          {!ending && next && (
            <section className={`card p-5 sm:p-7 relative overflow-hidden ${next.kind === "boss" ? "border-brass/60" : "border-brass/30"}`} aria-label="Next in your story">
              <div className="absolute top-0 left-0 w-1 h-full bg-brass/60" />
              {next.transition && (
                <p className="text-xs tracking-[0.18em] uppercase text-brass">{next.transition.when}</p>
              )}
              {next.transition && <p className="text-paper-2 mt-1">{next.transition.message}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {next.kind === "boss" && <span className="text-[11px] tracking-widest uppercase px-2 py-0.5 rounded-full bg-brass text-ink-0">A conversation that matters</span>}
                {next.kind === "recovery" && <span className="text-[11px] tracking-widest uppercase px-2 py-0.5 rounded-full border border-warn/50 text-warn">A chance to repair</span>}
                {next.act && <span className="text-[11px] tracking-widest uppercase text-paper-3">Act {toRoman(next.act.index)} · Chapter {campaign ? campaign.completed + 1 : ""} of {campaign?.total ?? ""}</span>}
              </div>
              <h2 className="font-display text-2xl sm:text-3xl mt-2">{next.title}</h2>
              <p className="text-paper-2 text-sm mt-1 italic">{next.tagline}</p>
              <p className="text-paper-3 text-xs mt-2">with {next.npcName}</p>
              {!active && <Link href={`/quests/${next.questId}`} className="btn btn-primary mt-5">{campaign && campaign.completed === 0 ? "Begin" : "Continue the story"} <span aria-hidden>→</span></Link>}
              {campaign && <div className="mt-6 pt-5 border-t border-line"><ActTrack campaign={campaign} /></div>}
            </section>
          )}

          {view.narrative && (!recIsChapter || view.narrative.threads.length > 0) && !ending && (
            <StoryPanel story={view.narrative} busy={!!active} hideRecommendation={recIsChapter} />
          )}

          <WorldMap worlds={worlds} initialWorldId={focusWorldId} currentQuestId={next?.questId ?? null} />
        </section>

        <aside className="space-y-4 fade-up min-w-0" style={{ animationDelay: "120ms" }}>
          {recap.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">Your story so far</p>
              <ol className="space-y-2.5 text-sm">
                {recap.slice(-6).map((m, i) => (
                  <li key={`${m.questId}-${i}`} className="flex gap-2">
                    <span className="text-brass mt-0.5" aria-hidden>•</span>
                    {m.attemptId ? <Link href={`/results/${m.attemptId}`} className="text-paper-2 hover:text-brass leading-snug">{m.label}</Link> : <span className="text-paper-2 leading-snug">{m.label}</span>}
                  </li>
                ))}
              </ol>
              {recap.length > 6 && <p className="text-xs text-paper-3 mt-3">{recap.length - 6} earlier moments</p>}
            </div>
          )}

          {openCommitments.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">Promises you&apos;ve made</p>
              <ul className="space-y-2 text-sm text-paper-2">
                {openCommitments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="text-brass">•</span>
                    <span>{c.description} <span className="text-paper-3">— to {c.toNpcName}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-5">
            <p className="eyebrow mb-3">People</p>
            {people.length === 0 ? (
              <p className="text-sm text-paper-3">You haven&apos;t met anyone yet. Your first call is with Emma, at Nova Labs.</p>
            ) : (
              <ul className="space-y-2">
                {people.map((p) => (
                  <li key={p.npcId}>
                    <Link href={`/characters/${p.npcId}`} className="flex items-center gap-3 rounded-lg p-1.5 -m-1.5 hover:bg-white/5 transition">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-display shrink-0" style={{ background: `hsl(${p.appearance.hue} 40% 28%)` }}>{p.appearance.initials}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-paper truncate">{p.name}</span>
                        <span className="block text-xs text-paper-3">{p.role} · {p.standing}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {view.advancedCampaign && <ConsequencesCard campaign={view.advancedCampaign} />}
          {!!view.narrative?.reputation.length && <div className="card p-5"><p className="eyebrow mb-3">The word about you</p>{view.narrative.reputation.map((line) => <p key={line} className="text-sm text-paper-2 mt-2">{line}</p>)}</div>}

          <div className="card p-5">
            <p className="eyebrow mb-3">Skills</p>
            <SkillList skills={skills} compact />
            {view.insight && <p className="mt-4 text-xs text-paper-3 border-t border-line pt-3 leading-relaxed">{view.insight}</p>}
            {view.narrative && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-brass">Techniques you are developing</summary>
                <ul className="mt-3 space-y-3">{view.narrative.techniques.map((t) => <li key={t.id}><p className={t.stage === "learning" ? "text-paper-3" : "text-paper-2"}>{t.title} <span className="text-xs text-paper-3">· {t.stage === "reliable" ? "reliable" : t.stage === "discovered" ? "discovered" : "not yet seen"}</span></p>{t.stage !== "learning" && <p className="text-xs text-paper-3 mt-1">{t.hint}</p>}</li>)}</ul>
              </details>
            )}
          </div>

          {view.narrative && !ending && <PlayerGoals story={view.narrative} busy={!!active} />}
        </aside>
      </div>
    </main>
  );
}
