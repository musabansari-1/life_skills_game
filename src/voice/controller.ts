/**
 * ConversationController — the turn-taking state machine for a spoken scene.
 *
 * Platform-neutral: no DOM, no React, no network. Speech providers and the
 * transport are injected (web: src/voice/browser.ts + the /api/v1 client;
 * React Native: a native STT/TTS pair implementing the same interfaces). Every
 * client wraps this class, so the rules below live in exactly one place:
 *
 *   idle ──(tap / auto)──▶ listening ──(pause)──▶ thinking ──▶ speaking ──▶ idle
 *                                                                │
 *          (barge-in: tap, or the player just talks) ◀───────────┘
 *
 * Guarantees:
 *   - NPC speech is spoken sentence by sentence as it streams; the caption
 *     follows what has been HEARD, not what has been generated.
 *   - Cutting in cancels audio at once, and the exact delivered prefix is
 *     reported to the server (with the next line, or on its own), so the
 *     transcript never claims the NPC finished a sentence nobody heard.
 *   - Stale audio never plays: every cancel bumps a generation counter and
 *     late stream/audio callbacks are dropped.
 *   - Lines are sent in order even in rapid back-and-forth (a new line waits
 *     for the previous one to be committed), and an accidental double
 *     submission of the same line is ignored.
 *   - Failures leave the player's line available for retry; text stays usable.
 */
import type { DeliveryReport } from "@/contracts/api";
import { takeSpeakableChunks } from "./chunker";
import { DeliveryTracker } from "./delivery";
import { BargeInDetector, stripLeadingEcho } from "./bargeIn";
import type { ConversationTransport, NpcLine, SpeechRecognizer, SpeechSynthesizer, VoiceProfile, VoiceState } from "./types";

export interface ConversationSnapshot {
  state: VoiceState;
  /** Player's words so far while listening. */
  interim: string;
  error: string | null;
  /** What the NPC has audibly said so far this line (the streamed text when there is no audio). */
  caption: string;
  /** True while the caption is still growing (line not finished). */
  captionLive: boolean;
  textOnly: boolean;
  micAvailable: boolean;
  ttsAvailable: boolean;
  /** The player can cut in just by talking (recognizer listens during NPC speech). */
  bargeInArmed: boolean;
  /** The last player line that failed to send, kept for retry. */
  failedLine: { text: string; modality: "voice" | "text" } | null;
}

export interface ControllerTimers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

export interface ConversationControllerOptions {
  profile: VoiceProfile;
  transport: ConversationTransport;
  recognizer: SpeechRecognizer | null;
  synthesizer: SpeechSynthesizer;
  textOnly?: boolean;
  lang?: string;
  /** Hands-free: after the NPC finishes replying to a spoken line, listen again automatically. */
  autoListen?: () => boolean;
  /** Keep the recognizer listening while the NPC speaks so the player can just talk over them. Default: true. */
  voiceBargeIn?: boolean;
  /** An NPC line was fully delivered (or, in text mode, fully shown). */
  onLineDelivered?: (line: NpcLine) => void;
  /** The player cut a line off; `heardText` is what they got. */
  onLineInterrupted?: (report: DeliveryReport) => void;
  timers?: ControllerTimers;
}

const DUPLICATE_WINDOW_MS = 1500;
const AUTO_LISTEN_DELAY_MS = 250;
const CAPTION_TICK_MS = 120;

export class ConversationController {
  private snap: ConversationSnapshot;
  private readonly listeners = new Set<(s: ConversationSnapshot) => void>();
  private readonly timers: ControllerTimers;
  private generation = 0;
  private inflight: Promise<void> | null = null;
  private tracker: DeliveryTracker | null = null;
  /** The NPC line currently streaming/playing. `index` is known once the server commits it. */
  private currentLine: { index: number | null; text: string } | null = null;
  private queue: { text: string; seg: number }[] = [];
  private draining = false;
  private consumed = 0;
  /** A cut-off line whose heard prefix still has to be reported. */
  private interrupted: { turnIndex: number | null; heardText: string } | null = null;
  private lastSubmitted: { text: string; at: number } | null = null;
  private monitoring = false;
  /** NPC text that was playing when the player cut in, for stripping echo from their line. */
  private bargeEcho: string | null = null;
  private captionTimer: unknown = null;
  private readonly barge = new BargeInDetector();
  private disposed = false;

