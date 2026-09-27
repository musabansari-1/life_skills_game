# Counterpart V1 — Closed Beta Readiness

**Scope.** This is a focused beta-readiness pass over the content-complete Career City season. It does not add a world, monetization, native clients, or new core game systems.

## Current verdict

**NOT READY** for external closed beta yet.

The game itself is complete. The remaining blockers are validation blockers, not missing content:

1. `.env.local` still points to `deepseek/deepseek-v4-flash-0731:free`, which is no longer available through the configured OpenRouter route. A one-case production semantic probe returned `unavailable` immediately. The secret-bearing file was not edited.
2. The intended production model has not yet passed the live semantic acceptance corpus or the full V1 live scene playtest.
3. Voice has not been tested on a physical phone.
4. No human has yet played all 13 chapters end-to-end with voice.

## Changes in this pass

### Priya Director reachability

`Sunday at the Bakery` remains optional, but after the Meridian boss the Director now gives it a specific `breathing_room_after_meridian` reason for players who already know Priya. Its normal prerequisites and world access still apply, so it is not forced on players who never met her.

A regression test verifies that it becomes the leading Director candidate in that window. The nine-persona campaign divergence simulation still passes.

### Live semantic acceptance corpus

Added `scripts/v1-semantic-corpus.ts` and the `pnpm test:semantic-live` command.

The corpus exercises natural paraphrases across the most fragile V1 semantic features, including:

- bounded help vs dumping work on Maya
- discovery vs blind commitment with Nora
- plain ownership, blame, risk discovery, protection plans and overpromising on the Meridian call
- supporting Maya vs taking over her proposal
- coaching Arjun vs taking his work away
- specific upward feedback vs flattery/attack
- a grounded growth ask vs a naked promotion ultimatum in The Review

The runner reports:

- pass/fail per utterance
- missing or forbidden semantic features
- unavailable interpretations
- p50 / p90 / p95 / max latency
- count at or above the current 8-second deadline

It operates only on the bounded scene interpreter and never touches player data. `CORPUS_LIMIT=N` can be used for a cheap provider smoke test before running the full corpus.

## Production-model status

Current local configuration:

- provider: OpenRouter
- model: `deepseek/deepseek-v4-flash-0731:free`

A single semantic-corpus probe completed in ~313 ms but returned `unavailable`, confirming that the current configured path cannot interpret gameplay turns. This is a provider/configuration blocker rather than a game-engine failure.

Do not silently switch to a paid model. Set the intended production model explicitly, then run:

```bash
pnpm test:semantic-live
npx tsx --env-file=.env.local scripts/v1-live-playtest.ts
```

The semantic corpus is the acceptance gate for the 8-second scene-read deadline. The live playtest is the dialogue/personality/game-state gate.

## Act III pacing

Act III still has one mandatory boss milestone for players who deliberately skip all optional content. This is **not treated as a beta blocker**: the boss is history-dependent, and the Director now has a stronger low-pressure post-boss option for players who engaged with Priya. Do not make optional scenes mandatory merely to increase chapter count before observing real player pacing.

The first full human run should determine whether Act III actually feels thin. If testers consistently report a pacing hole, fix it from evidence rather than adding filler now.

## Required production-model validation

Before inviting external testers:

1. Configure the intended production model without committing secrets.
2. Run the full semantic corpus and record pass rate plus p50/p90/p95/max latency.
3. Investigate every false positive/negative on game-critical features.
4. Decide whether the 8-second interpretation deadline is acceptable from measured p95/timeout rate.
5. Run all important V1 scenes with `scripts/v1-live-playtest.ts`, including Rohan's feedback, The Review and Project Crisis.
6. Verify concise character voice, no coaching language, no hidden-information leaks, correct multi-NPC identity and canonical state/speech agreement.

## Physical-device validation still required

No physical-phone validation has been performed. At minimum test:

### Android Chrome

- microphone permission
- first mic activation
- automatic mic reopen
- speaker playback
- barge-in / interruption
- long pause mid-sentence
- self-correction
- noisy room
- mobile data and Wi-Fi
- background → foreground
- keyboard open/closed
- full two-NPC and three-NPC scene
- result and replay flow

### iPhone Safari, if available

Run the same core checks, especially permission handling, audio routing, backgrounding and speech-recognition behavior.

Do not mark this complete from viewport emulation.

## Full human campaign run still required

A human should play all 13 chapters with voice and record:

- total and act-by-act playtime
- fatigue/repetition points
- confusing transitions
- characters that start sounding interchangeable
- moments where callbacks/consequences are noticed without explanation
- optional content that feels worthwhile or skippable
- whether each boss feels earned
- whether the personalized ending feels true to the run

This cannot be replaced by campaign simulations.

## Existing automated confidence

The content-complete baseline passed before this pass:

- 257 automated tests
- typecheck
- lint
- production build
- desktop browser checks
- 390px mobile-width checks
- nine divergent campaign simulations

The Priya reachability change has an added regression test, bringing `v1-content.test.ts` to 19 tests; the focused V1 + campaign-simulation run passes.

## Closed beta gate

Counterpart becomes **READY** for a 5–10 person closed beta when all of the following are true:

- a stable intended production model is configured
- live semantic corpus accuracy is acceptable on the game-critical features
- the 8-second interpretation deadline is supported by measured production latency or deliberately adjusted from evidence
- all key V1 scenes complete successfully against the intended real model
- physical-phone voice works on at least one real target device/browser
- one human completes the full 13-chapter season with voice without a blocking issue

Optional future systems — payments, native apps, another world, custom real-life missions, B2B and multiplayer — are not beta blockers.
