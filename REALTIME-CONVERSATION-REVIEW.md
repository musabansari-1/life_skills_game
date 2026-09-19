# Realtime Conversation Review

**Scope.** This phase improved the live conversation layer only: turn-taking, interruption, the canonical transcript, end-of-turn detection, NPC speech, difficulty and failure handling. No quests, worlds, pages or unrelated features were added. The rules-before-speech invariant is kept and made stronger.

**Verdict.** What the character says out loud and what the game records now agree by construction, not by prompt wording. Interrupted speech no longer corrupts history, memory or evaluation. Ten scripted conversations against the real model ended with the spoken figures equal to the recorded state in every one. Six mismatches found in live play along the way were fixed and pinned with regression tests. Latency to first speech is unchanged, because it is dominated by the model. The gains are in turn-taking, in reply length, and in never saying or recording the wrong thing.

---

## 1. Previous voice architecture

```
mic ─▶ BrowserSpeechRecognizer (Web Speech, continuous + interim)
        └─ Endpointer: fixed 1.4 s pause after last word, 8 s no-speech, 45 s cap
     ─▶ useVoiceSession (React hook: idle → listening → thinking → speaking)
     ─▶ POST /api/v1/attempts/:id/turn (SSE)
          server: readPlayerUtterance → quest.preTurn (rules decide the cap)
                  → NPC model streams <speech>…</speech><moves>{…}</moves>
                  → speech streamed to the client as generated
                  → inferMovesFromSpeech + moves → scene reducer → persist full line
     ◀─ client: sentence-chunked speechSynthesis; caption = streamed text
        auto-reopens the mic 350 ms after the NPC finishes
        "barge-in" = tapping the mic, which cancelled audio
```

| Stage | Before |
|---|---|
| Microphone capture | Web Speech API, `en-IN`, continuous with interim results |
| End of turn | Fixed 1.4 s silence after the last recognised word |
| Recognition | Browser engine; the final text is the whole utterance |
| Submission | One request per line, with retry safety via `expectedTurnCount` |
| Rules | `preTurn` set this turn's cap and told the NPC in prose |
| Generation | One streamed call; speech first, then a JSON moves block |
| Streaming | The raw speech was forwarded to the client as it was generated |
| Text to speech | Browser `speechSynthesis`, one utterance per complete sentence |
| Transcript | The full generated line was persisted, whatever was heard |
| Mic reopen | A fresh recognizer 350 ms after the last sentence |
| Cancellation | A generation counter dropped stale audio chunks |
| Errors | Error text was shown and the player's line was rolled back server-side |

## 2. Latency before changes (measured)

Measured with `scripts/latency.ts` against the configured model: OpenRouter `deepseek/deepseek-v4-flash-0731:free`, desktop, same network.

| Measure | Before |
|---|---|
| Opening line (before the scene appears) | 4.2 s |
| First streamed speech characters, per turn | 1.5–1.9 s |
| Full reply | 2.4–4.6 s |
| Reply length | 29–34 words |
| Wrap-up (evaluation + memory in parallel) | 49.3 s |

The old script timed the first streamed *characters*. Audio only starts on a complete sentence, so true time to first audible word was not measured before this phase.

## 3. Problems discovered

Found by auditing the code, then confirmed or newly found in live play.

1. **Interrupted speech became canon.** When the player tapped over Emma, the full generated line was still saved. An offer she never finished saying was recorded, remembered and evaluated.
2. **Speech could disagree with state, in several ways found live:**
   - Emma said "I can meet you partway — nine point two". The phrase wasn't in the offer reader's list, so the game recorded ₹8.5L and the player accepted ₹8.5L.
   - "Nine point seven is the most I can put on base" was likewise allowed but not recorded.
   - The player said "nine point two then, I accept" with ₹9.7L on the table. Emma confirmed 9.2 while the game recorded 9.7.
   - After "I accept", Emma added a ₹60K bonus that was never agreed, and it was recorded.
   - The prompt told her the cap, but nothing enforced it before she spoke.
