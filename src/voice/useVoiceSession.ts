"use client";
/**
 * Turn-taking state machine for a spoken scene.
 *
 *   idle ──(hold/tap mic)──▶ listening ──(release/stop)──▶ thinking ──▶ speaking ──▶ idle
 *                                                                        │
 *                               (barge-in: mic pressed while speaking) ◀─┘
 *
 * NPC speech streams in as text; we speak it sentence by sentence so audio
 * starts before generation finishes. Audio providers are injected; the hook
 * never touches the network — the caller supplies `sendTurn`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserSpeechRecognizer, BrowserSpeechSynthesizer, NullSpeechSynthesizer } from "./browser";
import type { SpeechRecognizer, SpeechSynthesizer, VoiceProfile, VoiceState } from "./types";

export interface UseVoiceSessionOptions {
  profile: VoiceProfile;
  /** Sends the player's text; must call `onSpeech` with the growing NPC speech and `done` when finished. */
  sendTurn: (text: string, modality: "voice" | "text", onSpeech: (speechSoFar: string, done: boolean) => void) => Promise<void>;
  /** Text-only mode: no TTS, no mic. */
  textOnly?: boolean;
  recognizer?: SpeechRecognizer;
  synthesizer?: SpeechSynthesizer;
}

export interface VoiceSessionApi {
  state: VoiceState;
  interim: string;
  error: string | null;
  micAvailable: boolean;
  ttsAvailable: boolean;
  startListening: () => void;
  stopListening: () => void;
  cancelSpeaking: () => void;
  sendText: (text: string) => Promise<void>;
  /** Speak an arbitrary NPC line (e.g. the opening) without a player turn. */
  speakLine: (text: string) => Promise<void>;
  setTextOnly: (v: boolean) => void;
  textOnly: boolean;
}

const SENTENCE_RE = /[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g;

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionApi {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [textOnly, setTextOnly] = useState(!!opts.textOnly);

  const recognizer = useMemo(() => opts.recognizer ?? (typeof window !== "undefined" ? new BrowserSpeechRecognizer() : null), [opts.recognizer]);
  const synth = useMemo<SpeechSynthesizer>(() => {
    if (opts.synthesizer) return opts.synthesizer;
    if (typeof window === "undefined") return new NullSpeechSynthesizer();
    return new BrowserSpeechSynthesizer();
  }, [opts.synthesizer]);

  const stateRef = useRef<VoiceState>("idle");
  const setS = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);
  const textOnlyRef = useRef(textOnly);
  const sendTurnRef = useRef(opts.sendTurn);
  const profileRef = useRef(opts.profile);
  useEffect(() => {
    textOnlyRef.current = textOnly;
    sendTurnRef.current = opts.sendTurn;
    profileRef.current = opts.profile;
  }, [textOnly, opts.sendTurn, opts.profile]);

  // ---- speaking queue (sentence-chunked)
  const queueRef = useRef<string[]>([]);
  const spokenUpToRef = useRef(0);
  const speakingRef = useRef(false);
  const generationRef = useRef(0); // increments on cancel so stale chunks are dropped

  const drainQueue = useCallback(
    async (gen: number) => {
      if (speakingRef.current) return;
      speakingRef.current = true;
      while (queueRef.current.length && gen === generationRef.current) {
        const chunk = queueRef.current.shift()!;
        if (stateRef.current !== "speaking") setS("speaking");
        await synth.speak(chunk, profileRef.current);
      }
      speakingRef.current = false;
    },
    [synth, setS],
  );

  const enqueueSpeech = useCallback(
    (speechSoFar: string, done: boolean, gen: number) => {
      if (textOnlyRef.current || !synth.available) return;
      const unread = speechSoFar.slice(spokenUpToRef.current);
      const sentences = unread.match(SENTENCE_RE) ?? [];
      // Only speak complete sentences unless generation is done.
      const complete = done ? sentences : sentences.filter((s) => /[.!?…]["')\]]*\s*$/.test(s));
      for (const s of complete) {
        queueRef.current.push(s.trim());
        spokenUpToRef.current += s.length;
      }
      if (queueRef.current.length) void drainQueue(gen);
    },
    [synth, drainQueue],
  );

  const cancelSpeaking = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    synth.cancel();
    speakingRef.current = false;
    if (stateRef.current === "speaking") setS("idle");
  }, [synth, setS]);

  const runTurn = useCallback(
    async (text: string, modality: "voice" | "text") => {
      cancelSpeaking();
      const gen = generationRef.current;
      spokenUpToRef.current = 0;
      setS("thinking");
      setError(null);
      try {
        await sendTurnRef.current(text, modality, (speechSoFar, done) => {
          if (gen !== generationRef.current) return;
          enqueueSpeech(speechSoFar, done, gen);
        });
        // Wait for audio to finish.
        while ((speakingRef.current || queueRef.current.length) && gen === generationRef.current) {
          await new Promise((r) => setTimeout(r, 80));
        }
        if (gen === generationRef.current) setS("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setS("error");
      }
    },
    [cancelSpeaking, enqueueSpeech, setS],
  );

  // ---- listening
  const startListening = useCallback(() => {
    if (!recognizer?.available) {
      setError("Voice input isn't available here. Use text instead.");
      return;
    }
    if (stateRef.current === "thinking") return;
    cancelSpeaking(); // barge-in
    synth.prime();
    setInterim("");
    setError(null);
    setS("listening");
    recognizer.start(
      {
        onInterim: (t) => setInterim(t),
        onFinal: (t) => {
          setInterim("");
          if (stateRef.current !== "listening") return;
          if (t.trim()) void runTurn(t.trim(), "voice");
          else setS("idle");
        },
        onError: (msg, fatal) => {
          setError(msg);
          if (fatal) setS("error");
        },
        onEnd: () => {
          if (stateRef.current === "listening") setS("idle");
        },
      },
      { lang: "en-IN" },
    );
  }, [recognizer, synth, cancelSpeaking, runTurn, setS]);

  const stopListening = useCallback(() => {
    recognizer?.stop();
  }, [recognizer]);

  const sendText = useCallback((text: string) => runTurn(text, "text"), [runTurn]);

  const speakLine = useCallback(
    async (text: string) => {
      if (textOnlyRef.current || !synth.available) return;
      cancelSpeaking();
      const gen = generationRef.current;
      spokenUpToRef.current = 0;
      enqueueSpeech(text, true, gen);
      while ((speakingRef.current || queueRef.current.length) && gen === generationRef.current) await new Promise((r) => setTimeout(r, 80));
      if (gen === generationRef.current && stateRef.current === "speaking") setS("idle");
    },
    [synth, cancelSpeaking, enqueueSpeech, setS],
  );

  useEffect(() => () => cancelSpeaking(), [cancelSpeaking]);

  return {
    state,
    interim,
    error,
    micAvailable: !!recognizer?.available,
    ttsAvailable: synth.available,
    startListening,
    stopListening,
    cancelSpeaking,
    sendText,
    speakLine,
    setTextOnly,
    textOnly,
  };
}
