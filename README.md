# Counterpart

A voice-first RPG for practising real-world skills. **Conversations are the gameplay.** You have one persistent character; you progress through a simulated world by actually speaking to AI characters who remember you, react to how you treat them, and change the world around you.

The first playable vertical slice is **The Counter Offer**: negotiate a job offer with Emma, a recruiter with hidden constraints you must discover by talking to her. How you negotiate changes your salary, her trust in you, what she remembers, and what happens on your first day.

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:3000 — runs on the fake AI provider by default
```

To play with a real model, create `.env.local`:

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# or
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
AI_MODEL=anthropic/claude-sonnet-5
```

See `.env.example` for all options.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm test` | Unit + integration tests (no model calls) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm smoke [evidence\|aggressive]` | Run the whole Counter Offer loop against the configured provider in an in-memory DB |
| `npx tsx scripts/e2e-walkthrough.ts` | Playwright walkthrough of the UI using local Chrome (dev server must be running) |
| `pnpm db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |

## Docs

- `ARCHITECTURE.md` — how the systems fit together (engine, AI layer, memory, competency, world state, voice)
- `DEVELOPMENT-HANDOFF.md` — invariants, known gaps, prioritised TODOs, trade-offs
- `docs/ADDING-CONTENT.md` — how to add quests, NPCs, worlds and AI tasks

## Layout

```
src/engine    deterministic game logic (pure, tested)
src/ai        provider-swappable model layer + task prompt contracts
src/content   worlds, NPCs, quests (typed config)
src/server    orchestrator (game loop), auth, analytics, view models
src/db        drizzle schema + client; migrations in ./drizzle
src/voice     speech input/output contracts, browser implementations, turn-taking hook
src/app       Next.js routes and screens
```
