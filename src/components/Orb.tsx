/** The NPC's abstract presence. Hue comes from the character; state from the voice session. */
export function Orb({ hue, initials, state = "idle", size = 160 }: { hue: number; initials: string; state?: "idle" | "listening" | "thinking" | "speaking" | "done" | "error"; size?: number }) {
  return (
    <div
      className="orb flex items-center justify-center select-none"
      data-state={state === "done" || state === "error" ? "idle" : state}
      style={{ width: size, height: size, ["--orb-h" as string]: hue }}
      aria-hidden
    >
      <span className="font-display text-paper/80" style={{ fontSize: size * 0.22, letterSpacing: "0.05em" }}>
        {initials}
      </span>
    </div>
  );
}
