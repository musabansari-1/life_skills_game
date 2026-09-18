# Adding content: quests, NPCs, worlds

Content is typed TypeScript in `src/content`. `validateContent()` (run by the test suite) catches dangling references. Keep everything pure: no IO in predicates or reducers.

## Add an NPC

`src/content/npcs/index.ts`:

```ts
export const maya: NPCDefinition = {
  id: "maya_iyer",                 // stable id; used in world state, memory, prerequisites
  name: "Maya Iyer", shortName: "Maya",
  role: "Head of Sales", organisation: "Nova Labs",
  worldId: "influence_arena", locationId: "influence_arena.forum",
  personality: {
    summary: "One paragraph of prose. This is pasted into the prompt verbatim — make it vivid and behavioural.",
    traits: ["sceptical", "fast", "numbers-first"],
    values: ["clear asks", "people who know their numbers"],
    dislikes: ["hedging", "slides with no data"],
    speakingStyle: "Short. Interrupts. Uses 'so what?' a lot.",
    underPressure: "Checks her phone. Says 'let's take this offline.'",
  },
  goals: ["hit quarter", "not waste a minute"],
  publicDossier: "What the player can read before meeting her.",
  appearance: { hue: 150, initials: "MI" },
  voice: { lang: "en-IN", gender: "female", rate: 1.1, pitch: 1, preferredVoiceHints: ["Heera", "en-IN", "Female"] },
  baseRelationship: { trust: 0, respect: 0, familiarity: 0, warmth: 0 },
};
NPCS[maya.id] = maya; // add to the record
```

Per-player NPC state (relationship, memory, timesMet) is created lazily on first meeting from `baseRelationship`. Nothing else to do.

## Add a world / location

`src/content/worlds.ts`: add a `WorldDefinition` (`status: "open" | "locked"`, `map: {x, y}` in percent, `accent`) and any `LocationDefinition`s. If the world should be open for new players, add its id to `createInitialWorldState()` in `src/engine/types/world.ts` (or unlock it via a `world.unlock.world` consequence from a quest). Locations with `lockedByDefault` need a `world.unlock.location` consequence.

## Add a quest

Create `src/content/quests/<id>.ts` with `defineQuest<Hidden, Scene>({...})` and register it in `src/content/quests/index.ts`. Use `counter-offer.ts` as the reference for a numbers-driven scene and `first-day-nova-labs.ts` for a rapport/information scene.

The shape:

| Field | What it does |
|---|---|
| `briefing` | What the player reads before entering. `intel` = known facts; `hint` optional. |
| `prerequisites` | Typed checks over world state / competencies / relationships. Use `quest_completed`, `world_flag`, `world_unlocked_quest`, `career_status`, `skill_level`, `relationship`, or `custom`. |
| `objectives` | `primary` (shown in briefing), `hidden` (revealed in results), `optional`. Give a `check(scene, hidden)` when scene state can decide it; omit to let the evaluator judge. |
| `scene.createHidden` | Instantiate hidden NPC constraints from world state + relationship. Vary them: this is where consequences of earlier quests bite. |
| `scene.createCustom` | Quest-specific live state (offer on the table, agreed date…). |
| `scene.initialPatience` | 0–100; lower = tougher. |
| `scene.opening` | `scripted(ctx)` or `generatedHint` for the NPC's first line. |
| `scene.npcSituation` | The situation as the NPC understands it. |
| `scene.hiddenBriefing` | Explains hidden state to the NPC model in prose, including *when* to reveal each item. Include `KEY=value` lines if the fake provider should read them. |
| `scene.revealableKeys` | Keys the NPC may reveal, with a description. Reveals outside this list are rejected. |
| `scene.proposalKeys` | Keys the NPC may put in `proposal` (e.g. `base`, `agreedDate`) with parsing hints. |
| `scene.reduceProposal` | **Enforces constraints.** Clamp, make monotonic, gate on reveals. Return new `custom` + flags. |
| `scene.inferMovesFromSpeech` | Optional deterministic safety net that reads reveals/proposals from the NPC's own words (helps weaker models). Be conservative. |
| `scene.preTurn` | **Runs before the NPC speaks**, with `readPlayerUtterance(text)` (ask, floor, evidence, pressure, real vs conditional yes). Decide what the NPC may do this turn, update `custom`, and return `direction` lines the NPC must obey. This is how strategies produce different outcomes reliably. What the NPC then *says* is binding (up to hidden limits). |
| `carryOver` | Lines shown on the briefing under "What carries over": how earlier choices shape this quest. The main way persistence becomes visible *before* a scene. |
| outcome `aftermath` | Forward-looking consequence lines on the result screen ("Emma will remember you pushed hard."). |
| `scene.director` | Per-turn behavioural notes derived from numbers ("base is at ceiling; steer to bonus"). Models act on prose, not numbers. |
| `scene.visibleStatus` | What the player sees on screen (e.g. "Base on the table: ₹8.5L"). |
| `scene.minTurns / maxTurns` | NPC can only close after `minTurns`; the scene ends at `maxTurns`. |
| `rubric` | Criteria the evaluator scores 0–4, each mapped to a skill facet with exemplary/weak anchors. |
| `evaluatorNotes` | Scenario-specific guidance for the evaluator. |
| `outcomes` | **Ordered**; first `when(ctx)` that matches wins; the last must be a catch-all (`when: () => true`). Each has `grade`, `narrative`, `consequences`, `rewardMultiplier`, `followUpQuestIds`. |
| `rewards` | `baseXp` and per-skill weights. XP actually earned depends on demonstrated facet quality. |

