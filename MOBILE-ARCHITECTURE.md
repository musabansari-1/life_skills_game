# Mobile Architecture Review

**Scope.** This review checks whether the Counterpart game system, built first as a Next.js web app, can serve future Web/PWA, iOS and Android clients. Every core system was inspected. Changes were limited to places with a concrete, practical payoff. Nothing was rewritten for architectural purity, and the web UI is unchanged apart from where it gets its data.

**Verdict.** The core was already sound for multiple clients: the simulation, memory, quests, world state, competencies, evaluation and AI layer. The coupling was in how the game was *exposed*. Auth was cookie-and-server-action only, every read was server-rendered HTML, the turn endpoint was stream-only, and turn submission wasn't safe against retries. All of that is now fixed. The browser app is now the first client of a versioned JSON API that a native app can use unchanged. That was verified end to end over HTTP with bearer tokens (`scripts/api-smoke.ts`).

---

## 1. Current architecture

```
                        ┌────────────────────────── Next.js server ───────────────────────────┐
 Web (browser) ───────► │ Server Components ─┐                                                │
   cookie session       │                    ├─► server/queries.ts  (read models → DTOs)      │
                        │ /api/v1/* routes ──┤   server/account.ts  (sign up / in / onboard)  │
 Native (future) ─────► │  (JSON + SSE)      └─► server/orchestrator.ts (GameService: loop)   │
   bearer token         │                              │            │                        │
                        │                              ▼            ▼                        │
                        │                        src/engine    src/ai (providers + tasks)     │
                        │                        (pure logic)  src/content (quests/NPCs)     │
                        │                              │                                     │
                        │                              ▼                                     │
                        │                        src/db (Drizzle + libsql/SQLite)            │
                        └─────────────────────────────────────────────────────────────────────┘
 Shared by all clients: src/contracts/api.ts (zod schemas), src/client/* (API SDK), src/voice/{types,chunker,useVoiceSession}
```

| Layer | Path | Runs where | Depends on |
|---|---|---|---|
| Domain engine | `src/engine` | anywhere (pure TS) | zod only |
| Content | `src/content` | server | engine |
| AI | `src/ai` | server only (holds API keys) | engine types |
| Game service | `src/server/orchestrator.ts` | server | engine, ai, content, db |
| Read models | `src/server/queries.ts`, `game-view.ts` | server | engine, content |
| Auth service | `src/server/auth.ts`, `account.ts` | server | db (no Next.js) |
| Next adapter | `src/server/session.ts`, `src/app/actions/*` | server (Next) | `next/headers` |
| HTTP API | `src/app/api/v1/*` | server (Next route handlers) | services above |
| Public contract | `src/contracts/api.ts` | anywhere | zod, engine types |
| Client SDK | `src/client/*` | any JS runtime | contracts |
| Voice core | `src/voice/{types,chunker,useVoiceSession}.ts` | any React runtime | nothing platform-specific |
| Web UI | `src/app/**/page.tsx`, `src/components`, `src/voice/browser.ts` | browser | Next, DOM |

## 2. Already mobile-ready (category 1)

These were inspected and left unchanged:

| System | Why it's ready |
|---|---|
| **NPC simulation** (`engine/scene`) | A pure reducer turns the NPC's perception and proposals into scene state. There is no IO and no framework. |
| **NPC persistent memory** (`engine/memory`, `npc_states` table) | Structured merge, caps and prompt selection are pure. Memory is stored server-side per player and NPC. |
| **Quest engine** (`engine/quests`, `engine/world` prerequisites, `src/content/quests`) | Typed content plus pure predicates, evaluated on the server. |
| **World state and consequences** (`engine/world`) | One write path (`applyConsequences`) and a server-authoritative document. |
| **Competency and skills** (`engine/competency`) | Pure math, covered by unit tests. |
| **Evaluation** (`ai/tasks/evaluate`) | A server-side AI task with a zod-validated contract. Clients only ever see the result. |
| **AI provider integrations** (`ai/provider.ts`, `ai/registry.ts`) | An `LLMProvider` interface with Anthropic, OpenAI-compatible and Fake implementations, picked by env. Keys never leave the server. |
| **Orchestrator** (`server/orchestrator.ts`) | Dependency-injected `GameService`. The whole loop runs in tests on an in-memory DB. |
| **Persistence** | All game state is server-side and validated on load. Migrations live in `drizzle/`. |
| **Hidden-information boundary** | Hidden NPC state was already stripped before reaching the client. It is now enforced by the contract schemas and a test. |

