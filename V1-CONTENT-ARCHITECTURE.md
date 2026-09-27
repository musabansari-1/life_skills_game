# V1 content architecture: Career City, season one

This is the authoritative map of the V1 campaign: what exists, how it's wired, and the rules content must follow. It builds on `ADVANCED-CAMPAIGN-ARCHITECTURE.md` (systems) and does not introduce a parallel quest system. Every encounter below is an ordinary `defineQuest` definition run by the same orchestrator, reducers, Director and persistence.

Source of truth in code:

| Concern | File |
|---|---|
| Acts, milestone order, failure-continues list, ending freeze | `src/engine/campaign/index.ts` (`CAREER_ACTS`, `CONTINUES_ON_FAILURE`, `FINAL_MILESTONE`, `resolveEnding`) |
| Player-facing chapter list and progress | `src/content/campaign.ts` (derived from `CAREER_ACTS`) |
| Ending prose: defining moments, character outcomes, weakness advice | `src/content/ending.ts` |
| Quest registry and content validation | `src/content/quests/index.ts` |
| Semantic-encounter helpers | `src/content/quests/kit.ts` |
| Recovery grammar and authored recovery text | `src/content/quests/recovery.ts` |
| NPC voices (`personality.manner`) | `src/content/npcs/index.ts` |
| Pacing and difficulty | `src/engine/campaign/pacing.ts` |
| Director (curated + personalized) | `src/engine/director/index.ts` |

## 1. Campaign structure

Career City, season one, is a career story in six acts: from a candidate on a screening call, through a first job at Nova Labs, to a crisis room and a review that decides what comes next. There are **13 milestones** (required chapters). Around them sit **5 optional or Director-selected scenes**, **2 personalized Director templates (8 variants)** and **7 recovery conversations**, for **27 encounter opportunities**. A typical run plays 13–20 of them.

```
Act I   Get in           Screening → Interview → The Counter Offer [BOSS 1] → First Day
Act II  Prove yourself   Maya → The Deadline → Nora's Request → The Status Update
Act III Consequences     The Meridian Call [BOSS 2, two people]
Act IV  Step up          The New Hire → What Should I Do Differently?
Act V   The crisis       The Project Crisis [FINAL BOSS, three people]
Act VI  Resolution       The Review  → personalized ending
```

Between chapters the Director offers, depending on history: *Before Friday Becomes a Promise / The Next Commitment* (Rohan), *A Door Emma Can Open / Put My Name Behind It* (Emma), *Maya Wants a Word* (repair or backing), *Ninety Days In* (Emma), *Sunday at the Bakery* (Priya), and any open recovery.

## 2. Acts

| Act | Purpose | Teaches | Difficulty |
|---|---|---|---|
| I · Get in | Establish Emma and Rohan, the first promises and the first number. | Specific examples, protecting leverage, owning a failure story, negotiating. | 1 → 3. One primary skill per scene; patient NPCs. |
| II · Prove yourself | Join the team; meet Maya and Nora before they matter; make the commitment that Act III will test. | Asking for help, saying no with an alternative, discovery before estimating, owning bad news. | 1 → 3. Relationship consequences begin. |
| III · Consequences | What you said comes back: the customer escalation reads the incident you owned or hid, the slip, or the date nobody owned, and any dashboard you promised. | Plain accounts, finding the real risk, checkable commitments, two people at once. | 3–4. Stronger objections, hidden constraints. |
| IV · Step up | Responsibility for other people: coaching a scared new hire; upward feedback to your manager. | Listening, delegation, candour with care. | 3. Combined skills; nobody is hostile. |
| V · The crisis | Everything built so far, in one room with Rohan, Nora and Maya. | All of it. | Boss rating 4, hidden pressure 2–4 from history. |
| VI · Resolution | The review: reach for what the crisis earned, or hear "not yet" well. | Making the ask, taking feedback. | 3. |

## 3. Mandatory milestones

