/**
 * Voice architecture contracts.
 *
 * Separated so providers can be swapped:
 *   SpeechRecognizer  — speech input → transcript (browser Web Speech API today;
 *                       Deepgram/Whisper over a /api/voice/stt route later)
 *   SpeechSynthesizer — text → audio (browser speechSynthesis today;
 *                       ElevenLabs/OpenAI TTS over /api/voice/tts later)
 *   VoiceSession      — turn-taking state machine (see useVoiceSession.ts)
 *
 * Dialogue orchestration and NPC generation live on the server and know
 * nothing about audio. The session hook only ever sends text and receives
 * streamed text.
 */

export interface RecognizerEvents {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
  onEnd: () => void;
}

export interface SpeechRecognizer {
  readonly available: boolean;
  start(events: RecognizerEvents, opts?: { lang?: string }): void;
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

export interface SpeechSynthesizer {
  readonly available: boolean;
  /** Speak a chunk; resolves when finished or cancelled. */
  speak(text: string, profile: VoiceProfile, opts?: { onStart?: () => void; onEnd?: () => void }): Promise<void>;
  cancel(): void;
  /** Warm up (some browsers need a user gesture before voices load). */
  prime(): void;
}

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";
