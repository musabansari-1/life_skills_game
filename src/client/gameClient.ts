/**
 * Platform-neutral client for the /api/v1 game API.
 *
 * Works in the browser (web app), React Native / Expo, and Node (tests,
 * scripts). No DOM, no Next.js, no React. Inject `fetch` and a token getter:
 *
 *   // web (cookie auth, same origin)
 *   const api = createGameClient({ baseUrl: "" });
 *
 *   // React Native / Expo (bearer auth)
 *   import { fetch as expoFetch } from "expo/fetch";          // streaming-capable fetch
 *   const api = createGameClient({
 *     baseUrl: "https://api.example.com",
 *     fetch: expoFetch as typeof fetch,
 *     getToken: () => SecureStore.getItemAsync("session"),
 *   });
 *
 * Responses are validated against the zod contracts in src/contracts/api.ts,
 * so a client/server version mismatch fails loudly instead of rendering junk.
 */
import type { z } from "zod";
import {
  AckSchema,
  ActiveAttemptResponseSchema,
  ConcludeResponseSchema,
  API_BASE,
  ApiErrorSchema,
  AttemptEnvelopeSchema,
  AuthSessionSchema,
  ClientAttemptSchema,
  DebriefSchema,
  DeliveryResponseSchema,
  DossierSchema,
  PlayerIdentitySchema,
  QuestBriefingSchema,
  TurnResponseSchema,
  TurnSpeechEventSchema,
  WorldOverviewSchema,
  NarrativeViewSchema,
  type ApiErrorCode,
  type ClientAttempt,
  type Credentials,
  type DeliveryReport,
  type TurnRequest,
} from "@/contracts/api";
import { SSEParser } from "./sse";
import type { DirectorState } from "@/engine/director/types";
import type { TurnIdentity } from "@/engine/scene/ensemble";

export class GameApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GameApiError";
  }
}

export interface GameClientOptions {
  /** "" for same-origin web; absolute origin for native. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Bearer token for native clients. Omit on web (cookie auth). */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
}

export interface StreamTurnHandlers {
  onSpeaker?: (identity: TurnIdentity) => void;
  /** Growing NPC speech (captions + sentence-chunked TTS). */
  onSpeech?: (speechSoFar: string, done: boolean) => void;
}

