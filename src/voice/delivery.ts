/**
 * Delivery tracking: how much of an NPC line has actually been heard.
 *
 * Generated text, text queued for playback, text audibly delivered and the
 * canonical transcript are four different things. This tracker follows one
 * NPC line through playback, sentence by sentence, so that when the player
 * cuts in the client can report exactly the delivered prefix. Pure and
 * platform-neutral; timers and audio events are fed in by the controller.
 *
 * Precision: word-boundary progress from the synthesizer when available
 * (Chrome desktop), otherwise a time-based estimate from the speaking rate,
 * rounded DOWN to a word boundary so we never claim more than was heard.
 */
export type SegmentStatus = "queued" | "playing" | "done" | "cancelled";

export interface Segment {
  text: string;
  status: SegmentStatus;
  /** Highest character index known to have been spoken (from boundary events). */
  progressChars: number;
  /** Whether any boundary event arrived for this segment (else fall back to timing). */
  hasBoundaries: boolean;
  startedAt: number | null;
}

/** Characters per millisecond of typical synthesized speech at rate 1.0 (~15 chars/s). */
export const DEFAULT_CHARS_PER_MS = 0.015;

export class DeliveryTracker {
  readonly segments: Segment[] = [];
  private readonly charsPerMs: number;

  constructor(rate = 1, charsPerMs = DEFAULT_CHARS_PER_MS) {
    this.charsPerMs = charsPerMs * Math.max(0.5, Math.min(2, rate));
  }

  enqueue(text: string): number {
    this.segments.push({ text, status: "queued", progressChars: 0, hasBoundaries: false, startedAt: null });
    return this.segments.length - 1;
  }

  start(index: number, now: number) {
    const s = this.segments[index];
    if (!s || s.status === "cancelled") return;
    s.status = "playing";
    s.startedAt = now;
  }

  progress(index: number, charIndex: number) {
    const s = this.segments[index];
    if (!s || s.status !== "playing") return;
    s.hasBoundaries = true;
    s.progressChars = Math.max(s.progressChars, Math.min(charIndex, s.text.length));
  }

  complete(index: number) {
    const s = this.segments[index];
    if (!s || s.status === "cancelled") return;
    s.status = "done";
    s.progressChars = s.text.length;
  }

  /** Stop everything that hasn't finished. Returns the heard text at that moment. */
  cancel(now: number): string {
    const heard = this.heardText(now);
    for (const s of this.segments) if (s.status !== "done") s.status = "cancelled";
    return heard;
  }

  /** Everything queued or spoken so far (the generated text the client knows about). */
  fullText(): string {
    return this.segments.map((s) => s.text).join(" ");
  }

  /** True once every queued segment has finished playing. */
  get allDone(): boolean {
    return this.segments.length > 0 && this.segments.every((s) => s.status === "done");
  }

  /** Text heard so far: completed sentences plus the delivered prefix of the one playing. */
  heardText(now: number): string {
    const parts: string[] = [];
    for (const s of this.segments) {
      if (s.status === "done") {
        parts.push(s.text);
        continue;
      }
      if (s.status === "playing") {
        const prefix = this.playingPrefix(s, now);
        if (prefix) parts.push(prefix);
      }
      break;
    }
    return parts.join(" ");
  }

  /** Recent words the NPC has said (for echo detection while listening during playback). */
  recentText(now: number, maxChars = 240): string {
    const heard = this.heardText(now);
    const playing = this.segments.find((s) => s.status === "playing");
    const withCurrent = playing ? `${heard} ${playing.text}` : heard;
    return withCurrent.slice(-maxChars);
  }

  private playingPrefix(s: Segment, now: number): string {
    let chars: number;
    if (s.hasBoundaries) chars = s.progressChars;
    else if (s.startedAt !== null) chars = Math.floor(Math.max(0, now - s.startedAt) * this.charsPerMs);
    else chars = 0;
    if (chars >= s.text.length) return s.text;
    // Round down to a word boundary: never claim a partial word.
    const cut = s.text.lastIndexOf(" ", chars);
    return cut <= 0 ? "" : s.text.slice(0, cut).trim();
  }
}
