# V1 campaign systems review

## Implemented

The existing Counterpart architecture now runs multi-NPC conversations with persistent speaker identity, separate NPC memories, bounded autonomous reactions, phase-based boss rules, explicit canonical setbacks and recovery, visibility-aware information routes, campaign pacing, act gates and personalized endings. The web and JSON API share the same projections and authoritative service.

The database change is additive: migration `0002_fat_franklin_storm` adds nullable turn identity. The campaign document defaults safely on existing world JSON. `.env.local` was not edited.

## Climax prototype

**The Project Crisis** takes place after the six existing Nova Labs milestones. Rohan needs an accountable decision; Nora Shah protects customer continuity; Maya Sen protects verification capacity. Priya retains her established neighbor identity.

The scene references actual earlier commitments, the rushed-migration flag, recoveries and relationships. It supports a reduced-scope pilot and a justified delay with interim protection. Four phases test responsibility, information gathering, tradeoffs and a bounded commitment. Success aligns a plan, partial success adds oversight, and failure gives Rohan control while leaving a narrower professional path.

Participants can address each other. For example, a player volunteering everyone's overtime while speaking to Rohan can prompt Maya's brief interjection. The next response waits for delivery of the preceding line; only one autonomous reaction is allowed before the player gets the floor again.

## Failure and recovery

A withdrawn offer remains withdrawn in the original quest history even if a rehearsal succeeds. A separate counter-offer recovery can reopen employment at the authored original terms, with limited trust restoration. The original failed attempt remains linked to the repair.

An unsafe Friday promise is a commitment failure even though the legacy quest grade is partial. A later repair can improve the next commitment; it does not delete the incident or the original decision. Failed recovery conversations record further damage and leave the original failure unresolved. Further recovery attempts are distinct canonical conversations; repeating the original quest is practice.

The six milestone recovery definitions are instances of one constrained grammar, not six new independent quest systems.

## Cross-NPC causality

Existing authored recommendations and warnings now also have information and communication records. In the climax, Rohan may recommend the player to Emma when both the outcome and his trust support it. Otherwise he sends an incident summary. Emma receives that limited professional account rather than the meeting's private dialogue. Private salary information cannot travel through the propagation API.

The world view surfaces sender, recipient and reason, and the source outcome remains accessible. Nora and Maya receive distinct memories of the meeting they actually witnessed.

## Simulated paths and endings

`simulateCampaignPath` runs the real service against a database. Persona competency/reputation baselines are explicit fixtures. Every quest outcome, failure, repair and boss result is produced by a saved attempt; the harness does not inject fabricated completed-quest records. A few offline NPC disclosures are scripted so the fake provider can express the existing scene's binding facts.

| Persona | Material path difference | Climax | Professional resolution |
| --- | --- | --- | --- |
| A: assertive negotiator, weak listening | Strong asks; skips discovering the full set of stakeholder constraints | Partial | Specialist path without a people mandate |
| B: cooperative overcommitter | Promises Friday, minimizes the incident, gets a repair opportunity, then overpromises again | Failure | Narrower remit with trust to rebuild |
| C: struggles, then recovers | Fails screening and interview; completes two separate recovery conversations | Success | A second chance earned as a trusted contributor |
| D: balanced performer | Protects the rollout boundary, asks both stakeholders, gives ownership and a checkpoint | Success | Project lead trial when competence, reputation and trust meet the authored rule |

The simulation asserts four distinct professional outcomes and identities, differing relationships, recovery histories, Director choices, pressure levels and communication outcomes. A separate integration test proves that negotiating a delay can succeed too.

Ending presentation includes act completion, the professional path, defining decisions linked to their real debriefs, relationship resolutions, measured XP growth, unfinished promises and a future-facing close. The climax debrief links directly to this presentation.

## Validation

The full automated suite reached **239 passing tests in 30 files** during this phase. The original failure-replay test was deliberately updated to enforce the requested canonical-failure rule; the other existing regression coverage remains.

New tests cover semantic evidence provenance and revocation, NPC selection/support/interjection, distinct witness memories, interruptions of secondary speakers and autonomous reactions, private/team information visibility, explicit sender knowledge, duplicate communications, pacing, difficulty bounds, milestone bypass prevention, separate recovery, public DTO safety, stale clients, malformed semantic output, deterministic ending ordering, frozen practice history and duplicate rewards.

A saved/reloaded ending initially changed the ordering of relationship entries because database row order differed. The resolver now sorts by NPC ID, and the full campaign simulation guards against regression.

Visual inspection also caught unrelated salary-negotiation feedback in the offline climax debrief. The fake evaluator now recognizes the crisis and recovery rubrics, since deterministically checked objectives are absent from evaluation prompts. The integration test asserts scenario-appropriate feedback.

Production build, typecheck, lint and browser verification are tracked in the final verification record below.

## Limits and remaining V1 work

- Production semantic interpretation needs a curated live-model acceptance corpus for paraphrases, ambiguity, retractions and adversarial instructions. Provenance validation cannot prove that every interpretation is correct. The automated suite uses the fake provider and explicit semantic fixtures.
- NPC interjections use clean line boundaries. Simultaneous voices and overlapping audio are intentionally not implemented.
- Pacing supports more categories than currently have authored content. A full season needs additional low-pressure, reflection, relationship and optional opportunity scenes.
- Recovery writing currently shares a compact grammar. It should receive scenario-specific dialogue and more distinctive consequences without weakening the separation from practice.
- Nora and Maya enter at the climax in this prototype. Earlier relationship-building scenes, favors and disappointments need content; the game does not pretend those events already occurred.
- The season has one reference climax. Further acts, intermediate bosses, alternate employer paths and additional ending prose remain content work. A leadership trial is an ending invitation, not a newly built playable district.
- Initial skill growth is measured from the recorded campaign baseline. For an older save first entering these systems, it covers recorded progress from that point, rather than inventing earlier measurements.
- Real microphone quality, speech recognition and subjective voice/personality quality need device and live-provider playtests. Passing browser and controller tests is not a claim about those hardware conditions.

## Work ready for Opus

Use [ADVANCED-CAMPAIGN-ARCHITECTURE.md](ADVANCED-CAMPAIGN-ARCHITECTURE.md), especially its nine-row authoring guide. Safe next assignments are: add earlier Maya/Nora relationship scenes; enrich the recovery variants; add low-pressure interludes between milestones; author another boss using the existing phases; add grounded communication routes; expand deterministic ending prose/conditions; and tune content pacing with the existing simulation harness.

Each assignment should include concrete success, partial, failure and recovery examples, constraints on who knows what, and the relevant regression tests. Major rewards, gates and relationship effects belong in authored consequence rules, never in an NPC prompt.

## Final verification record

- `npm.cmd test`: **239 passed in 30 files**, including all four actual campaign paths.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `git diff --check`: passed.
- Production browser walkthrough with Chrome, the fake provider and an isolated QA database: passed desktop/mobile endings, climax debrief link, Maya's shared history, boss briefing, three live speakers, persisted speaker identity after reload, an automatic Maya-to-Rohan reaction, and failure-to-recovery navigation. Mobile overflow and uncaught page errors were checked. Screenshots are saved locally in `e2e-shots/campaign/`.
- `npm.cmd run build`: passed. The browser walkthrough passed again against this rebuilt production server after the offline-feedback correction, including an assertion for crisis-specific feedback.
- No live AI calls or microphone/device acceptance test was performed. These remain the release checks described above.
