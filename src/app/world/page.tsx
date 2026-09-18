import Link from "next/link";
import { redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { formatINR } from "@/engine/util";
import { getCurrentPlayer } from "@/server/auth";
import { getGame } from "@/server/context";
import { buildInsight, buildSkillViews, buildWorldCards } from "@/server/game-view";
import { SkillList } from "@/components/SkillList";
import { TopBar } from "@/components/TopBar";
import { WorldMap } from "@/components/WorldMap";
import { relationshipLabel } from "@/engine/relationships";

export const metadata = { title: "World" };
export const dynamic = "force-dynamic";

export default async function WorldPage() {
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  if (!player.onboardingCompleted) redirect("/onboarding");

  const state = await game.getPlayerState(player.playerId);
  const worlds = buildWorldCards(state);
  const skills = buildSkillViews(state);
  const insight = buildInsight(state);
  const active = await game.getActiveAttempt(player.playerId);
  const activeQuest = active ? findQuest(active.questId) : null;
  const met = Object.values(state.npcs).filter((n) => n.timesMet > 0 || state.world.peopleMet.includes(n.npcId));
  const career = state.world.career;
  const openCommitments = state.world.commitments.filter((c) => c.status === "open");

  return (
    <main className="flex-1 flex flex-col">
      <TopBar playerName={state.displayName} />
      <div className="px-4 sm:px-6 py-6 max-w-7xl w-full mx-auto grid lg:grid-cols-[1fr_300px] gap-6">
        <section className="fade-up space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">The universe</p>
              <h1 className="font-display text-3xl sm:text-4xl mt-1">Where to next, {state.displayName}?</h1>
            </div>
            <p className="text-sm text-paper-3">
              {career.status === "employed" && career.employer ? (
                <>
                  {career.role} at {career.employer}
                  {career.baseSalary ? ` · ${formatINR(career.baseSalary)}` : ""}
                </>
              ) : career.status === "offer_received" ? (
                "Offer on the table from Nova Labs"
              ) : (
                "Between things"
              )}
            </p>
          </div>

          {active && activeQuest && (
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-brass/40">
              <div>
                <p className="eyebrow text-brass">In progress</p>
                <p className="text-paper mt-0.5">{activeQuest.title}</p>
                <p className="text-xs text-paper-3">You left mid-conversation with {NPCS[active.npcId]?.shortName}.</p>
              </div>
              <Link href={`/play/${active.id}`} className="btn btn-primary">
                Return to the scene
              </Link>
            </div>
          )}

          <WorldMap worlds={worlds} initialWorldId={worlds.find((w) => w.quests.some((q) => q.isNext || (q.availability === "available" && q.id === "counter_offer")))?.id} />
        </section>

        <aside className="space-y-4 fade-up" style={{ animationDelay: "120ms" }}>
          <div className="card p-5">
            <p className="eyebrow mb-3">Skills</p>
            <SkillList skills={skills} compact />
            {insight.sentence && <p className="mt-4 text-xs text-paper-3 border-t border-line pt-3 leading-relaxed">{insight.sentence}</p>}
          </div>

          <div className="card p-5">
            <p className="eyebrow mb-3">People</p>
            {met.length === 0 ? (
              <p className="text-sm text-paper-3">You haven&apos;t met anyone yet.</p>
            ) : (
              <ul className="space-y-2">
                {met.map((n) => {
                  const def = NPCS[n.npcId];
                  return (
                    <li key={n.npcId}>
                      <Link href={`/characters/${n.npcId}`} className="flex items-center gap-3 rounded-lg p-1.5 -m-1.5 hover:bg-white/5 transition">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-display" style={{ background: `hsl(${def.appearance.hue} 40% 28%)` }}>
                          {def.appearance.initials}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm text-paper truncate">{def.name}</span>
                          <span className="block text-xs text-paper-3">
                            {def.role} · {relationshipLabel(n.relationship)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {openCommitments.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">Promises you&apos;ve made</p>
              <ul className="space-y-2 text-sm text-paper-2">
                {openCommitments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="text-brass">•</span>
                    <span>
                      {c.description} <span className="text-paper-3">— to {NPCS[c.toNpcId]?.shortName ?? c.toNpcId}</span>
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