3. **Walk-outs didn't end the scene.** Emma said "we're done here, I wish you the best". The scene stayed open, and wrap-up then hired the player with the same trust gain as a polite player.
4. **Chatbot tells.**
   - A bare "Hi." made Emma repeat her whole opening, word for word, even after a prompt rule against it.
   - Replies ran to 56 words.
   - There were assistant phrases such as "That's a great point", and coaching.
5. **Premature end of turn.** A fixed 1.4 s pause cut off "I was hoping for something around…" mid-thought, and the half-line was then penalised as filler.
6. **Self-corrections were misread.** In "twelve lakh… no wait, I mean nine point five", the game kept twelve.
7. **A conditional yes counted as a deal.** "I accept, but only with a sixty thousand bonus" was treated as acceptance.
8. **Barge-in was tap-only.** In hands-free mode, speech during the NPC's line was lost.
9. **Speaker echo.** When the mic listens during NPC speech, it hears the NPC, and the recognizer garbles it into near-miss words. A browser test with a real mic produced a false interruption.
10. **Stale caption.** For a moment before a reply's audio started, the previous line reappeared.
11. **The session died on remount.** React's development strict mode unmounts and remounts once. The old cleanup made every later action a no-op.
12. **The status chip announced offers before they were spoken.** The offer chip updated as soon as the server answered, sometimes seconds before Emma said the figure.
13. **Difficulty was only an XP multiplier.** It didn't change how anyone behaved.
14. **The prompt was never cache-friendly.** Per-turn director notes were embedded in the "cacheable" system prompt.

## 4. Changes made

| Area | Change | Where |
|---|---|---|
| Speech gate | Every NPC sentence is checked by the quest's `speechGate` before it is streamed. Violations are rewritten to the allowed figure or dropped. Only gated text is ever spoken, captioned, persisted or read by the rules. | `engine/scene/speechGate.ts`, `orchestrator.generateGated`, `content/quests/counter-offer.ts` |
| One offer reader | The gate and the recorder share one reader. Emma's own figure above the table is an offer unless the clause negates it, attributes it to the player, or asks a question. The player's figure needs explicit agreement. After acceptance, the confirmation must name exactly the agreed base and bonus. | `readOfferSpeech`, `confirmedFigures` |
| Unspoken proposals | A figure in the model's JSON that was never said out loud is dropped. | `engine/scene/delivery.dropUnspokenFigures` |
| Canonical transcript | Interrupted lines are truncated to the heard prefix, and the scene is re-reduced from the pre-turn state. | `engine/scene/delivery.ts`, `orchestrator.applyDelivery`, the `dialogue_turns.scene_before` column |
| Contract (additive) | `TurnRequest.interrupted`, `POST /attempts/:id/delivery`, and `ClientTurn.interrupted`. | `contracts/api.ts`, the delivery route, `gameClient.reportDelivery` |
| Conversation controller | A platform-neutral class holds turn-taking, delivery tracking, barge-in, ordered sends, duplicate protection, retry and stale-audio cancellation. The React hook is now a thin adapter. | `voice/controller.ts`, `voice/useVoiceSession.ts` |
| Delivery tracking | Word-boundary progress from TTS, with a rate-based fallback rounded down to a word. It never claims a word that wasn't heard. | `voice/delivery.ts` |
| Voice barge-in | While the NPC speaks, the recognizer listens in monitor mode. Echo is filtered with fuzzy matching, and a barge-in must persist across at least two updates over 350 ms. Leading echo is stripped from the player's line. | `voice/bargeIn.ts`, `BrowserSpeechRecognizer.armEndpointing` |
| Endpointing | The silence window adapts to how complete the line looks and to the speaker's cadence. | `voice/endpointing.ts`, `engine/parsing/utterance.ts` |
| Messy speech | The corrected part of a line wins. Conditional yeses are not acceptances. A trailing-off line is hesitation, not filler, and Emma is told to prompt. | `engine/parsing/player.ts`, `orchestrator` |
| Walk-outs | Walk-out language ends the scene. Below 25 patience, an NPC can walk out before `minTurns`; walking out spends the rest of their patience, so it counts as a walk-away. | `engine/parsing/closing.ts`, `engine/scene/index.ts` |
| Repetition | A sentence that nearly duplicates one the NPC already said is dropped. If a reply is all repeats, it is regenerated once with a direct instruction. | `orchestrator.generateGated` |
| Length | The prompt asks for 8–30 words and one to three sentences, with a hard gate at four sentences. | `npcTurn.ts`, `SpeechGate` |
| Prompt | A cacheable stable prefix (`system`) is separated from the per-turn `systemVolatile`: hidden values, director notes and binding rule direction. Assistant phrases are banned. Guidance covers speech-recognition messiness, being interrupted, conditional yeses and not repeating. | `npcTurn.ts`, providers |
| Difficulty | It now shapes starting patience, how much of the band a good turn unlocks, how much a weak line costs, and behavioural director notes. | `engine/scene/difficulty.ts` |
| Scene UI | The caption follows *heard* audio and never shows a stale line. Status and mood update when the line finishes playing. There is a subtle "thinking" cue, a "just start talking to cut in" hint, a "Send that again" retry, and "(you cut in)" markers in the transcript. The mic stops when the tab is backgrounded. | `app/play/[attemptId]/Scene.tsx`, `globals.css` |
| Stream robustness | A client disconnect mid-reply no longer aborts the turn. The server finishes and persists it, and the client resyncs; if its line is already there, it continues with the reply. | turn route, `Scene.sendTurn` |

