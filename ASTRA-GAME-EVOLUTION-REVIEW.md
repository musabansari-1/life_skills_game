# Counterpart: game evolution review

## 1. Before this phase

Counterpart already had a strong conversation game: six connected Nova Labs chapters, returning NPC memory, multidimensional relationships, persistent consequences, strategy-sensitive reducers and evidence-based competencies. The deadline changed the status update. Realtime speech, interruptions and the canonical transcript were already implemented.

The world around those conversations was still mostly a fixed sequence. The campaign knew which chapter came next, but did not choose a different next situation for someone who overcommitted, ignored concerns or avoided making an ask. Persistent memory did not yet have an explicit character-arc or delayed-thread model.

## 2. What was added

- A Game Director that assembles grounded candidates, invites a structured AI proposal, validates it and applies only an approved offer.
- Two playable encounter grammars with four skill-focus variants, supported difficulty adjustment and returning characters.
- Persisted character arcs, reputation dimensions, progression-based causal threads and structured decision audits.
- Dynamic next-event selection on the world page and debrief, alongside the existing campaign.
- A reusable sponsorship boss profile with realistic resistance and two viable strategies.
- Optional player goals and an upcoming-focus foundation, plus learned techniques drawn from existing facets.
- Explicit practice before story play and stricter once-canonical rules for new personalized encounters, with pinned replay setups.
- Player-facing causes, unresolved threads, relationship context and locked-world previews.

No conversation engine, provider abstraction, voice controller, database architecture or canonical campaign was replaced. No billing, admin or marketing work was added.

## 3. Concrete personalized journeys

The executable simulation uses the same planner as production. These are reproducible synthetic profiles, not claims from a human playtest.

| Player | Next situation | Focus | Difficulty | Distinct behavior |
| --- | --- | --- | --- | --- |
| A: strong negotiator who overcommits | The Next Commitment, with Rohan | Conflict handling, alternatives, clarity | 2 | Past reliability problems require a stronger case; the production incident remains traceable to Friday. |
| B: confident but pushes past people | Before You Give an Answer, with Rohan | Listening, acknowledgement, leadership | 2 | Strained trust and diplomacy make another forceful argument insufficient. Discovery and acknowledgement are required. |
| C: empathetic but avoids asking | The Ask You Haven't Made, with Emma | Confidence, persuasion, listening | 2 | A trusted contact offers room to make a specific ask; low observed confidence keeps pressure manageable. |
| D: balanced high performer | Put My Name Behind It, with Emma | Leadership, negotiation, persuasion, listening | 4 | A boss combines multiple skills and tests whether an ambitious request fits real capacity. |

These are two authored situations, not four reskinned quest catalogs. Their pressure, relevant history, objective gates, evidence requirements, NPC reactions and opportunity paths differ. Candidate scores and reasons are available in the simulation output.

## 4. Delayed consequences

The strongest implemented chain begins before the existing finale:

1. The player agrees to Friday without rollback.
2. The Director recognizes an unresolved commitment and offers a checkpoint.
3. The player can explain the risk, discover what Friday actually requires and propose a read-only demonstration with Monday rollback testing.
4. On success, the original decision stays in history. Its promise is marked superseded and a replacement is recorded.
5. The later status update concerns a slip instead of the production incident. If the checkpoint is skipped or fails, the unsafe decision still produces the existing incident.

The integration test executes the checkpoint through the real service, then starts the later status update and checks its hidden situation. This is a changed future, not just a different recommendation label.

The second chain is positive: trust built during hiring makes an introduction possible after further progression. It is not granted immediately, and it is not awarded merely because the Director proposed it.

## 5. Returning NPCs

Emma returns with a professional reason to be interested: she may recommend an internal pilot. Her own credibility is at stake. If the player earns the introduction, her arc becomes advocate and an opportunity is persisted. A failed meeting remains a failed canonical meeting even if practice later goes well.

Rohan's relationship changes the commitment conversation. A player he respects but does not feel close to receives professional reserve. A warm relationship does not excuse unsupported claims. Low trust or poor reliability raises the evidence requirement or pushes toward a smaller reversible plan.

Existing NPC titles remain authored. There is no fictional offscreen promotion used to make an arc look more developed than it is.

## 6. Director decisions

Examples of actual decision metadata:

- `observed_weakness:conflict_resolution` plus `commitment_pattern` selects Rohan's repair focus.
- `observed_weakness:listening` plus `pressure_without_listening` selects a discovery-first conversation.
- `observed_weakness:confidence` plus `causal_thread_ready` brings Emma back for a direct ask.
- `ready_to_combine_skills` promotes the introduction situation into a boss encounter.
- A malformed proposal or unsupported state patch produces a rejection rule and a validated authored fallback.

