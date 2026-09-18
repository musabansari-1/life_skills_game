/**
 * End-of-speech detection ("endpointing") for hands-free turns.
 *
 * Platform-neutral: feed it recognition activity and it tells you when the
 * speaker has finished. Used by the browser recognizer; a native recognizer
 * can reuse it. Timers are injectable for tests.
 *
 *   - after the speaker has said something, `silenceMs` without new words ends the turn
 *   - if nothing is said within `noSpeechMs`, the turn ends (empty)
 *   - a turn never runs longer than `maxMs`
 */
export interface EndpointingOptions {
  silenceMs: number;
  noSpeechMs: number;
  maxMs: number;
}

export const DEFAULT_ENDPOINTING: EndpointingOptions = { silenceMs: 1400, noSpeechMs: 8000, maxMs: 45000 };

type Timer = ReturnType<typeof setTimeout>;

export class Endpointer {
  private silence: Timer | null = null;
  private noSpeech: Timer | null = null;
  private max: Timer | null = null;
  private heardAnything = false;
  private done = false;

  constructor(
    private readonly onEnd: (reason: "silence" | "no_speech" | "max_length") => void,
    private readonly opts: EndpointingOptions = DEFAULT_ENDPOINTING,
    private readonly timers: { set: (fn: () => void, ms: number) => Timer; clear: (t: Timer) => void } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (t) => clearTimeout(t),
    },
  ) {}

  start() {
    this.noSpeech = this.timers.set(() => this.finish("no_speech"), this.opts.noSpeechMs);
    this.max = this.timers.set(() => this.finish("max_length"), this.opts.maxMs);
  }

  /** Call on every recognition result with the transcript so far. */
  activity(transcriptSoFar: string) {
    if (this.done || !transcriptSoFar.trim()) return;
    if (!this.heardAnything && this.noSpeech) this.timers.clear(this.noSpeech);
    this.heardAnything = true;
    if (this.silence) this.timers.clear(this.silence);
    this.silence = this.timers.set(() => this.finish("silence"), this.opts.silenceMs);
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
