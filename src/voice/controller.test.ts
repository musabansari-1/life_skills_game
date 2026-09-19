/**
 * ConversationController with fake providers: the guarantees every client
 * relies on, exercised without a browser, a network or a model.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryReport } from "@/contracts/api";
import { ConversationController, type ControllerTimers } from "./controller";
import type { ConversationTransport, NpcLine, RecognizerEvents, RecognizerStartOptions, SpeakOptions, SpeechRecognizer, SpeechSynthesizer, VoiceProfile } from "./types";

const profile: VoiceProfile = { lang: "en-IN", gender: "female", rate: 1, pitch: 1, preferredVoiceHints: [] };

/** Virtual clock. Everything async in the controller waits on these timers. */
function clock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: ControllerTimers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (t) => void pending.delete(t as number),
  };
  /** Advance the clock, running due timers and letting promise chains settle between them. */
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, p]) => p.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      pending.delete(due[0]);
      due[1].fn();
      await flush();
    }
    now = target;
    await flush();
  };
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { timers, advance, flush, get now() { return now; } };
}

/** Synthesizer that "plays" a chunk over `msPerChar` ms, emitting word boundaries, until cancelled. */
function fakeSynth(c: ReturnType<typeof clock>, msPerChar = 50) {
  const spoken: string[] = [];
  let cancelled = 0;
  let active: { text: string; opts?: SpeakOptions; resolve: () => void; done: boolean } | null = null;
  const synth: SpeechSynthesizer = {
    available: true,
    prime() {},
    cancel() {
      cancelled += 1;
      if (active && !active.done) {
        active.done = true;
        active.resolve();
      }
      active = null;
    },
    speak(text, _p, opts) {
      spoken.push(text);
      return new Promise<void>((resolve) => {
        const me = { text, opts, resolve, done: false };
        active = me;
        opts?.onStart?.();
        // Word boundaries at each word start.
        let idx = 0;
        const words = text.split(" ");
        let offset = 0;
        const tick = () => {
          if (me.done) return;
          if (idx >= words.length) {
            me.done = true;
            if (active === me) active = null;
            opts?.onEnd?.();
            resolve();
            return;
          }
          opts?.onProgress?.(offset);
          offset += words[idx].length + 1;
          idx += 1;
          c.timers.setTimeout(tick, words[Math.max(0, idx - 1)].length * msPerChar + msPerChar);
        };
        c.timers.setTimeout(tick, 1);
      });
    },
  };
  return { synth, spoken, get cancelled() { return cancelled; } };
}

/** Recognizer the test drives by hand. */
function fakeRecognizer() {
  let events: RecognizerEvents | null = null;
  let opts: RecognizerStartOptions | undefined;
  const log: string[] = [];
  const rec: SpeechRecognizer & { say: (t: string, final?: boolean) => void; end: () => void; get monitor(): boolean; armed: boolean; resets: number } = {
    available: true,
    armed: true,
    resets: 0,
    start(e, o) {
      events = e;
      opts = o;
      rec.armed = !o?.monitor;
      log.push(`start${o?.monitor ? ":monitor" : ""}`);
    },
    armEndpointing(o) {
      rec.armed = true;
      if (o?.reset) rec.resets += 1;
      log.push(`arm${o?.reset ? ":reset" : ""}`);
    },
    stop() {
      log.push("stop");
      const e = events;
      events = null;
      e?.onFinal(current);
      e?.onEnd();
    },
    abort() {
      log.push("abort");
      events = null;
    },
    say(t, final = false) {
      current = t;
      events?.onInterim(t, { isFinal: final });
    },
    end() {
      const e = events;
      events = null;
      e?.onFinal(current);
      e?.onEnd();
      current = "";
    },
    get monitor() {
      return !!opts?.monitor && !rec.armed;
    },
  };
  let current = "";
  return { rec, log };
}