export function createGameClient(opts: GameClientOptions) {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = `${opts.baseUrl.replace(/\/$/, "")}${API_BASE}`;

  async function headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
    const token = opts.getToken ? await opts.getToken() : null;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function fail(res: Response): Promise<never> {
    const raw = await res.json().catch(() => null);
    const parsed = ApiErrorSchema.safeParse(raw);
    if (parsed.success) throw new GameApiError(parsed.data.error, parsed.data.code, res.status);
    throw new GameApiError(`Request failed (${res.status})`, "internal", res.status);
  }

  async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    const res = await f(`${base}${path}`, { method, headers: await headers(), body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" });
    if (!res.ok) return fail(res);
    return schema.parse(await res.json());
  }

  return {
    // ---- auth
    signUp: (c: Credentials) => request("POST", "/auth/signup", AuthSessionSchema, c),
    signIn: (c: Credentials) => request("POST", "/auth/signin", AuthSessionSchema, c),
    signOut: () => request("POST", "/auth/signout", AckSchema, {}),
    me: () => request("GET", "/me", PlayerIdentitySchema),
    completeOnboarding: (displayName: string) => request("POST", "/me/onboarding", PlayerIdentitySchema.pick({ displayName: true }), { displayName }),

    // ---- reads
    world: () => request("GET", "/world", WorldOverviewSchema),
    refreshDirector: () => request("POST", "/director", NarrativeViewSchema, {}),
    saveGoals: (preferences: DirectorState["preferences"]) => request("PUT", "/director/goals", NarrativeViewSchema, preferences),
    quest: (questId: string) => request("GET", `/quests/${encodeURIComponent(questId)}`, QuestBriefingSchema),
    character: (npcId: string) => request("GET", `/characters/${encodeURIComponent(npcId)}`, DossierSchema),
    attempt: (attemptId: string) => request("GET", `/attempts/${encodeURIComponent(attemptId)}`, AttemptEnvelopeSchema),
    activeAttempt: async () => (await request("GET", "/attempts/active", ActiveAttemptResponseSchema)).active,
    result: (attemptId: string) => request("GET", `/attempts/${encodeURIComponent(attemptId)}/result`, DebriefSchema),

    // ---- scene
    startQuest: (questId: string, modality: "voice" | "text" = "text", mode: "story" | "practice" = "story") => request("POST", `/quests/${encodeURIComponent(questId)}/start`, AttemptEnvelopeSchema, { modality, mode }),
    abandon: (attemptId: string) => request("POST", `/attempts/${encodeURIComponent(attemptId)}/abandon`, AckSchema, {}),
    react: (attemptId: string, expectedTurnCount: number) => request("POST", `/attempts/${encodeURIComponent(attemptId)}/react`, AttemptEnvelopeSchema, { expectedTurnCount }),
    /** Can take 10-120 s (evaluation + memory). Show a waiting state; safe to retry (idempotent once completed). */
    conclude: (attemptId: string) => request("POST", `/attempts/${encodeURIComponent(attemptId)}/conclude`, ConcludeResponseSchema, {}),
    trackShare: (questId: string) => request("POST", "/events/share", AckSchema, { questId }),

    /**
     * Conclude with live progress (SSE). `onProgress` receives stages:
     * reviewing → remembering → evaluated → applying → done (plus "working" heartbeats).
     */
    async concludeWithProgress(attemptId: string, onProgress: (stage: string) => void): Promise<{ attemptId: string; status: string }> {
      const res = await f(`${base}/attempts/${encodeURIComponent(attemptId)}/conclude`, {
        method: "POST",
        headers: await headers({ Accept: "text/event-stream" }),
        body: "{}",
        credentials: "include",
      });
      if (!res.ok) return fail(res);
      const parser = new SSEParser();
      let result: { attemptId: string; status: string } | null = null;
      const handle = (events: ReturnType<SSEParser["push"]>) => {
        for (const ev of events) {
          const data = JSON.parse(ev.data);
          if (ev.event === "progress") onProgress(String(data.stage));
          else if (ev.event === "result") result = ConcludeResponseSchema.parse(data);
          else if (ev.event === "error") {
            const e = ApiErrorSchema.parse(data);
            throw new GameApiError(e.error, e.code, e.code === "conflict" ? 409 : 500);
          }
        }
      };
      const reader = res.body?.getReader?.();
      if (!reader) {
        handle([...parser.push(await res.text()), ...parser.end()]);
      } else {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          handle(parser.push(decoder.decode(value, { stream: true })));
        }
        handle(parser.end());
      }
      if (!result) throw new GameApiError("The connection dropped while finishing. Check the result in a moment.", "internal", 500);
      return result;
    },

    /** Non-streaming turn: one round trip, returns the whole reply. Works with any fetch. */
    sendTurn: (attemptId: string, turn: TurnRequest) => request("POST", `/attempts/${encodeURIComponent(attemptId)}/turn`, TurnResponseSchema, turn),

    /**
     * The player cut the NPC's last line off and said nothing after. Records
     * only the heard prefix as canon. When the player DOES follow with a line,
     * pass the report as `interrupted` on the turn instead. Idempotent.
     */
    reportDelivery: async (attemptId: string, report: DeliveryReport) => (await request("POST", `/attempts/${encodeURIComponent(attemptId)}/delivery`, DeliveryResponseSchema, report)).attempt,

    /**
     * Streaming turn over SSE. With a fetch whose Response.body is a
     * ReadableStream (browsers, Node 18+, `expo/fetch`) speech arrives
     * incrementally. Without one, the whole SSE payload is parsed at the end
     * (correct, just not incremental) — prefer `sendTurn` in that case.
     */
    async streamTurn(attemptId: string, turn: TurnRequest, handlers: StreamTurnHandlers = {}): Promise<ClientAttempt> {
      const res = await f(`${base}/attempts/${encodeURIComponent(attemptId)}/turn`, {
        method: "POST",
        headers: await headers({ Accept: "text/event-stream" }),
        body: JSON.stringify(turn),
        credentials: "include",
      });
      if (!res.ok) return fail(res);
      const reader = res.body?.getReader?.();
      if (!reader) {
        // Environment without streaming bodies: parse the whole SSE payload at once.
        return consumeSSE(await res.text(), handlers);
      }
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      let result: ClientAttempt | null = null;
      const handle = (events: ReturnType<SSEParser["push"]>) => {
        for (const ev of events) {
          const data = JSON.parse(ev.data);
          if (ev.event === "speech") {
            const s = TurnSpeechEventSchema.parse(data);
            if (s.identity) handlers.onSpeaker?.(s.identity);
            handlers.onSpeech?.(s.text, s.done);
          } else if (ev.event === "result") {
            result = ClientAttemptSchema.parse(data);
          } else if (ev.event === "error") {
            const e = ApiErrorSchema.parse(data);
            throw new GameApiError(e.error, e.code, e.code === "conflict" ? 409 : 500);
          }
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        handle(parser.push(decoder.decode(value, { stream: true })));
      }
      handle(parser.end());
      if (!result) throw new GameApiError("The reply was cut off. Try again.", "internal", 500);
      return result;
    },
  };
}

function consumeSSE(text: string, handlers: StreamTurnHandlers): ClientAttempt {
  const parser = new SSEParser();
  let result: ClientAttempt | null = null;
  for (const ev of [...parser.push(text), ...parser.end()]) {
    const data = JSON.parse(ev.data);
    if (ev.event === "speech") { if (data.identity) handlers.onSpeaker?.(data.identity); handlers.onSpeech?.(data.text, data.done); }
    else if (ev.event === "result") result = ClientAttemptSchema.parse(data);
    else if (ev.event === "error") {
      const e = ApiErrorSchema.parse(data);
      throw new GameApiError(e.error, e.code, 500);
    }
  }
  if (!result) throw new GameApiError("The reply was cut off. Try again.", "internal", 500);
  return result;
}

export type GameClient = ReturnType<typeof createGameClient>;
