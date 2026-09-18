import type { SkillView } from "@/contracts/api";

export function SkillList({ skills, compact = false }: { skills: SkillView[]; compact?: boolean }) {
  return (
    <ul className={`grid ${compact ? "grid-cols-2 gap-x-4 gap-y-3" : "gap-3"}`}>
      {skills.map((s) => (
        <li key={s.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`${compact ? "text-xs" : "text-sm"} text-paper-2`}>{s.label}</span>
            <span className="font-display text-paper text-sm tabular-nums">
              <span className="text-paper-3 text-[10px] tracking-widest mr-1">LVL</span>
              {s.level}
            </span>
          </div>
          <div className="mt-1.5 h-[3px] rounded-full bg-ink-4 overflow-hidden">
            <div className="h-full rounded-full bg-brass transition-all duration-700" style={{ width: `${Math.max(3, s.progress.pct * 100)}%` }} />
          </div>
          {!compact && s.discovered.length > 0 && (
            <p className="mt-1.5 text-[11px] text-paper-3">
              {s.discovered.map((d) => d.label).join(" · ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