  /** Swap the callbacks (transport, auto-listen, delivery hooks) without recreating the controller. */
  configure(patch: Partial<Pick<ConversationControllerOptions, "transport" | "autoListen" | "onLineDelivered" | "onLineInterrupted" | "voiceBargeIn">>) {
    this.opts = { ...this.opts, ...patch };
  }

  constructor(private opts: ConversationControllerOptions) {
    this.timers = opts.timers ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
    this.snap = {
      state: "idle",
      interim: "",
      error: null,
      caption: "",
      captionLive: false,
      textOnly: !!opts.textOnly,
      micAvailable: !!opts.recognizer?.available,
      ttsAvailable: opts.synthesizer.available,
      bargeInArmed: false,
      failedLine: null,
    };
  }

  // ---------------------------------------------------------------- store

  subscribe = (fn: (s: ConversationSnapshot) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ConversationSnapshot => this.snap;

  private update(patch: Partial<ConversationSnapshot>) {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }

  private get audioOn(): boolean {
    return !this.snap.textOnly && this.opts.synthesizer.available;
  }

  // ---------------------------------------------------------------- listening

  /** Tap the mic (or hands-free auto-listen). While the NPC speaks this is a barge-in. */
  startListening() {
    const rec = this.opts.recognizer;
    if (!rec?.available) {
      this.update({ error: "Voice input isn't available here. Use text instead." });
      return;
    }
    if (this.snap.state === "listening" || this.snap.state === "thinking") return;
    if (this.snap.state === "speaking") this.interruptSpeaking();
    if (this.monitoring) {
      // The recognizer is already running (it was listening for a barge-in): continue that session as the turn.
      this.monitoring = false;
      this.bargeEcho = this.currentLine?.text ?? null;
      rec.armEndpointing?.({ reset: true });
      this.update({ state: "listening", interim: "", error: null, bargeInArmed: false });
      return;
    }
    this.opts.synthesizer.prime();
    this.update({ state: "listening", interim: "", error: null, bargeInArmed: false });
    rec.start(this.recognizerEvents(), { lang: this.opts.lang ?? this.opts.profile.lang });
  }

  /** End the turn now (the endpointer normally does this on a pause). */
  stopListening() {
    if (this.monitoring) return;
    this.opts.recognizer?.stop();
  }

  /**
   * Stop the NPC mid-line without speaking (tap on the character, wrap-up,
   * leaving). Resolves once the cut-off has been reported, so a wrap-up that
   * follows evaluates the canonical transcript.
   */
  cancelSpeaking(): Promise<void> {
    if (this.snap.state !== "speaking") return Promise.resolve();
    this.interruptSpeaking();
    this.stopMonitoring();
    this.update({ state: "idle" });
    return this.flushInterruption();
  }

  sendText(text: string): Promise<void> {
    return this.submit(text, "text");
  }

  /** Re-send the line that failed. */
  retry(): Promise<void> {
    const f = this.snap.failedLine;
    if (!f) return Promise.resolve();
    this.lastSubmitted = null;
    return this.submit(f.text, f.modality);
  }

  setTextOnly(v: boolean) {
    if (v) {
      if (this.snap.state === "speaking") this.cancelSpeaking();
      if (this.snap.state === "listening") this.opts.recognizer?.abort();
      this.stopMonitoring();
      this.update({ textOnly: true, state: this.snap.state === "listening" ? "idle" : this.snap.state, interim: "" });
    } else {
      this.update({ textOnly: false });
    }
  }

  /** The app went to the background: the mic can't be trusted to keep running. */
  pause() {
    if (this.snap.state === "listening") {
      this.opts.recognizer?.abort();
      this.update({ state: "idle", interim: "" });
    }
    this.stopMonitoring();
  }

  /**
   * Stop all audio and listening, drop pending speech, but stay usable (a UI
   * unmount/remount, e.g. React strict mode, must not kill the session).
   */
  stop() {
    this.generation += 1;
    this.queue = [];
    this.draining = false;
    this.opts.synthesizer.cancel();
    this.monitoring = false;
    this.opts.recognizer?.abort();
    this.stopCaptionTicks();
    if (this.snap.state === "speaking" || this.snap.state === "listening") this.update({ state: "idle", interim: "", bargeInArmed: false, captionLive: false });
  }

  /** Permanent teardown: nothing works after this. */
  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.queue = [];
    this.opts.synthesizer.cancel();
    this.opts.recognizer?.abort();
    this.stopCaptionTicks();
    this.listeners.clear();
  }

