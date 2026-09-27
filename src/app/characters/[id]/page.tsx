import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { getWorld } from "@/content/worlds";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { dossierView } from "@/server/queries";
import { Orb } from "@/components/Orb";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/characters/[id]">) {
  const { id } = await params;
  return { title: NPCS[id]?.name ?? "Character" };
}

export default async function CharacterPage({ params }: PageProps<"/characters/[id]">) {
  const { id } = await params;
  const npc = NPCS[id];
  if (!npc) notFound();
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  const state = await game.getPlayerState(player.playerId);
  // Same payload as GET /api/v1/characters/:id.
  const d = dossierView(state, id);
  const world = getWorld(npc.worldId);
  const history = d.history;

  return (
    <main className="flex-1 flex flex-col">
      <TopBar playerName={state.displayName} right={<Link href="/world" className="btn btn-quiet px-2 py-1 text-xs">← Map</Link>} />
      <div className="px-4 sm:px-6 py-8 max-w-4xl w-full mx-auto fade-up">
        <div className="flex items-center gap-6">
          <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} size={96} />
          <div>
            <p className="eyebrow" style={{ color: world?.accent }}>
              {world?.name}
            </p>
            <h1 className="font-display text-4xl mt-1">{npc.name}</h1>
            <p className="text-paper-3">
              {npc.role}, {npc.organisation}
            </p>
          </div>
        </div>

        <div className="mt-8 grid md:grid-cols-[1fr_280px] gap-6">
          <div className="space-y-6">
            {d.arc && <section className="card p-5 border-brass/30">
              <p className="eyebrow text-brass">{d.arc.stage.replace(/_/g, " ")}</p>
              <p className="text-paper-2 mt-2 leading-relaxed">{d.arc.context}</p>
              {d.arc.favors.map((favor) => <p key={favor} className="text-sm text-paper-2 mt-3">{favor}</p>)}
              {d.arc.disappointments.length > 0 && <details className="mt-3 text-sm"><summary className="text-paper-3 cursor-pointer">What still needs repairing</summary>{d.arc.disappointments.map((line, i) => <p key={i} className="mt-2 text-paper-2">{line}</p>)}</details>}
            </section>}
            <section className="card p-5">
              <p className="eyebrow mb-2">Public dossier</p>
              <p className="text-paper-2 leading-relaxed">{npc.publicDossier}</p>
            </section>

            <section className="card p-5">
              <p className="eyebrow mb-2">What {npc.shortName} remembers about you</p>
              {!d.met ? (
                <p className="text-sm text-paper-3">You haven&apos;t met yet.</p>
              ) : (
                <div className="space-y-4">
                  {d.lastInteractionSummary && <p className="text-paper italic leading-relaxed">“{d.lastInteractionSummary}”</p>}
                  {d.remembers.length > 0 && (
                    <ul className="space-y-1.5 text-sm text-paper-2">
                      {d.remembers.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-brass">—</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.impressions.length > 0 && (
                    <div>
                      <p className="eyebrow mb-1.5">Impressions</p>
                      <ul className="flex flex-wrap gap-2">
                        {d.impressions.map((b, i) => (
                          <li key={i} className={`text-xs px-3 py-1.5 rounded-full border ${b.valence >= 0.2 ? "border-success/40 text-success" : b.valence <= -0.2 ? "border-warn/40 text-warn" : "border-line text-paper-2"}`}>
                            {b.statement}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {d.openCommitments.length > 0 && (
                    <div>
                      <p className="eyebrow mb-1.5">Open commitments</p>
                      <ul className="text-sm text-paper-2 space-y-1">
                        {d.openCommitments.map((c, i) => (
                          <li key={i}>
                            <span className="text-paper-3">{c.by === "player" ? "You" : npc.shortName}:</span> {c.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            {history.length > 0 && (
              <section className="card p-5">
                <p className="eyebrow mb-2">History</p>
                <ol className="space-y-2 text-sm">
                  {history.map((h) => (
                    <li key={h.attemptId} className="flex justify-between gap-3">
                      <Link href={`/results/${h.attemptId}`} className="text-paper hover:text-brass-2">
                        {h.questTitle}
                      </Link>
                      <span className="text-paper-3">{h.outcomeLabel}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <aside className="card p-5 h-fit">
            <p className="eyebrow mb-3">Standing</p>
            <p className="font-display text-2xl">{d.relationshipLabel}</p>
            {d.relationship && (
              <ul className="mt-4 space-y-3">
                {(["trust", "respect", "warmth", "familiarity"] as const).map((k) => {
                  const v = d.relationship![k];
                  const pct = k === "familiarity" ? v : 50 + v / 2;
                  return (
                    <li key={k}>
                      <div className="flex justify-between text-xs text-paper-3 capitalize">
                        <span>{k}</span>
                        <span>{Math.round(v)}</span>
                      </div>
                      <div className="mt-1 h-[3px] bg-ink-4 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: v >= 0 ? "var(--brass)" : "var(--warn)" }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-xs text-paper-3">Met {d.timesMet} time{d.timesMet === 1 ? "" : "s"}.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
