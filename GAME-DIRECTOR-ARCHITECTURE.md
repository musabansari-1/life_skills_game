# Counterpart Game Director

Counterpart now has a narrative planning layer around its existing conversation engine. The six-chapter campaign, scene reducers, canonical transcript, speech gates, skill estimates, memory extraction and mobile API remain in place. The new layer chooses what deserves the player's attention next and carries the cost of earlier decisions forward.

## 1. Architecture

```text
Canonical world + competencies + relationships + optional goals
  → reconcile causal threads and character arcs
  → assemble eligible authored encounter variants
  → score relevance, recovery, variety and readiness
  → AI proposes one structured candidate (or rules select a fallback)
  → deterministic schema, continuity, priority and authority validation
  → persist approved offer and structured decision record
  → pin proposal and pre-attempt world when conversation starts
  → existing conversation/evaluation/outcome engine
  → atomically persist consequences, skills, relationships and next plan
```

The primary files are:

| Responsibility | Location |
| --- | --- |
| Versioned proposal, preferences, arc and thread schemas | `src/engine/director/types.ts` |
| Candidate assembly, ranking, validation and approval | `src/engine/director/index.ts` |
| Canonical evidence, reputation, arcs and delayed threads | `src/engine/director/continuity.ts` |
| AI proposal task with authored fallback | `src/ai/tasks/gameDirector.ts` |
| Two playable encounter grammars | `src/content/quests/director-encounters.ts` |
| Reusable boss resistance profile | `src/engine/scene/boss.ts` |
| Attempt snapshots and atomic conclusion | `src/server/orchestrator.ts` |
| Public narrative projection | `src/server/director-view.ts` |
| Simulated journeys | `src/engine/director/simulations.ts` |

There is no new database service or table. `WorldState.director` is a defaulted, versioned JSON extension; old saves parse with an empty Director state. Existing canonical records can backfill causal threads and character milestones without inventing past meetings. NPC memory and relationship documents remain where they were.

## 2. Proposal and validation flow

Each proposal includes a stable quest identity, template and variant, world version, event type, title, situation, reason for appearing, target skills, typed history references, NPC, difficulty, objective identifiers, effect policy, urgency, repeatability and content category.

The model receives the highest-ranked candidates, recent outcomes, optional goals and concise character context. It returns one complete structured proposal. It cannot call state-writing tools. JSON is parsed with a strict schema and then compared field by field with the current eligible authored grammar. Even schema-valid invented prose, an invented history reference or a substituted objective is rejected. The model cannot choose an event more than 18 relevance points below the strongest candidate.

Validation checks:

- Current world version, quest/NPC identity and compatibility.
- World and location access, employment/story prerequisites, and prior meetings.
- Real history references, plausible stakes and continuity through exact grammar matching.
- The supported skill combination, measurable objective identifiers and allowed difficulty.
- No second canonical resolution of a personalized event.
- No arbitrary rewards, relationship deltas, flags, patches or progression skips.

Rejected or unavailable model output uses the best validated authored candidate. Planning has a 12-second cancellation deadline, propagated to both real provider adapters. A lack of eligible content returns no recommendation; it does not invent one. Authenticated commands recheck state before writing. Conclusion verifies ownership of the evaluation claim and the world version within the transaction, so a stale response cannot overwrite a newer story.

## 3. Personalized quests

This release uses constrained generation: authored encounter grammars assembled from a player's history, pressure, relationship, focus and supported difficulty. It deliberately does not accept unrestricted model-written quest scripts.

The first grammar is Rohan's commitment checkpoint. Before the finale it becomes **Before Friday Becomes a Promise**; after the migration it can become **The Next Commitment** or **Before You Give an Answer**. It can emphasize holding a boundary, hearing the constraint or making a credible plan. A Friday read-only demonstration with Monday rollback testing is an actual alternative the reducer can recognize and the world can apply.

The second grammar is Emma's internal introduction. For a player who avoids asking it becomes **The Ask You Haven't Made**. A well-established, skilled player can face **Put My Name Behind It**, a sponsorship boss. These share an understandable situation but differ in resistance, focus, evidence requirements and narrative significance.

The generator gives considerable weight to observed weakness, repeated low observations, overcommitment, strained diplomacy, selected goals and imminent needs. It also considers recent improvement, the last variant, the last NPC, failures and readiness to combine skills. Unknown facets are not treated as weakness: two observations and sufficient confidence are required.