## 3. Intentionally web-specific

These stay web-only. A native app replaces them rather than reusing them:

- **Pages and components** (`src/app/**/page.tsx`, `*.tsx` under `app/` and `components/`). They are server components, Tailwind styling and DOM.
- **`src/voice/browser.ts`.** It holds the Web Speech API STT/TTS implementations and `createBrowserVoiceProviders()`.
- **`src/server/session.ts` cookie handling and `src/app/actions/auth.ts`.** These are server actions that set an httpOnly cookie.
- **`src/proxy.ts`.** It redirects web page visitors without a cookie and doesn't touch `/api/v1`.
- **Web-only UI states.** The results reveal choreography, the world map SVG and the Playwright walkthrough.

## 4. Shared domain and game systems

Every rule of the game runs on the server behind `GameService`. No client, web or native, reimplements any of it. Clients render state and send player utterances.

| Capability | Entry point |
|---|---|
| Start a scene (prerequisites, hidden state, opening line) | `GameService.startQuest` |
| Take a turn (NPC generation, safety nets, reducer) | `GameService.submitPlayerTurn` |
| Conclude (evaluation, outcome, XP, memory, consequences) | `GameService.concludeQuest` |
| Abandon | `GameService.abandonQuest` |
| Read models | `server/queries.ts`: `worldOverview`, `questBriefing`, `dossier`, `attemptEnvelope`, `debrief` |
| Accounts | `server/account.ts`: `registerAccount`, `loginAccount`, `onboardPlayer` |

## 5. Backend and API boundaries

All routes live under **`/api/v1`**, and every response matches a schema in `src/contracts/api.ts`. Errors are `{ error, code }`, with `code` one of `unauthorized | forbidden | not_found | prerequisites | state | conflict | ai | validation | internal`.

| Method | Path | Returns | Notes |
|---|---|---|---|
| POST | `/auth/signup` | `AuthSession` (201) | `{ token, expiresAt, player }` |
| POST | `/auth/signin` | `AuthSession` | |
| POST | `/auth/signout` | `{ ok }` | Revokes the calling token or cookie |
| GET | `/me` | `PlayerIdentity` | Validates a stored token on launch |
| POST | `/me/onboarding` | `{ displayName }` | |
| GET | `/world` | `WorldOverview` | Worlds, quest cards, skills, people, promises, active scene, `stateVersion` |
| GET | `/quests/:id` | `QuestBriefingView` | Briefing, whether it can start, unmet reasons, NPC dossier |
| POST | `/quests/:id/start` | `AttemptEnvelope` (201) | `{ attempt, scene }`, where `scene` has the NPC voice profile |
| GET | `/attempts/active` | `{ active: AttemptEnvelope \| null }` | Resume after restart or on another device |
| GET | `/attempts/:id` | `AttemptEnvelope` | Resync after a 409 or a drop |
| POST | `/attempts/:id/turn` | `TurnResponse` (JSON) **or** SSE | Content negotiation, see §8 |
| POST | `/attempts/:id/conclude` | `{ attemptId, status }` | 10–120 s. Exactly-once, see §9 |
| GET | `/attempts/:id/result` | `Debrief` | 409 until concluded |
| GET | `/characters/:id` | `Dossier` | Memory, standing, history |
| POST | `/events/share` | `{ ok }` | Analytics only |

Status mapping: validation errors return 400. Unauthorized returns 401. Forbidden returns 403. Not found returns 404. Prerequisites, state and conflict errors return 409. AI failures return 502.

