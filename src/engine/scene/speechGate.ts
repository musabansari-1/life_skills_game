/**
 * Speech gate: the systematic guarantee that what an NPC says agrees with what
 * the rules allow, applied BEFORE any text is streamed, spoken or recorded.
 *
 * The NPC model streams speech. The gate splits it into sentences as they
 * complete and runs the quest's `speechGate` check on each one. A sentence
 * that violates the rules is replaced by the quest's rewrite (e.g. the figure
 * is lowered to this turn's cap) or dropped. Only gated sentences reach the
 * client, so the audible line, the caption and the persisted transcript are the
 * same text, and that text is what the scene rules then read.
 *
 * Pure and platform-neutral; the orchestrator owns the instance for one turn.
 */
import type { SpeechCheck } from "../types/quest";
import { takeCompleteSentences } from "../parsing/sentences";

export class SpeechGate {
  private source = "";
  private consumed = 0;
  private readonly sentences: string[] = [];
  /** Diagnostics for the AI call log ("speech gate: …"). */
  readonly problems: string[] = [];
  /** How many sentences were rewritten or dropped. */
  violations = 0;

  constructor(
    private readonly check: (sentence: string) => SpeechCheck,
    /** Hard ceiling on spoken length: sentences beyond this are dropped (the prompt asks for far fewer). */
    private readonly opts: { maxSentences?: number } = {},
  ) {}

  /**
   * Feed the speech generated so far. Returns true when the gated text grew.
   * If the incoming text no longer extends what was consumed (a retry produced
   * a different line), the gate starts over on the new text.
   */
  push(speechSoFar: string, done: boolean): boolean {
    if (!speechSoFar.startsWith(this.source.slice(0, this.consumed))) this.reset();
    this.source = speechSoFar;
    const { chunks, consumed } = takeCompleteSentences(speechSoFar, this.consumed, done);
    this.consumed = consumed;
    let changed = false;
    for (const sentence of chunks) {
      if (this.opts.maxSentences && this.sentences.length >= this.opts.maxSentences) {
        if (!this.problems.some((p) => p.startsWith("speech gate: over length"))) this.problems.push(`speech gate: over length; dropped sentences after ${this.opts.maxSentences}`);
        this.violations += 1;
        continue;
      }
      const verdict = this.check(sentence);
      if (verdict.ok) {
        this.sentences.push(sentence);
        changed = true;
        continue;
      }
      this.violations += 1;
      this.problems.push(`speech gate: ${verdict.reason}`);
      if (verdict.rewrite && verdict.rewrite.trim()) {
        this.sentences.push(verdict.rewrite.trim());
        changed = true;
      }
    }
    return changed;
  }

  /** The gated speech: exactly what may be spoken and recorded. */
  get text(): string {
    return this.sentences.join(" ");
  }

  private reset() {
    this.source = "";
    this.consumed = 0;
    this.sentences.length = 0;
  }
}
