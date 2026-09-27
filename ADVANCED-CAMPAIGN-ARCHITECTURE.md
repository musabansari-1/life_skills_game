# Advanced campaign architecture

This extends the existing Counterpart quest engine, Director, persistence layer and voice controller. The production boundary remains: AI interprets or proposes; authored rules apply consequences. Career City is the reference campaign, with one new climax and one reusable recovery grammar.

## 1. Multi-NPC encounters

`QuestDefinition.ensemble` declares participants and a lead. Each participant has an NPC registry identity, scene goal, private constraint, interests, supporting/challenging features, and relationships with other participants. The NPC registry supplies personality, voice and initial player relationship. Individual `npc_states` rows retain separate memories and relationships.

The shared scene is the existing attempt's `SceneState`. Participant identity is persisted per dialogue turn in a nullable JSON column (`drizzle/0002_fat_franklin_storm.sql`). Existing dialogue rows remain valid. The API projects only speaker identity and public scene framing; private constraints and semantic evidence remain server-side.

`snapshotBefore.participants` and the original hidden state are pinned for rehearsal. Practice does not substitute current relationships or current adaptive pressure for the original situation.

## 2. Turn orchestration

`engine/scene/ensemble.ts` chooses one floor holder using direct address, current evidence, interests, safety objections and recent speaker identity. Other participants can stay silent. Support and disagreement are independent of courtesy: disagreeing is not intrinsically a penalty.

There are two bounded paths:

1. A player turn selects one responding participant. Identity is sent before streamed speech, allowing the web client to switch its caption, portrait and voice profile before playback.
2. An authored supporting or challenging interest may schedule **one** further NPC reaction. Once the first line is delivered, the client calls `POST /api/v1/attempts/:id/react` with `expectedTurnCount`. The reactor addresses the other NPC, then returns the floor. Reactions never recursively schedule another reaction and do not consume another player turn or charge another patience penalty.

This deliberately uses clean line boundaries rather than overlapping synthetic voices. An interjection can challenge another speaker's proposed decision, but the implementation does not simulate two simultaneous audio streams. Taking the floor or interrupting cancels an unspoken pending reaction.

The reaction endpoint reserves a unique turn index while generating. Stale requests conflict; a repeated request after the reaction is consumed has no additional effect. Player submissions and conclusions cannot proceed through an in-flight reservation.

## 3. Boss framework

`BossEncounterProfile` retains the existing stakes, combined skills, approaches and resistance stages. Optional `BossPhase[]` adds named phases, dependencies, changing stakes, checkpoint predicates and directions. `bossProgress` evaluates authored predicates from authoritative scene evidence and delivered disclosures. Dependencies must be authored in topological order.

The Project Crisis has four checkpoints: accountability, hearing the room, choosing a tradeoff, and a credible commitment. Reducing scope and negotiating a delay are both viable. Revoking a plan removes the corresponding evidence, so a formerly satisfied checkpoint may cease to hold. Checkpoints are scene-local; persistent effects commit with the final outcome transaction, not each time a phase is visited.

The NPC cannot grant success. The final rubric gives communication feedback, while deterministic objective checks and ordered outcome branches decide success, partial containment, or manager takeover. No boss response can award a promotion or modify salary.

## 4. Failure types

`CampaignState.failures` records source quest, source attempt, NPC, category, summary, offered recovery, recovery attempts and successful repair link. Categories cover recoverable mistakes, relationship damage, lost/delayed opportunities, reputation hits, unresolved conflict, commitment failure, partial success and hard branch closure.

`QuestDefinition.failure` supplies an authored category and optional recovery quest. A partial result may therefore be meaningful damage: agreeing to an unsafe Friday date is a commitment failure even though the original quest's grade remains `partial`. Grades and historical outcome IDs are preserved for compatibility.

