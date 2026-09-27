"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorldCard } from "@/contracts/api";

/**
 * The world map: an abstract, slowly drifting chart of districts. Open worlds
 * show quest markers; locked worlds are fogged. Selecting a world reveals its
 * quests in a side panel (or below on mobile).
 */
export function WorldMap({ worlds, initialWorldId, currentQuestId = null }: { worlds: WorldCard[]; initialWorldId?: string; currentQuestId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string>(initialWorldId ?? worlds.find((w) => w.availableCount > 0)?.id ?? worlds[0]?.id);
  const selected = worlds.find((w) => w.id === selectedId) ?? worlds[0];

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 min-w-0">
      <div className="card relative overflow-hidden aspect-[4/3] sm:aspect-[16/10] sm:min-h-[320px] min-w-0 w-full">
        <svg viewBox="0 0 100 62" className="absolute inset-0 w-full h-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="grid" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(236,230,218,0.05)" strokeWidth="0.15" />
            </pattern>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="rgba(201,166,107,0.25)" />
              <stop offset="100%" stopColor="rgba(201,166,107,0)" />
            </radialGradient>
          </defs>
          <rect width="100" height="62" fill="url(#grid)" />
          {/* Roads between open worlds */}
          {worlds
            .filter((w) => w.status === "open")
            .flatMap((a, i, arr) => arr.slice(i + 1).map((b) => <line key={a.id + b.id} x1={a.map.x} y1={a.map.y * 0.62} x2={b.map.x} y2={b.map.y * 0.62} stroke="rgba(236,230,218,0.12)" strokeWidth="0.25" strokeDasharray="1 1.2" />))}
          {worlds.map((w) => (
            <circle key={w.id} cx={w.map.x} cy={w.map.y * 0.62} r={w.map.size === "lg" ? 12 : w.map.size === "md" ? 9 : 7} fill={w.id === selectedId ? "url(#glow)" : "transparent"} />
          ))}
        </svg>

        {worlds.map((w) => {
          const locked = w.status === "locked";
          const active = w.id === selectedId;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedId(w.id)}
              className={`map-marker absolute -translate-x-1/2 -translate-y-1/2 text-left group ${locked ? "opacity-60" : ""}`}
              style={{ left: `${w.map.x}%`, top: `${w.map.y}%` }}
              aria-pressed={active}
            >
              <span className="relative block">
                <span
                  className="block rounded-full border transition-all"
                  style={{
                    width: w.map.size === "lg" ? 22 : w.map.size === "md" ? 16 : 12,
                    height: w.map.size === "lg" ? 22 : w.map.size === "md" ? 16 : 12,
                    background: locked ? "transparent" : w.accent,
                    borderColor: locked ? "rgba(236,230,218,0.35)" : w.accent,
                    boxShadow: active && !locked ? `0 0 0 6px ${w.accent}33` : "none",
                    borderStyle: locked ? "dashed" : "solid",
                  }}
                />
                {w.availableCount > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brass ring-2 ring-ink-1" />}
              </span>
              <span className={`mt-2 block whitespace-nowrap text-[10px] sm:text-xs tracking-wide ${w.map.x > 75 ? "-translate-x-1/3" : ""} ${active ? "text-paper" : "text-paper-2"} ${locked ? "italic" : ""}`}>
                {w.name}
                {locked && <span className="text-paper-3 not-italic"> · locked</span>}
              </span>
            </button>
          );
        })}
      </div>

      <aside className="card p-5 flex flex-col gap-4 min-h-[260px]">
        {selected && (
          <>
            <div>
              <p className="eyebrow" style={{ color: selected.accent }}>
                {selected.status === "locked" ? "Locked district" : "District"}
              </p>
              <h2 className="font-display text-2xl mt-1">{selected.name}</h2>
              <p className="text-paper-2 text-sm mt-1 italic">{selected.tagline}</p>
              <p className="text-paper-3 text-sm mt-3 leading-relaxed">{selected.description}</p>
            </div>
            {selected.status === "locked" ? (
              <p className="text-sm text-paper-3 border-t border-line pt-4">Opens in a later season. The people here will have heard about you by then.</p>
            ) : (
              <DistrictQuests quests={selected.quests} currentQuestId={currentQuestId} />
            )}
          </>
        )}
      </aside>
    </div>
  );
}

type Quest = WorldCard["quests"][number];
const KIND_LABEL: Record<NonNullable<Quest["kind"]>, string> = { main: "Chapter", boss: "Boss", recovery: "Repair", event: "Event", optional: "Optional" };

/** Now → waiting → behind you → later. Finished and locked chapters fold away so the list reads like a story, not a dashboard. */
function DistrictQuests({ quests, currentQuestId }: { quests: Quest[]; currentQuestId: string | null }) {
  if (quests.length === 0) return <p className="text-sm text-paper-3 border-t border-line pt-4">Nothing here yet.</p>;
  const now = quests.filter((q) => q.id === currentQuestId && q.availability === "available");
  const waiting = quests.filter((q) => q.availability === "available" && q.id !== currentQuestId);
  const behind = quests.filter((q) => q.availability === "replayable" || q.availability === "completed");
  const later = quests.filter((q) => q.availability === "locked");
  return (
    <div className="border-t border-line pt-4 space-y-4">
      {now.length > 0 && <Group label="Now" quests={now} highlight />}
      {waiting.length > 0 && <Group label={now.length ? "Also waiting" : "Waiting for you"} quests={waiting} />}
      {behind.length > 0 && (
        <details>
          <summary className="eyebrow cursor-pointer">Behind you · {behind.length}</summary>
          <p className="text-xs text-paper-3 mt-2">Replaying is practice: your skills improve, the story keeps what happened.</p>
          <div className="mt-2"><Group quests={behind} /></div>
        </details>
      )}
      {later.length > 0 && <p className="text-xs text-paper-3">{later.length} more {later.length === 1 ? "chapter" : "chapters"} later in the season.</p>}
    </div>
  );
}

function Group({ label, quests, highlight = false }: { label?: string; quests: Quest[]; highlight?: boolean }) {
  return (
    <div>
      {label && <p className={`eyebrow mb-1 ${highlight ? "text-brass" : ""}`}>{label}</p>}
      <ul className="space-y-1">
        {quests.map((q) => {
          const kind = q.kind ?? "optional";
          const done = q.availability === "replayable" || q.availability === "completed";
          return (
            <li key={q.id}>
              <Link href={`/quests/${q.id}`} className="flex items-start gap-3 rounded-xl p-2.5 -mx-2.5 transition hover:bg-white/5">
                <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: done ? "var(--paper-3)" : kind === "recovery" ? "var(--warn)" : "var(--brass)", boxShadow: kind === "boss" && !done ? "0 0 0 3px rgba(201,166,107,0.25)" : "none" }} />
                <span className="min-w-0">
                  <span className="text-sm text-paper flex items-center gap-2 flex-wrap">
                    <span>{q.title}</span>
                    {!done && kind !== "main" && <span className={`text-[10px] tracking-widest uppercase ${kind === "boss" ? "text-brass" : kind === "recovery" ? "text-warn" : "text-paper-3"}`}>{KIND_LABEL[kind]}</span>}
                  </span>
                  <span className="block text-xs text-paper-3 mt-0.5">{q.npcName} · {q.locationName}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
