# Architecture

Counterpart is a voice-first RPG where **conversations are the gameplay**. One persistent player character moves through a simulated world by speaking to AI characters who remember, react, and change the world.

This document explains how the system is built so it can be extended without breaking it. Read `DEVELOPMENT-HANDOFF.md` for what to do next and `docs/ADDING-CONTENT.md` for quest/NPC/world recipes.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict | Server components for state-heavy screens, route handlers for streaming, one deployable |
| Styling | Tailwind v4 + design tokens in `globals.css` | Fast iteration, tokens keep it from looking like SaaS |
| Motion | CSS keyframes (the `motion` package is installed for later cinematic transitions) | Keep the bundle light until needed |
| Persistence | Drizzle ORM + libsql (SQLite file locally, Turso/libsql server in production) | Zero-infra dev, real migrations, trivially portable to Postgres |
| Validation | zod 4 | Single source of truth for domain types and AI output contracts |
| AI | Anthropic SDK (default `claude-opus-5`), OpenAI-compatible (OpenRouter), Fake | Provider-swappable via `AI_PROVIDER` |
| Voice | Web Speech API (STT + TTS) behind provider interfaces | Zero cost, low latency today; swappable for Deepgram/ElevenLabs |
| Tests | Vitest (unit + integration on in-memory DB), Playwright (UI walkthrough via local Chrome) | Deterministic logic is fully testable without model calls |

## Layering

```
src/
  engine/      Pure, deterministic game logic. No IO, no AI, no framework imports.
    types/     Domain model (zod schemas + TS types) — the data model of the game
    competency Facet estimates, XP, levels, discovery, insight
    relationships  Trust/respect/warmth/familiarity math + prose rendering
    memory     Merge extracted memory into persistent NPC memory; select for prompts
    world      Apply consequences to WorldState; prerequisites
    scene      Per-turn reducer: signals → patience/stance; reveals; quest proposals; endings
    quests     Objective + outcome resolution
    parsing    Spoken-number parsing for speech inference
  ai/          Probabilistic layer. Provider contract + tasks with strict output contracts.
    provider.ts     LLMProvider interface (complete / stream)
    providers/      anthropic, openai-compatible (OpenRouter), fake
    tasks/          npcTurn, perceive, evaluate, extractMemory (+ shared retry/log)
    format.ts       NPC wire format parser (<speech> + <moves>)
    json.ts         JSON extraction/repair + zod validation
    logger.ts       AI call logging sinks
  content/     Worlds, locations, NPCs, quests. Typed TS config, versioned in code.
  db/          Drizzle schema, client, migrations (drizzle/)
  server/      Orchestrator (the game loop), player repo, auth, analytics, view models
  voice/       SpeechRecognizer / SpeechSynthesizer contracts, browser impls, useVoiceSession
  app/         Routes (server components + a few client components), API route handlers
  components/  Shared UI (Orb, WorldMap, SkillList, TopBar, AuthForm)
```

Dependency direction: `app → server → (engine, ai, content, db)`. `engine` imports nothing outside itself. `content` imports only `engine`. `ai` imports `engine` types only.

## The game loop

```
startQuest(playerId, questId)
  ├─ checkPrerequisites(quest, world/competencies/npcs)        engine/world
  ├─ hidden = quest.scene.createHidden({world, npc})          content
  ├─ scene = createSceneState(quest.scene.createCustom(hidden)) engine/scene
  ├─ persist QuestAttempt (hidden never leaves the server)
  └─ NPC opening line (scripted or generated)                  ai/tasks/npcTurn

submitPlayerTurn(playerId, attemptId, text)
  ├─ append player DialogueTurn
  ├─ generateNpcTurn → { speech (streamed), moves }            ai/tasks/npcTurn
  ├─ safety nets: inferMovesFromSpeech (content) + perceiveMoves (ai) when moves are empty
  ├─ reduceNpcTurn(scene, moves)  → new scene state             engine/scene
  │     signals → patience → stance; validate reveals; quest.reduceProposal under hidden constraints; endings
  └─ persist NPC turn + scene

concludeQuest(playerId, attemptId)
  ├─ evaluateConversation(transcript, rubric, hidden, scene) → Evaluation   ai/tasks/evaluate
  ├─ resolveObjectives / resolveOutcome (scene state is ground truth)        engine/quests
  ├─ applyObservations(evaluation.behaviors) → competencies, XP, levels, discoveries   engine/competency
  ├─ extractMemory → mergeMemory (dedupe, caps)                             ai/tasks/extractMemory + engine/memory
  ├─ consequences = outcome.consequences(ctx) + player commitments from memory
  │     world.* → applyConsequences (engine/world)
  │     relationship.delta → applyRelationshipDelta (engine/relationships)
  │     npc.memory.event → appended to NPC memory
  ├─ persist world, competencies, NPC states, attempt result (one logical unit)
  └─ emit events (analytics + history)
```

The **NPC never grades the player**. It perceives (which behaviours it noticed) and proposes (what it is offering). The **reducer decides** what actually happens, under hidden constraints. The **evaluator** is a separate task with the full transcript, rubric and ground truth.

