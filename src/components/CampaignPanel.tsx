import Link from "next/link";
import type { WorldOverview } from "@/contracts/api";

type Campaign = NonNullable<WorldOverview["campaign"]>;
type Advanced = NonNullable<WorldOverview["advancedCampaign"]>;

/** The season at a glance: six acts, each a row of chapter pips. */
export function ActTrack({ campaign }: { campaign: Campaign }) {
  const acts = campaign.acts ?? [];
  return (
    <ol className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-4" aria-label="Season acts">
      {acts.map((a, i) => {
        const chapters = campaign.chapters.filter((c) => c.actId === a.id);
        return (
          <li key={a.id} className="min-w-0">
            <div className="flex gap-1" aria-hidden>
              {chapters.map((c) => <span key={c.questId} className={`h-1 flex-1 rounded-full ${c.state === "done" ? "bg-brass" : c.state === "current" ? "bg-brass/45" : "bg-ink-4"}`} />)}
            </div>
            <p className={`mt-1.5 text-[11px] leading-tight ${a.state === "current" ? "text-paper" : a.state === "done" ? "text-paper-2" : "text-paper-3"}`}>
              <span className="text-paper-3">{toRoman(i + 1)} · </span>{a.title}
            </p>
            <p className="sr-only">{a.completed} of {a.total} chapters, {a.state}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** Setbacks and how word travels: the consequences the player should be able to trace. */
export function ConsequencesCard({ campaign }: { campaign: Advanced }) {
  const open = campaign.setbacks.filter((f) => !f.recovered && f.recoveryQuestId);
  const history = campaign.setbacks.slice(-4);
  if (!history.length && !campaign.communications.length) return null;
  return (
    <div className="card p-5 space-y-5">
      {!!history.length && (
        <div>
          <p className="eyebrow mb-3">Setbacks and repairs</p>
          <ul className="space-y-3">
            {history.map((f) => (
              <li key={f.id} className="text-sm">
                <Link href={`/results/${f.sourceAttemptId}`} className="text-paper-2 hover:text-brass">{f.summary}</Link>
                <p className="text-xs text-paper-3 mt-1">{f.recovered ? "Repaired. The original moment is still part of your story." : f.recoveryQuestId ? "Still open. A separate conversation could repair what happens next." : "Part of your story now."}</p>
                {!f.recovered && f.recoveryQuestId && open.some((o) => o.id === f.id) && <Link className="inline-block text-brass text-sm mt-1" href={`/quests/${f.recoveryQuestId}`}>Open the recovery conversation →</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!campaign.communications.length && (
        <div>
          <p className="eyebrow mb-3">How word travels</p>
          <ul className="space-y-2">{campaign.communications.map((c) => <li key={c.id} className="text-sm text-paper-2">{c.reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function toRoman(n: number) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n - 1] ?? String(n);
}