Old failed Career City records are backfilled by `reconcileCampaign` using their actual attempt IDs. No historical conversation is fabricated. A hard closure projects a closed failure branch; authors must provide the intended alternate continuation explicitly.

## 5. Recovery and practice

A replay of an original failed quest is now a rehearsal. Its better outcome cannot overwrite history, restore trust, reopen a job, or resolve a failure. The previous generic canonical second-chance behavior is superseded by this rule.

`content/quests/recovery.ts` builds distinct recovery quests for the six existing milestones. They share a grammar rather than six independently invented systems: ownership, concrete repair, credible boundary. The hidden state pins the target failure ID. Successful conclusion sets `recoveredBy` on that original failure, applies bounded relationship changes, and executes an authored continuation. It does not add a successful record for the failed original quest.

A failed recovery records the attempt and further trust loss. A later canonical recovery conversation can still address that unresolved failure; the persisted `second_chance` mode is retained for this follow-up case. Once repaired, further replays are practice. The counter-offer recovery explicitly offers the original ₹8.5L base with no joining bonus; it does not recover lost negotiation gains.

## 6. Cross-character consequences

Cross-NPC events have a sender, recipient, fact ID, source attempt, event kind and causal reason. Supported event kinds are recommendation, warning, inquiry, support, undermining, introduction and incident sharing. Authored quest consequences determine when these may occur; a model cannot invent a route.

Existing authored cross-character memory events are recorded in the new communication ledger. For the climax, Rohan sends Emma a limited professional summary. A successful boss and sufficient Rohan trust yield a recommendation; other outcomes yield an incident account. Emma does not receive the room's full dialogue.

## 7. Information visibility

`engine/campaign/information.ts` separates facts from communications:

- Private: known by the owner; cannot be forwarded through `communicate`.
- Shared: explicitly listed audience or a valid communication route.
- Team-visible: explicit team audience; the label does not mean every employee knows it.
- Organizational: also uses an explicit audience, allowing a public reputation fact without universal access to private source dialogue.

`informationFor` supplies only facts known by the specific NPC. A sender must know the fact before transmitting it. Duplicate event IDs do not send it twice. Recipient memory receives the permitted summary, not the sender's complete memory. Ordinary personal NPC memories remain private unless authored consequences explicitly share something.

## 8. Pacing

`PacingProfile` supplies category, intensity, emotional pressure, importance and urgency. Categories include progression, challenge, relationship, recovery, reflection, opportunity, side, consequence, boss and low-pressure scenes. Actual canonical completions populate a bounded recent history.

`pacingAdjustment` rewards breathing room after consecutive intense scenes, penalizes repeated categories, recognizes category novelty, and prioritizes an available repair. These scores feed both curated and personalized Director candidates. The Director still validates the exact authored candidate grammar.

Not every supported category has new content in this phase. The low-pressure neighborhood encounter and recovery grammar provide existing alternatives; writers must add enough varied interludes for a longer season's rhythm.

## 9. Difficulty

The existing quest difficulty and behavioral profile remain. The climax additionally pins a bounded pressure level (2–4) from demonstrated competency, unresolved setbacks and the manager's trust. Pressure changes at most one step relative to the recent campaign difficulty. Higher pressure asks for a fallback and stronger verification, rather than insults.

The boss's advertised challenge rating remains 4; its hidden pressure level personalizes resistance within that rating. The required outcome conditions remain stable. Practice reuses the original hidden pressure.

## 10. Campaign structure

`CAREER_ACTS` in `engine/campaign/index.ts` defines Get In, Earn Trust and Lead Under Pressure. The six existing quests remain the first two acts. Project Crisis is the final milestone. `campaignActs` projects completed/open/locked act progress.

`milestoneResolved` accepts a canonical completion or a distinct successful recovery; the final crisis also resolves on failure because failure is an authored ending. `milestoneAllowed` requires all earlier milestones. Completing an optional Director event cannot substitute for a missing milestone.