New events are optional alongside the campaign. An event can be left for later while the player continues a curated chapter. Offers whose chronology changes are refreshed after canonical progress; an active attempt retains its own pinned version.

## 4. Character arcs

Major recurring NPCs acquire a persisted arc document containing their role, current professional context, goals, stage, expectations, beliefs, unresolved commitments, favors, disappointments and canonical milestones. Stages currently include new contact, working relationship, strained, trusted ally and advocate.

Arc changes are earned from canonical records, relationships and approved outcome flags. Emma becomes an advocate after a successful introduction conversation. Her job title is not automatically promoted; the current title remains the authored character definition. Rohan's strained relationship changes how evidence is received. Future role changes should likewise be authored consequences with explicit prerequisites.

The dossier presents the relationship's current context and what still needs repairing. The model already receives persistent memory, and now also receives relationship-specific behavioral guidance. Belief keys indicating overcommitment or pressure are weak recommendation hints; they never become prerequisites or authoritative facts on their own.

## 5. Relationships affect play

Trust, respect, warmth and familiarity remain distinct. High trust opens candid constraints and the possibility of a recommendation. Low trust requires stronger evidence or a smaller reversible proposal. High respect with low warmth produces reserved professional engagement. High warmth with low respect remains friendly but requires proof.

In the new encounters, trust and reliability deterministically affect evidence requirements. Trust and warmth affect initial patience. A warm interaction alone cannot unlock an introduction. Resistance remains tied to capacity, credibility and commitments, rather than hostility.

## 6. Reputation

The Director tracks reliability, assertiveness, diplomacy, credibility and empathy separately from the existing reputation-by-world score. Deltas are small and capped per canonical encounter, with values bounded to -100…100. Repeating a phrase hundreds of times does not multiply the reward.

Reputation comes from deterministic reads of the player's canonical utterances and authored outcomes. An accepted unsafe deadline reduces reliability. Owning an incident begins to repair it; a credible checkpoint repairs more. Aggression lowers diplomacy. Specific evidence and acknowledgement can build credibility and empathy.

The world page shows at most two plain-language impressions. Internal dimensions influence recommendations, NPC expectations and resistance without becoming a dashboard of meters.

## 7. World events

The implemented event types are next quest, consequence, relationship, skill challenge and boss. Each approved event runs through the existing quest loop. Opportunities are awarded by outcome code after play, not by planning.

There is intentionally no unrestricted event scheduler. The first two event families prove reactive pressure and a positive returning-character opportunity. Additional event types can extend the strict grammar and authored rules. Real-life timestamps do not silently punish an absent player: narrative time advances with canonical progression.

## 8. Delayed consequence chains

A thread records its source quest, source attempt, source decision, relevant commitments, progression threshold, stage, status and eventual resolving attempt. Stages support setup, tension, escalation, decision, consequence and resolution. Not every small arc needs every stage.

**Deadline chain:** accept Friday without rollback → Rohan checks the commitment → either revise the plan or leave the risk standing → the status update handles a slip or a production incident. A successful checkpoint adds a correction flag, marks the original promise **superseded**, and creates the replacement promise. It preserves the original decision and rushed-migration flag. The status-update situation resolver gives the later explicit correction priority.

**Emma chain:** build trust during hiring → an introduction possibility is pending → two further distinct canonical conversations and the first chapter's resolution make it timely → Emma returns → the introduction is earned or held back. The source hiring attempt remains attached to the thread.

Players can follow “Began with” links back to the source result. Pending events do not execute consequences merely because a page was opened. Practice never advances the clock or changes a thread.

## 9. Boss encounters

`BossEncounterProfile` defines stakes, combined skills, viable approaches and resistance in opening, probing and decision phases. The sponsorship profile is attached to the introduction grammar when the player is ready. It requires multiple skills, stronger supporting evidence and a bounded plan.

There are two viable approaches: an evidence-led case, or discovery followed by a constrained trial. The NPC probes the weakest assumption and stops moving the goalposts once requirements are met. Failure closes this canonical introduction and affects the relationship, while leaving other conversations available. Rewards use the existing competency engine with an authored, bounded pool and multiplier.

No abilities are buttons that win a conversation. The player must say the relevant things. The UI explains the stakes without exposing the exact internal thresholds or hidden constraints.

