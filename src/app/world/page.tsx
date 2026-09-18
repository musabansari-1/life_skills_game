import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { worldOverview } from "@/server/queries";
import { SkillList } from "@/components/SkillList";
import { TopBar } from "@/components/TopBar";
import { WorldMap } from "@/components/WorldMap";
import { findQuest } from "@/content/quests";
import { NPCS } from "@/content/npcs";

export const metadata = { title: "World" };
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
  const currentQuest = campaign?.currentQuestId ? findQuest(campaign.currentQuestId) : null;
  const focusWorldId = currentQuest?.worldId ?? worlds.find((w) => w.availableCount > 0)?.id;

  return (
    <main className="flex-1 flex flex-col">
      <TopBar playerName={view.player.displayName} />
      <div className="px-4 sm:px-6 py-6 max-w-7xl w-full mx-auto grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
        <section className="fade-up space-y-4 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">The universe</p>
              <h1 className="font-display text-3xl sm:text-4xl mt-1">Where to next, {view.player.displayName}?</h1>
            </div>
            <p className="text-sm text-paper-3">{view.career.label}</p>
          </div>

          {campaign && (
            <div className="card p-5 sm:p-6 relative overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="eyebrow text-brass">{campaign.title}</p>
                  {campaign.finished ? (
                    <p className="font-display text-2xl mt-1">Chapter complete.</p>
                  ) : currentQuest ? (
                    <>
                      <p className="font-display text-2xl sm:text-3xl mt-1">{currentQuest.title}</p>
                      <p className="text-paper-2 text-sm mt-1 italic">{currentQuest.tagline}</p>
                      <p className="text-paper-3 text-xs mt-1">with {NPCS[currentQuest.npcId]?.name}</p>
                    </>
                  ) : null}
                </div>
                {!campaign.finished && currentQuest && !active && (
                  <Link href={`/quests/${currentQuest.id}`} className="btn btn-primary shrink-0">
                    Continue
                  </Link>
                )}
              </div>
              <ol className="mt-5 grid grid-cols-6 gap-1.5" aria-label="Chapters">
                {campaign.chapters.map((c, i) => (
                  <li key={c.questId} className="min-w-0">
                    <div className={`h-1 rounded-full ${c.state === "done" ? "bg-brass" : c.state === "current" ? "bg-brass/40" : "bg-ink-4"}`} />
                    <p className={`mt-1.5 text-[10px] sm:text-[11px] truncate ${c.state === "current" ? "text-paper" : c.state === "done" ? "text-paper-2" : "text-paper-3"}`}>
                      <span className="hidden sm:inline">{i + 1}. </span>
                      {c.label}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {active && (
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-brass/40">
              <div>
                <p className="eyebrow text-brass">In progress</p>
                <p className="text-paper mt-0.5">{active.questTitle}</p>
                <p className="text-xs text-paper-3">You left mid-conversation with {active.npcShortName}.</p>
              </div>
              <Link href={`/play/${active.attemptId}`} className="btn btn-primary">
                Return to the scene
              </Link>
            </div>
          )}

          <WorldMap worlds={worlds} initialWorldId={focusWorldId} />
        </section>

        <aside className="space-y-4 fade-up min-w-0" style={{ animationDelay: "120ms" }}>
          <div className="card p-5">
            <p className="eyebrow mb-3">Skills</p>
            <SkillList skills={skills} compact />
            {view.insight && <p className="mt-4 text-xs text-paper-3 border-t border-line pt-3 leading-relaxed">{view.insight}</p>}
          </div>

          <div className="card p-5">
            <p className="eyebrow mb-3">People</p>
            {people.length === 0 ? (
              <p className="text-sm text-paper-3">You haven&apos;t met anyone yet.</p>
            ) : (
              <ul className="space-y-2">
                {people.map((p) => (
                  <li key={p.npcId}>
                    <Link href={`/characters/${p.npcId}`} className="flex items-center gap-3 rounded-lg p-1.5 -m-1.5 hover:bg-white/5 transition">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-display" style={{ background: `hsl(${p.appearance.hue} 40% 28%)` }}>
                        {p.appearance.initials}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-paper truncate">{p.name}</span>
                        <span className="block text-xs text-paper-3">
                          {p.role} · {p.standing}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {view.story.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">Your story so far</p>
              <ol className="space-y-2 text-sm text-paper-2">
                {view.story.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-paper-3 tabular-nums">{view.story.length - i}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {openCommitments.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">Promises you&apos;ve made</p>
              <ul className="space-y-2 text-sm text-paper-2">
                {openCommitments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="text-brass">•</span>
                    <span>
                      {c.description} <span className="text-paper-3">— to {c.toNpcName}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