## 5. Interruption architecture

```
 NPC line streams ─▶ gated sentences ─▶ client queue ─▶ TTS (one utterance per sentence)
                                         DeliveryTracker: per-sentence status + word-boundary progress
 player cuts in (tap, typed line, or confirmed voice barge-in)
   1. synth.cancel(); generation++ → no queued or late audio ever plays
   2. heard = completed sentences + delivered words of the current one
   3. the report rides on the player's next line: TurnRequest.interrupted = { turnIndex, heardText }
      or, if the player says nothing: POST /attempts/:id/delivery (idempotent)
 server (applyDelivery, before the new line is appended):
   heard' = heardPrefix(generated, heard)      exact prefix of what was generated, whole words
   moves' = movesForHeardSpeech(moves, heard') keep perception of the player's line; keep only reveals
                                               and offers audible in heard'; drop wantsToEnd
   scene  = reduceNpcTurn(scene_before, moves')
   turn.text = heard', interrupted = true, generatedText = full line (diagnostics only)
 next NPC turn: the history shows "…heard—" then "(cutting in) <player line>", plus a direction:
   "they cut you off; anything you were about to offer was NOT offered"
```

If the player cuts in before the server has committed the line, the report waits for the line's index. The player's new line is queued behind the previous request, so the report is never lost or misordered.

Live example: Emma said "Ten lakh is above where I can go today, Asha. That said, the migration win is solid — I can work with nine point three." The player cut in after the first sentence. The ₹9.3L offer was never recorded and the scene stayed at ₹8.5L. Emma's next line reacted to the interruption, and memory described only what was said.

## 6. Canonical transcript strategy

Four texts are kept distinct.

| Text | What it is | Who sees it |
|---|---|---|
| Generated | Raw model output | Nobody; logged problems only |
| Gated | After the speech gate | The client stream: captions and TTS |
| Delivered | What actually played before any cut | Client-side `DeliveryTracker` |
| Canonical | `dialogue_turns.text` | Transcript, next NPC turn, evaluation, memory, results |

Canonical equals gated when a line plays out, and the heard prefix when it was cut. `generatedText` is stored for interrupted lines as diagnostics only and never leaves the server. `renderTranscript` marks cut lines as "…— [Asha cut in here; the rest was never said]", so the evaluator and memory extractor can judge the interruption itself without seeing the unheard words.

## 7. End-of-turn strategy

| Situation | Silence before the turn ends |
|---|---|
| Short complete answer ("yes", "okay, deal", "sounds good") | 0.85 s |
| Engine has committed a complete-looking final result | 0.65 s |
| Default | 1.3 s |
| Line looks unfinished (trailing "around", "and", "um", "nine point", "…") | 2.6 s |
| Slow speaker (median gap over 0.9 s) | Up to +0.6 s, capped at 2.6 s |
| Nothing said / hard cap | 8 s / 45 s |

