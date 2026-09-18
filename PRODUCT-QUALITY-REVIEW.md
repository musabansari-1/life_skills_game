# Product Quality Review

This phase asked one question: is the core game genuinely compelling? The goal was a persistent world where conversations are the gameplay, not an AI coaching app with XP. I played The Counter Offer repeatedly with scripted strategies against a real model (`deepseek/deepseek-v4-flash-0731:free` via OpenRouter). I fixed what broke the illusion, connected the quests into one story, and made the consequences visible. The architecture is unchanged. Every addition sits behind the existing engine, content and `/api/v1` boundaries.

Evidence tools added:
- `scripts/strategies.ts` plays seven strategies side by side.
- `scripts/latency.ts` measures turn and wrap-up timing.
- `scripts/e2e-walkthrough.ts` plays the first three chapters in the browser, then checks phone widths.

---

## 1. What was weak before this phase

Measured on the real model with the baseline harness:

| Problem | What actually happened |
|---|---|
| **Emma coached the player** | The player said "I'm happy to go with that." Emma replied "before you sign off, I want to make sure you're settled", which is a helpful assistant, not a recruiter closing a deal. To a player who revealed their minimum, she explained how to negotiate. |
| **Spoken figures and the game disagreed** | Emma said "nine point five on base", but the scene recorded ₹9.2L, because the rules clamped the figure after she had already said it. |
| **The worst strategy was rewarded** | After three rounds of "twenty lakh, my friends make that", the player asked "what's your best?". Emma offered her full ceiling (₹9.7L plus ₹30K) and named it as the ceiling. The game then recorded ₹8.6L. |
| **"I accept" didn't end anything** | Accepting on turn 1 left the scene running, because the NPC could only close after 4 turns. |
| **Stated minimums were missed** | "The lowest I could accept is nine lakh" wasn't detected as a floor, so it had no consequence. |
| **Emma talked too much** | 3–4 sentences and about 60 words per turn, too long for speech. |
| **The game-state block leaked into speech** | On one turn the raw JSON block was spoken as part of Emma's line. |
| **Quests weren't a story** | Four standalone scenarios, one consequence chain (Counter Offer to First Day), and no visible "because you did X" before a scene. |
| **Replays duplicated consequences** | Replaying a quest re-applied world changes, relationship deltas and full XP. |
| **Wrap-up felt frozen** | 10–120 seconds behind a static "Reading the room…". |
| **The evaluator could invent praise** | It wasn't required to quote the player. A one-line "I accept" could score well. |

## 2. What I improved

**The central mechanic: rules decide before the NPC speaks.**
- `readPlayerUtterance` (`src/engine/parsing/player.ts`) reads each player line with fixed rules, not the model. It picks out salary asks and floors, evidence (an achievement or market reference with a real number), pressure and ultimatums, questions about the package, and a real yes as opposed to a conditional one ("anything above nine and I'm in" is a floor, not an acceptance).
- A new quest hook, `preTurn`, uses that reading to decide what the NPC may do this turn, and tells the NPC in binding direction lines. In The Counter Offer that means:
  - **Evidence:** she may move up to a computed cap.
  - **A bare ask:** at most a small move.
  - **Pressure:** no movement.
  - **An unrealistic ask:** a plain no, with no counter.
  - **"What's your best?":** at most a token move.
  - **A stated floor:** she offers exactly the floor.
  - **Acceptance:** she confirms the terms and closes.
- What the NPC then *says* is binding up to her hidden ceiling. Figures are read from her speech, including unitless ones like "nine point two five", and they override the model's own game-state figure. A figure above the cap is flagged in the logs, not silently undone. That closes the said-versus-recorded gap.

**Emma as a character.**
- The prompt rules:
  - One or two sentences, under about 35 words.
  - "You are not their coach."
  - Say no plainly.
  - Close when you hear a yes.
  - Call out contradictions.
  - Hidden information has to be earned.
  - Never say a figure the rules don't allow.
- The rules-based reading also feeds her perception, so weak models miss less.

**Evaluation.**
- A grounding check: a behaviour scored as strongly demonstrated must quote words the player actually said, or it's capped at neutral. The evaluator can't invent praise.
- Anti-gaming: a conversation under 15 words is capped (no high scores for "I accept").
- Tighter output: at most 3 strengths, 3 improvements and 3 key moments.
- The evaluator is told to state the hidden truth when it teaches something ("base was capped at ₹9.7L; the bonus was the lever").

