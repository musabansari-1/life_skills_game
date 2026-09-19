import { describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINTING, Endpointer, looksIncomplete, looksShortAndComplete, silenceFor, type EndpointingOptions } from "./endpointing";

/** Deterministic timer harness: fires callbacks when the clock advances past them. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    set: (fn: () => void, ms: number) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t: ReturnType<typeof setTimeout>) => void pending.delete(t as unknown as number),
    now: () => now,
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      const next = [...pending.entries()].filter(([, p]) => p.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      pending.delete(next[0]);
      next[1].fn();
    }
    now = target;
  };
  return { timers, advance };
}

const opts: EndpointingOptions = { silenceMs: 1000, shortSilenceMs: 500, longSilenceMs: 2500, finalSilenceMs: 600, noSpeechMs: 5000, maxMs: 20000 };

describe("silenceFor", () => {
  it("waits longer when the speaker trails off mid-thought", () => {
    expect(looksIncomplete("I was hoping for something around")).toBe(true);
    expect(looksIncomplete("I was hoping for something around ten")).toBe(true);
    expect(looksIncomplete("what I'd really like is, um")).toBe(true);
    expect(looksIncomplete("nine point")).toBe(true);
    expect(looksIncomplete("I was hoping for ten lakh")).toBe(false);
    expect(silenceFor("I was hoping for something around", { isFinal: false }, opts)).toBe(2500);
    expect(silenceFor("I was hoping for something around ten", { isFinal: true }, opts)).toBe(2500);
  });

  it("ends short, complete answers quickly", () => {
    expect(looksShortAndComplete("yes")).toBe(true);
    expect(looksShortAndComplete("okay, deal")).toBe(true);
    expect(looksShortAndComplete("okay so what I")).toBe(false);
    expect(silenceFor("Sounds good.", { isFinal: false }, opts)).toBe(500);
  });

  it("uses the engine's final result to end complete lines sooner, and gives slow speakers more time", () => {
    expect(silenceFor("I'd like ten lakh", { isFinal: true }, opts)).toBe(600);
    expect(silenceFor("I'd like ten lakh", { isFinal: false }, opts)).toBe(1000);
    expect(silenceFor("I'd like ten lakh", { isFinal: false, gapMs: 1500 }, opts)).toBe(1300);
    // Never beyond the long bound.
    expect(silenceFor("I was hoping for something around", { isFinal: false, gapMs: 3000 }, opts)).toBe(2500);
  });

  it("defaults are sane", () => {
    expect(DEFAULT_ENDPOINTING.shortSilenceMs).toBeLessThan(DEFAULT_ENDPOINTING.silenceMs);
    expect(DEFAULT_ENDPOINTING.silenceMs).toBeLessThan(DEFAULT_ENDPOINTING.longSilenceMs);
  });
});

describe("Endpointer", () => {
  it("does not cut off a speaker who pauses mid-sentence, then ends after the completed thought", () => {
    const { timers, advance } = fakeTimers();
    const ended: string[] = [];
    const e = new Endpointer((r) => ended.push(r), opts, timers);
    e.start();
    e.activity("I was hoping for something around");
    advance(1200); // longer than the default pause; the sentence is unfinished so we wait
    expect(ended).toEqual([]);
    e.activity("I was hoping for something around ten lakh", { isFinal: true });
    advance(500);
    expect(ended).toEqual([]);
    advance(200);
    expect(ended).toEqual(["silence"]);
  });

  it("ends the turn after a pause once something complete was said", () => {
    const { timers, advance } = fakeTimers();
    const ended: string[] = [];
    const e = new Endpointer((r) => ended.push(r), opts, timers);
    e.start();
    e.activity("hi emma thanks for the call");
    advance(800);
    e.activity("hi emma thanks for the call today");
    advance(800);
    expect(ended).toEqual([]);
    advance(300);
    expect(ended).toEqual(["silence"]);
  });

  it("ends an empty turn if nothing is said, and caps long turns", () => {
    const { timers, advance } = fakeTimers();
    const silent: string[] = [];
    new Endpointer((r) => silent.push(r), opts, timers).start();
    advance(5000);
    expect(silent).toEqual(["no_speech"]);

    const t2 = fakeTimers();
    const long: string[] = [];
    const e = new Endpointer((r) => long.push(r), opts, t2.timers);
    e.start();
    for (let i = 0; i < 60; i++) {
      e.activity(`word ${i} and`);
      t2.advance(400);
    }
    expect(long).toEqual(["max_length"]);
  });

  it("in monitor mode nothing ends the turn until armed", () => {
    const { timers, advance } = fakeTimers();
    const ended: string[] = [];
    const e = new Endpointer((r) => ended.push(r), opts, timers);
    e.start({ armed: false });
    advance(6000);
    expect(ended).toEqual([]);
    e.activity("what about a signing bonus");
    advance(3000);
    expect(ended).toEqual([]);
    e.arm();
    advance(1100);
    expect(ended).toEqual(["silence"]);
  });

  it("does nothing after cancel", () => {
    const { timers, advance } = fakeTimers();
    const ended: string[] = [];
    const e = new Endpointer((r) => ended.push(r), opts, timers);
    e.start();
    e.activity("hello");
    e.cancel();
    advance(30000);
    expect(ended).toEqual([]);
  });
});