`CAREER_MILESTONES` in order. Each milestone's prerequisite includes `milestoneAllowed(world, id)`: all earlier milestones must be resolved. A Director or optional scene can never substitute for one.

| # | Quest id | Title | NPC(s) | Structure | Resolves on failure? |
|---|---|---|---|---|---|
| 1 | `recruiter_screening` | Recruiter Screening | Emma | Presentation | No → recovery *One More Call* |
| 2 | `hiring_manager_interview` | The Hiring Manager | Rohan | Ownership, pressure | No → *The Follow-Up* |
| 3 | `counter_offer` | The Counter Offer (Boss 1) | Emma | Negotiation | No → *The Call You Have to Make* |
| 4 | `first_day_nova_labs` | First Day | Emma | Discovery, relationship | (no failure branch) |
| 5 | `meet_maya` | The Codebase Nobody Explains | Maya | Relationship, discovery | (no failure branch) |
| 6 | `push_back_on_deadline` | Push Back on a Deadline | Rohan | Pushback | Partial "caved" is a commitment setback with repair *Before Friday Arrives* |
| 7 | `nora_requirements` | What the Customer Actually Asked For | Nora | Listening, ambiguity | Partial "promised dashboard" is a commitment setback carried into Act III |
| 8 | `status_update` | The Status Update | Rohan | Ownership | Partial "covered up" is a setback with repair *The Honest Version* |
| 9 | `customer_escalation` | The Meridian Call (Boss 2) | Nora + Vikram | Multi-NPC, negotiation | **Yes**: Nora takes the account; optional repair *Nora's Debrief* |
| 10 | `mentor_arjun` | The New Hire | Arjun | Listening, delegation | Yes (partials only) |
| 11 | `feedback_for_rohan` | What Should I Do Differently? | Rohan | Relationship, candour | Yes (partials only) |
| 12 | `project_crisis` | The Project Crisis (final boss) | Rohan + Nora + Maya | Multi-NPC, conflict | **Yes**: Rohan takes over |
| 13 | `the_review` | The Review | Rohan | Ask / feedback | Yes; freezes the ending |

Milestones 9–13 are in `CONTINUES_ON_FAILURE`: their failure is itself the authored continuation. Earlier failures block and open a separate recovery conversation.

## 4. Optional and Director content

| Encounter | Opens when | Situations | Why it exists |
|---|---|---|---|
| `director_checkpoint` (4 variants) | After the deadline, before the crisis | Pressure (before the migration ships) or "next commitment" | Chance to change a promise early; overcommitment practice |
| `director_introduction` (4 variants, stretch = sponsorship boss) | After Act II, if Emma trusts you enough | Earned introduction vs earn one | Emma's arc toward advocate |
| `maya_checkin` | After the status update, before the crisis | **Strained** (rushed migration cost her a weekend, or you brushed her off) vs **backing** (she asks you to support her rollback rule) | Maya's arc: repair or alliance; feeds the crisis |
| `emma_check_in` | After the status update, before the crisis | Varies by negotiation history and what Rohan told her | Returning Emma; reflection; learns of the lead role early |
| `priya_interlude` | After meeting Priya and settling in | — | Breathing room; teaches "label the concern" |
| `introduce_yourself` | Any time | — | Low-stakes warm-up, Everyday District texture |

The Director scores milestones at 40 and optional scenes at 26, then applies pacing and consequences, so side scenes are offered when they have a reason: a consequence to answer (`urgency: consequence`), a quieter scene after a boss, a skill need, or an open repair. After the crisis, only the Review is offered.

## 5. Boss placement

