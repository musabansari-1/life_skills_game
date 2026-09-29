# Development Handoff

Counterpart V1 is a complete single-world game: **Career City, season one**. It has 13 milestone chapters in six acts (Get in → Prove yourself → Consequences → Step up → The crisis → Resolution), three bosses (The Counter Offer, The Meridian Call, The Project Crisis), Director-selected events and optional scenes between chapters, seven authored recoveries, and a personalized ending that freezes after **The Review**. That is 27 encounter opportunities in all. This document tells the next engineer or model how to continue without damaging the foundations.

Reading order: `ARCHITECTURE.md` → **`V1-CONTENT-ARCHITECTURE.md`** (the campaign map and its rules) → `ADVANCED-CAMPAIGN-ARCHITECTURE.md` (systems: multi-NPC, bosses, failure/recovery, information, pacing, endings) → `docs/ADDING-CONTENT.md` (recipes) → `MOBILE-ARCHITECTURE.md` (client/API boundary). What was built in V1, how it was tested, and the exact closed-beta task list are in **`V1-CONTENT-REVIEW.md`**.

## Run it

```bash
pnpm install
cp .env.example .env.local        # optional; defaults run on the fake provider
pnpm dev                          # http://localhost:3000
pnpm test                         # 259 unit + integration tests (incl. nine full simulated seasons), no model calls
pnpm simulate:campaign -- --summary   # nine personas play Career City end to end; prints path, ending, identity
npx tsx --env-file=.env.local scripts/v1-live-playtest.ts [ids]   # live-model playtest of the V1 scenes (natural paraphrases)
pnpm test:semantic-live           # production-model semantic paraphrase corpus + p50/p90/p95 latency (CORPUS_LIMIT=N for a cheap probe)
# Browser QA against a production server with the isolated QA DB + fake provider (see script headers):
#   DATABASE_URL=file:./data/campaign-qa.db AI_PROVIDER=fake SESSION_SECRET=<32+ chars> npx next start -p 3012
#   (same env) npx tsx scripts/e2e-v1.ts        # new player → mid-season → Boss 2 in the UI → strong/weak endings, desktop + 390px
#   (same env) npx tsx scripts/e2e-campaign.ts  # crisis multi-NPC, reactions, reload identity, failure→recovery UI
pnpm smoke                        # full loop against the configured provider, in-memory DB
pnpm smoke aggressive             # the hostile path
npx tsx scripts/e2e-walkthrough.ts   # Playwright UI walkthrough using local Chrome (dev server must be running)
pnpm smoke:api                    # plays the game over /api/v1 with bearer tokens, like a native app (dev server must be running)
npx tsx scripts/strategies.ts     # 7 Counter Offer strategies side by side against the configured model (SKIP_CONCLUDE=1 for scene only)
npx tsx scripts/latency.ts [n]    # model first token / first speakable sentence / turn / conclude timing (n repeats)
npx tsx scripts/conversation-scenarios.ts [names]   # 10 realtime scenarios (interrupt, pause, self-correction, …) against the real model
npx tsx scripts/e2e-scene-smoke.ts   # browser check of the conversation screen (voice-mode UI, interruption, captions); dev server must be running
```

Providers: set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (default model `claude-opus-5`), or `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY` + `AI_MODEL=<slug>`. `AI_PROVIDER=fake` runs the whole game deterministically with heuristics, which is good for UI work. Scripts run with `tsx` must pass `--env-file=.env.local`, because `src/lib/env` parses at import time.

> **As of 2026-09-26 the model in `.env.local` (`deepseek/deepseek-v4-flash-0731:free`) returns HTTP 404 on OpenRouter ("unavailable for free").** With that config every semantic turn fails. The V1 live playtest used `nvidia/nemotron-3-super-120b-a12b:free` via a process-level `AI_MODEL` override. Set the intended production model before any playtest.

Verified in this phase:
- Full loop with the fake provider (tests + Playwright walkthrough: sign up → onboarding → map → briefing → scene → results → follow-up → dossier).
- Full loop with a real model over OpenRouter (`deepseek/deepseek-v4-flash-0731:free`), both scripted strategies:
  - Evidence + discovery: ₹8.5L → ₹9.2L base + ₹60K bonus, outcome "Strong deal", Emma trust +7 / respect +10, follow-up unlocked.
  - Ultimatums: Emma's patience hit 0 by turn 3, she withdrew the offer ("Walked away"), career reset to exploring, trust −15, negative beliefs stored in her memory.
  Free models are slow (evaluation 60–170 s) and under-report moves; the speech-inference + perception safety nets carried that run. A Claude model is the intended production path.
