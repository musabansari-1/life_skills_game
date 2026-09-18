import { describe, expect, it } from "vitest";
import { takeSpeakableChunks } from "@/voice/chunker";
import { createGameClient, GameApiError } from "./gameClient";
import { SSEParser } from "./sse";

describe("SSEParser", () => {
  it("handles events split across arbitrary chunk boundaries", () => {
    const payload = 'event: speech\ndata: {"text":"Hi","done":false}\n\nevent: result\ndata: {"a":1}\n\n';
    for (let cut = 1; cut < payload.length; cut += 7) {
      const p = new SSEParser();
      const events = [...p.push(payload.slice(0, cut)), ...p.push(payload.slice(cut)), ...p.end()];
      expect(events.map((e) => e.event)).toEqual(["speech", "result"]);
      expect(JSON.parse(events[1].data)).toEqual({ a: 1 });
    }
  });
  it("supports CRLF, comments, multi-line data and a trailing unterminated event", () => {
    const p = new SSEParser();
    const ev = [...p.push(": keepalive\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\ndata: tail"), ...p.end()];
    expect(ev).toEqual([
      { event: "x", data: "a\nb" },
      { event: "message", data: "tail" },
    ]);
  });
});

describe("takeSpeakableChunks", () => {
  it("releases only complete sentences until done", () => {
    let consumed = 0;
    let r = takeSpeakableChunks("Look, honestly. The band is", consumed, false);
    expect(r.chunks).toEqual(["Look, honestly."]);
    consumed = r.consumed;
    r = takeSpeakableChunks("Look, honestly. The band is fixed. What else?", consumed, false);
    expect(r.chunks).toEqual(["The band is fixed.", "What else?"]);
    consumed = r.consumed;
    r = takeSpeakableChunks("Look, honestly. The band is fixed. What else? Okay", consumed, true);
    expect(r.chunks).toEqual(["Okay"]);
  });
});

/** Minimal in-memory fake of the HTTP API to exercise the client without a server. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}

const attempt = { id: "a1", questId: "counter_offer", npcId: "emma_kapoor", status: "active", turns: [], visibleStatus: [], mood: "neutral", ended: null, turnCount: 1, maxTurns: 12 };

describe("createGameClient", () => {
  it("sends bearer tokens and maps ApiError responses", async () => {
    const seen: RequestInit[] = [];
    const api = createGameClient({
      baseUrl: "https://game.example",
      getToken: async () => "tok123",
      fetch: fakeFetch((url, init) => {
        seen.push(init);
        expect(url).toBe("https://game.example/api/v1/me");
        return new Response(JSON.stringify({ error: "Not signed in", code: "unauthorized" }), { status: 401 });
      }),
    });
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(GameApiError);
    expect(err).toMatchObject({ code: "unauthorized", status: 401 });
    expect((seen[0].headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  it("streams a turn over SSE and returns the validated attempt", async () => {
    const body =
      'event: speech\ndata: {"text":"Hi","done":false}\n\n' +
      'event: speech\ndata: {"text":"Hi there.","done":true}\n\n' +
      `event: result\ndata: ${JSON.stringify(attempt)}\n\n`;
    const api = createGameClient({
      baseUrl: "",
      fetch: fakeFetch((_url, init) => {
        expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    });
    const speech: string[] = [];
    const res = await api.streamTurn("a1", { text: "hello", modality: "voice", expectedTurnCount: 1 }, { onSpeech: (s) => speech.push(s) });
    expect(res.id).toBe("a1");
    expect(speech).toEqual(["Hi", "Hi there."]);
  });

  it("surfaces an SSE error event as a typed conflict", async () => {
    const api = createGameClient({
      baseUrl: "",
      fetch: fakeFetch(() => new Response('event: error\ndata: {"error":"moved on","code":"conflict"}\n\n', { headers: { "Content-Type": "text/event-stream" } })),
    });
    await expect(api.streamTurn("a1", { text: "hi", modality: "text" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects responses that don't match the contract", async () => {
    const api = createGameClient({ baseUrl: "", fetch: fakeFetch(() => new Response(JSON.stringify({ attempt: { id: 1 } }), { status: 200 })) });
    await expect(api.attempt("a1")).rejects.toThrow();
  });
});
