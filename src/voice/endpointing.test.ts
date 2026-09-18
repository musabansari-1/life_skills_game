import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Endpointer } from "./endpointing";

describe("Endpointer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const opts = { silenceMs: 1000, noSpeechMs: 5000, maxMs: 20000 };

  it("ends the turn after a pause once something was said", () => {
    const onEnd = vi.fn();
    const e = new Endpointer(onEnd, opts);
    e.start();
    e.activity("hi emma");
    vi.advanceTimersByTime(800);
    e.activity("hi emma thanks for");
    vi.advanceTimersByTime(800);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onEnd).toHaveBeenCalledWith("silence");
  });

  it("ends an empty turn if nothing is said, and caps long turns", () => {
    const silent = vi.fn();
    new Endpointer(silent, opts).start();
    vi.advanceTimersByTime(5000);
    expect(silent).toHaveBeenCalledWith("no_speech");

    const long = vi.fn();
    const e = new Endpointer(long, opts);
    e.start();
    for (let i = 0; i < 40; i++) {
      e.activity(`word ${i}`);
      vi.advanceTimersByTime(500);
    }
    expect(long).toHaveBeenCalledWith("max_length");
    expect(long).toHaveBeenCalledTimes(1);
  });

  it("does nothing after cancel", () => {
    const onEnd = vi.fn();
    const e = new Endpointer(onEnd, opts);
    e.start();
    e.activity("hello");
    e.cancel();
    vi.advanceTimersByTime(30000);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