- Production build (`next build`) passes. All screens fit a 390px phone with no horizontal scroll.
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
10. **Clients talk to the game only through `/api/v1` and `src/contracts/api.ts`.** No game rule runs on a client. Web pages may call `server/queries.ts` directly (same DTOs). Contract changes within v1 are additive only.
12. **Rules decide before the NPC speaks; speech is binding.** Quest `preTurn` computes what the NPC may do from `readPlayerUtterance`; what the NPC says out loud (read by `inferMovesFromSpeech`) is what gets recorded. Don't reintroduce silent post-speech clamping.
13. **Failure is canon; replays are practice.** A failed early milestone blocks progress and opens a separate recovery conversation; later milestones continue on failure (see V1 invariants). Replaying any quest is practice: skills grow, the world keeps what happened.
14. **Only what was heard is canon.** NPC speech passes the quest's `speechGate` before it is streamed; an interrupted line is truncated to the heard prefix and the scene re-derived from it. Never store, evaluate or remember text the player didn't hear. `generatedText` on a turn is diagnostics only.
15. **Voice logic lives in `ConversationController`.** Keep React, DOM and network out of it; platform adapters implement `SpeechRecognizer` / `SpeechSynthesizer` / `ConversationTransport`.
11. **Mutations must be retry-safe.** Turns use `expectedTurnCount`; conclude is claimed atomically and commits in one transaction. Keep it that way for any new mutating endpoint.

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
| Add an API endpoint | schema in `src/contracts/api.ts` → read model in `src/server/queries.ts` (or a `GameService` method) → route in `src/app/api/v1/` → method in `src/client/gameClient.ts` → test |

## Known gaps and TODOs (prioritised)

**Product-critical**
1. **Manual voice QA in Chrome with a mic.** Check: mic permission prompt, interim transcript, barge-in while Emma is speaking, TTS voice selection on Windows/macOS/Android, Space push-to-talk. Tune `preferredVoiceHints` per NPC. Consider a server TTS (ElevenLabs/OpenAI) behind `SpeechSynthesizer` for quality — the interface is ready.
2. **Latency.** With `claude-opus-5` at `effort: "low"` NPC turns should be ~2–4 s to first sentence. If too slow, route `npc_turn` to `claude-sonnet-5` via `AI_MODEL_NPC` and keep evaluation on Opus. Consider prompt caching: the system prompt is marked `cache_control` but changes each turn because director notes are embedded; move volatile director notes into the last user message to get cache hits.
3. **Production semantic acceptance.** The Director and personalized recommendation system are now implemented. Before beta, run `pnpm test:semantic-live` on the intended production model and investigate every game-critical false positive/negative plus the measured 8-second scene-read timeout rate.
4. **Full human/phone validation.** Commitment follow-through is now part of the campaign and Director. What remains is one complete 13-chapter human voice run plus physical-phone microphone/barge-in testing; see `V1-BETA-READINESS.md`.

**Robustness**
5. ~~Concluding a quest without a transaction~~ — done: atomic claim + single transaction (see `MOBILE-ARCHITECTURE.md` §9). Remaining: make conclude an async job for mobile (see its Fable escalation note).
6. The `perceive` fallback and `inferMovesFromSpeech` are safety nets for weak models. With Claude they rarely fire; check `ai_calls.problems` to see how often they do.
7. `evaluate` on reasoning-heavy open models can take >60 s. Route handlers set `maxDuration = 120`; on serverless hosts consider a background job + polling for the results screen.
8. Rate limiting and abuse protection on API routes (none yet).

**UX polish**
9. Results reveal: XP counters could animate; the share card should render to an image (`/api/share/[attemptId].png` via `@vercel/og` or satori) — the data shape (`result.shareCard`) is ready.
10. World map: markers are static; add ambient drift and a per-district illustration. Locked worlds could show "rumours" from NPCs.
11. Scene: show the transcript inline as faded prior lines on large screens; add keyboard hints only on first use.
12. Settings/account screens (password change, delete account, voice preferences) — routine.

**Content (V1 complete; see `V1-CONTENT-REVIEW.md` §12 and §17)**
13. Career City season one is content-complete: 13 milestones, 3 bosses, 5 optional/Director scenes, 2 personalized templates, 7 recoveries. Add content per `docs/ADDING-CONTENT.md` and the V1 kit (`src/content/quests/kit.ts`); never insert a milestone without updating `CAREER_ACTS` and the season simulation.
14. ~~Influence Arena has no quests~~: it is now the locked *Negotiation Arena* (a future-world hook).
15. Known weak spots: *Sunday at the Bakery* now has a post-Meridian Director reason for players who know Priya; the checkpoint and introduction templates still predate `manner`; the crisis partial is still recorded as a setback and should be reclassified only if playtest evidence says it feels punitive.

**V1 invariants (in addition to the list above)**
- The season ending freezes only when `FINAL_MILESTONE` (`the_review`) concludes canonically. The crisis hands off to it.
- Milestones in `CONTINUES_ON_FAILURE` resolve on failure (the failure is the authored continuation). Earlier milestones block on failure and open a separate recovery.
- A partial is a campaign setback only if the outcome declares `setback`, or the quest declares `failure` and the outcome leaves `setback` undefined.
- Repairs of a chapter the story has moved past close when the following chapter resolves. The setback stays in history.
- Semantic-encounter disclosures are authored lines delivered through `canonicalSpeech` and recorded only if heard (`kit.disclose` / `kit.revealsFrom`). They fire from *fresh* evidence only (`kit.trackFresh`).

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