### Consequences you can emit

`world.career.set`, `world.var.set`, `world.flag.add/remove`, `world.reputation.delta`, `world.unlock.world/location/quest`, `world.commitment.add/resolve`, `world.decision.add`, `world.opportunity.add`, `world.person.met`, `relationship.delta`, `npc.memory.event`. See `src/engine/types/consequences.ts`.

### Grades and replays

- `failure` means **progress is blocked** (offer withdrawn, not put forward). Replaying a failed quest is a *second chance* whose outcome becomes canon.
- A bad-but-consequential choice (caving to a deadline, playing an incident down) is `partial`, not `failure`: the story continues and the consequence plays out later.
- Replaying a resolved quest is a *rehearsal*: it starts from the NPC's state at the canonical run, awards skill updates at half XP, and never applies consequences again. The result shows a comparison with the previous run.

### Campaign

Chapters are listed in `src/content/campaign.ts`. A chapter counts as done after a non-failed completion. Keep chapters connected: each should read at least one thing an earlier chapter wrote (a `world.var`, flag, commitment or NPC memory) and write at least one thing a later chapter reads.

### Making earlier quests matter

- Read world state in `createHidden` (salary, flags, vars, commitments) and in `npcSituation`/`hiddenBriefing`.
- Read `npc.relationship` to set `initialPatience` or hidden generosity.
- Memory is injected automatically: the NPC model sees `renderMemoryBlock(npc.memory)`. Use `memoryFocus` to narrow it.
- Gate with prerequisites: `{ type: "quest_completed", questId: "counter_offer", outcomeIds: ["hardball_deal"] }` for branch-specific follow-ups.

### Signals

The shared vocabulary in `PLAYER_SIGNALS` (`src/engine/types/scene.ts`) is what the NPC can "notice". Add a signal only if a reducer or director will act on it, and add its patience effect to `SIGNAL_PATIENCE`.

### Testing a quest

1. Unit-test `reduceProposal` and outcome predicates with `createSceneState` + `NPCMovesSchema.parse({...})` (see `src/engine/scene/scene.test.ts`, `src/engine/quests/outcomes.test.ts`).
2. Add an orchestrator integration case if the quest introduces a new consequence path.
3. Run `pnpm smoke` (edit `scripts/smoke.ts` scripts) against a real provider and read the `[moves=…]` lines: they show what the model perceived and what the reducer did.

## Add an AI task

Create `src/ai/tasks/<name>.ts`. Build the prompt from typed inputs, call `runStructuredTask(ctx, req, zodSchema)` (JSON) — it validates, repairs, retries once with the error, and logs. Add the task name to `AITaskName` in `src/ai/provider.ts` and handle it in `FakeProvider` so tests stay model-free.