  /**
   * Speak an NPC line that did not come from a player turn (the opening).
   * `turnIndex` lets an interruption of it be reported like any other line.
   */
  async speakLine(text: string, turnIndex: number): Promise<void> {
    if (!this.audioOn) {
      this.update({ caption: text, captionLive: false });
      this.opts.onLineDelivered?.({ npcText: text, npcTurnIndex: turnIndex });
      return;
    }
    if (this.snap.state === "speaking") this.interruptSpeaking();
    const gen = ++this.generation;
    this.beginLine(turnIndex, text);
    this.enqueueSpeech(text, true, gen);
    await this.waitForQueue(gen);
    if (gen !== this.generation) return;
    this.finishLine({ npcText: text, npcTurnIndex: turnIndex }, "voice");
  }

  // ---------------------------------------------------------------- turns

  private async submit(rawText: string, modality: "voice" | "text"): Promise<void> {
    const text = rawText.trim();
    if (!text || this.disposed) return;
    const now = this.timers.now();
    if (this.lastSubmitted && this.lastSubmitted.text === text && now - this.lastSubmitted.at < DUPLICATE_WINDOW_MS) return;
    this.lastSubmitted = { text, at: now };
    if (this.snap.state === "speaking") this.interruptSpeaking(); // a typed line while the NPC speaks cuts them off too
    this.stopMonitoring();
    // Immediate feedback, and it keeps a trailing recognizer `onEnd` from flipping us back to idle.
    this.update({ state: "thinking", error: null, failedLine: null, interim: "" });

    const prev = this.inflight;
    const run = (async () => {
      // Rapid back-and-forth: the previous line must be committed before this one is sent.
      if (prev) await prev.catch(() => {});
      if (this.disposed) return;
      const gen = ++this.generation;
      this.update({ state: "thinking", error: null, failedLine: null, caption: "", captionLive: true, interim: "" });
      const interrupted = this.takeInterruption();
      this.beginLine(null, "");

      let line: NpcLine | null;
      try {
        line = await this.opts.transport.sendTurn({ text, modality, interrupted }, (speechSoFar, done) => {
          if (gen !== this.generation || !this.currentLine) return;
          this.currentLine.text = speechSoFar;
          if (!this.audioOn) {
            this.update({ caption: speechSoFar, captionLive: !done });
            return;
          }
          this.enqueueSpeech(speechSoFar, done, gen);
        });
      } catch (err) {
        if (gen === this.generation) this.update({ state: "error", error: err instanceof Error ? err.message : "Something went wrong.", failedLine: { text, modality }, captionLive: false });
        return;
      }

      if (line && this.currentLine) {
        this.currentLine.index = line.npcTurnIndex;
        this.currentLine.text = line.npcText;
      }
      if (gen !== this.generation) {
        // The player cut in before this line finished arriving: the heard prefix can be reported now that the index is known.
        if (this.interrupted && this.interrupted.turnIndex === null) this.interrupted.turnIndex = line?.npcTurnIndex ?? null;
        if (this.snap.state === "idle") this.flushInterruption();
        return;
      }
      if (!line) {
        this.update({ state: "idle", captionLive: false });
        return;
      }
      if (!this.audioOn) {
        this.finishLine(line, modality);
        return;
      }
      this.enqueueSpeech(line.npcText, true, gen);
      await this.waitForQueue(gen);
      if (gen !== this.generation) return;
      this.finishLine(line, modality);
    })();
    this.inflight = run;
    await run;
  }