## NPC intelligence

Each NPC turn's system prompt is assembled from:

1. Identity + personality (static content)
2. Relationship rendered as prose (`describeRelationship`) — numbers alone are ignored by models
3. Structured memory block (`renderMemoryBlock`) — top-K facts, beliefs, events, open commitments, last summary
4. Situation + hidden briefing (quest content, using current scene values)
5. Director notes (deterministic, per turn): patience band, stance, time pressure, quest-specific guidance (e.g. "base is at the ceiling, steer to bonus")
6. Signal vocabulary + strict output format

Messages are the **windowed recent turns** of the current conversation only. Long-term history comes through memory, never a transcript dump.

Output format streams speech first, then a JSON moves block, so TTS starts before generation ends:

```
<speech>…</speech>
<moves>{"noticed":[…],"reveal":[…],"proposal":{…},"patienceDelta":0,"wantsToEnd":false}</moves>
```

`parseNpcTurn` is forgiving: missing tags → whole text is speech; broken JSON → repaired or salvaged; empty speech → one retry, then an in-character fallback line. A turn can never crash.

## Scene reducer (why strategies produce different outcomes)

`engine/scene/reduceNpcTurn`:

- **Patience** shifts per signal (`SIGNAL_PATIENCE`): evidence +4, aggression −12, ultimatum −15, contradiction −8, plus a small per-turn cost so conversations converge. The model's own `patienceDelta` counts half and is clamped.
- **Stance** derives from patience and recent hostility; the model may harden stance but never soften it.
- **Reveals** are validated against `quest.scene.revealableKeys`.
- **Proposals** go through `quest.scene.reduceProposal`, which enforces hidden constraints. In The Counter Offer: base is monotonic, capped at `hidden.maxBase`, and limited per-turn by a *concession budget* driven by evidence, clear asks, alternatives, leverage earned, and stance. Bonus is capped lower until the lever is revealed.
- **Endings**: patience 0 → NPC walks; `wantsToEnd` honoured only after `minTurns`; `maxTurns` ends the scene.

## Memory architecture

`NPCMemory` = `{ facts, beliefs, events, commitments, lastInteractionSummary }`. The extraction task proposes candidates; `mergeMemory` de-duplicates (by key, then text similarity), blends beliefs, caps sizes, and ranks. `selectMemoryForPrompt` bounds what the model sees. Recent conversational context is never stored in memory.

Scripted memory events from outcome consequences (`npc.memory.event`) are appended alongside extracted ones, so critical facts (e.g. "I withdrew the offer") persist even if extraction fails.

## Competency model

Visible skills (8) each have facets (e.g. negotiation: anchoring, discovery, handling_resistance, proposing_alternatives, protecting_leverage, understanding_priorities, recognizing_tradeoffs, maintaining_rapport). The evaluator reports `behaviors: {skill, facet, score 0..1, evidence}`. `applyObservations`:

- updates facet estimates with a confidence-weighted adaptive rate,
- computes XP per skill from *demonstrated quality* × quest reward weights × difficulty × outcome multiplier (strong play earns disproportionately more; absent skills get small consolation XP),
- derives levels from a concave curve,
- records "discovered" facets on the first strong demonstration.

`deriveInsight` produces "strong at X; weakest at Y" once confidence is sufficient. This is the hook for personalised quest recommendation (not built yet).

## World state & consequences

`WorldState` is one typed document per player (career, reputation, unlocks, completed/failed quests, flags, commitments, decisions, people met, opportunities, vars). `Consequence` is a discriminated union; `applyConsequences` is the only write path and reports what changed so events can be emitted and results displayed. Quests read world state in `createHidden` (e.g. First Day at Nova Labs reads salary and the `emma.bruised` flag) and in prerequisites.

## Persistence

Tables: `users`, `sessions`, `players` (competencies JSON), `world_states` (JSON), `npc_states` (relationship + memory JSON per player×NPC), `quest_attempts` (hidden, scene, evaluation, result JSON), `dialogue_turns`, `events`, `ai_calls`. Structured documents are validated with zod on load. Migrations live in `drizzle/` and are applied on first DB use.

## Voice

`voice/types.ts` defines `SpeechRecognizer`, `SpeechSynthesizer`. `voice/browser.ts` implements them with the Web Speech API. `useVoiceSession` is the turn-taking state machine (idle → listening → thinking → speaking), with barge-in (mic press cancels TTS) and sentence-chunked TTS fed by the SSE stream. The server knows nothing about audio: it receives text and streams text.

## Security notes

- Hidden NPC state never reaches the client (`toClientAttempt` strips it; the play page sends only the client view).
- Passwords are scrypt-hashed; sessions are DB-backed with hashed tokens in an httpOnly cookie.
- Env is validated once in `lib/env.ts`; production refuses the dev session secret.

## Observability

Every model call is logged (`ai_calls` table + console): task, provider, model, latency, tokens, validation problems (e.g. "moves JSON repaired", "perceive fallback used"). Game events (`events` table) cover onboarding, quest start/complete/fail/retry, voice start, abandonment, share, XP, level-ups, relationship changes, memory updates and consequences.