## 11. Curated and dynamic hybrid

Curated quests define milestones, hidden constraints, outcome authority and ending conditions. The existing Director ranks available authored encounters for goals, skills, relationships, unresolved consequences and pacing. It cannot invent an encounter, patch the world, change reward amounts or skip the climax's gates.

The model proposes among validated candidates with a bounded deadline and deterministic fallback. An active attempt pins its personalized proposal. Content definitions, including recovery factories, remain registered TypeScript content rather than model-written executable rules.

## 12. Personalized endings

`resolveEnding` produces a structured resolution: professional path, identity, defining decisions, NPC outcomes with evidence, XP growth since the recorded baseline, selected goals, unresolved promises and threads, and a future-facing close.

Rules distinguish a specialist without a people mandate, shared oversight, lateral growth, a project-lead trial, trust rebuilt after multiple failures, and a narrower remit after an unresolved crisis. Professional outcomes depend on boss results, recovery history, reputation, demonstrated competence and relationships. Identity and narrative details draw on the same data rather than a free-form LLM congratulation.

`advanceCampaign` freezes the ending during canonical boss conclusion. Duplicate completion cannot reapply it or its rewards. Relationship entries are sorted by NPC ID so database row order cannot change the ending. Later practice does not rewrite this snapshot. An ending's lead-trial invitation is a narrative professional outcome, not a salary change or an already-built new world.

## 13. Persistence

`WorldState.campaign` is an additive, Zod-defaulted JSON document beside `WorldState.director`. It contains processed attempts, milestone outcomes, branch states, failures/recoveries, information, communications, recent pacing, competency baseline and resolution. Existing saves retain their Director state.

Canonical conclusion retains the original atomic claim, world-version check and transaction. World consequences, all touched NPCs, competencies, campaign state, ending and attempt result commit together. Rehearsal updates competency only. This avoids a separate campaign database with conflicting authority.

## 14. NPC arcs

The existing Director character arcs now include multi-NPC participation in their milestone history. Dossiers also show witnessed ensemble encounters. Relationship outcomes can remain strained, develop into a working relationship, or justify advocacy. No positive resolution is forced.

Nora Shah is a new product lead and Maya Sen a platform engineer. Priya Nair remains the established neighbor. The prototype does not fabricate earlier Maya encounters; writers can add those later using the same participant memory and relationship system.

## 15. Validation and safety boundaries

`readSceneMeaning` uses the existing provider abstraction and `perceive` routing. It returns only authored feature IDs, exact quotations from the latest player utterance, revocations and a possible addressee. Unknown features/participants and ungrounded quotations are dropped. An eight-second deadline, malformed result or provider error fails the turn conservatively and removes its pending player row for retry.

Interpretation is semantic in production. The fake provider's regexes are offline fixtures, not the production scoring system. Quote validation proves provenance, not the correctness of semantic judgment; varied live-model acceptance tests remain necessary before shipping.

Player evidence is processed before NPC speech. Critical hidden disclosures use `canonicalSpeech`, then become revealed only if actually delivered. Interrupted speech is re-reduced from `sceneBefore` with the correct participant identity. Unheard text never enters evaluation or any witness's memory. The autonomous reaction path uses the same delivery machinery.

Content validation checks NPCs, participant uniqueness, leads, world/location references, rubric facets, follow-ups and recovery references. Public DTOs exclude hidden state, raw semantic evidence and diagnostic generated text.

## 16. Content authoring guide for Opus

Start with `docs/ADDING-A-QUEST.md`, `engine/types/quest.ts`, the quest registry and the relevant reference below. Add content without changing the provider, database or UI architecture unless a genuinely new primitive is needed.