**Versioning rule.** Within v1, changes are additive only (new optional fields and new routes). A breaking change needs `/api/v2` and a new contract module, because native binaries in the wild can't be force-updated.

## 6. Shared schemas and types

- **`src/contracts/api.ts`** is the single source of truth for the wire format: zod schemas plus inferred TS types. It depends only on `zod` and pure engine types, such as `EvaluationSchema`, `QuestRewardsSchema` and `RelationshipSchema`.
- **Server** routes and `queries.ts` return these types, and the tests parse real outputs through the schemas.
- **Clients** validate every response with the same schemas (`src/client/gameClient.ts`). A client/server version skew fails loudly instead of rendering garbage.
- For a native codebase in a separate repo, publish `src/contracts` together with `src/engine/types` as a small package, or copy them. Neither has platform dependencies. A monorepo (`packages/contracts`, `packages/client`) is the natural next step once a second client exists (see §15).

## 7. Authentication approach for mobile

- One session model for all clients: opaque random tokens, stored **hashed** in `sessions`, with 30-day expiry.
- **Web** keeps the httpOnly cookie, set by server actions. The token is never exposed to JavaScript.
- **Native** calls `POST /api/v1/auth/signin` or `/signup`, stores `token` in the Keychain or Keystore (`expo-secure-store`), and sends `Authorization: Bearer <token>`.
- `server/session.ts#getRequestToken` checks the bearer header first, then the cookie, so every `/api/v1` route serves both clients.
- `POST /auth/signout` revokes the token server-side.
- CORS isn't needed for native apps. Add it only if a separately hosted web client appears.

Recommended later additions, none of which block V1 native:
- **Sign in with Apple and Google.** Apple is required on iOS once any third-party login exists. Add them as extra ways to issue the same session token.
- **Token rotation or refresh**, if 30-day tokens become a concern.
- **Rate limiting** on the auth routes.

## 8. Voice and streaming architecture

The pipeline is split so that only the edges are platform-specific:

```
 [SpeechRecognizer]  →  ConversationController (turn-taking, barge-in,  →  ConversationTransport  →  server
   browser: Web Speech      delivery tracking; platform-neutral class)     (gameClient: streamTurn,     (text only)
   native: platform STT          ▲ wrapped by useVoiceSession (React)       reportDelivery)
 [SpeechSynthesizer] ←  sentence queue + DeliveryTracker  ←  server-gated NPC speech (SSE)
   browser: speechSynthesis
   native: expo-speech / server TTS
```

- **Contracts** (`src/voice/types.ts`) define `SpeechRecognizer`, `SpeechSynthesizer` and `ConversationTransport`.
- **The conversation state machine** (`src/voice/controller.ts`, `ConversationController`) is a plain class: no React, no DOM, no network. It handles idle, listening, thinking and speaking; sentence-queued TTS; barge-in by tap or by voice; stale-audio cancellation; ordered sends; retry; and **delivery tracking** (how much of each NPC line was actually heard). `useVoiceSession` is a thin React adapter. A Swift/Kotlin client ports this one class.
- **Sentence chunking** (`src/engine/parsing/sentences.ts`) is shared with the server's speech gate, so both sides split lines identically.
- **Endpointing** (`src/voice/endpointing.ts`) and **barge-in echo filtering** (`src/voice/bargeIn.ts`) are pure and reusable by native recognizers.
- **The server is audio-agnostic.** It receives text, streams text, and receives a text report of what was heard (`DeliveryReport`). Swapping STT/TTS vendors never touches the game.
- **Interruptions:** a client that cuts an NPC line off sends `interrupted: { turnIndex, heardText }` on its next `TurnRequest`, or `POST /attempts/:id/delivery` if the player then says nothing. Both are idempotent. See `REALTIME-CONVERSATION-REVIEW.md`.