The old rule was a fixed 1.4 s pause. On the server, a trailing-off line never counts as filler, evasion or vagueness, and the NPC is told to prompt ("Go on — around what?"). This was verified live. These windows are configured values, unit-tested with a virtual clock. They have not been tuned against real speakers on devices.

## 8. NPC prompt and behaviour improvements

- **Prompt split.** The stable prefix holds persona, relationship, memory, situation, revealable vocabulary, how to talk and the output format. The per-turn part holds the hidden briefing with current values, what's already revealed, director notes, difficulty and binding rule direction. The Anthropic provider caches the prefix; OpenAI-compatible providers concatenate the two.
- **Length.** One to three sentences, 8–30 words, and "say the most important part and stop". The median live reply is 25 words.
- **Banned assistant phrasing.** For example "great question" and "I appreciate your honesty". She must not coach, restate, summarise or re-introduce the situation.
- **Messy speech.** Read intent over grammar, go with the correction, ask one short question when a line is unclear, and prompt a half-thought briefly.
- **Being interrupted.** Respond like someone who was cut off. Don't replay the sentence.
- **Negotiation behaviour.** "Yes, if…" is an ask. Name contradictions and ask which is true. Press again on hedging.
- **Difficulty as behaviour.** Easy is patient and lets the player recover. Medium challenges weak reasoning. Hard is sceptical, names inconsistencies and withholds. Expert objects sharply, doesn't rescue, and may redirect — "Resistance, not rudeness." Unit tests show the same evidence unlocks less of the band at higher difficulty and weak lines cost more.
- **Rules outrank the model.** Signals the rules rule out are removed from the model's perception too.

## 9. Latency after changes (measured)

The same model and the same network were used.

| Measure | After |
|---|---|
| Model first token (latency probe, 12 turns over two sessions, median) | 1.77–1.79 s |
| First complete gated sentence (latency probe, median) | 2.24–2.30 s |
| First complete gated sentence (33 live scenario turns, median) | 1.98 s, range 1.40–2.80 s |
| Full reply committed (33 turns, median) | 2.99 s |
| Reply length (33 turns) | Median 25 words, max 40; 29 of 33 replies were one to three sentences |
| Opening line | 4.5–5.7 s (unchanged; happens before "Pick up") |
| Wrap-up | 40–57 s (unchanged; out of scope) |

**Honest reading.** Time to the first audible word is roughly unchanged. About 80% of it is the model's time to first token on a free, shared model; the gate adds nothing measurable, because audio always waited for a complete sentence. The real turn-taking gains are listed below. They are configured windows, measured in tests rather than on real speakers:

| Gain | Detail |
|---|---|
| Short complete answer ends sooner | 0.85 s instead of 1.4 s (−0.55 s) |
| Complete line the engine has finalised | 0.65 s instead of 1.4 s (−0.75 s) |
| Mic after the NPC finishes | Continues with no gap, instead of a new recognizer after 0.35 s |
| Replies | Shorter, so less waiting through monologues |
| Wrong-number corrections | Gone; there are no "wait, she said 9.2 but it shows 8.5" moments |

The next latency win is a faster model for NPC turns (`AI_MODEL_NPC`, e.g. `claude-sonnet-5`), which the prompt cache now benefits.

## 10. Failure and recovery handling

| Failure | Handling |
|---|---|
| Mic permission denied | Fatal error message; text input stays visible; voice barge-in silently disables itself |
| No mic / engine network error | Specific message; state returns to idle; tap to retry |
| Recognition timeout / empty turn | Ends quietly to idle; a pending interruption is still reported |
| Network drop mid-reply | The server completes and persists the turn regardless of the client. The client resyncs; if its line is there, it plays the reply, otherwise it shows "Send that again". |
| Model error | Server rolls back the player line; client keeps the line for one-tap retry |
| Model emits only forbidden or repeated text | Regenerate once for repeats; otherwise an in-character hold line. The game never speaks a forbidden figure. |
| TTS error | The utterance resolves; a safety timer ends stuck utterances; the line still completes |
| Duplicate submission | Same line within 1.5 s ignored client-side; `expectedTurnCount` gives a 409 server-side |
| Rapid back-and-forth | Lines queue behind the previous commit, in order |
| Stale response or audio | Generation counter; late stream and audio callbacks are dropped |
| Player speaks while reconnecting | The line is queued until the previous request settles |
| Tab backgrounded | The mic session stops cleanly; state stays honest |
| Scene remount (strict mode) | `stop()` silences audio but keeps the controller usable |