| Boss | Where | Participants | Resistance | Viable strategies | Failure |
|---|---|---|---|---|---|
| The Counter Offer | End of Act I | Emma | Band cap, the flexible lever isn't base | Anchor + evidence; discovery of the joining bonus | Offer withdrawn → repair reopens ₹8.5L only |
| The Meridian Call | Act III | Nora (lead), Vikram (customer) | Three phases: straight answer → find what he's protecting → protect the close (and correct any dashboard promise) | Plain account + discovery + checkable protection; Nora interjects on overpromises, Vikram challenges blame | Nora takes the account; Meridian harder in the crisis |
| The Project Crisis | Act V | Rohan, Nora, Maya | Four phases: accountability → hear the room → tradeoff → credible commitment; pressure 2–4 from history | Reduced-scope pilot; justified delay with interim protection | Rohan takes over; narrower remit |

The Meridian Call deliberately teaches the multi-NPC mechanic (address people by name, participants react to each other) before the final boss uses three.

## 6. Recovery branches

One grammar (own it → concrete repair → credible boundary, over at least two lines), seven authored texts in `recovery.ts`:

| Recovery | After | NPC | What repair means here | Continuation |
|---|---|---|---|---|
| One More Call | Screening failure | Emma | One real example, own the screen, ask for one conversation | Interview opens, with doubt attached |
| The Follow-Up | Interview failure | Rohan | Honest failure story, realistic first milestone | Offer, with Rohan watching |
| The Call You Have to Make | Offer withdrawn | Emma | Own the behaviour, accept original terms | Employed at ₹8.5L, no bonus; lost negotiation stays lost |
| Before Friday Arrives | Caved to Friday | Rohan | Own the promise, safer plan, check-in | If before the status update: the migration ships safely (slip, not incident) |
| The Honest Version | Covered up the incident | Rohan | Real size of the problem, own the minimising, plan with a time | Some trust back; `status.repaired` changes the ending's identity |
| Nora's Debrief | Lost the Meridian call | Nora | Own the call, one protection Nora can offer Vikram | Credibility with Nora; account stays hers |
| Start Again | (First day has no failure branch; text exists for completeness) | Emma | — | — |

Rules: the original failure record survives; replaying the original is practice; a failed repair records another attempt; **repairs of a chapter the story has moved past close** once the following chapter resolves (the Friday repair stays open until the status update). The failure remains in history and in the ending's "what you carry".

## 7. Character arcs

Every major NPC has a `manner` block (rhythm, disagreement, approval, trust builders/breakers, ambiguity, decisions, relationship variation) rendered into the NPC prompt, and an ending outcome per stage in `content/ending.ts` (`advocate / trusted / working / distant / strained`).

| Character | Arc beats | Positive end | Negative end |
|---|---|---|---|
| Emma (Talent Partner) | Screening → offer → first day → (introduction) → (90-day check-in) → hears Rohan's crisis account | "Would put her name behind you again, and has." | "Still remembers how the negotiation went." |
| Rohan (Engineering Manager) | Interview → deadline → status update → (checkpoint) → feedback → crisis → review | "Trusts your judgment under pressure." | "Plans around you rather than with you, for now." |
| Maya (Platform Engineer) | First-week help → (the rollback fact) → (check-in: repair or alliance) → crisis disposition | "Backs you in the room, and tells people why." | "Stopped volunteering help." |
| Nora (Product Lead) | The request → the Meridian call → crisis disposition | "Trusts you to explain a tradeoff to a customer without spin." | "Checks everything you tell a customer before it goes out." |
| Vikram (customer, new) | Hears of you from Nora → the call | "Believes what you tell him about his month-end." | "Has started asking Nora about other vendors." |
| Arjun (new hire, new) | The New Hire | "Comes to you first when he's stuck." | "Still says 'it's fine' when it isn't." |
| Priya (neighbour) | Introduce yourself → Sunday at the bakery | "Knows how your job is actually going." | "A polite nod in the lift." |

Arcs are not forced positive: relationship values come only from authored consequences, and the crisis reads them. A guarded Nora (took the account back, or was given an unscoped dashboard promise) or a guarded Maya (brushed off, or closed after a failed repair) only shares her constraint in the crisis when asked for it directly.

