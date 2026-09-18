# Development Handoff

This phase built the architecture, the core systems, and one end-to-end vertical slice (**The Counter Offer**). This document tells the next engineer/model how to continue without damaging the foundations.

Read `ARCHITECTURE.md` first. Content recipes are in `docs/ADDING-CONTENT.md`.

## Run it

```bash
pnpm install
cp .env.example .env.local        # optional; defaults run on the fake provider
pnpm dev                          # http://localhost:3000
pnpm test                         # 69 unit + integration tests, no model calls
pnpm smoke                        # full loop against the configured provider, in-memory DB
pnpm smoke aggressive             # the hostile path
npx tsx scripts/e2e-walkthrough.ts   # Playwright UI walkthrough using local Chrome (dev server must be running)
```

Providers: set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (default model `claude-opus-5`), or `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY` + `AI_MODEL=<slug>`. `AI_PROVIDER=fake` runs the whole game deterministically with heuristics — good for UI work.

Verified in this phase:
- Full loop with the fake provider (tests + Playwright walkthrough: sign up → onboarding → map → briefing → scene → results → follow-up → dossier).
- Full loop with a real model over OpenRouter (`deepseek/deepseek-v4-flash-0731:free`): Emma opened, negotiated, evaluation + memory extraction produced valid structured output; world state, relationship and memory persisted; follow-up quest unlocked. Free models are slow and flaky; a Claude model is the intended production path.
- Voice mode was **not** exercised end-to-end in an automated way (headless Chrome has no mic). The Web Speech code paths are straightforward but need a manual pass in Chrome with a microphone.

## Invariants — do not break these

1. **`src/engine` stays pure.** No IO, no AI, no Next imports. If you need data, pass it in. Everything there must be unit-testable.
2. **The NPC never grades the player.** Perception (`noticed`) and proposals are inputs to the deterministic reducer; scoring lives in the evaluator task only.
3. **Hidden state never reaches the client.** Only `toClientAttempt` output crosses the boundary. Don't add `hidden` or raw `patience` to it. `mood` is deliberately coarse.
4. **Scene state is ground truth.** Objectives with a `check` and outcome predicates read scene state, not the evaluator's opinion. The evaluator judges *how*; the reducer decides *what happened*.
5. **All AI output goes through zod.** Add new AI tasks via `runStructuredTask` (JSON) or the `<speech>/<moves>` format (dialogue). Never `JSON.parse` model output directly.
6. **World state changes only through `Consequence` + `applyConsequences`.** Don't mutate `WorldState` elsewhere. Relationship changes only through `applyRelationshipDelta` (clamped).
7. **Memory is structured.** Never store transcripts in `NPCMemory`. Extract → merge.
8. **Content is code.** Quests/NPCs/worlds are typed objects in `src/content`; `validateContent()` runs in tests. Keep predicates pure.
9. **Every persistent change emits an event.** Use `analytics.track` (DB + console) — it is also the game's history.

## Where things are

| Need | File |
|---|---|
| Add a quest | `src/content/quests/*.ts` + register in `src/content/quests/index.ts` |
| Add an NPC | `src/content/npcs/index.ts` |
| Add a world / location | `src/content/worlds.ts` (+ `createInitialWorldState` unlocks if open by default) |
| Change signals / stance rules | `src/engine/types/scene.ts`, `src/engine/scene/index.ts` |
| Change XP / levels / discovery | `src/engine/competency/index.ts` |
| Change prompts | `src/ai/tasks/npcTurn.ts`, `evaluate.ts`, `extractMemory.ts`, `perceive.ts` |
| Add a provider | implement `LLMProvider` in `src/ai/providers/`, register in `src/ai/registry.ts`, add env in `src/lib/env.ts` |
| Swap voice provider | implement `SpeechRecognizer` / `SpeechSynthesizer` in `src/voice/`, inject into `useVoiceSession` |
| Schema change | edit `src/db/schema.ts`, run `pnpm db:generate`, commit the migration in `drizzle/` |
| Game loop | `src/server/orchestrator.ts` |
| Screens | `src/app/{world,quests,play,results,characters}` |