The model has latitude among closely relevant candidates. It cannot override a much stronger unresolved need, fabricate history or increase rewards. The stored reasons are decision metadata, not private model reasoning.

## 7. Evaluation evidence

`npm run simulate:director` produces the four paths above. Automated assertions distinguish all four focus variants, the two NPCs, recovery versus boss difficulty, trust affordances and different consequence histories.

Database-backed tests additionally verify:

- An approved introduction can be briefed, played, evaluated and persisted through the shared service/API projections.
- Repeating a conclusion does not award the opportunity twice.
- Practice before the first story run changes competencies while leaving world and NPC state identical.
- A successful rehearsal cannot overwrite a failed personalized meeting.
- A replay retains the original proposal, difficulty and NPC limits after live trust and reputation change.
- Page reads do not spend model tokens or mutate state; repeated refreshes reuse the current recommendation.
- A goal edit cannot replace an active conversation's setup.
- The Thursday correction changes the later incident and preserves its source decision.
- Invalid NPCs, rewards, objectives, skills, history, difficulty, worlds and stale proposals fail validation.

All 223 tests pass, including the original 191 plus Director, encounter, timeout and persistence regressions. The production browser check verifies desktop and mobile narrative rendering, preparing an event, the boss briefing, the pinned live-scene title, saving goals and character-arc display. Screenshots are written under `e2e-shots/director/` against an isolated fixture database. A full run under concurrent compilation hit resource-related five-second test timeouts; running the suite alone passed without timeout or assertion changes.

## 8. Remaining weaknesses

The content grammar is intentionally limited to two new encounter families. A long-term player will still reach its edges. It needs more meaningful authored branches, not dozens of generic situations.

The AI selects among assembled proposals; it does not yet author unconstrained narrative text or invent novel scenario mechanics. This is a deliberate validation boundary. Future text generation needs semantic consistency checks or a similarly bounded grammar.

The new scene gates are conservative language detectors. They handle the tested natural strategies, negate obvious contradictory requests and prevent repeated evidence from counting twice, but they do not understand every paraphrase. Evaluation can coach beyond what the deterministic gate recognizes. Broader utterance fixtures and human playtests are the next way to improve that boundary.

Some arc elements are projections of existing memory rather than a new autonomous offscreen simulation. Role changes, conflicts between multiple NPCs, richer long-term favors and complete cross-world arcs still need authored transitions. Old saves reconstruct threads and milestones but do not retroactively infer every reputation observation.

The Director uses a small progression clock rather than a real-world calendar. Its pending events do not expire while the player is away. Upcoming needs currently supply a focus and horizon, not a private free-text rehearsal generator.

The extra planning call occurs after evaluation, so provider latency can lengthen the debrief by up to its 12-second planning deadline. The request is cancelled through the provider adapter and falls back to authored content. A dedicated small planning model is configurable. The conversation and evaluation tasks retain their existing timing behavior.

The fake-provider and simulation checks establish control and path differentiation. They do not establish live-model dialogue quality, speech recognition quality, retention or transfer to real-life performance.

## 9. Highest-value next steps

1. Playtest the checkpoint with people who naturally hedge, overcommit or disagree. Expand language fixtures around missed but valid strategies before expanding content volume.
2. Author the payoff to Emma's pilot opportunity, including a viable path for a player whose first introduction was held back. Keep the original meeting canonical.
3. Extract new candidate sources into content modules as the third event family is introduced; retain the strict policy vocabulary and common validator.
4. Add explicit, evidence-backed arc transitions for conflicting promises across two NPCs. Keep source references visible to the player.
5. Build a private rehearsal-draft pipeline with category checks and scoped custom NPCs, using the existing practice-only execution path.
6. Run a small human study: whether players can explain why a situation appeared, whether the NPC response feels continuous, and whether they want to see the next event. Compare return intent and strategy changes, not just completion or XP.

## 10. Work suited to cheaper models

Smaller models can write first drafts of constrained dialogue, variations in incidental wording, utterance regression fixtures, content documentation and UI copy. They can propose new candidates within an already validated grammar. `AI_MODEL_DIRECTOR` separates planning cost from the conversational model.

Keep narrative-system decisions, authoring of consequence policies, continuity changes, progression economics, adversarial validation review and interpretation of playtest evidence under stronger review. A cheaper model can propose those changes; it should not be the authority that approves its own rules.