**Streaming turn transport** uses content negotiation on `POST /attempts/:id/turn`:
- With `Accept: text/event-stream`, the server streams SSE. `speech` events carry the growing NPC line, followed by one `result` (a `ClientAttempt`) or one `error` (an `ApiError`). The web app uses this. On native, it works with a streaming-capable fetch such as `expo/fetch` (Expo SDK 52+).
- With any other `Accept`, the server returns one JSON `{ attempt, npcText }`. This works with React Native's default fetch, which can't stream response bodies.
- `SSEParser` (`src/client/sse.ts`) is a pure incremental parser, tested across arbitrary chunk boundaries.

## 9. Game-state synchronization

- **The server is authoritative.** Clients hold no game state beyond what they are rendering. There is no offline play for scenes, which need the AI anyway, so no client-side merge or CRDT is needed.
- **Turn submission is safe under retries and multiple devices.** The client sends `expectedTurnCount`, the number of turns it has seen:
  - If that doesn't match, the server returns **409 `conflict`** and appends nothing. The client then calls `GET /attempts/:id` to resync.
  - A second submit while a reply is still being generated also returns 409.
  - A unique-index collision from a true race maps to 409 instead of a raw 500.
  - A player turn orphaned by a server crash is cleared automatically after 2 minutes.
- **Concluding is exactly-once.** The attempt is claimed atomically (`active` → `evaluating`), so a retried or concurrent conclude returns 409 instead of evaluating twice. All effects commit in **one transaction**: world state, competencies, NPC memory and relationships, and the attempt result. A claim older than 5 minutes is treated as a crash and can be re-claimed. Once completed, conclude is an idempotent no-op.
- **Resume.** `GET /attempts/active` returns the in-progress scene, and `GET /world` includes `activeAttempt`.
- **Change detection.** `WorldOverview.stateVersion` increases on every world change. Clients can compare it to skip re-rendering.

## 10. AI orchestration architecture

This is unchanged and suitable as-is. All model calls happen on the server behind `LLMProvider`. There are separate tasks for the NPC turn (streamed speech plus moves), perception fallback, evaluation and memory extraction, each with zod contracts, repair and one corrective retry. Deterministic safety nets (`inferMovesFromSpeech`) keep weaker models from breaking the game. Per-task model routing uses env vars (`AI_MODEL_NPC`, `AI_MODEL_EVAL`, `AI_MODEL_MEMORY`). Every call is logged to `ai_calls`. Mobile clients never hold provider keys and never call models directly.

## 11. How a React Native client talks to the system

```ts
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { createGameClient } from "@counterpart/client";          // = src/client + src/contracts
import { useVoiceSession } from "@counterpart/voice";            // = src/voice/useVoiceSession + chunker

const api = createGameClient({
  baseUrl: "https://api.counterpart.app",
  fetch: expoFetch as typeof fetch,                              // streaming-capable
  getToken: () => SecureStore.getItemAsync("session"),
});

// launch
const me = await api.me().catch(() => null);                     // 401 → show sign-in
// sign in
const s = await api.signIn({ email, password }); await SecureStore.setItemAsync("session", s.token);
// home
const world = await api.world();
// scene
const { attempt, scene } = await api.startQuest("counter_offer", "voice");
const voice = useVoiceSession({
  profile: scene.npc.voice,
  recognizer: nativeRecognizer,          // implements SpeechRecognizer (e.g. expo-speech-recognition)
  synthesizer: nativeSynthesizer,        // implements SpeechSynthesizer (e.g. expo-speech); onProgress if the engine reports word boundaries
  sendTurn: async (text, modality, onSpeech, interrupted) => {
    const next = await api.streamTurn(attempt.id, { text, modality, expectedTurnCount: turnsSeen, interrupted }, { onSpeech });
    setAttempt(next);
    const npc = next.turns.filter((t) => t.speaker === "npc").at(-1);
    return npc ? { npcText: npc.text, npcTurnIndex: npc.index } : null;
  },
  reportDelivery: async (report) => setAttempt(await api.reportDelivery(attempt.id, report)),
});
// finish
await api.conclude(attempt.id);            // show "reading the room…" (10–120 s)
const debrief = await api.result(attempt.id);
```

