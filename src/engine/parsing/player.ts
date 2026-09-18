/**
 * Deterministic reading of a player's utterance.
 *
 * The NPC model also reports what it "noticed", but weaker models miss things
 * and stronger ones are inconsistent. These detectors give quests a reliable,
 * testable read of the player's words *before* the NPC replies, so the game can
 * tell the NPC what it is allowed to do this turn. They are deliberately
 * conservative: a false negative is fine (the model's perception is merged
 * in), a false positive changes outcomes and must be rare.
 */
import type { PlayerSignal } from "../types/scene";
import { extractRupeeAmounts, normalizeMoneyText } from "./numbers";

export interface PlayerRead {
  signals: PlayerSignal[];
  /** Largest salary-scale figure the player asked for, in rupees. */
  ask: number | null;
  /** Salary floor the player disclosed, in rupees. */
  minimum: number | null;
  /** Thousand-scale figure mentioned near bonus language. */
  bonusAsk: number | null;
  wordCount: number;
}

const ACHIEVEMENT = /\b(led|built|shipped|launched|cut|reduced|saved|grew|increased|scaled|delivered|migrated|automated|owned|designed|architected|improved|doubled|halved)\b/;
const MARKET = /\b(market|benchmark|levels\.fyi|glassdoor|ambitionbox|industry|peers?|comparable|going rate|range for)\b/;
const QUANTITY = /(\d+(\.\d+)?\s*(%|percent|x\b|lakh|l\b|k\b|crore|users|customers|hours|days|weeks|months|ms|people|engineers|services))|\b(half|double|triple|thirty|forty|fifty|twenty|ten)\s+(percent|x)\b|\b\d{2,}\b/;
const AGGRESSIVE = /\b(insult(ing)?|ridiculous|joke|laughable|pathetic|waste of (my )?time|wasting my time|demand|how dare|you people|lowball(ing)?|disrespectful|unacceptable)\b/;
const ULTIMATUM = /\b(take it or leave it|non[- ]?negotiable|final offer|or i('| wi)ll walk|or i walk|or i'?m (out|gone|walking)|last chance|my way or)\b/;
const TOTAL_COMP = /\b(bonus|joining|sign[- ]?on|signing|equity|esops?|stock|rsus?|total comp(ensation)?|whole package|full package|the package|beyond (the )?base|benefits|review (cycle|timeline)|variable( pay)?|relocation)\b/;
const COMPETING = /\b((another|other|competing|second|different) offer|offer (from|at|with) [a-z]|counter[- ]?offer from|interviewing (with|elsewhere)|other companies)\b/;
const MINIMUM = /\b(lowest i (could|can|would|'d)|my (minimum|floor|walk[- ]?away)|bare minimum|at (the )?very least|at least|can'?t go below|won'?t go below|wouldn'?t go below|would (still )?accept|i'?d (still )?accept|i'?ll accept anything|anything above .{0,40} (and|i'?m) in|i'?d be (fine|happy|ok(ay)?) with)\b/;
const ACCEPT = /\b(i accept|i'?ll accept|accept (the|your|this) offer|i'?ll take it|we have a deal|it'?s a deal|deal\.?$|let'?s do it|i'?m in\b|count me in|happy to (accept|go with|sign)|i can sign( today)?|sounds (great|good|fair)[,.! ]+(i'?m in|let'?s|i accept|deal|happy)|that works for me|works for me\.?$|send (me )?the (letter|offer)|i'?ll sign)\b/;
const QUESTION_WORDS = /^(what|how|why|when|where|who|which|is|are|could|can|would|do|does|did|will)\b/;
const RAPPORT = /\b(thank(s| you)|appreciate|excited|love (the|what)|glad|grateful|looking forward|enjoyed)\b/;
const EMPATHY = /\b(i understand|i get (that|it)|that makes sense|i hear you|i know (it'?s|you'?re)|fair enough|totally (get|understand))\b/;

function isQuestion(t: string): boolean {
  return /\?/.test(t) || QUESTION_WORDS.test(t.trim());
}

export function readPlayerUtterance(text: string): PlayerRead {
  const t = normalizeMoneyText(text).replace(/[’‘]/g, "'");
  const signals = new Set<PlayerSignal>();
  const words = t.split(/\s+/).filter(Boolean);
  const amounts = extractRupeeAmounts(text);
  const salaryAmounts = amounts.filter((a) => a.unit === "lakh" || a.amount >= 300000).map((a) => a.amount);
  const hasBonusWords = /\b(bonus|joining|sign[- ]?on|signing)\b/.test(t);
  const bonusAmounts = hasBonusWords ? amounts.filter((a) => a.amount >= 5000 && a.amount < 300000 && a.unit !== "lakh").map((a) => a.amount) : [];

  if (words.length === 0 || /^(um+|uh+|hmm+|ok(ay)?|yeah|so|well)[.!?]*$/.test(t.trim())) signals.add("silence_or_filler");
  if (AGGRESSIVE.test(t)) signals.add("aggressive_tone");
  if (ULTIMATUM.test(t)) signals.add("ultimatum");
  if (TOTAL_COMP.test(t) && isQuestion(t)) signals.add("asked_about_total_comp");
  if (COMPETING.test(t)) signals.add("mentioned_competing_offer");
  if (isQuestion(t) && words.length >= 4) signals.add("good_question");
  if (RAPPORT.test(t)) signals.add("rapport");
  if (EMPATHY.test(t)) signals.add("acknowledged_npc");

  // Evidence needs *content*: an achievement or market reference plus a concrete quantity.
  if ((ACHIEVEMENT.test(t) || MARKET.test(t)) && (QUANTITY.test(t) || amounts.length > 0)) signals.add("evidence_provided");
  else if (/\b(i deserve|everyone (knows|pays|gets)|obviously worth|i'?m worth|my friends (make|get|earn))\b/.test(t)) signals.add("vague_claim");

  let minimum: number | null = null;
  if (MINIMUM.test(t) && salaryAmounts.length) {
    minimum = Math.min(...salaryAmounts);
    signals.add("revealed_minimum");
  }
  const ask = salaryAmounts.length && minimum === null ? Math.max(...salaryAmounts) : null;
  if (ask !== null) signals.add("clear_ask");

  // A real yes, not a conditional one: "anything above nine and I'm in" is a floor, not an acceptance.
  const conditional = /\b(if|only if|as long as|provided|unless|anything above|anything over|above that|over that|as soon as)\b/.test(t) || minimum !== null;
  if (ACCEPT.test(t) && !conditional) signals.add("accepted_terms");
  if (words.length > 90) signals.add("rambling");

  return { signals: [...signals], ask, minimum, bonusAsk: bonusAmounts.length ? Math.max(...bonusAmounts) : null, wordCount: words.length };
}
