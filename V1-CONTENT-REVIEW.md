# V1 content review: Career City, season one

Companion to `V1-CONTENT-ARCHITECTURE.md`. This records what was built in the V1 content phase, how it was checked, and what's still weak.

## 1. Encounters added

| Encounter | Type | Structure | What it adds to the story |
|---|---|---|---|
| **The Codebase Nobody Explains** (`meet_maya`) | Act II milestone | Relationship + discovery | Maya exists before the crisis. How you ask for help decides whether she becomes a collaborator. The right question reveals that *the rollback has never run on production-sized data*: evidence for the deadline scene. |
| **What the Customer Actually Asked For** (`nora_requirements`) | Act II milestone | Listening under ambiguity | Nora exists before the crisis. The obvious move (estimate the dashboard) is wrong. Discovery finds Meridian's month-end export problem. A blind yes becomes a commitment that comes back in Act III. Nora tells Vikram about the engineer who asked. |
| **The Meridian Call** (`customer_escalation`) | Act III milestone, **Boss 2** | Multi-NPC (Nora + Vikram), negotiation | Reads Act II: the incident you owned or hid, the slip, the date nobody owned, any dashboard promise. Three phases. Failure continues the story: Nora takes the account back. |
| **Maya Wants a Word** (`maya_checkin`) | Consequence event (optional) | Conflict repair, or relationship/support | *Strained* if the rushed migration cost her a weekend or you brushed her off; *backing* if things went well and she wants support for her rollback rule. |
| **Ninety Days In** (`emma_check_in`) | Relationship interlude (optional) | Reflection, candour | Returning Emma, shaped by the negotiation and by what Rohan told her. Candour plus a real question reveals the coming lead role. |
| **Sunday at the Bakery** (`priya_interlude`) | Everyday District side scene | Listening, low pressure | Breathing room outside Nova Labs. Advice-first is the weak move; teaches "label the concern". |
| **The New Hire** (`mentor_arjun`) | Act IV milestone | Listening + delegation | Arjun has been hiding that he broke staging. Lecturing or taking over gets "it's fine". Making it safe gets the truth; letting him own the fix is the win. A deliberate echo of the player's own first weeks. |
| **What Should I Do Differently?** (`feedback_for_rohan`) | Act IV milestone | Relationship, candour with care | Upward feedback. Flattery wastes the ask; an attack bruises. Success creates a reciprocal commitment the crisis remembers. |
| **The Review** (`the_review`) | Resolution milestone | Make the ask / take feedback | Three authored situations from the crisis grade. Freezes the ending. |
| **Nora's Debrief** (`recovery_customer_escalation`) | Recovery (optional) | Ownership | Rebuild credibility with Nora after losing the Meridian call. |