A native Swift or Kotlin client does the same over plain HTTPS. It sends a bearer token, parses JSON matching the contract, and either requests the non-streaming turn or reads SSE with a platform SSE library.

## 12. What would actually need to be rewritten for native

- **All screens** in React Native components or SwiftUI/Compose. They'd be roughly equivalent to the 7 web screens, driven by the same DTOs.
- **Two small voice adapters**, `SpeechRecognizer` and `SpeechSynthesizer`, for the native speech APIs. Alternatively, a server STT/TTS behind the same interfaces.
- **Token storage and a sign-in screen** calling `/auth/*`. Add Apple and Google sign-in when needed.
- **Nothing else.** The game logic, AI, memory, persistence, contracts, the client SDK (in React Native) and the voice turn-taking hook (in React Native) are reused.

For Swift or Kotlin, the SDK and voice hook would be ported, not reused. They are small: under 300 lines each.

## 13. Architectural risks

| Risk | Severity | Notes |
|---|---|---|
| **Long synchronous conclude (10–120 s)** | Medium | Mobile OSes suspend apps mid-request. Now safe: exactly-once, with a 409 while evaluating and a stale-claim takeover. But the UX would be better as an async job with polling. `GET /attempts/active` doesn't return `evaluating` attempts, so clients must remember the attempt id. |
| **SQLite file database** | Medium (deployment) | Fine for one server. For serverless or horizontal scaling, move to Turso/libsql server (a URL change) or Postgres (a schema dialect swap; the schema is portable). This isn't mobile-specific. |
| **Voice quality and latency on native** | Medium | Browser and OS TTS voices vary. Real conversational feel likely needs a server TTS or a realtime audio pipeline (see Fable escalation). |
| **No rate limiting or abuse protection** | Medium | Each turn costs model tokens. Add per-token rate limits before any public mobile launch. |
| **Contract drift across repos** | Low | Mitigated by zod validation on both sides and contract tests. Publish contracts as a versioned package once a native repo exists. |
| **Content is compiled into the server** | Low | Deliberate. Clients get content through DTOs, never by importing quests, so new quests reach mobile without an app update. |
| **Dev-only hydration warning in Playwright runs** | None | Caused by Playwright injecting `caret-color` during screenshots, not the app. |

## 14. Changes made during this review, and why

| Finding (category) | Change |
|---|---|
| Auth was cookie and server-action only, so native apps couldn't log in (3) | Split `server/auth.ts` into a transport-agnostic service. Added `server/session.ts` (bearer header or cookie), `server/account.ts` (shared use-cases) and `/api/v1/auth/*`, `/me`, `/me/onboarding`. The web server actions now call the same service. |
| No JSON read API, so a native app couldn't show the map, briefing, results or dossier (3) | Added `server/queries.ts` read models and the matching `/api/v1` GET routes. Web pages now call the same functions, so web and native data are identical and not duplicated. |
| Turn endpoint was SSE-only, which default RN fetch can't read (3) | Added content negotiation: JSON unless `Accept: text/event-stream`. |
| Turn retries and concurrency caused duplicate turns or raw 500s (3) | Added `expectedTurnCount` optimistic concurrency, an in-flight guard, unique-violation mapping to 409 and orphan-turn recovery, all with tests. The unique-violation detection bug was found by the new test. |
| Concurrent or retried conclude could double-apply rewards and consequences (4, mobile-amplified) | Added an atomic `active → evaluating` claim, one transaction for all conclude writes and stale-claim takeover. Tests cover concurrency and crash recovery. |
| Unversioned API (2) | Moved every route to `/api/v1`. The old unversioned routes are removed because the web app was their only caller. |
| API DTO type lived in a web page folder and the turn route imported from UI code (2) | Created `src/contracts/api.ts` for all wire schemas. The mapper moved to `server/queries.ts`. |
| `maxTurns` was always 12 on streamed turns (bug) | The mapper now looks up the quest's real limit. |
| SSE parsing inline in a React component (2) | Added `src/client/sse.ts` (pure parser) and `src/client/gameClient.ts` (platform-neutral SDK with injectable fetch and token). The web scene, start button and share button now use it. |
| Voice hook built browser providers internally (2) | Providers are now injected. `createBrowserVoiceProviders()` lives in the web layer, and `chunker.ts` was extracted. The hook has no browser code. The web scene now creates providers after hydration, which also fixes a server/client render mismatch. |
| Pages computed domain data inline (2) | The world, briefing, dossier, results and play pages read from `server/queries.ts`. The JSX is unchanged. |