A quest can never be lost to a voice failure. Nothing is committed to the world until wrap-up. Every turn failure leaves the attempt resumable and the line retryable.

## 11. Web/native separation

- **Platform-neutral:** `ConversationController`, `DeliveryTracker`, `Endpointer`, `BargeInDetector`, the sentence splitter, the utterance heuristics, the contracts and `gameClient`. They have no DOM, React or network imports.
- **Per platform:**
  - `SpeechRecognizer`, including optional `armEndpointing` for monitor-mode barge-in.
  - `SpeechSynthesizer`, including optional `onProgress` word boundaries for precise delivery tracking; without it, a rate estimate is used.
  - `ConversationTransport`, which is `gameClient.streamTurn` plus `reportDelivery`.
- **The server is audio-agnostic.** It receives text, streams gated text, and receives a text delivery report. A native app that can't stream uses the JSON turn plus the same delivery report.
- **All rule enforcement is on the server** (gate, delivery, reducer). A client can't make the NPC say or record something the rules forbid.

## 12. Tests added

The suite grew from 110 to 191 tests, all using fake providers and a virtual clock. None make model calls.

| File | What it covers |
|---|---|
| `voice/controller.test.ts` | Sentence-by-sentence playback, captions following audio, tap interruption with an exact heard-prefix report, interruption followed by silence, cutting in before the commit, hands-free voice barge-in versus echo, seamless hands-free continuation, stale audio never playing, ordered rapid sends, duplicate protection, retry after failure, empty turn after a cut, text mode, and remount lifecycle |
| `voice/delivery.test.ts` | Heard text from boundaries and from timing; never a partial word; nothing after cancel |
| `voice/bargeIn.test.ts` | Echo versus own words, mis-heard speaker echo, debounce, leading-echo stripping |
| `voice/endpointing.test.ts` | Mid-sentence pause not cut off, short answers, final results, cadence, monitor mode |
| `engine/scene/speechGate.test.ts` | Streaming gate, rewrite/drop, retry reset, decimals, length ceiling |
| `engine/scene/delivery.test.ts` | Moves for heard speech, re-reduction, unspoken figures |
| `engine/scene/difficulty.test.ts` | Monotonic profiles, concessions, weak-line cost, director notes |
| `engine/parsing/*` | Sentences and heard prefix, self-correction, conditional yes, walk-out language |
| `content/quests/counter-offer.speech.test.ts` | The gate in every figure style, and every live line that exposed a mismatch |
| `server/conversation.test.ts` | Full-loop tests on an in-memory DB, listed below |

The full-loop tests in `server/conversation.test.ts` cover:
- the gate before streaming, so the audible, recorded and displayed figures agree;
- unspoken JSON proposals dropped;
- a gated opening line;
- an interruption undoing an unheard offer;
- the NPC told it was cut off;
- evaluation and memory receiving only the heard transcript;
- idempotent and stale delivery reports;
- duplicate-turn 409s;
- a counter-plus-yes not accepted;
- trailing off not penalised;
- the length ceiling;
- repetition regenerated;
- an early walk-out recorded as walking away;
- an offer in Emma's own words becoming exactly the accepted deal.

## 13. Real-model scenarios tested

`scripts/conversation-scenarios.ts` was run against OpenRouter `deepseek/deepseek-v4-flash-0731:free`, each scenario including evaluation, memory and consequences. Final run, after all fixes:

| # | Scenario | Emma (excerpt) | Recorded | Outcome / relationship / next |
|---|---|---|---|---|
| 1 | Normal negotiation | "I can get to nine point four five… plus sixty thousand joining" | ₹9.45L + ₹60K | Strong deal; trust +12, respect +10; employed; First Day unlocked |
| 2 | Rapid back-and-forth | "Hi." → a short new line, no repeated opening | ₹8.5L | Offer unchanged |
| 3 | Interruption ×2 | Cut before "I can work with nine point three" | ₹8.5L (9.3 unheard, not recorded) | Offer unchanged; memory reflects only what was said |
| 4 | Long pause mid-sentence | "I was hoping for something around" → "Go on — around what were you hoping for?" | ₹8.5L | Not penalised as filler |
| 5 | Self-correction | "twelve… I mean nine point five" read as 9.5 → "I can do nine point three" | ₹9.3L | Modest improvement |
| 6 | Contradiction | "You said nine was your floor a second ago… I can do nine point seven"; confirms 9.7 when the player says "9.2, I accept" | ₹9.7L | Met your floor |
| 7 | Immediate acceptance | Takes the yes, doesn't coach | ₹8.5L | Took the first offer; respect −4 |
| 8 | Aggressive demand | "Then I think we're done here… Good luck with the search" | Scene ended by Emma | Offer withdrawn (failure); trust −10, warmth −10; career reset |
| 9 | Discovery questions | Reveals the bonus, urgency and competing candidate when asked; "I can do that. Sixty thousand" | ₹8.5L + ₹60K | Modest improvement |
| 10 | Ending naturally | "I'll get the written offer over to you today" | ₹8.5L | Took the first offer |

In all ten, every figure Emma said matched the recorded state, the results screen, the career and memory. Earlier runs found six mismatches (§3.2, §3.3, §3.4), which are now fixed and pinned by tests. In those earlier runs the gate corrected three lines; in the final run the model stayed within the rules on its own.

Also verified:
- **API smoke, native-style** (`pnpm smoke:api`). Bearer auth plays chapter one over HTTP, including a delivery report, the unheard rest absent from the client view, an idempotent repeat report, a natural reply after the cut ("No worries… so you led that migration and you're after ten lakh"), and memory and world persisted.
- **Browser check** (`scripts/e2e-scene-smoke.ts`, headless Chrome with a fake audio device). An opening cut off by typing is recorded as "Hi— (you cut in)". The reply plays in full. The caption follows audio from the first word. The mic failure path leaves text usable. There were no page errors.

## 14. Remaining limitations

- **The browser voices on Windows sound robotic,** and browser TTS gives no reliable word timing on Android or iOS; the tracker then estimates from the speaking rate, conservatively. A server TTS with timestamps (behind `SpeechSynthesizer`) would give exact delivery and much better character.
- **Voice barge-in depends on the device's echo handling.** The debounce and fuzzy echo filter prevent false cuts. The cost is roughly 0.35 s plus the recognizer's interim delay before a genuine barge-in registers. On speakerphone with loud playback, voice barge-in may miss; tap still works.
- **The free model often drops the output tags and the moves block.** The deterministic readers carry the game; a Claude model would reduce this.
- **The opening line (4–6 s) is generated before "Pick up".** It is hidden behind the briefing but not streamed.
- **Wrap-up takes about 50 s on this model.** Unchanged; out of scope.
- **Offer reading is rule-based.** It is now far more robust (clause-level, ownership-based), but an exotic phrasing could still slip through. The fix path is to add the line to `counter-offer.speech.test.ts` and adjust `readOfferSpeech`, which both the gate and the recorder use.
- **Only The Counter Offer has a `speechGate`.** Other quests have no negotiable figures yet. A new quest with figures should add one, as documented in `docs/ADDING-CONTENT.md`.

## 15. Physical-phone tests still required

None of these were performed. Only desktop Chrome, headless, was exercised.