## Known gaps and TODOs (prioritised)

**Product-critical**
1. **Manual voice QA in Chrome with a mic.** Check: mic permission prompt, interim transcript, barge-in while Emma is speaking, TTS voice selection on Windows/macOS/Android, Space push-to-talk. Tune `preferredVoiceHints` per NPC. Consider a server TTS (ElevenLabs/OpenAI) behind `SpeechSynthesizer` for quality — the interface is ready.
2. **Latency.** With `claude-opus-5` at `effort: "low"` NPC turns should be ~2–4 s to first sentence. If too slow, route `npc_turn` to `claude-sonnet-5` via `AI_MODEL_NPC` and keep evaluation on Opus. Consider prompt caching: the system prompt is marked `cache_control` but changes each turn because director notes are embedded; move volatile director notes into the last user message to get cache hits.
3. **Quest recommendation** (`recommend` task exists as a name only). `deriveInsight` gives strengths/weaknesses; build a deterministic recommender first (weak facet → quests whose rubric targets it), LLM later.
4. **Commitment follow-through.** `world.commitments` are recorded (Push Back on a Deadline creates one). Nothing yet resolves them or builds a quest around a broken promise. Add a quest with `prerequisites: [{type:"custom", check: ctx => ctx.world.commitments.some(c => c.status==="open" && c.toNpcId==="rohan_mehta")}]` and a `world.commitment.resolve` consequence.

**Robustness**
5. Concluding a quest is several DB writes without a transaction (libsql batch/transaction support is available; wrap `concludeQuest` persistence in `db.transaction`).
6. The `perceive` fallback and `inferMovesFromSpeech` are safety nets for weak models. With Claude they rarely fire; check `ai_calls.problems` to see how often they do.
7. `evaluate` on reasoning-heavy open models can take >60 s. Route handlers set `maxDuration = 120`; on serverless hosts consider a background job + polling for the results screen.
8. Rate limiting and abuse protection on API routes (none yet).

**UX polish**
9. Results reveal: XP counters could animate; the share card should render to an image (`/api/share/[attemptId].png` via `@vercel/og` or satori) — the data shape (`result.shareCard`) is ready.
10. World map: markers are static; add ambient drift and a per-district illustration. Locked worlds could show "rumours" from NPCs.
11. Scene: show the transcript inline as faded prior lines on large screens; add keyboard hints only on first use.
12. Settings/account screens (password change, delete account, voice preferences) — routine.

**Content**
13. Only 4 quests exist. The engine supports branching, prerequisites, hidden objectives, world-state inputs and follow-ups; add quests per `docs/ADDING-CONTENT.md`. Keep each quest's `outcomes` ordered with a catch-all last.
14. Influence Arena has no quests yet (world is open on the map). Either add one or set it `locked`.

## Trade-offs made

- **Predicates as TS functions, not a JSON DSL.** Typed, testable, and content authors are engineers/models. If non-engineers must author content later, add a small DSL that compiles to these functions.
- **SQLite/libsql over Postgres** for zero-friction local dev. Schema is Postgres-portable (JSON columns, text ids).
- **Web Speech API** instead of a realtime voice pipeline. Interfaces exist to swap; the session state machine (`useVoiceSession`) is the part worth keeping.
- **Single NPC call for speech + moves** (streamed) rather than two calls. Cheaper and faster; a perception fallback covers weak models.
- **Fake provider uses keyword heuristics.** It exists to test the deterministic loop, not to be clever.

## Testing conventions

- Engine tests are pure and use `makeTestEnv()` for deterministic ids/timestamps.
- `src/server/orchestrator.test.ts` runs the whole loop on `createTestDb()` (in-memory libsql) with `FakeProvider`, including invalid-output and failure-injection cases. Add a case here whenever you add an orchestrator branch.
- `scripts/smoke.ts` is the real-provider check; run it after prompt changes.