/** Transport whose replies the test controls: streams sentences on demand and resolves when told. */
function fakeTransport(c: ReturnType<typeof clock>) {
  const sent: { text: string; modality: string; interrupted?: DeliveryReport }[] = [];
  const reports: DeliveryReport[] = [];
  let turnIndex = 1;
  let pending: { onSpeech: (s: string, d: boolean) => void; resolve: (l: NpcLine | null) => void; reject: (e: Error) => void } | null = null;
  const transport: ConversationTransport = {
    sendTurn(input, onSpeech) {
      sent.push({ text: input.text, modality: input.modality, interrupted: input.interrupted });
      return new Promise<NpcLine | null>((resolve, reject) => {
        pending = { onSpeech, resolve, reject };
      });
    },
    async reportDelivery(report) {
      reports.push(report);
    },
  };
  /** Stream a full reply in sentence steps and commit it. */
  const reply = async (sentences: string[], opts: { commitDelayMs?: number } = {}) => {
    const p = pending!;
    let soFar = "";
    for (const s of sentences) {
      soFar = soFar ? `${soFar} ${s}` : s;
      p.onSpeech(soFar, false);
      await c.flush();
    }
    if (opts.commitDelayMs) await c.advance(opts.commitDelayMs);
    p.onSpeech(soFar, true);
    const line = { npcText: soFar, npcTurnIndex: (turnIndex += 2) };
    pending = null;
    p.resolve(line);
    await c.flush();
    return line;
  };
  const fail = async (msg: string) => {
    const p = pending!;
    pending = null;
    p.reject(new Error(msg));
    await c.flush();
  };
  return { transport, sent, reports, reply, fail, get pending() { return pending !== null; } };
}

function setup(options: { textOnly?: boolean; autoListen?: boolean; voiceBargeIn?: boolean } = {}) {
  const c = clock();
  const s = fakeSynth(c);
  const r = fakeRecognizer();
  const t = fakeTransport(c);
  const delivered: NpcLine[] = [];
  const interrupted: DeliveryReport[] = [];
  const ctl = new ConversationController({
    profile,
    transport: t.transport,
    recognizer: r.rec,
    synthesizer: s.synth,
    textOnly: options.textOnly,
    voiceBargeIn: options.voiceBargeIn,
    autoListen: () => options.autoListen ?? false,
    onLineDelivered: (l) => delivered.push(l),
    onLineInterrupted: (rep) => interrupted.push(rep),
    timers: c.timers,
  });
  return { c, s, r, t, ctl, delivered, interrupted };
}