Cross-NPC information uses authored routes only: Emma → Rohan (screening, offer), Nora → Vikram (the engineer who asked what his team needed), Nora → Rohan (the Meridian call), Arjun → Rohan and Maya, Rohan → Maya (capacity checks after feedback), Maya → Rohan (the rollback rule), Rohan → Emma (crisis recommendation or account).

## 8. Pacing model

Each encounter has a `PacingProfile` (category, intensity, pressure, importance, urgency). The season rhythm:

```
intensity  1  3  4  1 | 2  3  3  3 | 4 | 2  3 | 5 | 3
           Scr Int Off Day| Maya Dl Nora Upd| Mer | Arj Fb | Cri | Rev
           (+ Director/optional scenes at 1–3 between chapters)
```

`pacingAdjustment` adds: +28 for a quiet scene after two intense ones, **+20 for a quiet scene immediately after a boss / −15 for back-to-back peaks** (new), −7 per repeated category, +5 novelty, +45 for an open repair, +15 for consequence urgency.

## 9. Skill progression

- XP per quest is `baseXp × skill weight × quality × difficulty × outcome`. New encounters use weights summing ~1.0–1.4 and `baseXp` 45–120 (bosses highest), so a featured skill gains roughly 40–100 XP per scene. Level thresholds (80, 218, 395, 599 XP…) put an engaged player around levels 3–5 by the end of the season; the simulation's strong persona ends at Communication/Listening 4.
- Visible skills stay simple (eight skills, levels, bars). Facet estimates stay internal and drive the Director, difficulty and the ending's single "still working on" line.
- Techniques are learned concepts, never buttons: Clarifying question, Label the concern, Summarise and confirm, Strategic silence, Anchoring, Offer alternatives, Evidence first, Reframing. Each maps to a measured facet and shows as *not yet seen → discovered → reliable*; hints appear once discovered. Result screens announce newly discovered techniques.

## 10. Ending structure

The ending freezes when **The Review** concludes canonically (`FINAL_MILESTONE`), not when the crisis room empties. `resolveEnding` produces:

| Field | Source |
|---|---|
| `professional` | Crisis grade sets the ceiling; the Review decides whether it was reached (lead trial / path to lead / agreed way back / lead role still open), plus specialist and second-chance rules. |
| `path` | Candidate → Platform Engineer → (Trusted Contributor / Under Scrutiny / Team Member) → short professional label. |
| `identity` | Ordered evidence rules: recovery, abrasive negotiator, boundary-less collaborator, hiding bad news, overcommitment pattern (≥2 unsupported promises), emerging leader, trusted communicator, listener, diplomat, careful-but-quiet, fallback. |
| `headline` | One sentence from salary, incident handling and crisis outcome. |
| `definingMoments` | The seven heaviest real moments from `storyMoments()` (the same function feeds the home screen's "Your story so far"), in story order, each linked to its debrief. |
| `relationships` | Per NPC, stage-specific prose in their register, with evidence. |
| `growth` | Top three skills by XP since the campaign baseline, shown as level changes. |
| `weakness` | The weakest facet measured at least twice, with one line of advice. |
| `tease` | Leadership Tower (lead trial), Emma's next opportunity (Emma trust ≥ 20), "Career City isn't finished with you" (crisis failure), or the Negotiation Arena. |
| `unresolved` | Open promises and unrepaired setbacks you carry into next season. |

The ending is deterministic, idempotent under duplicate conclusion, unaffected by later practice, and sorted independently of database row order.

## 11. Future-world hooks

- **Leadership Tower** (locked): the lead-trial ending points here.
- **Negotiation Arena** (locked; renamed from the unused "Influence Arena"): Meridian's renewal is the natural first conversation.
- **Everyday District** (open): Priya is the thread; the interlude teases more neighbourhood life.
- **Speaking Stage**, **Founder Valley** (locked, on the map only).
- Carried state for season two: `season1.complete`, `review.*` flags, open commitments (e.g. Vikram's go/no-go call), NPC relationships and memories, reputation.