New characters: **Vikram Rao** (Meridian's head of finance operations) and **Arjun Iyer** (associate engineer). Nora and Maya were rewritten from clones of Rohan's definition into full characters. New locations that open as you progress: *Product Floor*, *Customer Call Room*.

## 2. Encounters changed

- **The Counter Offer** is now Boss 1: stakes and approaches on the briefing, boss pacing, narrative transition.
- **First Day → Maya → Deadline → Nora → Status Update**: follow-ups and milestone gates rewired. The deadline briefing now cites Maya's rollback fact, or its absence. The status update cites Maya's warning and her already-running restore.
- **Project Crisis**: now explicitly the *Meridian* rollout. Participant dispositions come from history. A guarded Nora or Maya only shares her constraint when asked for it directly. Carry-over cites the Meridian call, Maya's arc, Rohan's feedback and hidden staging problems. Every outcome hands off to The Review instead of ending the season.
- **Recoveries**: the shared grammar is unchanged; each now has authored title, stakes, opening, situation, what repair means for that NPC, and outcome prose. *Before Friday Arrives* genuinely changes the migration if taken before the status update. Repair windows close once the story has moved on.
- **All milestones** have narrative transitions ("Ten days later — Month-end is six days out…") and pacing profiles.
- **Setback policy**: failures are always setbacks. Partials are setbacks only when authored as such (`OutcomeBranch.setback`), so an awkward first day is no longer listed as an unresolved failure.
- **NPC prompt**: `personality.manner` (rhythm, disagreement, approval, trust builders/breakers, ambiguity, decisions, relationship variation) for all seven characters.
- **World**: the unused, open "Influence Arena" is now the locked *Negotiation Arena* (a future hook).

## 3. Full campaign path (strong player, as simulated)

Priya in the lift → Screening (strong) → Interview (solid) → **Counter Offer** (₹9L + ₹40K) → First Day → Maya (offers to pair; learns the rollback is untested) → Deadline (Monday, with a partial on Friday) → *Director: Before Friday Becomes a Promise* → Nora (finds the month-end need) → Status Update (owns the slip) → *Director: Emma's introduction* → *Maya Wants a Word* (backs her rule) → **Meridian Call** (plan Vikram can check) → New Hire (Arjun owns the fix) → Feedback for Rohan (lands) → **Project Crisis** (aligned) → Review (one-quarter lead trial).

Ending: *Project lead trial*. "An emerging leader people bring the hard problems to". Candidate → Platform Engineer → Trusted Contributor → Emerging Lead. Tease: Leadership Tower is opening.

## 4. Alternate paths (all nine simulated personas reach an ending)

| Persona | Scenes played | Optional/Director | Setbacks | Professional ending | Identity |
|---|---|---|---|---|---|
| strong | 17 | checkpoint, introduction, Maya | — | Project lead trial | An emerging leader people bring the hard problems to |
| average | 13 | — | crisis (partial) | Trusted contributor with a path to lead | A developing professional with unfinished work |
| weak | 14 | — | screening (repaired), deadline, dashboard, cover-up, Meridian, crisis | A narrower remit, with an agreed way back | Still learning to bring bad news early |
| recovery-heavy | 20 | checkpoint, introduction, Maya, Emma 90-day | screening, interview, cover-up: **all repaired** | A second chance earned: trusted contributor | Accountability earned through recovery |
| aggressive | 18 | checkpoint, introduction, Maya (repair), Emma | Meridian (repaired), feedback (bruised), crisis | Specialist path, without a people mandate | A strong negotiator still learning to listen |
| overcommitter | 19 | checkpoint, introduction, Maya | Friday (repaired), dashboard, cover-up (repaired), Meridian (repaired), crisis failure | A narrower remit, with an agreed way back | A thoughtful collaborator learning boundaries |
| cautious | 13 | — | deadline stalemate, messy update, crisis partial | Trusted contributor with a path to lead | Careful and trusted, still finding the nerve to ask |
| listener | 17 | checkpoint, introduction, Maya | — | Trusted contributor; the lead role is still open | A thoughtful listener building a professional voice |
| ignores optional | 13 | — | — | Project lead trial | An emerging leader people bring the hard problems to |

Nine distinct scene sequences. Six distinct professional outcomes. Eight distinct identities. Four distinct optional-content sets. The acceptance test (`campaign-simulation.test.ts`) asserts these properties.

## 5. Failure and recovery examples

- **Weak**: fails screening → *One More Call* repairs it → takes the first offer → brushes Maya off → caves to Friday → promises Nora a dashboard → hides the incident → loses the Meridian call (Vikram "has started asking Nora about other vendors") → takes over nothing, notices nothing with Arjun (staging stays broken, which the crisis mentions) → flatters Rohan → Rohan takes the crisis back → agrees a way back in the review. Still a complete story, and the ending tells the truth about it.
- **Overcommitter**: every promise comes back. Friday → repaired in time, so the migration slips instead of breaking. The dashboard → Vikram asks about it on the call. The cover-up → *The Honest Version*. The Meridian call → *Nora's Debrief*. Repairs don't erase history: the crisis still fails, and the ending is "A narrower remit, with an agreed way back".
- **Recovery-heavy**: three repairs, all remembered as repairs. Rohan's review counts it ("You've repaired things before"), and the ending is *A second chance earned*.

## 6. Character arc examples

- **Maya**: strong → "Backs you in the room, and tells people why". Aggressive → brushed off, then repaired in *Maya Wants a Word* → "Works with you well. Keeps her evenings to herself". Weak → "Stopped volunteering help". In the crisis, a guarded Maya holds her capacity constraint until asked.
- **Emma**: advocate (introduction earned) → "Would put her name behind you again, and has". Otherwise → "Remembers you as a solid hire". Her tease ("Emma has another opportunity for you") appears only with enough trust.
- **Nora**: found the need + won the call → "Trusts you to explain a tradeoff to a customer without spin". Took the account back → "Checks everything you tell a customer before it goes out".
- **Rohan**: from "still deciding whether your estimates mean anything" to "trusts your judgment under pressure", or "plans around you rather than with you".

## 7. Director-personalized examples

- Right after the deadline, players heading into a risky Friday get *Before Friday Becomes a Promise* (pressure variant). Its success prevents the incident.
- Burned Maya → *Maya Wants a Word (strained)*. Clean migration → *(backing)*.
- The aggressive persona, who lost the Meridian call, is offered *Nora's Debrief*.
- After a boss, quieter scenes get priority (`breathing_room_after_boss`), which is where *Ninety Days In* surfaces for two personas.
- After the crisis, only *The Review* is offered. Personalized events and side scenes stop.

## 8. Boss progression

Counter Offer (one person, numbers, difficulty 3) → Meridian Call (two people, one is the customer, three phases, difficulty 3–4) → Project Crisis (three people, four phases, pressure 2–4 from history). Each adds a dimension: numbers → stakeholders → the whole team plus your own history.

## 9. Project Crisis integration

The crisis reads commitments to Rohan (including the feedback reciprocal commitment), the rushed migration (unless replanned), repairs, the Meridian outcome, Maya's arc, Nora's history, Arjun's hidden staging problem, and Rohan's trust. Its phases are unchanged. What changed is who shares what, and when, based on the relationships the player built. Its outcome sends Rohan's recommendation or incident account to Emma and hands off to The Review.

## 10. Ending variations

See section 4. Endings also vary in defining moments, character outcomes, the "still working on" line (from measured facets) and the tease: Leadership Tower, Emma's opportunity, "Career City isn't finished with you", or the Negotiation Arena.

## 11. Content pacing assessment

- Intensity alternates 1-3-4-1 | 2-3-3-3 | 4 | 2-3 | 5 | 3, with optional 1–3 scenes between chapters. Two bosses never sit back to back.
- A milestones-only run is 13 conversations, roughly 1–1.5 hours with voice. A full run with optional content is 17–20, roughly 2–3 hours. Both fit the target.
- Act III is the thinnest: one milestone. It relies on the Director's consequence events and on the Meridian call's history-dependence to feel like "the game remembers". For players who ignore optional content, Act III is one (strong) scene.

## 12. Remaining weak encounters

1. **Sunday at the Bakery** now receives an explicit post-Meridian `breathing_room_after_meridian` Director boost for players who already know Priya. It remains optional and still respects its normal prerequisites.
2. **Introduce Yourself** needs the NPC to say "bakery" to count as learning about Priya. This works with real models and fails with the offline fake. Low stakes.
3. **Director checkpoint copy** in Act IV ("After the migration…") reads slightly stale. Kept, because the overcommitter's personalized repair path depends on it.
4. The **Emma introduction** and **checkpoint** templates predate `manner` and the kit; their writing is plainer than the V1 scenes.
5. **Start Again** (first-day recovery text) is unreachable because First Day has no failure branch. Harmless.
6. The crisis's **partial grade** still records a "relationship damage" setback for average players (legacy `failure` config on the quest). It is accurate, but reads harsher than intended in "Setbacks and repairs".

## 13. Game-feel improvements

- Home screen is now a story, not a dashboard: act heading, one next-chapter card with a transition stamp ("TEN DAYS LATER"), boss and repair badges, and a six-act track. The Director's pick shows as "Also waiting" only when it differs from the chapter.
- "Your story so far" shows real moments ("Asked what Meridian actually needed…"), each linked to its debrief, instead of raw decisions.
- District panel reads Now → Also waiting → Behind you (practice) → "4 more chapters later in the season".
- Briefings: transition stamp, act and chapter label, "A separate repair" / "Because of what happened" / "Optional" framing, clearer practice copy.
- Results: humane grade copy ("It landed" / "Partly your way" / "It didn't go your way"), every participant's relationship change, next chapter with its transition, correct practice wording.
- A full season-ending presentation, both on the home screen and linked from the Review debrief.
- Developer terminology removed from player text ("authored professional summary", "witnessed plan justify…").
- Onboarding copy fixed: it claimed you start with an offer.

## 14. Testing performed

- `npx vitest run`: **257 passed in 31 files** (was 239 in 30). New: `v1-content.test.ts` (18 tests: every new encounter's branches, the Review's three situations, the title-demand stall, repair windows, Director season rules, map kinds, transitions) and a rewritten `campaign-simulation.test.ts` (nine full seasons, divergence assertions, determinism, idempotence). Existing tests updated only where the design changed: new milestone order, ending freezes at the Review, seeded profiles include Acts 3–4.
- `npx tsc --noEmit`: pass. `npx eslint .`: pass (0 problems). `next build`: pass.
- `npx tsx scripts/campaign-simulation.ts --summary`: nine personas (section 4).
- Production-server browser runs (Chrome via Playwright, fake provider, isolated `data/campaign-qa.db`), desktop 1440 and mobile 390:
  - `scripts/e2e-v1.ts` (new): new player signup → onboarding → first chapter → result → home. Mid-season home (Act III, boss marked, recap). Meridian briefing. **Meridian call played in the UI with two live speakers**. Result with both relationships. Strong ending. Weak ending. Maya dossier. 8 checks, no page errors, no horizontal overflow. Screenshots in `e2e-shots/v1/`.
  - `scripts/e2e-campaign.ts` (updated): ending, review debrief link, Maya history, crisis briefing, three live speakers, identity after reload, autonomous NPC reaction, failure → recovery UI. Pass.
  - `scripts/api-smoke.ts http://127.0.0.1:3012`: pass.
- Screenshots were reviewed by eye (home mid-season, ending on mobile, Meridian scene on mobile, Meridian result on mobile).

## 15. Real-model playtesting performed

`scripts/v1-live-playtest.ts` plays the new scenes with natural paraphrases, not the offline fixture phrasings, so the semantic reader is really exercised.

- The configured model (`deepseek/deepseek-v4-flash-0731:free`) is **no longer available free** on OpenRouter (HTTP 404). I did not switch to the paid slug, to avoid charges. I used `nvidia/nemotron-3-super-120b-a12b:free` through a process-level `AI_MODEL` override. `.env.local` was not modified.
- **Maya**: every read correct (`specific_ask, did_homework, respects_time` from one line; then `rollback_question`; then `gives_back`). The pairing offer and rollback disclosure fired at the right moments. New line in her voice: "Good. Save the team time. I'll be around if you hit something weird." Outcome *ally*. Evaluator headline: "Precise ask uncovered hidden risk".
- **Nora**: `need_question → reflects_need → alternative_scope`. Both disclosures fired. "That's a trade I can explain to them. Can you have the export ready to run before the close on the thirtieth…". Outcome *found the need*.
- **Meridian call** (two runs): plain account and risk question read correctly. Vikram: "I've heard that before. What's different this time?" (his manner exactly). Close disclosure delivered. The third turn was lost to upstream overload / rate limits both times, so the result was *on watch* (partial). This is correct for what was actually heard.
- **Arjun** (second run): `open_question` → surface answer ("It's going… fine") → `safety` → truth disclosure → `his_plan` → plan disclosure → `concrete_support`. Outcome *unstuck*. "Yeah, four works. I'll pair and then I'll tell Maya. Thanks, Asha. Really."
- **Feedback for Rohan** and **The Review**: not live-tested. OpenRouter's free daily cap (50 requests) ran out. Both are covered offline only.
- Line length in live runs: average 11–16 words, maximum 23. No banned assistant phrases.
- Latency: semantic reads 0.6–6.5 s (one near 10 s during rate limiting), against the 8 s deadline. The deadline is tight for slower models. Evaluation took 15–61 s on the free model.

## 16. Physical-device testing still needed

Nothing was tested on a physical phone. Still needed: microphone permission and speech recognition on iOS Safari and Android Chrome; barge-in and TTS voice selection per NPC (seven voices; Vikram and Arjun are new); layout at real device widths and with keyboards open; the two- and three-speaker scenes over mobile networks (the reaction endpoint, and stale-turn conflicts).

## 17. Exact remaining tasks before CLOSED BETA

1. **Fix the provider configuration**: the configured model 404s. Use the intended Claude model (or a paid slug), and re-run `scripts/v1-live-playtest.ts` for all six scenes plus the crisis, including Rohan's feedback and the Review.
2. **Live semantic acceptance corpus** for the new features (≈10 paraphrases, negations and retractions per scene), especially `blind_yes`, `takes_over`, `flattery`/`attack`, `title_grab`, `overpromise`.
3. **Decide the scene-read deadline** (8 s) for the production model; measure the failure rate of "could not be interpreted reliably" under real load.
4. **Physical-device voice QA** (section 16).
5. **One human playthrough of all 13 chapters with voice**, timing each act and noting where a scene drags.
6. ~~Give **Sunday at the Bakery** a Director reason to surface~~ — done: after the Meridian boss it can become the Director's low-pressure breathing-room pick for players who already know Priya.
7. Refresh the **Director template writing** (checkpoint / introduction) to the V1 standard with `manner`-aware direction.
8. Reclassify the crisis's partial as a non-setback (`setback: false`) if playtesters read it as a failure.

## Is Counterpart V1 now a complete game?

**YES.**

A new player goes from signup into the first spoken call with no explanation. The player lives a 13-chapter career story across six acts, with personalized events between chapters. Mistakes create different scenes and different relationships, not retry screens. Repairs work, and they are remembered as repairs. Two bosses build to a three-person climax that reads the whole season. The season ends with a personalized ending grounded in what actually happened, and teases what comes next. Nine very different simulated players all reach distinct, honest endings through the real game service. The UI shows it without developer language.

None of the items above blocks V1 completeness. Items 1–5 block a **closed beta**, because they are about validating the game with the production model, real voices and real devices, not about missing content.
