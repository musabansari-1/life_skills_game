# Counterpart V1 — Closed Beta Readiness

**Scope.** Focused validation of the content-complete Career City season. No new world, monetization, native client, or major gameplay system was added.

## Current verdict

**NOT READY for external closed beta yet — for two human/device validation reasons only.**

The production-model path, semantic interpreter, key live scenes, automated suite, production build, and desktop/mobile-width browser flows are now validated. The remaining gates are:

1. physical-phone microphone / TTS / interruption testing on at least one target device/browser
2. one human playthrough of all 13 chapters with voice

These are validation gates, not missing game content or architecture.

## Production model

Current local configuration:

- provider: OpenRouter
- model: `stealth/space-bunny-alpha`

The first production probe exposed an adapter incompatibility: this endpoint requires reasoning and rejects `reasoning: { enabled: false }`. `OpenAICompatibleProvider` now detects Space Bunny and requests low reasoning instead. Other models retain the existing behavior.

After that compatibility fix, Space Bunny completed the production semantic corpus and live scene runs successfully.

## Semantic acceptance corpus

`pnpm test:semantic-live` now covers **28 natural-language cases** across the highest-risk V1 semantics:

- bounded help vs dumping work on Maya
- rollback discovery
- Nora discovery vs blind commitment
- Meridian ownership, blame, risk discovery, protection plans and overpromising
- supporting Maya vs taking over her proposal
- coaching Arjun vs taking his work away
- upward feedback vs flattery/attack
- Project Crisis scope tradeoff, ownership and checkpointing
- Review growth evidence, title grabs, accepting feedback and setting a path

Final production-model result:

- **28 / 28 passed**
- unavailable interpretations: **0**
- p50: **1.686 s**
- p90: **2.818 s**
- p95: **2.820 s**
- max: **2.884 s**
- interpretations at or above the 8-second deadline: **0**

This supports keeping the current 8-second scene-read deadline for the closed-beta build.

`CORPUS_FILTER=<text>` can run one family cheaply, and `CORPUS_LIMIT=N` remains available for a quick provider probe.

## Live production-model playtesting

Live text-mode playtests were run against Space Bunny for the high-risk V1 scenes:

- The Codebase Nobody Explains / Maya
- What the Customer Actually Asked For / Nora
- The Meridian Call / Nora + Vikram
- The New Hire / Arjun
- What Should I Do Differently? / Rohan
- The Project Crisis / Rohan + Nora + Maya
- The Review / Rohan
- The Counter Offer, including evidence and aggressive strategy probes

Observed positive behavior:

- hidden disclosures occurred from the intended player evidence
- characters remained distinct and concise
- no banned generic coaching phrases appeared in the sampled runs
- multi-NPC identity and autonomous reactions remained understandable
- Project Crisis reached the intended successful bounded-scope path
- The Review reached the one-quarter lead-trial outcome
- Meridian reached `trust_restored` after the floor-selection fix

### Evaluation reliability and latency

The first Space Bunny run found two evaluator failures and very slow concludes (42–125 s). The causes were provider/model compatibility rather than campaign rules:

- mandatory reasoning was running at the endpoint default instead of a bounded low setting
- one evaluator emitted fractional 0–4 rubric scores even though the schema required integers

Fixes:

- Space Bunny now uses low reasoning through the OpenRouter adapter
- fractional rubric scores are normalized to the nearest integer on the existing anchored 0–4 scale

Targeted post-fix conclude times:

- Maya / asking for help: **11 s**
- Nora / requirements discovery: **13 s**
- Arjun / mentoring: **15 s**
- Rohan feedback: **14 s**
- Project Crisis: **19 s**
- The Review: **14 s**
- Meridian after the final floor-selection fix: **32 s**

All targeted post-fix evaluations completed successfully. Most sampled scenes now conclude in roughly 11–19 seconds; Meridian was the slowest at 32 seconds. This is acceptable for a small closed beta with the existing staged result-progress UI, but human testing should still tell us whether the wait feels too long.

## Production bugs found and fixed during validation

### 1. Space Bunny reasoning compatibility

OpenRouter returned HTTP 400 because Space Bunny requires reasoning and Counterpart disabled it by default. The provider adapter now uses low reasoning for this model.

