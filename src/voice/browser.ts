/**
 * Browser implementations of the voice contracts using the Web Speech API.
 * Zero cost, low latency, works in Chrome/Edge/Safari. Quality varies by OS
 * voices; the interfaces exist so a server TTS/STT can replace these.
 */
import type { RecognizerEvents, SpeechRecognizer, SpeechSynthesizer, VoiceProfile } from "./types";

type SR = typeof window extends { SpeechRecognition: infer T } ? T : never;

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechRecognizer implements SpeechRecognizer {
  private rec: SpeechRecognition | null = null;
  private ctor = getSpeechRecognitionCtor();
  private finalText = "";
  readonly available = !!this.ctor;

  start(events: RecognizerEvents, opts?: { lang?: string }) {
    if (!this.ctor) {
      events.onError("Speech recognition is not supported in this browser.", true);
      return;
    }
    this.abort();
    const rec = new this.ctor();
    this.rec = rec;
    this.finalText = "";
    rec.lang = opts?.lang ?? "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += (this.finalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      events.onInterim((this.finalText + " " + interim).trim());
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed";
      events.onError(fatal ? "Microphone access was blocked. Allow the microphone or use text." : `Speech recognition error: ${e.error}`, fatal);
    };
    rec.onend = () => {
      if (this.rec === rec) {
        this.rec = null;
        events.onFinal(this.finalText.trim());
        events.onEnd();
      }
    };
    try {
      rec.start();
    } catch (err) {
      events.onError((err as Error).message, false);
    }
  }

  stop() {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }

  abort() {
    const r = this.rec;
    this.rec = null;
    try {
      r?.abort();
    } catch {
      /* noop */
    }
  }
}

export class BrowserSpeechSynthesizer implements SpeechSynthesizer {
  readonly available = typeof window !== "undefined" && "speechSynthesis" in window;
  private voices: SpeechSynthesisVoice[] = [];
  private current: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (this.available) {
      this.voices = window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        this.voices = window.speechSynthesis.getVoices();
      };
    }
  }

  prime() {
    if (!this.available) return;
    this.voices = window.speechSynthesis.getVoices();
    // Chrome sometimes needs a first (silent) utterance after a gesture.
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  pickVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
    if (!this.voices.length) this.voices = window.speechSynthesis.getVoices();
    const v = this.voices;
    for (const hint of profile.preferredVoiceHints) {
      const h = hint.toLowerCase();
      const match = v.find((x) => x.name.toLowerCase().includes(h) || x.lang.toLowerCase() === h);
      if (match) return match;
    }
    return v.find((x) => x.lang.toLowerCase().startsWith(profile.lang.toLowerCase())) ?? v.find((x) => x.lang.toLowerCase().startsWith("en")) ?? v[0] ?? null;
  }

  speak(text: string, profile: VoiceProfile, opts?: { onStart?: () => void; onEnd?: () => void }): Promise<void> {
    if (!this.available || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.pickVoice(profile);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? profile.lang;
      u.rate = profile.rate;
      u.pitch = profile.pitch;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this.current === u) this.current = null;
        opts?.onEnd?.();
        resolve();
      };
      u.onstart = () => opts?.onStart?.();
      u.onend = finish;
      u.onerror = finish;
      this.current = u;
      window.speechSynthesis.speak(u);
      // Safety: some engines never fire onend for cancelled utterances.
      const est = 1500 + text.length * 90;
      setTimeout(() => {
        if (!done && !window.speechSynthesis.speaking) finish();
      }, est);
    });
  }

  cancel() {
    if (!this.available) return;
    this.current = null;
    window.speechSynthesis.cancel();
  }
}

/** No-op synthesizer for text-only mode. */
export class NullSpeechSynthesizer implements SpeechSynthesizer {
  readonly available = false;
  prime() {}
  cancel() {}
  speak() {
    return Promise.resolve();
  }
}

export type { SR };

/** Web defaults for useVoiceSession. Call on the client only. */
export function createBrowserVoiceProviders(): { recognizer: SpeechRecognizer | null; synthesizer: SpeechSynthesizer } {
  if (typeof window === "undefined") return { recognizer: null, synthesizer: new NullSpeechSynthesizer() };
  const recognizer = new BrowserSpeechRecognizer();
  return { recognizer: recognizer.available ? recognizer : null, synthesizer: new BrowserSpeechSynthesizer() };
}