Not changed on purpose: the engine, AI layer, content, DB schema, UI design, the Next.js stack and SQLite. None of them blocks native clients.

**Verification.**
- 87 unit and integration tests pass. There are new tests for contract conformance, hidden-state leakage, bearer auth, turn concurrency, exactly-once conclude, SSE parsing, the chunker and the client SDK.
- `tsc`, eslint and `next build` pass.
- The browser Playwright walkthrough passes on desktop and mobile widths.
- A new HTTP-level native simulation, `scripts/api-smoke.ts`, passes all 16 checks with bearer tokens. It covers JSON and SSE turns, the 409 resync, conclude, debrief, dossier and revocation.

## 15. Recommended mobile implementation path

1. **Stand up the API for real clients.** Deploy with Turso/libsql or Postgres, add per-token rate limiting, and set `SESSION_SECRET`.
2. **Make conclude async** (see Fable escalation). Have `POST /conclude` return 202, and let the client poll `GET /attempts/:id` until `completed`. Also include `evaluating` attempts in `/attempts/active`.
3. **Extract packages** once a second client repo exists. Create `packages/contracts` (from `src/contracts` plus `src/engine/types`), `packages/client` (from `src/client`) and `packages/voice-core` (the hook, chunker and types). Use pnpm workspaces. There are no code changes, only moves.
4. **Build an Expo (React Native) app.** Include sign-in with secure token storage, then Home (`/world`), Briefing, Scene (reusing `useVoiceSession` with `expo-speech` and `expo-speech-recognition` adapters and `expo/fetch` streaming), Results and Dossier.
5. **Wrap the web app as a PWA** in the meantime: add a manifest, icons and a service worker that caches only static assets, since the game is online-only.
6. **Consider voice upgrades.** Measure latency on device. If OS voices or turn latency hurt the experience, move to server STT/TTS behind the existing interfaces, or to a realtime pipeline.
7. **Add store requirements:** Sign in with Apple, account deletion (`DELETE /api/v1/me`, required by the App Store), and push notifications for "Emma wants to talk" hooks later.

---

## FABLE ESCALATION RECOMMENDATIONS

Only two items are complex or architecture-sensitive enough to justify a more capable model. Everything else above is ordinary implementation work.

1. **Realtime voice pipeline, if on-device latency or voice quality isn't good enough.** Moving from request/response text turns to duplex audio means server-side STT/TTS, WebSocket or WebRTC transport, and voice-activity detection with true barge-in. Interrupting the NPC mid-sentence would have to feed back into *what the NPC has actually said* and therefore into scene state and memory. That touches the NPC turn contract, the scene reducer's turn model and the voice state machine at once, and a naive implementation would desync spoken text from persisted dialogue. Escalate only after the current Web Speech / `expo-speech` path is measured and found lacking.

2. **Async conclusion job with exactly-once side effects.** The current synchronous conclude is now safe: an atomic claim, one transaction and stale takeover. Making it a background job (202 plus polling or push) is the right mobile UX. The subtle part is keeping the invariant that evaluation, memory extraction and consequences apply **exactly once**, across worker crashes, retries, multiple devices and a player who starts a new scene meanwhile. The AI steps run before the transaction and aren't idempotent. Getting job ownership, retry semantics and the `evaluating` lifecycle right is architecture-sensitive. The mechanical parts (a job table, a poll endpoint, a UI spinner) are not.
