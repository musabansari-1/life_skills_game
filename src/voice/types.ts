/**
 * Voice architecture contracts.
 *
 * Separated so providers can be swapped per platform:
 *   SpeechRecognizer     — speech input → transcript (browser Web Speech API today;
 *                          a native STT module or Deepgram/Whisper later)
 *   SpeechSynthesizer    — text → audio (browser speechSynthesis today;
 *                          expo-speech / ElevenLabs later)
 *   ConversationTransport— how a client sends a line and receives the NPC's
 *                          streamed reply (web: /api/v1 over fetch+SSE)
 *   ConversationController (controller.ts) — the platform-neutral turn-taking
 *                          state machine every client wraps
 *
 * Dialogue orchestration and NPC generation live on the server and know
 * nothing about audio. The controller only ever sends text and receives
 * streamed text, and reports back how much of a line was audibly delivered.
 */
import type { DeliveryReport } from "@/contracts/api";

export interface RecognizerEvents {
  /**
   * Transcript so far (final + interim words). `isFinal` is true when the
   * engine has committed everything heard so far (it detected a pause itself).
   */
  onInterim: (text: string, meta?: { isFinal: boolean }) => void;
  /** The engine stopped; `text` is the whole utterance. Empty if nothing was heard. */
  onFinal: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
  onEnd: () => void;
}

export interface RecognizerStartOptions {
  lang?: string;
  /**
   * Monitor mode: listen while the NPC is speaking, to detect the player
   * cutting in. Endpointing does not apply (nothing is submitted from here);
   * the caller decides when a barge-in has happened and continues the same
   * session as a normal turn.
   */
  monitor?: boolean;
}

export interface SpeechRecognizer {
  readonly available: boolean;
  start(events: RecognizerEvents, opts?: RecognizerStartOptions): void;
  /**
   * Leave monitor mode and apply normal endpointing to the current session.
   * `reset` discards what was heard so far (the NPC's own voice), for the
   * hands-free case where the NPC finished and the session becomes the player's turn.
   */
  armEndpointing?(opts?: { reset?: boolean }): void;
  stop(): void;
  abort(): void;
}

export interface VoiceProfile {
  lang: string;
  gender: "female" | "male" | "neutral";
  rate: number;
  pitch: number;
  preferredVoiceHints: string[];
}

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  /**
   * Playback progress as a character index into `text` (from word-boundary
   * events where the engine provides them). Lets the controller know exactly
   * how much of a sentence was heard when the player cuts in.
   */
  onProgress?: (charIndex: number) => void;
}

export interface SpeechSynthesizer {
  readonly available: boolean;
  /** Speak one chunk; resolves when finished or cancelled. */
  speak(text: string, profile: VoiceProfile, opts?: SpeakOptions): Promise<void>;
  cancel(): void;
  /** Warm up (some browsers need a user gesture before voices load). */
  prime(): void;
}

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

/** The NPC line a turn produced, as the server committed it. */
export interface NpcLine {
  npcText: string;
  npcTurnIndex: number;
}

export interface ConversationTransport {
  /**
   * Send the player's line. `onSpeech` receives the NPC's (server-gated) speech
   * as it streams. Resolves with the committed NPC line, or null if the scene
   * produced none (e.g. it ended).
   */
  sendTurn(input: { text: string; modality: "voice" | "text"; interrupted?: DeliveryReport }, onSpeech: (speechSoFar: string, done: boolean) => void): Promise<NpcLine | null>;
  /** The player cut a line off and said nothing after: record what they heard. */
  reportDelivery(report: DeliveryReport): Promise<void>;
}