**Persistence and replays.**
- Four replay rules:
  - **Failure means progress is blocked.** Examples are a withdrawn offer, or not being put forward.
  - **After a failure, a replay is a second chance.** It becomes what happened, and the NPC remembers the first attempt.
  - **Replaying a resolved quest is a rehearsal.** It starts from the NPC as they were at the original run, awards half XP, and never touches the world. The result compares it with the previous run.
  - **A bad but consequential choice is graded partial,** so the story carries it forward.
- Wrap-up is exactly-once, as already built in the previous phase. Tests now cover the new modes too.

**Game feel and UX.**
- **Briefing:** "What carries over", a chapter position, and honest rehearsal or second-chance labels.
- **Scene:**
  - Emma's mood line reacts to the conversation.
  - Offer changes flash, with the old figure struck through.
  - A turn meter shows time left, and "Emma has to go soon" appears near the end.
  - An end card appears when the deal is done.
  - The mic is larger, with state labels.
  - The mic ends your turn when you pause, and reopens after Emma replies to a spoken turn, for hands-free conversation.
- **Wrap-up:** a live progress screen with four real stages and an elapsed timer, streamed over SSE with heartbeats. A results page that opens mid-evaluation waits and refreshes on its own.
- **Results:** reordered as:
  1. What happened.
  2. What changed: numbers plus relationship deltas.
  3. What this means: aftermath.
  4. Skills: animated XP and level badges.
  5. Two "Worked" and two "Next time" notes, each with a concrete line to try.
  6. Next chapter.

  A breakdown is available on request.
- **World:** a chapter track with Continue, and "Your story so far" in the player's own decisions.
- **Onboarding:** after naming, the player goes straight into chapter 1's briefing, with a three-line prologue instead of a tutorial.

## 3. How the connected campaign works

"Chapter One: Nova Labs" (`src/content/campaign.ts`) has six quests. Every chapter reads something an earlier one wrote.

| # | Quest | NPC | Reads | Writes (examples) |
|---|---|---|---|---|
| 1 | Recruiter Screening | Emma | — | `screening.stated_expectation` (the number you gave, or null); flag `screening.deflected`; Rohan hears "sharp in screening" |
| 2 | The Hiring Manager | Rohan | Emma's note to Rohan | `interview.verdict` (strong/solid/shaky); an overpromise becomes a commitment plus `interview.overpromised`; `interview.blamed_others`; whether you learned the release is late |
| 3 | The Counter Offer | Emma | verdict sets her ceiling (₹9.2L / ₹9.7L / ₹10L) and bonus lever; she holds you to your screening number; second chance if withdrawn | salary; `counter_offer.style` (collaborative / hardball / accepted_immediately / revealed_floor / modest / no_change); Emma's relationship and memory; Rohan hears how you negotiated |
| 4 | First Day at Nova Labs | Emma | style changes her attitude and opening line; salary; what you already know | Emma warmth (hardball can be repaired); unlocks the deadline |
| 5 | Push Back on a Deadline | Rohan | week-one promise; what Emma told him; your salary | caving → `nova_labs.rushed_migration` plus a Friday commitment; a plan → a dated commitment; nothing agreed → unresolved |
| 6 | The Status Update | Rohan | the deadline choice sets the situation: a **production incident** (2% of records failed), a **one-day slip** of your own plan, or **nobody owns the date** | owning it vs. playing it down: a large Rohan trust swing and a lasting memory; commitments resolved; chapter complete |

"Introduce Yourself" stays as an optional side quest in Everyday District.

## 4. Examples of persistent consequences