- **Permissions:** the first prompt, denial, and re-grant from settings, on iOS Safari and Android Chrome.
- **iOS Safari:** `webkitSpeechRecognition` availability, continuous mode, interim results, monitor-mode listening during TTS, and TTS–mic audio-session conflicts.
- **Android Chrome:** recognizer auto-stop behaviour, `onboundary` support, and voice selection for `en-IN`.
- **Audio routes:** phone speaker (echo and false barge-in rate), earpiece, wired headset, Bluetooth headset (routing switch latency, mic on headset versus phone).
- **Lifecycle:** backgrounding mid-reply and mid-listen, screen lock, incoming call, returning to the scene (resync), and a network change mid-turn.
- **Environment:** a noisy room (endpointing and false barge-in), soft speakers, and strong accents in `en-IN` recognition.
- **Tuning:** the adaptive silence windows and barge-in debounce with real speakers; auto-mic reopen timing after the NPC finishes.

## 16. Is further Fable-level work necessary?

**Not for correctness.** The hard, architecture-sensitive part is done and tested: consistent interruption, a canonical transcript, and speech bound to the rules. The remaining items are routine or measurement-driven.

1. **Routine:** route `npc_turn` to a faster Claude model and measure; tune the endpointing and barge-in windows from the phone tests above; add a server TTS provider behind `SpeechSynthesizer`.
2. **Fable-level only if the phone tests show the browser stack isn't good enough.** That means a streaming speech-to-text and text-to-speech pipeline over WebSocket or WebRTC with real voice-activity detection and echo cancellation. The contracts are ready for it: delivery reports, gated streaming and the controller all stay as they are, and only the providers change.

---

## BEFORE VS AFTER

**The player interrupts.**
- *Before:* Emma: "That's a solid result, Asha, I won't argue the thirty percent. Ten lakh though, that's past what I can do. Nine point three is the most I can stretch to today." The player tapped in after the first sentence. The transcript, memory and evaluation all recorded the ₹9.3L offer, which the player never heard, and the offer chip had already jumped to ₹9.3L.
- *After:* Canon is "That's a solid result, Asha, I won't argue the thirty percent.— (you cut in)". The offer stays ₹8.5L. Emma's next line reacts to the interruption ("I was just saying… the base is pretty firm, but I can move on a one-time signing bonus"). Memory says she "held the base", which is true.

**Emma says a number the rules didn't record.**
- *Before (live):* "I can meet you partway — nine point two." The game kept ₹8.5L. The player said "Okay, I accept" and was hired at ₹8.5L after hearing 9.2.
- *After (live, same scenario):* "I can do nine point three, and that's me being straight with you." The game records ₹9.3L. "So nine point three lakh base, no joining bonus." The player is hired at ₹9.3L.

**The player accepts a lower number than is on the table.**
- *Before (live):* ₹9.7L on the table. The player said "Fine, nine point two then. I accept." Emma: "Nine point two it is." Recorded: ₹9.7L.
- *After (live):* "Nine point seven's the number, Asha. That's where I can land you today." Recorded: ₹9.7L.

**The player gets aggressive.**
- *Before (live):* Emma: "If twelve is a hard line for you, then we're done here. I wish you the best." The scene stayed open. Wrap-up hired the player at ₹8.5L, trust +7.
- *After (live):* "Then I think we're done here. I'll let the team know you passed." Offer withdrawn (failure), trust −10, warmth −10, career back to exploring, and Emma remembers it.

**The player just says hi.**
- *Before (live):* "Hi." got Emma's entire opening again, word for word.
- *After (live):* "Hi Asha, good to speak with you. So, what are your thoughts on the eight point five lakh offer?"

**The player pauses to think.**
- *Before:* "I was hoping for something around" was sent after 1.4 s, counted as filler, and cost patience.
- *After:* The mic waits up to 2.6 s for an unfinished line. If it's sent anyway, there's no penalty, and Emma says: "Go on — around what were you hoping for?"

**The player corrects themselves.**
- *Before:* "Twelve lakh… no wait, I mean nine point five" was read as a twelve lakh ask.
- *After:* It is read as 9.5 and noted as owning a slip. Emma: "Nine point five — okay, that's a jump. What's that figure based on?"

**Hands-free talk.**
- *Before:* Talking while Emma spoke was lost. The player had to wait or tap.
- *After:* The player just starts talking. Emma stops once their own words are confirmed, what they heard is recorded, and echoed NPC words are stripped from their line. When Emma finishes, the mic continues straight into the player's turn.