  private beginLine(index: number | null, text: string) {
    this.tracker = new DeliveryTracker(this.opts.profile.rate);
    this.consumed = 0;
    this.queue = [];
    this.currentLine = { index, text };
  }

  private finishLine(line: NpcLine, modality: "voice" | "text") {
    this.stopCaptionTicks();
    this.update({ state: "idle", caption: line.npcText, captionLive: false, bargeInArmed: false });
    this.opts.onLineDelivered?.(line);
    if (modality === "voice" && !this.snap.textOnly && this.opts.autoListen?.()) {
      if (this.monitoring) {
        // The recognizer kept listening through the NPC's line: continue it as the player's turn with no gap.
        this.monitoring = false;
        this.opts.recognizer?.armEndpointing?.({ reset: true });
        this.bargeEcho = null;
        this.update({ state: "listening", interim: "" });
        return;
      }
      const gen = this.generation;
      this.timers.setTimeout(() => {
        if (!this.disposed && this.snap.state === "idle" && gen === this.generation) this.startListening();
      }, AUTO_LISTEN_DELAY_MS);
    } else {
      this.stopMonitoring();
    }
  }

  // ---------------------------------------------------------------- speaking

  private enqueueSpeech(speechSoFar: string, done: boolean, gen: number) {
    if (!this.tracker) return;
    // A retry on the server can replace the line; if so, start the queue over.
    if (speechSoFar.length < this.consumed) this.consumed = 0;
    const { chunks, consumed } = takeSpeakableChunks(speechSoFar, this.consumed, done);
    this.consumed = consumed;
    for (const c of chunks) this.queue.push({ text: c, seg: this.tracker.enqueue(c) });
    if (this.queue.length) void this.drain(gen);
  }