All of these are asserted in `src/server/campaign.test.ts`, which plays the whole chapter two different ways:
- **Your screening number follows you.** Tell Emma "I'd be happy with eight lakh" in screening. The Counter Offer briefing then shows "In screening you told Emma ₹8L would work. She wrote it down." When you later ask for ₹10L, Emma's direction includes "In screening they told you ₹8L would work. Mention that, briefly." Her concession budget is also lower.
- **Your interview promise follows you.** Promise Rohan you'll be "shipping real work in my first week" in the interview. The world page's "Promises you've made" lists it, and two chapters later Rohan's opening prompt includes "they promised they'd be shipping in week one. It's week two." His patience starts lower.
- **Caving comes back as an incident.** Cave to Friday in the deadline quest, and the finale is a production incident. Play it down ("minor issue… should be fine") and the rules flag a contradiction, Rohan loses trust, and he remembers: "They told me it was minor. It wasn't. I found out from someone else."
- **A plan changes the finale.** Propose a plan instead, and the finale is a one-day slip of your own plan. Owning it ("That's on me… I'll have it done by Thursday noon") raises Rohan's trust and records `chapter1.owned_incident`.
- **Hardball bruises Emma.** Negotiate hard and Emma is cool on your first day. Rohan also has a memory: "Emma warned me the new hire negotiates hard."
- **A walk-away gets a second chance.** Get the offer withdrawn, replay, and Emma's opening prompt carries "you withdrew the offer". The new outcome becomes what happened.
- **A rehearsal leaves the world alone.** The test compares the world state and Emma's relationship and memory before and after a rehearsal: they're identical. Only XP moves.

## 5. Evidence that strategies produce different outcomes

Seven scripted strategies against the real model, same starting state. The second round ran after the fixes (`scripts/strategies.ts`):

| Strategy | Emma's behaviour (real transcript) | Result |
|---|---|---|
| Aggressive ("an insult… twelve or I walk") | "I'm not going to chase a number that's outside what this role supports." Then "we're at an impasse… Best of luck with your search." | Offer withdrawn by turn 3. Trust −15, warmth −20; Rohan hears about it. |
| Collaborative (warm, questions, no number) | Reveals urgency and bonus flexibility, then closes the moment the player says yes | ₹8.5L, no bonus. Good relationship, no money: the player accepted before naming a number. |
| Evidence plus discovery | "That thirty percent migration is a strong data point… I can move to nine point four five." Then adds ₹40K. | ₹9.45L plus ₹40K. Strong deal. |
| Reveals minimum ("lowest I could accept is nine") | "I can make that work: nine lakh base." Holds there. | Met your floor: exactly ₹9L. "The rest of the room she had (up to ₹9.7L) stayed on her side of the table." |
| Total comp and discovery | Reveals the cap, then the bonus lever, then urgency; agrees to a ₹60K bonus | ₹8.5L plus ₹60K |
| Accept immediately | "Wonderful… eight and a half lakh base, no joining bonus. Welcome aboard." | Took the first offer. Emma's memory: "Easy close." |
| Unrealistic ("twenty lakh… my friends make that") | "Twenty lakh is not going to happen." Then "I'm not going to debate what your friends make." Then "My best is what's on the table." | Offer unchanged. Feedback: "Anchor with justification, not fantasy"; "Don't surrender leverage by asking for Emma's best". |

The same behaviours are pinned by the rule tests in `src/engine/scene/scene.test.ts`: evidence beats a bare ask, pressure gets nothing, a floor caps the offer, an unrealistic ask gets a no, and "what's your best" gets a token move.

## 6. Remaining UX problems

- **Voice untested on a real device.** Voice hasn't been tried on a phone with a microphone. The web speech API differs across iOS Safari, Android Chrome and desktop, especially around permission prompts and auto-listen. Needs one manual session per platform.
- **The opening line blocks the scene.** It takes about 5 seconds on the free model while "Emma is picking up…" shows. It could stream in the scene instead.
- **Standing labels are coarse.** "Neutral" persists through several positive interactions. Consider more bands, or showing "warming".
- **Wrap-up is still about a minute on free models.** The progress screen makes it feel alive, but it's still long. See §8.
- **Fake-provider screenshots misrepresent NPC quality.** The fake is canned and for tests only. Judge believability with a real model.
- **The world map is decorative.** It's static, and the district quest list gets long once the chapter is played. The chapter track does the real navigation work.
- **No "resume evaluating" affordance.** If the app is closed mid-evaluation, the world page doesn't list evaluating attempts. The results URL works, but nothing links to it.

## 7. Voice assessment

