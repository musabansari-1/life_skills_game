"use client";

/**
 * The scene: a spoken conversation with a persistent character.
 * Not a chat window. The NPC's presence is central; captions show what they
 * said; the player's controls are a mic and (fallback) a text line.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Orb } from "@/components/Orb";
import { useVoiceSession } from "@/voice/useVoiceSession";
import type { VoiceProfile } from "@/voice/types";
import type { ClientAttempt } from "./client-types";

interface SceneProps {
  initial: ClientAttempt;
  quest: { id: string; title: string; objective: string; locationName: string; minTurns: number };
  npc: { id: string; name: string; shortName: string; role: string; organisation: string; appearance: { hue: number; initials: string }; voice: VoiceProfile };
  playerName: string;
  initialMode: "voice" | "text";
}

const MOOD_COPY: Record<ClientAttempt["mood"], string> = {
  warm: "seems warm",
  neutral: "is listening",
  guarded: "seems guarded",
  defensive: "is getting defensive",
  done: "has wrapped up",
};

export function Scene({ initial, quest, npc, playerName, initialMode }: SceneProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<ClientAttempt>(initial);
  const [caption, setCaption] = useState<string>(initial.turns.filter((t) => t.speaker === "npc").at(-1)?.text ?? "");
  const [began, setBegan] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [text, setText] = useState("");
  const [concluding, setConcluding] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);

  const sendTurn = useCallback(
    async (playerText: string, modality: "voice" | "text", onSpeech: (s: string, done: boolean) => void) => {
      setNetError(null);
      // Optimistically show the player's line in the transcript.
      setAttempt((a) => ({ ...a, turns: [...a.turns, { id: `tmp_${Date.now()}`, index: a.turns.length, speaker: "player", text: playerText }] }));
      setCaption("");
      const res = await fetch(`/api/attempts/${attempt.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: playerText, modality }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "The line dropped. Try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalAttempt: ClientAttempt | null = null;
      let errorMsg: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const dataLine = /^data: (.+)$/m.exec(block)?.[1];
          if (!ev || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (ev === "speech") {
            setCaption(data.text);
            onSpeech(data.text, data.done);
          } else if (ev === "result") {
            finalAttempt = data as ClientAttempt;
          } else if (ev === "error") {
            errorMsg = data.error;
          }
        }
      }
      if (errorMsg) {
        // Roll back the optimistic player line.
        setAttempt((a) => ({ ...a, turns: a.turns.filter((t) => !t.id.startsWith("tmp_")) }));
        throw new Error(errorMsg);
      }
      if (finalAttempt) {
        setAttempt(finalAttempt);
        const last = finalAttempt.turns.filter((t) => t.speaker === "npc").at(-1);
        if (last) {
          setCaption(last.text);
          onSpeech(last.text, true);
        }
      }
    },
    [attempt.id],
  );

  const voice = useVoiceSession({ profile: npc.voice, sendTurn, textOnly: initialMode === "text" });
  const ended = !!attempt.ended || attempt.status !== "active";
  const busy = voice.state === "thinking";
  const playerTurns = attempt.turns.filter((t) => t.speaker === "player").length;
  const canConclude = playerTurns > 0 && !busy;

  // Begin: prime audio (needs a gesture) and speak the opening line.
  const begin = () => {
    setBegan(true);
    const opening = attempt.turns.find((t) => t.speaker === "npc")?.text;
    if (opening && !voice.textOnly) void voice.speakLine(opening);
  };

  // Space bar = push to talk (when not typing).
  useEffect(() => {
    if (!began || voice.textOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.repeat) return;
      if (voice.state === "listening") voice.stopListening();
      else if (!ended && !busy) voice.startListening();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [began, voice, ended, busy]);

  useEffect(() => {
    captionRef.current?.scrollTo({ top: captionRef.current.scrollHeight });
  }, [caption]);

  async function conclude() {
    setConcluding(true);
    voice.cancelSpeaking();
    try {
      const res = await fetch(`/api/attempts/${attempt.id}/conclude`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't wrap up.");
      router.push(`/results/${attempt.id}`);
    } catch (err) {
      setNetError(err instanceof Error ? err.message : "Couldn't wrap up.");
      setConcluding(false);
    }
  }

  async function leave() {
    voice.cancelSpeaking();
    await fetch(`/api/attempts/${attempt.id}/abandon`, { method: "POST" }).catch(() => {});
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

  return (
    <main className="fixed inset-0 flex flex-col bg-ink-0">
      {/* Ambient backdrop keyed to the character */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 70% 50% at 50% 35%, hsl(${npc.appearance.hue} 40% 22% / 0.35), transparent 70%)` }} />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-line">
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate hidden sm:block">{quest.locationName}</p>
          <p className="text-sm text-paper truncate">{quest.title}</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="btn btn-quiet px-2 py-1 text-xs">
            <span className="hidden sm:inline">Transcript</span>
            <span className="sm:hidden">Log</span>
          </button>
          <button type="button" onClick={() => setLeaveConfirm(true)} className="btn btn-quiet px-2 py-1 text-xs">
            Leave
          </button>
          <button type="button" onClick={conclude} disabled={!canConclude || concluding} className={`btn ${ended ? "btn-primary" : "btn-ghost"} px-3 py-1.5 text-xs whitespace-nowrap`}>
            {ended ? "See how it went" : "Wrap up"}
          </button>
        </div>
      </header>

      {/* Stage */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 gap-6 min-h-0">
        <div className="flex flex-col items-center gap-3">
          <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} state={ended ? "idle" : orbState} size={148} />
          <div className="text-center">
            <p className="font-display text-2xl">{npc.name}</p>
            <p className="text-xs text-paper-3">
              {npc.role}, {npc.organisation}
            </p>
            <p className="text-xs mt-1 text-paper-2 min-h-[1rem]">
              {ended ? `${npc.shortName} ${MOOD_COPY.done}.` : voice.state === "thinking" ? `${npc.shortName} is thinking…` : voice.state === "listening" ? "Listening to you…" : `${npc.shortName} ${MOOD_COPY[attempt.mood]}.`}
            </p>
          </div>
        </div>

        <p ref={captionRef} className="font-display text-xl sm:text-2xl text-center max-w-2xl leading-relaxed text-paper min-h-[3.5rem] max-h-[9rem] overflow-y-auto scrollbar-thin px-2">
          {caption || (voice.state === "thinking" ? <span className="text-paper-3">…</span> : "")}
        </p>

        {attempt.visibleStatus.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {attempt.visibleStatus.map((s) => (
              <span key={s.label} className="text-xs px-3 py-1.5 rounded-full border border-line bg-ink-1/60 text-paper-2">
                {s.label}: <span className="text-brass-2 font-medium">{s.value}</span>
              </span>
            ))}
          </div>
        )}

        {ended && attempt.ended && (
          <div className="card px-5 py-3 text-center max-w-md">
            <p className="text-sm text-paper-2">{attempt.ended.reason}</p>
          </div>
        )}
      </section>

      {/* Controls */}
      <footer className="relative z-10 px-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 border-t border-line bg-ink-0/80 backdrop-blur">
        {(voice.error || netError) && (
          <p role="alert" className="text-center text-sm text-warn mb-2">
            {netError ?? voice.error}
          </p>
        )}
        {voice.state === "listening" && (
          <p className="text-center text-sm text-paper-2 mb-2 min-h-[1.25rem] italic">{voice.interim || "Go ahead."}</p>
        )}
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {!voice.textOnly && (
            <button
              type="button"
              onClick={() => (voice.state === "listening" ? voice.stopListening() : voice.startListening())}
              disabled={ended || busy || !voice.micAvailable}
              aria-pressed={voice.state === "listening"}
              className={`relative shrink-0 w-16 h-16 rounded-full border transition-all flex items-center justify-center ${
                voice.state === "listening" ? "bg-brass text-ink-0 border-brass scale-105" : "bg-ink-2 border-line-strong text-paper hover:border-brass"
              } disabled:opacity-40`}
              title="Tap to talk (or hold Space)"
            >
              {voice.state === "listening" ? (
                <span className="wave flex items-end h-6">
                  <span /><span /><span /><span /><span />
                </span>
              ) : (
                <MicIcon />
              )}
            </button>
          )}
          <form onSubmit={submitText} className="flex-1 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={ended || busy}
              placeholder={voice.textOnly ? `Say something to ${npc.shortName}…` : "…or type"}
              className="input py-3"
            />
            <button type="submit" disabled={ended || busy || !text.trim()} className="btn btn-ghost px-4">
              Say
            </button>
          </form>
        </div>
        <div className="max-w-2xl mx-auto flex justify-between items-center mt-2 text-[11px] text-paper-3">
          <span>{voice.textOnly ? "Text mode" : voice.micAvailable ? "Tap the mic or hold Space to speak" : "Voice unavailable in this browser"}</span>
          <button type="button" className="hover:text-paper-2" onClick={() => voice.setTextOnly(!voice.textOnly)}>
            {voice.textOnly ? "Switch to voice" : "Switch to text only"}
          </button>
        </div>
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
        <div className="absolute inset-0 z-30 bg-ink-0/90 backdrop-blur flex items-center justify-center p-6">
          <div className="text-center max-w-md fade-up">
            <Orb hue={npc.appearance.hue} initials={npc.appearance.initials} state="speaking" size={110} />
            <p className="eyebrow mt-6">{quest.locationName}</p>
            <h1 className="font-display text-3xl mt-2">{npc.name}</h1>
            <p className="text-paper-3 text-sm">{npc.role}</p>
            <p className="mt-5 text-paper-2 leading-relaxed">{quest.objective}</p>
            <button type="button" onClick={begin} className="btn btn-primary mt-8">
              {voice.textOnly ? "Begin" : "Pick up"}
            </button>
            <p className="mt-3 text-xs text-paper-3">{voice.textOnly ? "You chose text mode." : voice.micAvailable ? "Your browser will ask for the microphone." : "Voice isn't supported here; you'll type instead."}</p>
          </div>
        </div>
      )}

      {/* Concluding overlay */}
      {concluding && (
        <div className="absolute inset-0 z-40 bg-ink-0/95 flex items-center justify-center">
          <div className="text-center fade-up">
            <p className="eyebrow">Mission ending</p>
            <p className="font-display text-3xl mt-2">Reading the room…</p>
            <p className="text-paper-3 text-sm mt-2">Weighing what you said, what {npc.shortName} heard, and what changes.</p>
          </div>
        </div>
      )}

      {leaveConfirm && (
        <div className="absolute inset-0 z-40 bg-ink-0/80 flex items-center justify-center p-6">
          <div className="card p-6 max-w-sm text-center">
            <p className="font-display text-xl">Walk out?</p>
            <p className="text-sm text-paper-3 mt-2">{npc.shortName} won&apos;t forget you left mid-conversation. Nothing you said will be evaluated.</p>
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