  private async drain(gen: number) {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length && gen === this.generation && !this.disposed) {
      const item = this.queue.shift()!;
      const tracker = this.tracker!;
      if (this.snap.state !== "speaking") {
        this.update({ state: "speaking" });
        this.startMonitoring();
        this.startCaptionTicks();
      }
      await this.opts.synthesizer.speak(item.text, this.opts.profile, {
        onStart: () => {
          if (gen !== this.generation) return;
          tracker.start(item.seg, this.timers.now());
          this.refreshCaption();
        },
        onProgress: (charIndex) => {
          if (gen !== this.generation) return;
          tracker.progress(item.seg, charIndex);
          this.refreshCaption();
        },
      });
      if (gen === this.generation) {
        tracker.complete(item.seg);
        this.refreshCaption();
      }
    }
    this.draining = false;
  }

  private async waitForQueue(gen: number) {
    while ((this.draining || this.queue.length) && gen === this.generation && !this.disposed) {
      await new Promise<void>((r) => this.timers.setTimeout(r, 60));
    }
  }

  /** Cancel audio now and remember exactly how much of the line was heard. */
  private interruptSpeaking() {
    const now = this.timers.now();
    const heard = this.tracker?.cancel(now) ?? "";
    this.generation += 1;
    this.queue = [];
    this.draining = false;
    this.opts.synthesizer.cancel();
    this.stopCaptionTicks();
    if (this.currentLine) this.interrupted = { turnIndex: this.currentLine.index, heardText: heard };
    this.update({ caption: heard, captionLive: false, bargeInArmed: false });
  }

  /** The report to attach to the next line, if a cut-off line is pending and its index is known. */
  private takeInterruption(): DeliveryReport | undefined {
    const i = this.interrupted;
    if (!i || i.turnIndex === null) {
      if (i) this.interrupted = null; // index never arrived (the previous request failed): nothing to report
      return undefined;
    }
    this.interrupted = null;
    const report = { turnIndex: i.turnIndex, heardText: i.heardText };
    this.opts.onLineInterrupted?.(report);
    return report;
  }

  /** Report a pending cut-off line on its own (the player didn't follow with a line). */
  private flushInterruption(): Promise<void> {
    const report = this.takeInterruption();
    if (!report) return Promise.resolve();
    return this.opts.transport.reportDelivery(report).catch(() => {});
  }

  private refreshCaption() {
    if (!this.tracker || this.snap.state !== "speaking") return;
    const heard = this.tracker.heardText(this.timers.now());
    if (heard !== this.snap.caption) this.update({ caption: heard, captionLive: true });
  }

  private startCaptionTicks() {
    if (this.captionTimer !== null) return;
    const tick = () => {
      this.captionTimer = null;
      if (this.snap.state !== "speaking" || this.disposed) return;
      this.refreshCaption();
      this.captionTimer = this.timers.setTimeout(tick, CAPTION_TICK_MS);
    };
    this.captionTimer = this.timers.setTimeout(tick, CAPTION_TICK_MS);
  }

  private stopCaptionTicks() {
    if (this.captionTimer !== null) this.timers.clearTimeout(this.captionTimer);
    this.captionTimer = null;
  }

  // ---------------------------------------------------------------- barge-in

  private startMonitoring() {
    const rec = this.opts.recognizer;
    if (this.opts.voiceBargeIn === false || !rec?.available || this.snap.textOnly || this.monitoring) return;
    this.monitoring = true;
    this.barge.reset();
    try {
      rec.start(this.recognizerEvents(), { lang: this.opts.lang ?? this.opts.profile.lang, monitor: true });
      this.update({ bargeInArmed: true });
    } catch {
      this.monitoring = false;
    }
  }

  private stopMonitoring() {
    if (!this.monitoring) return;
    this.monitoring = false;
    this.opts.recognizer?.abort();
    if (this.snap.bargeInArmed) this.update({ bargeInArmed: false });
  }

  private bargeIn() {
    this.bargeEcho = this.tracker?.recentText(this.timers.now()) ?? this.currentLine?.text ?? null;
    this.interruptSpeaking();
    this.monitoring = false;
    this.opts.recognizer?.armEndpointing?.();
    this.update({ state: "listening", interim: "", error: null });
  }

  private recognizerEvents() {
    return {
      onInterim: (text: string) => {
        if (this.monitoring) {
          const recent = this.tracker?.recentText(this.timers.now()) ?? this.currentLine?.text ?? "";
          if (this.barge.observe(text, recent, this.timers.now())) this.bargeIn();
          return;
        }
        if (this.snap.state === "listening") this.update({ interim: text });
      },
      onFinal: (text: string) => {
        if (this.monitoring) return; // handled in onEnd (restart while still speaking)
        this.update({ interim: "" });
        if (this.snap.state !== "listening") return;
        const cleaned = this.bargeEcho ? stripLeadingEcho(text, this.bargeEcho) : text.trim();
        this.bargeEcho = null;
        if (cleaned.trim()) {
          void this.submit(cleaned.trim(), "voice");
        } else {
          this.update({ state: "idle" });
          this.flushInterruption();
        }
      },
      onError: (message: string, fatal: boolean) => {
        if (this.monitoring) {
          // Barge-in by voice isn't possible here (permission, engine); tapping still works.
          this.monitoring = false;
          this.update({ bargeInArmed: false });
          return;
        }
        this.update({ error: message, state: fatal ? "error" : this.snap.state === "listening" ? "idle" : this.snap.state, interim: "" });
      },
      onEnd: () => {
        if (this.monitoring) {
          // The engine ends sessions on its own (silence timeouts): keep monitoring while the NPC still speaks.
          this.monitoring = false;
          this.update({ bargeInArmed: false });
          if (this.snap.state === "speaking") this.startMonitoring();
          return;
        }
        if (this.snap.state === "listening") this.update({ state: "idle" });
      },
    };
  }
}
