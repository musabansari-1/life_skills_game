"use client";
/**
 * React adapter over the platform-neutral ConversationController.
 *
 * All turn-taking, interruption and delivery logic lives in controller.ts so
 * a React Native client can wrap the same class with native speech providers.
 * This hook only: creates the controller for the injected providers, keeps the
 * callers' callbacks fresh via refs, subscribes React to its snapshot, and
 * pauses the mic when the tab goes to the background.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DeliveryReport } from "@/contracts/api";
import { ConversationController, type ConversationSnapshot } from "./controller";
import type { ConversationTransport, NpcLine, SpeechRecognizer, SpeechSynthesizer, VoiceProfile, VoiceState } from "./types";

export interface UseVoiceSessionOptions {
  profile: VoiceProfile;
  /**
   * Sends the player's text; must call `onSpeech` with the growing NPC speech
   * and `done` when finished, and resolve with the committed NPC line.
   */
  sendTurn: (text: string, modality: "voice" | "text", onSpeech: (speechSoFar: string, done: boolean) => void, interrupted?: DeliveryReport) => Promise<NpcLine | null>;
  /** The player cut a line off and said nothing after it. */
  reportDelivery: (report: DeliveryReport) => Promise<void>;
  /** Text-only mode: no TTS, no mic. */
  textOnly?: boolean;
  /** Speech-to-text provider (null when unavailable on this platform). */
  recognizer: SpeechRecognizer | null;
  /** Text-to-speech provider. */
  synthesizer: SpeechSynthesizer;
  /** Hands-free conversation: after the NPC finishes replying to a spoken turn, listen again if this returns true. */
  shouldAutoListen?: () => boolean;
  /** An NPC line finished playing (or, in text mode, finished showing). */
  onLineDelivered?: (line: NpcLine) => void;
  /** Let the player cut in just by talking while the NPC speaks (default true). */
  voiceBargeIn?: boolean;
}

export interface VoiceSessionApi extends ConversationSnapshot {
  state: VoiceState;
  startListening: () => void;
  stopListening: () => void;
  /** Stops the NPC and resolves once any cut-off has been reported. */
  cancelSpeaking: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  /** Speak an NPC line that didn't come from a player turn (the opening), by its turn index. */
  speakLine: (text: string, turnIndex: number) => Promise<void>;
  setTextOnly: (v: boolean) => void;
}

const unconfigured: ConversationTransport = {
  sendTurn: async () => {
    throw new Error("Voice session not ready yet.");
  },
  reportDelivery: async () => {},
};

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionApi {
  const { profile, recognizer, synthesizer, textOnly, voiceBargeIn, sendTurn, reportDelivery, shouldAutoListen, onLineDelivered } = opts;

  // Providers arrive after hydration on the web; a new provider pair means a new controller.
  // Profile and textOnly are initial values; everything else is (re)wired below.
  const controller = useMemo(
    () => new ConversationController({ profile, recognizer, synthesizer, textOnly, voiceBargeIn, transport: unconfigured }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recognizer, synthesizer],
  );
  // Unmount (or a strict-mode remount) stops audio and the mic but keeps the controller usable.
  useEffect(() => () => controller.stop(), [controller]);

  // Keep the controller's callbacks current without recreating it (callers' closures change every render).
  useEffect(() => {
    controller.configure({
      transport: {
        sendTurn: (input, onSpeech) => sendTurn(input.text, input.modality, onSpeech, input.interrupted),
        reportDelivery: (report) => reportDelivery(report),
      },
      autoListen: () => shouldAutoListen?.() ?? false,
      onLineDelivered: (line) => onLineDelivered?.(line),
      voiceBargeIn,
    });
  }, [controller, sendTurn, reportDelivery, shouldAutoListen, onLineDelivered, voiceBargeIn]);

  // Background tab: the mic session dies silently; make the state honest.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") controller.pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [controller]);

  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const startListening = useCallback(() => controller.startListening(), [controller]);
  const stopListening = useCallback(() => controller.stopListening(), [controller]);
  const cancelSpeaking = useCallback(() => controller.cancelSpeaking(), [controller]);
  const sendText = useCallback((text: string) => controller.sendText(text), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const speakLine = useCallback((text: string, turnIndex: number) => controller.speakLine(text, turnIndex), [controller]);
  const setTextOnly = useCallback((v: boolean) => controller.setTextOnly(v), [controller]);

  return { ...snap, startListening, stopListening, cancelSpeaking, sendText, retry, speakLine, setTextOnly };
}
