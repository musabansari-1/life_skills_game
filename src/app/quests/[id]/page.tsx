import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NPCS } from "@/content/npcs";
import { findQuest } from "@/content/quests";
import { getLocation, getWorld } from "@/content/worlds";
import { SKILLS } from "@/engine/types/skills";
import { getCurrentPlayer } from "@/server/session";
import { getGame } from "@/server/context";
import { questBriefing } from "@/server/queries";
import { TopBar } from "@/components/TopBar";
import { Orb } from "@/components/Orb";
import { StartQuestButton } from "./StartQuestButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/quests/[id]">) {
  const { id } = await params;
  return { title: findQuest(id)?.title ?? "Quest" };
}

export default async function QuestBriefingPage({ params, searchParams }: PageProps<"/quests/[id]">) {
  const { id } = await params;
  const first = (await searchParams).first === "1";
  const quest = findQuest(id);
  if (!quest) notFound();
  const { db, game } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) redirect("/");
  // Same payload as GET /api/v1/quests/:id.
  const b = await questBriefing(game, player.playerId, quest.id);
  const npc = NPCS[quest.npcId];
  const dossier = b.npc;
  const world = getWorld(quest.worldId);
  const location = getLocation(quest.locationId);

  return (
    <main className="flex-1 flex flex-col">
      <TopBar playerName={player.displayName} right={<Link href="/world" className="btn btn-quiet px-2 py-1 text-xs">← Map</Link>} />
      <div className="px-4 sm:px-6 py-8 max-w-5xl w-full mx-auto grid lg:grid-cols-[1fr_320px] gap-8">
        <article className="fade-up">
          {first && (
            <div className="mb-8 border-l-2 border-brass pl-4 space-y-1.5 text-paper-2">
              <p className="text-paper">This is a world, not a course.</p>
              <p>Every person you meet here remembers what you said, and what you say changes what happens next.</p>
              <p>You talk out loud. Pause when you&apos;re done, and they answer.</p>
            </div>
          )}
          <p className="eyebrow" style={{ color: world?.accent }}>
            {b.chapter ? `Chapter ${b.chapter.index} of ${b.chapter.total} · ` : ""}
            {world?.name} · {location?.name}
          </p>
          <h1 className="font-display text-4xl sm:text-5xl mt-2 leading-tight">{quest.title}</h1>
          <p className="text-paper-2 italic mt-2 text-lg">{quest.tagline}</p>

          <div className="mt-8 space-y-6 text-paper-2 leading-relaxed">
            <section>
              <p className="eyebrow mb-2">Situation</p>
              <p>{quest.briefing.situation}</p>
            </section>
            <section>
              <p className="eyebrow mb-2">Your objective</p>
              <p className="text-paper text-lg">{quest.briefing.objective}</p>
            </section>
            {b.carryOver.length > 0 && (
              <section className="rounded-xl border border-brass/30 bg-brass-dim/40 p-4">
                <p className="eyebrow text-brass mb-2">What carries over</p>
                <ul className="space-y-1.5">
                  {b.carryOver.map((line) => (
                    <li key={line} className="flex gap-2 text-paper">
                      <span className="text-brass">↳</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <p className="eyebrow mb-2">What you know</p>
              <ul className="space-y-1.5">
                {quest.briefing.intel.map((i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brass">—</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </section>
            {quest.briefing.hint && (
              <section className="border-l-2 border-brass/50 pl-4">
                <p className="eyebrow mb-1">A thought</p>
                <p className="text-paper-2">{quest.briefing.hint}</p>
              </section>
            )}
            {b.lastOutcomeLabel && (
              <section className="card p-4">
                <p className="eyebrow mb-1">Last time: {b.lastOutcomeLabel}</p>
                <p className="text-sm text-paper-3 mt-1">
                  {b.replayMode === "rehearsal"
                    ? `Replaying is a rehearsal: ${npc.shortName} is as they were then, your skills improve, and the world keeps what really happened. Try a different approach.`
                    : `This is a second chance. ${npc.shortName} remembers the first conversation, and whatever happens now becomes what happened.`}
                </p>
              </section>
            )}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {b.canStart ? (
              <StartQuestButton questId={quest.id} npcName={npc.shortName} replayMode={b.replayMode} />
            ) : (
              <div className="text-sm text-paper-3">
                <p className="text-paper-2">Not yet.</p>
                <ul>
                  {b.unmet.map((u) => (
                    <li key={u}>— {u}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {quest.skills.map((s) => (
                <span key={s} className="text-[11px] tracking-wide uppercase px-2.5 py-1 rounded-full border border-line text-paper-3">
                  {SKILLS[s].label}
                </span>
              ))}
              <span className="text-[11px] tracking-wide uppercase px-2.5 py-1 rounded-full border border-line text-paper-3">Difficulty {"●".repeat(quest.difficulty)}{"○".repeat(5 - quest.difficulty)}</span>
            </div>
          </div>
        </article>

        <aside className="fade-up" style={{ animationDelay: "120ms" }}>
          <div className="card p-5">
            <p className="eyebrow mb-4">Dossier</p>
            <div className="flex items-center gap-4">
              <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} size={64} />
              <div>
                <p className="font-display text-xl">{npc.name}</p>
                <p className="text-sm text-paper-3">
                  {npc.role}, {npc.organisation}
                </p>
              </div>
            </div>
            <p className="text-sm text-paper-2 mt-4 leading-relaxed">{npc.publicDossier}</p>
            <div className="mt-4 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-paper-3">Standing</span>
                <span className="text-paper">{dossier.relationshipLabel}</span>
              </div>
              {dossier.met && dossier.relationship && (
                <ul className="mt-3 space-y-1.5">
                  {(["trust", "respect", "warmth"] as const).map((k) => (
                    <li key={k} className="flex items-center gap-3">
                      <span className="w-16 text-paper-3 capitalize text-xs">{k}</span>
                      <span className="flex-1 h-[3px] bg-ink-4 rounded-full relative overflow-hidden">
                        <span className="absolute top-0 bottom-0 bg-ink-4 left-1/2 w-px" />
                        <span className="absolute top-0 bottom-0 rounded-full" style={{ left: dossier.relationship![k] >= 0 ? "50%" : `${50 + dossier.relationship![k] / 2}%`, width: `${Math.abs(dossier.relationship![k]) / 2}%`, background: dossier.relationship![k] >= 0 ? "var(--success)" : "var(--warn)" }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {dossier.lastInteractionSummary && (
                <p className="mt-4 text-xs text-paper-3 leading-relaxed">
                  <span className="text-paper-2">{npc.shortName} remembers:</span> {dossier.lastInteractionSummary}
                </p>
              )}
            </div>
            <Link href={`/characters/${npc.id}`} className="mt-4 inline-block text-xs text-brass hover:text-brass-2">
              Full dossier →
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