describe("ConversationController", () => {
  it("speaks sentence by sentence as the reply streams, captions follow the audio, and the line is delivered", async () => {
    const { c, s, t, ctl, delivered } = setup();
    const p = ctl.sendText("Hi Emma");
    await c.flush();
    expect(ctl.getSnapshot().state).toBe("thinking");
    expect(t.sent[0]).toMatchObject({ text: "Hi Emma", modality: "text" });
    const line = await t.reply(["Hi Asha.", "Where are you on the offer?"]);
    expect(ctl.getSnapshot().state).toBe("speaking");
    // Audio starts on the first complete sentence, before the reply is committed.
    expect(s.spoken[0]).toBe("Hi Asha.");
    expect(ctl.getSnapshot().caption.length).toBeLessThan(line.npcText.length);
    await c.advance(5000);
    await p;
    expect(s.spoken).toEqual(["Hi Asha.", "Where are you on the offer?"]);
    expect(ctl.getSnapshot()).toMatchObject({ state: "idle", caption: line.npcText, captionLive: false });
    expect(delivered).toEqual([line]);
  });

  it("interruption by tap: cancels audio, reports exactly the heard prefix with the next line, never plays the rest", async () => {
    const { c, s, t, ctl, r, interrupted } = setup();
    void ctl.sendText("I'd like ten lakh.");
    await c.flush();
    const line = await t.reply(["The specifics help.", "I can take base to nine point two lakh.", "That is a real stretch."]);
    // First sentence finished (~1 s), second is playing.
    await c.advance(1400);
    expect(ctl.getSnapshot().state).toBe("speaking");
    ctl.startListening(); // tap = barge-in
    expect(ctl.getSnapshot().state).toBe("listening");
    expect(s.cancelled).toBe(1);
    const heardAtCut = ctl.getSnapshot().caption;
    expect(heardAtCut.startsWith("The specifics help.")).toBe(true);
    expect(heardAtCut).not.toContain("stretch");
    // Nothing more plays after the cut.
    const spokenAtCut = s.spoken.length;
    await c.advance(5000);
    expect(s.spoken.length).toBe(spokenAtCut);
    // The player's line carries the delivery report.
    r.rec.say("what about a signing bonus");
    r.rec.end();
    await c.flush();
    expect(t.sent[1].modality).toBe("voice");
    expect(t.sent[1].text).toBe("what about a signing bonus");
    expect(t.sent[1].interrupted).toEqual({ turnIndex: line.npcTurnIndex, heardText: heardAtCut });
    expect(interrupted).toEqual([{ turnIndex: line.npcTurnIndex, heardText: heardAtCut }]);
  });

  it("interruption followed by silence reports the cut-off on its own; wrap-up waits for it", async () => {
    const { c, t, ctl } = setup();
    void ctl.sendText("Hello");
    await c.flush();
    const line = await t.reply(["One sentence here.", "And a second one."]);
    await c.advance(300);
    await ctl.cancelSpeaking();
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0].turnIndex).toBe(line.npcTurnIndex);
    expect(line.npcText.startsWith(t.reports[0].heardText)).toBe(true);
    expect(t.reports[0].heardText).not.toContain("second");
    expect(ctl.getSnapshot().state).toBe("idle");
  });

  it("cutting in before the server has committed the line still reports it once the index is known", async () => {
    const { c, t, ctl, r } = setup();
    void ctl.sendText("Hello");
    await c.flush();
    // Stream the first sentence but don't commit yet.
    const stream = t.reply(["Look, honestly.", "The band is fixed."], { commitDelayMs: 3000 });
    await c.advance(200);
    expect(ctl.getSnapshot().state).toBe("speaking");
    ctl.startListening();
    r.rec.say("hang on a second");
    r.rec.end();
    await c.flush();
    // The new line waits for the previous one to be committed.
    expect(t.sent).toHaveLength(1);
    const line = await stream;
    await c.flush();
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].interrupted?.turnIndex).toBe(line.npcTurnIndex);
    expect(t.sent[1].interrupted?.heardText.length).toBeLessThan(line.npcText.length);
  });

  it("hands-free barge-in: the player's own words cut the NPC off, echo does not", async () => {
    const { c, s, t, ctl, r } = setup();
    void ctl.sendText("Hello");
    await c.flush();
    await t.reply(["The base can't move beyond nine point two at this level.", "But there is a joining bonus."]);
    expect(r.log.at(-1)).toBe("start:monitor");
    expect(ctl.getSnapshot().bargeInArmed).toBe(true);
    // The mic hears Emma herself: not a barge-in.
    r.rec.say("the base can't move");
    expect(ctl.getSnapshot().state).toBe("speaking");
    expect(s.cancelled).toBe(0);
    // The player talks over her: one stray result is not enough, persistence confirms it.
    r.rec.say("the base can't move what about");
    expect(ctl.getSnapshot().state).toBe("speaking");
    await c.advance(400);
    r.rec.say("the base can't move what about a signing");
    expect(ctl.getSnapshot().state).toBe("listening");
    expect(s.cancelled).toBe(1);
    expect(r.log.at(-1)).toBe("arm");
    r.rec.say("the base can't move what about a signing bonus");
    r.rec.end();
    await c.advance(100);
    // Echoed NPC words are stripped from the front of the player's line.
    expect(t.sent[1].text).toBe("what about a signing bonus");
    expect(t.sent[1].interrupted?.heardText).not.toContain("joining bonus");
  });

  it("hands-free: when the NPC finishes, the monitoring session becomes the player's turn with no gap", async () => {
    const { c, t, ctl, r } = setup({ autoListen: true });
    ctl.startListening();
    r.rec.say("hi emma");
    r.rec.end();
    await c.flush();
    await t.reply(["Hi Asha."]);
    await c.advance(3000);
    expect(ctl.getSnapshot().state).toBe("listening");
    expect(r.log.at(-1)).toBe("arm:reset");
    expect(r.rec.resets).toBe(1);
  });

  it("stale audio never plays: a new line cancels the previous one's remaining sentences", async () => {
    const { c, s, t, ctl } = setup();
    void ctl.sendText("First");
    await c.flush();
    await t.reply(["Sentence one of the first reply.", "Sentence two of the first reply.", "Sentence three."]);
    await c.advance(200);
    void ctl.sendText("Second");
    await c.advance(100);
    expect(s.cancelled).toBe(1);
    await t.reply(["Reply two."]);
    await c.advance(5000);
    expect(s.spoken).toEqual(["Sentence one of the first reply.", "Reply two."]);
  });

  it("rapid back-and-forth: lines are sent in order, each after the previous is committed", async () => {
    const { c, t, ctl } = setup();
    void ctl.sendText("One");
    void ctl.sendText("Two");
    await c.flush();
    expect(t.sent.map((s) => s.text)).toEqual(["One"]);
    await t.reply(["Reply one."]);
    await c.advance(3000);
    expect(t.sent.map((s) => s.text)).toEqual(["One", "Two"]);
  });

  it("an accidental double submission of the same line is ignored", async () => {
    const { c, t, ctl } = setup();
    void ctl.sendText("Yes, I accept.");
    void ctl.sendText("Yes, I accept.");
    await c.flush();
    await t.reply(["Brilliant."]);
    await c.advance(3000);
    expect(t.sent).toHaveLength(1);
  });

  it("a failed send keeps the line for retry and stays out of the way of text input", async () => {
    const { c, t, ctl } = setup();
    void ctl.sendText("Hello there");
    await c.flush();
    await t.fail("Network down");
    expect(ctl.getSnapshot()).toMatchObject({ state: "error", error: "Network down", failedLine: { text: "Hello there", modality: "text" } });
    void ctl.retry();
    await c.flush();
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].text).toBe("Hello there");
    await t.reply(["Hi."]);
    await c.advance(2000);
    expect(ctl.getSnapshot()).toMatchObject({ state: "idle", failedLine: null, error: null });
  });

  it("an empty turn after cutting in leaves the scene idle and reports the cut-off", async () => {
    const { c, t, ctl, r } = setup();
    void ctl.sendText("Hello");
    await c.flush();
    await t.reply(["A long first sentence for Emma to say.", "A second."]);
    await c.advance(300);
    ctl.startListening();
    r.rec.end(); // nothing said
    await c.flush();
    expect(ctl.getSnapshot().state).toBe("idle");
    expect(t.reports).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it("text-only mode shows the streamed text as the caption and delivers immediately", async () => {
    const { c, t, ctl, delivered } = setup({ textOnly: true });
    void ctl.sendText("Hi");
    await c.flush();
    const line = await t.reply(["Hi Asha.", "Where are you on the offer?"]);
    expect(ctl.getSnapshot()).toMatchObject({ state: "idle", caption: line.npcText });
    expect(delivered).toEqual([line]);
  });
});

describe("ConversationController lifecycle", () => {
  it("stop() (UI unmount / strict-mode remount) silences everything but leaves the session usable", async () => {
    const { c, s, t, ctl } = setup();
    void ctl.sendText("Hello");
    await c.flush();
    await t.reply(["A first sentence here.", "And a second."]);
    await c.advance(200);
    ctl.stop();
    expect(s.cancelled).toBe(1);
    expect(ctl.getSnapshot().state).toBe("idle");
    void ctl.sendText("Still there?");
    await c.advance(100);
    expect(t.sent.map((x) => x.text)).toEqual(["Hello", "Still there?"]);
  });
});
