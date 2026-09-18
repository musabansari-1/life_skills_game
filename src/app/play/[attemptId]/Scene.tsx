"use client";

/**
 * The scene: a spoken conversation with a persistent character.
 * Not a chat window. The NPC's presence is central; captions show what they
 * said; the player's main control is the mic (text is the fallback).
 *
 * Game feel: the NPC's mood is visible and reacts; offer changes flash; a turn
 * meter shows how much conversation is left; wrapping up shows real progress.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Orb } from "@/components/Orb";
import { useVoiceSession } from "@/voice/useVoiceSession";
import { createBrowserVoiceProviders, NullSpeechSynthesizer } from "@/voice/browser";
import type { VoiceProfile } from "@/voice/types";
import type { ClientAttempt } from "@/contracts/api";
import { createGameClient, GameApiError } from "@/client/gameClient";

interface SceneProps {
  initial: ClientAttempt;
  quest: { id: string; title: string; objective: string; locationName: string; minTurns: number };
  npc: { id: string; name: string; shortName: string; role: string; organisation: string; appearance: { hue: number; initials: string }; voice: VoiceProfile };
  playerName: string;
  initialMode: "voice" | "text";
  chapter?: { index: number; total: number } | null;
}

const noopSubscribe = () => () => {};

const MOOD: Record<ClientAttempt["mood"], { text: string; tone: string }> = {
  warm: { text: "is warming to you", tone: "text-success" },
  neutral: { text: "is listening", tone: "text-paper-2" },
  guarded: { text: "is getting guarded", tone: "text-brass-2" },
  defensive: { text: "is losing patience", tone: "text-warn" },
  done: { text: "has wrapped up", tone: "text-paper-3" },
};

const CONCLUDE_STEPS: { stage: string; label: (npc: string) => string }[] = [
  { stage: "reviewing", label: () => "Replaying the conversation" },
  { stage: "remembering", label: (npc) => `${npc} is making notes about you` },
  { stage: "evaluated", label: () => "Weighing your moves" },
  { stage: "applying", label: () => "Updating your world" },
];

export function Scene({ initial, quest, npc, playerName, initialMode, chapter }: SceneProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<ClientAttempt>(initial);
  const [caption, setCaption] = useState<string>(initial.turns.filter((t) => t.speaker === "npc").at(-1)?.text ?? "");
  const [began, setBegan] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [text, setText] = useState("");
  const [showType, setShowType] = useState(initialMode === "text");
  const [concluding, setConcluding] = useState(false);
  const [concludeStages, setConcludeStages] = useState<string[]>([]);
  const [concludeStart, setConcludeStart] = useState(0);
  const [now, setNow] = useState(0);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, string>>({}); // label -> previous value
  const [moodPulse, setMoodPulse] = useState(0);
  const captionRef = useRef<HTMLParagraphElement>(null);

  const api = useMemo(() => createGameClient({ baseUrl: "" }), []);
  const turnsRef = useRef(initial.turns.length);
  useEffect(() => {
    turnsRef.current = attempt.turns.filter((t) => !t.id.startsWith("tmp_")).length;
  }, [attempt.turns]);

  /** Apply a new server attempt: flash changed status values and mood shifts. */
  const applyAttempt = useCallback((next: ClientAttempt) => {
    setAttempt((prev) => {
      const prevVals = new Map(prev.visibleStatus.map((s) => [s.label, s.value]));
      const diffs: Record<string, string> = {};
      for (const s of next.visibleStatus) {
        const before = prevVals.get(s.label);
        if (before !== s.value) diffs[s.label] = before ?? "—";
      }
      if (Object.keys(diffs).length) setChanged(diffs);
      if (prev.mood !== next.mood) setMoodPulse((n) => n + 1);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!Object.keys(changed).length) return;
    const t = setTimeout(() => setChanged({}), 4000);
    return () => clearTimeout(t);
  }, [changed]);

  const sendTurn = useCallback(
    async (playerText: string, modality: "voice" | "text", onSpeech: (s: string, done: boolean) => void) => {
      setNetError(null);
      const expectedTurnCount = turnsRef.current;
      setAttempt((a) => ({ ...a, turns: [...a.turns, { id: `tmp_${Date.now()}`, index: a.turns.length, speaker: "player", text: playerText }] }));
      setCaption("");
      try {
        const next = await api.streamTurn(
          attempt.id,
          { text: playerText, modality, expectedTurnCount },
          {
            onSpeech: (t, done) => {
              setCaption(t);
              onSpeech(t, done);
            },
          },
        );
        applyAttempt(next);
        const last = next.turns.filter((t) => t.speaker === "npc").at(-1);
        if (last) {
          setCaption(last.text);
          onSpeech(last.text, true);
        }
      } catch (err) {
        setAttempt((a) => ({ ...a, turns: a.turns.filter((t) => !t.id.startsWith("tmp_")) }));
        if (err instanceof GameApiError && err.code === "conflict") {
          const fresh = await api.attempt(attempt.id).catch(() => null);
          if (fresh) {
            applyAttempt(fresh.attempt);
            setCaption(fresh.attempt.turns.filter((t) => t.speaker === "npc").at(-1)?.text ?? "");
          }
        }
        throw err;
      }
    },
    [api, attempt.id, applyAttempt],
  );

  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const voiceProviders = useMemo(() => (isClient ? createBrowserVoiceProviders() : { recognizer: null, synthesizer: new NullSpeechSynthesizer() }), [isClient]);
  const endedRef = useRef(false);
  const shouldAutoListen = useCallback(() => !endedRef.current, []);
  const voice = useVoiceSession({ profile: npc.voice, sendTurn, textOnly: initialMode === "text", shouldAutoListen, ...voiceProviders });

  const ended = !!attempt.ended || attempt.status !== "active";
  useEffect(() => {
    endedRef.current = ended;
    if (ended && voice.state === "listening") voice.stopListening();
  }, [ended, voice]);
  const busy = voice.state === "thinking";
  const playerTurns = attempt.turns.filter((t) => t.speaker === "player").length;
  const canConclude = playerTurns > 0 && !busy && !concluding;
  const turnsLeft = Math.max(0, attempt.maxTurns - attempt.turnCount);

  const begin = () => {
    setBegan(true);
    const opening = attempt.turns.find((t) => t.speaker === "npc")?.text;
    if (opening && !voice.textOnly) void voice.speakLine(opening);
  };

  // Space bar = talk (when not typing).
  useEffect(() => {
    if (!began || voice.textOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== "Space" || tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (e.repeat) return;
      if (voice.state === "listening") voice.stopListening();
      else if (!ended && !busy) voice.startListening();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [began, voice, ended, busy]);

  const [captionOverflows, setCaptionOverflows] = useState(false);
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    setCaptionOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [caption]);

  useEffect(() => {
    if (!concluding) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [concluding]);

  async function conclude() {
    setConcluding(true);
    setConcludeStages([]);
    setConcludeStart(Date.now());
    setNow(Date.now());
    voice.cancelSpeaking();
    if (voice.state === "listening") voice.stopListening();
    try {
      await api.concludeWithProgress(attempt.id, (stage) => setConcludeStages((s) => (s.includes(stage) ? s : [...s, stage])));
      router.push(`/results/${attempt.id}`);
    } catch (err) {
      // A conflict means another request is already finishing it: the results page waits for that one.
      if (err instanceof GameApiError && err.code === "conflict") {
        router.push(`/results/${attempt.id}`);
        return;
      }
      setNetError(err instanceof Error ? err.message : "Couldn't wrap up.");
      setConcluding(false);
    }
  }

  async function leave() {
    voice.cancelSpeaking();
    await api.abandon(attempt.id).catch(() => {});
    router.push("/world");
  }

  const submitText = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || ended) return;
    setText("");
    await voice.sendText(t);
  };

  const orbState = useMemo<"idle" | "listening" | "thinking" | "speaking">(() => {
    if (voice.state === "listening") return "listening";
    if (voice.state === "thinking") return "thinking";
    if (voice.state === "speaking") return "speaking";
    return "idle";
  }, [voice.state]);

  const micLabel = ended
    ? ""
    : voice.state === "listening"
      ? "Listening… pause when you're done"
      : voice.state === "speaking"
        ? `${npc.shortName} is speaking. Tap to interrupt`
        : voice.state === "thinking"
          ? `${npc.shortName} is thinking…`
          : playerTurns === 0
            ? "Tap and talk"
            : "Tap to reply";

  const mood = MOOD[attempt.mood];
  const elapsed = concluding ? Math.max(0, Math.round((now - concludeStart) / 1000)) : 0;

  return (
    <main className="fixed inset-0 flex flex-col bg-ink-0">
      <div
        className="absolute inset-0 pointer-events-none transition-[background] duration-[1500ms]"
        style={{ background: `radial-gradient(ellipse 70% 50% at 50% 35%, hsl(${npc.appearance.hue} 40% ${attempt.mood === "warm" ? 26 : attempt.mood === "defensive" ? 16 : 22}% / 0.4), transparent 70%)` }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-line">
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate hidden sm:block">
            {chapter ? `Chapter ${chapter.index} of ${chapter.total} · ` : ""}
            {quest.locationName}
          </p>
          <p className="text-sm text-paper truncate">
            {quest.title}
            {attempt.mode === "rehearsal" && <span className="ml-2 text-[10px] tracking-widest uppercase text-brass">Rehearsal</span>}
            {attempt.mode === "second_chance" && <span className="ml-2 text-[10px] tracking-widest uppercase text-brass">Second chance</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="btn btn-quiet px-2 py-1 text-xs">
            <span className="hidden sm:inline">Transcript</span>
            <span className="sm:hidden">Log</span>
          </button>
          <button type="button" onClick={() => setLeaveConfirm(true)} className="btn btn-quiet px-2 py-1 text-xs">
            Leave
          </button>
          {!ended && (
            <button type="button" onClick={conclude} disabled={!canConclude} className="btn btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">
              Wrap up
            </button>
          )}
        </div>
      </header>
      {/* Turn meter: how much conversation is left */}
      <div className="relative z-10 h-[2px] bg-ink-2" aria-hidden>
        <div className="h-full bg-brass/60 transition-all duration-700" style={{ width: `${Math.min(100, (attempt.turnCount / attempt.maxTurns) * 100)}%` }} />
      </div>

      {/* Stage */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 gap-5 min-h-0">
        <div className="flex flex-col items-center gap-3">
          <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} state={ended ? "idle" : orbState} size={132} />
          <div className="text-center">
            <p className="font-display text-2xl">{npc.name}</p>
            <p className="text-xs text-paper-3">
              {npc.role}, {npc.organisation}
            </p>
            <p key={moodPulse} className={`text-xs mt-1.5 min-h-[1rem] fade-up ${voice.state === "thinking" ? "text-paper-2" : mood.tone}`}>
              {voice.state === "thinking" ? `${npc.shortName} is thinking…` : `${npc.shortName} ${ended ? MOOD.done.text : mood.text}`}
            </p>
          </div>
        </div>

        <p ref={captionRef} className={`font-display text-[1.35rem] leading-snug sm:text-2xl text-center max-w-2xl sm:leading-relaxed text-paper min-h-[3.2rem] max-h-[10.5rem] sm:max-h-[12.5rem] overflow-y-auto scrollbar-thin px-1 ${captionOverflows ? "[mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]" : ""}`}>
          {caption || (voice.state === "thinking" ? <span className="text-paper-3">…</span> : "")}
        </p>

        {attempt.visibleStatus.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {attempt.visibleStatus.map((s) => {
              const prev = changed[s.label];
              return (
                <span
                  key={s.label + s.value}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${prev !== undefined ? "border-brass bg-brass-dim text-paper fade-up" : "border-line bg-ink-1/60 text-paper-2"}`}
                >
                  {s.label}: <span className="text-brass-2 font-medium">{s.value}</span>
                  {prev !== undefined && prev !== "—" && <span className="ml-1.5 text-paper-3 line-through">{prev}</span>}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* Controls */}
      <footer className="relative z-10 px-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 border-t border-line bg-ink-0/85 backdrop-blur">
        {(voice.error || netError) && (
          <p role="alert" className="text-center text-sm text-warn mb-2">
            {netError ?? voice.error}
          </p>
        )}

        {ended ? (
          <div className="max-w-md mx-auto text-center py-1 fade-up">
            <p className="text-sm text-paper-2">{attempt.ended?.reason ?? "The conversation is over."}</p>
            <button type="button" onClick={conclude} disabled={concluding} className="btn btn-primary mt-3 w-full sm:w-auto">
              See how it went
            </button>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto flex flex-col items-center gap-2">
            {voice.state === "listening" && <p className="text-center text-sm text-paper-2 min-h-[1.25rem] italic px-2">{voice.interim || "Go ahead."}</p>}
            {!voice.textOnly && (
              <>
                <button
                  type="button"
                  onClick={() => (voice.state === "listening" ? voice.stopListening() : voice.startListening())}
                  disabled={busy || !voice.micAvailable}
                  aria-pressed={voice.state === "listening"}
                  aria-label={micLabel}
                  className={`relative w-[72px] h-[72px] rounded-full border transition-all flex items-center justify-center ${
                    voice.state === "listening" ? "bg-brass text-ink-0 border-brass scale-105 shadow-[0_0_0_8px_var(--brass-dim)]" : "bg-ink-2 border-line-strong text-paper hover:border-brass"
                  } disabled:opacity-40`}
                >
                  {voice.state === "listening" ? (
                    <span className="wave flex items-end h-6">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <MicIcon />
                  )}
                </button>
                <p className="text-xs text-paper-3 min-h-[1rem]">{voice.micAvailable ? micLabel : "Voice isn't available in this browser. Type instead."}</p>
              </>
            )}
            {(showType || voice.textOnly || !voice.micAvailable) && (
              <form onSubmit={submitText} className="w-full flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={`Say something to ${npc.shortName}…`} className="input py-3" />
                <button type="submit" disabled={busy || !text.trim()} className="btn btn-ghost px-4">
                  Say
                </button>
              </form>
            )}
            <div className="w-full flex justify-between items-center text-[11px] text-paper-3">
              {!voice.textOnly && voice.micAvailable ? (
                <button type="button" className="hover:text-paper-2" onClick={() => setShowType((v) => !v)}>
                  {showType ? "Hide keyboard" : "Type instead"}
                </button>
              ) : (
                <span />
              )}
              <span>{turnsLeft <= 2 && turnsLeft > 0 ? `${npc.shortName} has to go soon` : ""}</span>
              {voice.micAvailable && (
                <button type="button" className="hover:text-paper-2" onClick={() => voice.setTextOnly(!voice.textOnly)}>
                  {voice.textOnly ? "Turn voice on" : "Mute voice"}
                </button>
              )}
            </div>
          </div>
        )}
      </footer>

      {/* Transcript drawer */}
      {showTranscript && (
        <aside className="absolute z-20 right-0 top-0 bottom-0 w-full sm:w-[380px] bg-ink-1/95 backdrop-blur border-l border-line p-5 overflow-y-auto scrollbar-thin">
          <div className="flex items-center justify-between mb-4">
            <p className="eyebrow">Transcript</p>
            <button type="button" className="btn btn-quiet px-2 py-1 text-xs" onClick={() => setShowTranscript(false)}>
              Close
            </button>
          </div>
          <ol className="space-y-3">
            {attempt.turns.map((t) => (
              <li key={t.id} className={`text-sm leading-relaxed ${t.speaker === "player" ? "text-paper-2" : "text-paper"}`}>
                <span className="eyebrow block mb-0.5">{t.speaker === "player" ? playerName : npc.shortName}</span>
                {t.text}
              </li>
            ))}
          </ol>
        </aside>
      )}

      {/* Begin overlay (needs a gesture for audio) */}
      {!began && (
        <div className="absolute inset-0 z-30 bg-ink-0/92 backdrop-blur flex items-center justify-center p-6">
          <div className="text-center max-w-md fade-up">
            <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} state="speaking" size={104} />
            <p className="eyebrow mt-6">
              {chapter ? `Chapter ${chapter.index} · ` : ""}
              {quest.locationName}
            </p>
            <h1 className="font-display text-3xl mt-2">{npc.name}</h1>
            <p className="text-paper-3 text-sm">{npc.role}</p>
            <p className="mt-5 text-paper-2 leading-relaxed">{quest.objective}</p>
            {attempt.mode === "rehearsal" && <p className="mt-3 text-xs text-brass-2">Rehearsal: {npc.shortName} is as they were then. Your skills improve; the world keeps what really happened.</p>}
            {attempt.mode === "second_chance" && <p className="mt-3 text-xs text-brass-2">Second chance. {npc.shortName} remembers last time.</p>}
            <button type="button" onClick={begin} className="btn btn-primary mt-8 w-full sm:w-auto">
              {voice.textOnly ? "Begin" : "Pick up"}
            </button>
            <p className="mt-3 text-xs text-paper-3">
              {voice.textOnly ? "Text mode. You can turn voice on any time." : voice.micAvailable ? "Speak naturally. Pause when you're done and it sends." : "Voice isn't supported here; you'll type instead."}
            </p>
          </div>
        </div>
      )}

      {/* Concluding overlay with real progress */}
      {concluding && (
        <div className="absolute inset-0 z-40 bg-ink-0/95 flex items-center justify-center p-6">
          <div className="w-full max-w-sm fade-up">
            <p className="eyebrow text-center">Mission ending</p>
            <p className="font-display text-3xl mt-2 text-center">Reading the room…</p>
            <ul className="mt-8 space-y-3">
              {CONCLUDE_STEPS.map((step, i) => {
                const done = concludeStages.includes(step.stage) || concludeStages.includes("done");
                const active = !done && CONCLUDE_STEPS.slice(0, i).every((p) => concludeStages.includes(p.stage) || p.stage === "remembering");
                return (
                  <li key={step.stage} className={`flex items-center gap-3 text-sm transition-colors ${done ? "text-paper" : active ? "text-paper-2" : "text-paper-3"}`}>
                    <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] shrink-0 ${done ? "bg-brass border-brass text-ink-0" : "border-line-strong"}`}>
                      {done ? "✓" : active ? <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" /> : ""}
                    </span>
                    {step.label(npc.shortName)}
                  </li>
                );
              })}
            </ul>
            <p className="text-center text-xs text-paper-3 mt-8 tabular-nums">
              {elapsed}s{elapsed > 40 ? " · slower AI models can take a minute or two" : ""}
            </p>
          </div>
        </div>
      )}

      {leaveConfirm && (
        <div className="absolute inset-0 z-40 bg-ink-0/80 flex items-center justify-center p-6">
          <div className="card p-6 max-w-sm text-center">
            <p className="font-display text-xl">Walk out?</p>
            <p className="text-sm text-paper-3 mt-2">Nothing you said will be evaluated, and nothing changes in the world.</p>
            <div className="flex gap-2 justify-center mt-5">
              <button type="button" className="btn btn-ghost" onClick={() => setLeaveConfirm(false)}>
                Stay
              </button>
              <button type="button" className="btn btn-primary" onClick={leave}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