### 2. Counter Offer spoken-money binding

A live run exposed a serious invariant violation: Emma verbally used phrases such as `nine and a half lakh` and a lakh-denominated joining bonus that the deterministic money reader did not classify correctly, so audible terms could diverge from authoritative scene state.

Fixed by:

- parsing spoken half-lakh forms such as `nine and a half lakh`
- identifying a joining-bonus amount by its explicit bonus phrase instead of treating every lakh-scale figure as base salary
- handling bonus ranges correctly
- preserving natural wording when a capped bonus is rewritten
- rejecting an unagreed bonus during deal confirmation

The exact observed forms are pinned with regression tests.

### 3. Project Crisis dense final commitment

The first live run intermittently failed to interpret the final owner/checkpoint line. The low-reasoning provider setting removed that failure. Targeted production corpus checks now read owner/checkpoint correctly in about 2.9 seconds.

### 4. Multi-NPC follow-up ownership

A Meridian run showed a natural follow-up intended for Vikram being handed to Nora because the floor selector penalized consecutive speakers even when the previous speaker directly owned the new question.

The selector now keeps the previous participant when fresh evidence matches that participant's interests, support, or objection. A regression test pins the behavior. The live Meridian rerun then kept Vikram on the floor, revealed the month-end constraint, and ended in `trust_restored`.

## Automated validation

Final local checks after all fixes:

- **259 / 259 automated tests passed** across 32 test files
- typecheck: pass
- lint: pass
- production build: pass
- nine divergent campaign simulations: pass

The added tests cover evaluator score normalization, spoken half-lakh / bonus binding, and natural multi-NPC follow-up floor ownership.

## Browser / responsive validation

Production-build QA was run against the isolated `campaign-qa.db` with the deterministic fake provider.

`scripts/e2e-v1.ts`:

- **8 checks passed**
- signup → onboarding → first chapter
- first result / narrative transition
- early world / act progression
- mid-season Act III state
- Meridian briefing
- Meridian two-speaker UI and result relationships
- strong personalized ending
- weak personalized ending
- desktop + 390 px mobile checks
- no page errors / horizontal-overflow failure

`scripts/e2e-campaign.ts` also passed:

- desktop/mobile ending
- ending debrief link
- Maya history
- Project Crisis briefing
- three live speakers
- speaker identity after reload
- autonomous NPC reaction
- failure → recovery UI

Representative screenshots were visually inspected: Meridian mobile scene, Project Crisis multi-NPC mobile scene, mobile season ending, and desktop season ending. No blocking layout issue was observed.

## Priya Director reachability

`Sunday at the Bakery` remains optional, but after the Meridian boss the Director now has a `breathing_room_after_meridian` reason to surface it for players who already know Priya. It is not forced on players who never met her or players deliberately skipping optional content.

## Physical-device validation still required

Viewport emulation is not microphone testing. At minimum test on a real Android phone with Chrome:

- microphone permission
- first mic activation
- automatic mic reopen
- speaker/TTS playback
- barge-in / interruption
- long pause mid-sentence
- self-correction
- noisy room
- Wi-Fi and mobile data
- background → foreground
- keyboard open/closed
- one two-NPC scene
- Project Crisis three-NPC scene
- result and replay flow

If an iPhone is available, repeat the core flow in Safari, with special attention to permission handling, audio routing and backgrounding.

## Full human voice campaign run still required

One person should play all 13 chapters naturally with voice and record:

- total and act-by-act playtime
- where fatigue or repetition appears
- confusing transitions
- whether characters stay recognizably different over a full season
- callbacks/consequences noticed without being explained
- optional scenes that feel worthwhile or skippable
- whether each boss feels earned
- whether post-mission evaluation waits feel acceptable
- whether the personalized ending feels true to the run

Automated campaign simulations cannot answer these questions.

## Closed beta gate

The engineering/model-validation side is now strong enough for a beta build. Counterpart should be marked **READY** for 5–10 external testers after both remaining checks pass:

- physical-phone voice works on at least one real target device/browser
- one human completes the 13-chapter season with voice without a blocking issue

Payments, native apps, another world, custom real-life missions, B2B, multiplayer and additional architecture are **not** closed-beta blockers.
