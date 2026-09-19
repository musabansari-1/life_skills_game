/**
 * End-of-turn detection ("endpointing") for hands-free turns.
 *
 * Platform-neutral: feed it recognition activity and it tells you when the
 * speaker has finished. Used by the browser recognizer; a native recognizer
 * can reuse it. Timers are injectable for tests.
 *
 * The silence that ends a turn adapts to what has been said so far:
 *   - an utterance that trails off mid-thought ("I was hoping for something
 *     around…") waits longer, up to `longSilenceMs`;
 *   - a short, complete answer ("yes", "okay, deal") ends quickly;
 *   - once the engine itself has committed a final result (`isFinal`), a
 *     complete-looking line ends after `finalSilenceMs`;
 *   - a slow speaker (long gaps between words) gets extra time.
 * Hard limits: nothing said within `noSpeechMs` ends the turn empty; a turn
 * never runs longer than `maxMs`.
 */
import { looksIncomplete, looksShortAndComplete } from "@/engine/parsing/utterance";

export { looksIncomplete, looksShortAndComplete };

export interface EndpointingOptions {
  /** Default pause that ends a turn after speech. */
  silenceMs: number;
  /** Pause for a short, complete answer. */
  shortSilenceMs: number;
  /** Pause for a line that looks unfinished. Also the upper bound. */
  longSilenceMs: number;
  /** Pause after the engine has committed a complete-looking final result. */
  finalSilenceMs: number;
  noSpeechMs: number;
  maxMs: number;
}

export const DEFAULT_ENDPOINTING: EndpointingOptions = {
  silenceMs: 1300,
  shortSilenceMs: 850,
  longSilenceMs: 2600,
  finalSilenceMs: 650,
  noSpeechMs: 8000,
  maxMs: 45000,
};

/**
 * How long to wait after the latest words before ending the turn.
 * `gapMs` is the speaker's typical pause between updates so far (cadence).
 */
export function silenceFor(transcript: string, meta: { isFinal: boolean; gapMs?: number }, opts: EndpointingOptions = DEFAULT_ENDPOINTING): number {
  let ms: number;
  if (looksIncomplete(transcript)) ms = opts.longSilenceMs;
  else if (looksShortAndComplete(transcript)) ms = opts.shortSilenceMs;
  else if (meta.isFinal) ms = opts.finalSilenceMs;
  else ms = opts.silenceMs;
  // Slow speakers: pauses between phrases are part of how they talk.
  if (meta.gapMs !== undefined && meta.gapMs > 900 && !looksShortAndComplete(transcript)) ms += Math.min(600, Math.round((meta.gapMs - 900) * 0.5));
  return Math.min(opts.longSilenceMs, ms);
}

type Timer = ReturnType<typeof setTimeout>;

export class Endpointer {
  private silence: Timer | null = null;
  private noSpeech: Timer | null = null;
  private max: Timer | null = null;
  private heardAnything = false;
  private done = false;
  private armed = true;
  private lastActivityAt: number | null = null;
  private gaps: number[] = [];
  private lastText = "";
  /** The silence window chosen at the latest activity (for diagnostics/UI). */
  lastSilenceMs = 0;

  constructor(
    private readonly onEnd: (reason: "silence" | "no_speech" | "max_length") => void,
    private readonly opts: EndpointingOptions = DEFAULT_ENDPOINTING,
    private readonly timers: { set: (fn: () => void, ms: number) => Timer; clear: (t: Timer) => void; now: () => number } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (t) => clearTimeout(t),
      now: () => Date.now(),
    },
  ) {}

  /** `armed: false` starts in monitor mode: activity is tracked but no silence timer runs until `arm()`. */
  start(opts: { armed?: boolean } = {}) {
    this.armed = opts.armed ?? true;
    if (this.armed) this.noSpeech = this.timers.set(() => this.finish("no_speech"), this.opts.noSpeechMs);
    this.max = this.timers.set(() => this.finish("max_length"), this.opts.maxMs);
  }

  /** Leave monitor mode: from now on, pauses end the turn. */
  arm() {
    if (this.done || this.armed) return;
    this.armed = true;
    if (this.heardAnything) this.schedule(this.lastText, false);
    else this.noSpeech = this.timers.set(() => this.finish("no_speech"), this.opts.noSpeechMs);
  }

  /** Call on every recognition result with the transcript so far. */
  activity(transcriptSoFar: string, meta: { isFinal?: boolean } = {}) {
    if (this.done || !transcriptSoFar.trim()) return;
    const now = this.timers.now();
    if (this.lastActivityAt !== null && transcriptSoFar !== this.lastText) {
      this.gaps.push(now - this.lastActivityAt);
      if (this.gaps.length > 6) this.gaps.shift();
    }
    this.lastActivityAt = now;
    this.lastText = transcriptSoFar;
    if (!this.heardAnything && this.noSpeech) this.timers.clear(this.noSpeech);
    this.heardAnything = true;
    if (this.armed) this.schedule(transcriptSoFar, !!meta.isFinal);
  }

  private schedule(text: string, isFinal: boolean) {
    if (this.silence) this.timers.clear(this.silence);
    const gapMs = this.gaps.length >= 3 ? [...this.gaps].sort((a, b) => a - b)[Math.floor(this.gaps.length / 2)] : undefined;
    this.lastSilenceMs = silenceFor(text, { isFinal, gapMs }, this.opts);
    this.silence = this.timers.set(() => this.finish("silence"), this.lastSilenceMs);
  }

  cancel() {
    this.done = true;
    for (const t of [this.silence, this.noSpeech, this.max]) if (t) this.timers.clear(t);
  }

  private finish(reason: "silence" | "no_speech" | "max_length") {
    if (this.done) return;
    this.cancel();
    this.onEnd(reason);
  }
}
