@AGENTS.md

# Counterpart — project notes for coding agents

Read `ARCHITECTURE.md`, then `DEVELOPMENT-HANDOFF.md` (invariants + TODOs), then `docs/ADDING-CONTENT.md` before changing anything. `MOBILE-ARCHITECTURE.md` defines the client/API boundary.

- `src/engine` is pure and deterministic. No IO, no AI, no framework imports. Tests live next to the code.
- The NPC model never grades the player. Perception + proposals → deterministic scene reducer. Evaluation is a separate AI task.
- Hidden NPC state must never reach the client (`toClientAttempt`).
- All model output is validated with zod (`runStructuredTask`, `parseNpcTurn`). Never `JSON.parse` model text directly.
- World state changes only via `Consequence` + `applyConsequences`; relationships only via `applyRelationshipDelta`.
- Content (quests/NPCs/worlds) is typed TS in `src/content`; `validateContent()` runs in tests.
- Clients (web + future native) use only `/api/v1` + `src/contracts/api.ts`; web pages read via `src/server/queries.ts`. v1 changes are additive only.
- Verify with `pnpm typecheck && pnpm test`; run `pnpm smoke` after prompt changes; `npx tsx scripts/e2e-walkthrough.ts` for the UI.