| Content | Authoring steps | Required evidence |
| --- | --- | --- |
| Normal quest | Add `defineQuest` content, briefing, prerequisites, objectives, rubric, ordered outcomes and bounded consequences. Register it. | Success, partial/failure, and prerequisite tests. |
| Side quest | Same contract; set `pacing.category = side`, optional urgency and explicit prerequisites. Do not insert it into required milestones. | It cannot unlock a required act by itself. |
| Recovery quest | Give the source a recovery ID. Author a distinct quest with `recovery.target`, a pinned failure ID, ownership/repair/boundary predicates and explicit next-step consequences. Use the factory only where its continuation fits. | Original failure survives; practice cannot repair it; successful recovery links a real attempt. |
| Consequence event | Anchor it to an actual decision, commitment, outcome or failure. Use the Director's existing thread mechanism for delayed scheduling and consequence pacing. | No event before its cause; repeated completion has no duplicate effects. |
| Returning NPC | Use the existing NPC ID and private memory; require real shared history. Write a carry-over line and bounded relationship effect. | No fabricated meeting or automatic positive arc. |
| Multi-NPC scene | Add `ensemble`, specific interests, private constraints and NPC relationships. Use authored semantic features when appropriate. Provide exact canonical disclosures only for facts gating progress. | Speaker choice, silent participants, a bounded reaction, per-NPC memory and interrupted disclosures. |
| Boss | Add a `BossEncounterProfile` with combined skills and topologically ordered dependent phases. Write at least two feasible strategies, partial containment and a failure aftermath. | Sound paraphrases succeed; empty promises fail; disagreement is not automatically hostility. |
| Act milestone | Add the quest to `CAREER_ACTS`, provide unlock consequences and enforce `milestoneAllowed` in prerequisites. Add an explicit recovery or failure continuation. | Dynamic encounters cannot bypass it; each intended branch can continue. |
| Ending condition | Add a deterministic branch to `resolveEnding` with explicit authoritative inputs and grounded prose. Keep a conservative fallback. | Materially distinct histories resolve differently; ordering and duplicate completion remain deterministic. |

For a new semantic feature, describe behavior rather than a required phrase, supply paraphrase/negation/retraction examples, and make the rules consume only validated evidence. For a new information route, choose its visibility and summary first, then its sender, recipient, source and causal condition. Never copy a whole NPC memory to another NPC.

Validation commands: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run simulate:campaign -- --summary`. Browser acceptance is in `scripts/e2e-campaign.ts`; its isolated database guard must remain enabled.

## 17. V1 content addendum

The V1 content phase used these systems without replacing them. Where this document and `V1-CONTENT-ARCHITECTURE.md` differ, the latter describes the current campaign:

- **Acts**: `CAREER_ACTS` now has six acts and 13 milestones. The two prototype acts and single climax act became Get in / Prove yourself / Consequences / Step up / The crisis / Resolution.
- **Ending freeze** (§12) moved from the crisis to `FINAL_MILESTONE` (`the_review`). The crisis still sends Rohan's summary to Emma. The ending gained `headline`, `weakness` and `tease` (additive, defaulted) and draws defining moments from `storyMoments()` in `src/content/ending.ts`.
- **Milestone resolution** (§10): the "crisis resolves on failure" special case is generalized to `CONTINUES_ON_FAILURE` (Meridian call onward).
- **Failure recording** (§4): partials are setbacks only when authored (`OutcomeBranch.setback`, or quest `failure` with no outcome override).
- **Recovery** (§5): per-source authored text; repair windows close once the following chapter resolves (Friday's repair stays open until the status update).
- **Multi-NPC** (§1–2): a second ensemble scene (Nora + Vikram) precedes the crisis. Crisis participants can be *guarded* by history and then share constraints only when asked (`kit.fresh`).
- **Pacing** (§8): `breathing_room_after_boss` (+20) and `back_to_back_peaks` (−15).
- **Director** (§11): optional scenes score below milestones; after the crisis only the Review is offered.
- The "Nora and Maya enter at the climax" limitation (§14) is resolved: both have Act II introductions and optional follow-ups.