## 10. Skills and techniques

The existing eight skill families and their facets remain the progression model. The Director uses estimates, confidence, sample counts, recent observations, changes and repeated difficulty rather than XP alone. Difficulty moves at most one step from the most recent encounter and eases after repeated failures or low confidence. A boss requires observed competence and an appropriate relationship.

Four learned techniques are surfaced from existing evidence: clarifying questions, offering alternatives, evidence first and naming the concern. Their states are learning, discovered and reliable. Discovery uses the existing demonstrated-facet record; reliability requires repeated observations and a sufficiently strong estimate. Coaching text is optional and does not change scene mechanics.

## 11. Story versus practice

The existing campaign's second-chance semantics are preserved. A failed curated quest can still receive its established second chance. A resolved curated quest is a rehearsal.

New personalized encounters are canonical once, including failure. A retry is practice and cannot create an introduction, erase a failure, repair the relationship or advance the Director clock. Explicit practice is also available before the first story run through the UI and `StartQuestRequest.mode`.

Attempts pin the approved proposal and pre-attempt world in `snapshotBefore`, in addition to existing NPC snapshots. Rehearsals use the original NPC relationship, world-dependent hidden limits, difficulty and quest setup. Competencies still update at the existing half-XP rehearsal rate. Original canonical records and narrative state remain unchanged.

## 12. Safety and validation boundaries

Generated data cannot contain executable predicates, state patches, reward amounts or new NPC definitions. Only authored outcome code can change state. The new speech gate blocks premature agreement and claims of a guaranteed promotion or transfer. Outcome objectives are checked by the deterministic scene state, not a model's claimed reward.

The public DTOs project only narrative framing, visible relationship context, techniques and traceable history. Hidden constraints, exact evidence requirements, scene internals, raw proposals and decision audits are absent from world/briefing/live-attempt responses. Existing authentication applies to the new routes; player IDs are taken from the session, never the body.

`POST /api/v1/director` materializes an initial plan for an existing save and is repeat-safe while a recommendation exists. `PUT /api/v1/director/goals` validates preferences and replans deterministically. Both reject changes during an active or evaluating conversation. GET requests do not call the model or write state.

## 13. Future worlds

World and location registries, quest definitions, shared NPC identities and competencies remain the integration surface. Map access now follows persisted world unlocks. Leadership Tower, Speaking Stage, Founder Valley and the unentered Influence Arena remain previews; this release does not advertise an implemented promotion route into them.

To add a world: define its locations and NPCs, author executable quest templates, add an eligible candidate source, extend the proposal template/effect-policy vocabulary where necessary, and test its prerequisites, outcomes and causal references. The same planner, validation/application boundary, attempt snapshots, conversation loop and API projections apply. Geography does not reset skills or relationships. No new combat or quest execution engine is needed.

## 14. Personal real-life missions

The implemented foundation is an optional structured upcoming need: focus plus horizon, integrated into recommendation priority. It collects no real client names or sensitive situation text.

Free-text private quest creation is not enabled. Its next integration point is a separate private practice-draft API: classify the request, restrict it to conversational rehearsal, select approved role/objection/constraint templates, validate objectives, and start only with explicit practice semantics. Sensitive professional decisions need category-specific restrictions and referral wording; the model must not turn a request for rehearsal into authoritative legal, medical or financial advice. Custom characters should live in a private namespace and never enter canonical world registries by inference.

## Inspection and verification

- `npm run simulate:director` prints four reproducible personalized journeys, reactions, difficulty and causal chains.
- `npx tsx scripts/director-inspect.ts <player-id>` inspects decision audits against the development `DATABASE_URL` selected in the shell.
- `AI_MODEL_DIRECTOR` optionally selects a dedicated planning model; otherwise it uses the memory-model override, then the provider default.
- Audits retain input world version, selected quest, structured reasons, alternatives and scores, rejection rule IDs and source (`ai`, `rules`, `fallback`). They contain no chain-of-thought.
- Engine tests cover manipulated proposals, world access, duplicates, freshness, goals, cold starts, causal history, relationship distinctions and playable strategies. Database tests cover actual execution, atomic/idempotent conclusions, practice isolation and pinned replays.

The current grammar is intentionally small. It proves an extensible control boundary and meaningful path differences; it is not an unlimited autonomous storyteller.