**Current behaviour.**
- **Input:** Web Speech API. The turn now ends after a 1.4 s pause once you've spoken, with an 8 s timeout if you say nothing and a 45 s cap.
- **Output:** Emma's reply streams as text and is spoken sentence by sentence as it arrives.
- **Barge-in:** tapping the mic while Emma speaks cancels her.
- **Hands-free loop:** after Emma replies to a spoken turn, the mic reopens automatically. You can talk back and forth without touching the screen.

**Latency** (free model, `scripts/latency.ts`):

| Step | Time |
|---|---|
| Emma's first words, per turn | 1.3–1.7 s |
| Full reply | 2.6–4.5 s, now 24–37 words |
| Opening line | 5.2 s (before the scene appears) |

With a paid Claude model, first words should be comparable or faster.

**Is it conversational enough for V1?** Yes. A reply that starts speaking within about 2 seconds, from a character that keeps it short, is well inside "phone call" territory. It's not duplex: you can't talk over Emma naturally. The browser's text-to-speech voices vary a lot by operating system, and on Windows they're robotic.

**Fixed this phase:**
- A second tap was needed to finish speaking.
- There was no hands-free loop.
- Replies were too long to listen to.
- The mic's state was unclear.
- The screen rendered differently on server and client because of the speech APIs.

**Needs a more capable model later:** a realtime duplex pipeline (see §10).

## 8. Quest-completion latency

**Measured on the free model:**

| Stage | Time |
|---|---|
| Evaluation | 58.1 s |
| Memory extraction (parallel) | 14.7 s |
| Total wrap-up | 58.2 s |

The strategy harness saw 50–66 s across runs. It was sequential before this phase; running the two AI calls in parallel saves about 15 s.

**Also done:**
- **Shorter evaluator output:** strict limits on list and evidence lengths.
- **Live progress** over SSE with heartbeats.
- **Waiting page:** a results page opened mid-evaluation waits and refreshes on its own.
- **Exactly-once conclude:** retries are safe.

**Next low-risk step:** route evaluation to a faster model with `AI_MODEL_EVAL`. The evaluator's job is structured judgement, not long prose, so a fast model with the grounding check is likely adequate.

**Is a background-job rewrite needed?** Not for the web V1: the stream shows progress and survives the wait. It becomes necessary for native mobile, where the OS suspends apps mid-request. Details are in §10, and the design is already in MOBILE-ARCHITECTURE.md.

## 9. Highest-value next features

1. **Play on a paid Claude model and tune.** The rules make outcomes robust, but NPC texture (humour, memory callbacks, sharper pushback) scales with model quality. Route NPC turns and evaluation separately.
2. **Manual voice QA on iOS and Android,** then choose a server text-to-speech voice per NPC for character.
3. **A chapter-end recap screen:** "Your Chapter One", with the key decisions, how each person sees you now, and your salary. This is the "this world remembers me" moment, and it doubles as a share card.
4. **Chapter Two in the already-open Influence Arena,** reusing Emma and Rohan. For example, Rohan asks you to pitch a proposal to a sceptical stakeholder, and your Chapter One reputation opens or closes doors.
5. **Personalised rehearsal suggestions,** driven by the weakest competency facets ("You give away leverage early. Rehearse The Counter Offer without naming a number first.").
6. **Stream the opening line** into the scene instead of blocking the start.
7. **Async wrap-up job for native clients.**

## 10. FABLE ESCALATION RECOMMENDATIONS

Only two items qualify; everything else above is routine implementation.

1. **Realtime duplex voice with state-consistent interruption.** True talk-over turn-taking needs streaming speech recognition and synthesis, voice-activity detection, and a transport such as WebSocket or WebRTC. The hard, architecture-sensitive part is consistency. If the player interrupts Emma mid-sentence, the game must record only what she actually said. A figure she was about to say, but didn't, must not be binding, and memory extraction must see the truncated line. That touches the binding-speech rule, the scene rules, the turn model and the voice state machine at once. Do it only after testing on real devices shows the current turn-based loop isn't good enough.

2. **Async, exactly-once conclusion for mobile.** Moving wrap-up to a background job (202 plus polling or push) while keeping evaluation, memory and consequences applied exactly once. It has to survive worker crashes, app suspension, retries across devices, and a player who starts the next chapter before the previous one has finished evaluating (the next chapter's rules read world state that isn't committed yet). The current synchronous path is safe; this is about native UX and it's genuinely subtle.
