/**
 * Shape of a spoken utterance, independent of meaning. Pure; shared by
 * client-side endpointing (how long to wait before ending a turn) and the
 * server (a line that trails off is hesitation, not an empty answer).
 */

/** Words a spoken sentence rarely ends on: the speaker is mid-thought. */
const TRAILING_INCOMPLETE =
  /\b(and|but|so|or|because|around|about|roughly|approximately|like|the|a|an|to|of|for|with|at|in|on|my|your|our|their|i|i'm|i'd|i've|is|was|are|that|which|if|when|then|than|maybe|um|uh|er|hmm|erm|point|plus|minus|something|somewhere|what|how|why|where|can|could|would|should|will|let|let's|say|wait|actually|basically|kind|sort|well|you|we|they|it's|there's|be|get|make|do|have|has|had|not)$/i;

const NUMBER_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty";
/** A bare trailing number ("…around ten") usually continues with a unit. */
const TRAILING_NUMBER = new RegExp(`\\b(${NUMBER_WORD}|\\d+(\\.\\d+)?)$`, "i");
const NUMBER_LEAD_IN = new RegExp(`\\b(around|about|roughly|say|maybe|like|point|for|to|at|of|or)\\s+(${NUMBER_WORD}|\\d+(\\.\\d+)?)$`, "i");

/** Short complete answers that don't need a long pause. */
const SHORT_COMPLETE = /^(not really|no thanks|that works|sounds good|sounds fair|works for me|let's do it|i accept|i'll take it|go on|go ahead|thank you)$/i;
const ACK_WORDS = new Set(["yes", "yeah", "yep", "no", "nope", "okay", "ok", "sure", "fine", "deal", "done", "agreed", "right", "correct", "exactly", "absolutely", "definitely", "alright", "great", "perfect", "thanks", "please"]);

/** The speaker stopped mid-thought ("I was hoping for something around…"). */
export function looksIncomplete(transcript: string): boolean {
  const t = transcript.trim().replace(/[.,!?…\-—]+$/, "").trim();
  if (!t) return false;
  if (/(\.\.\.|…|—|-)\s*$/.test(transcript.trim()) && t.split(/\s+/).length >= 2) return true;
  if (TRAILING_INCOMPLETE.test(t)) return true;
  if (NUMBER_LEAD_IN.test(t)) return true;
  if (TRAILING_NUMBER.test(t) && t.split(/\s+/).length >= 3 && !/\b(lakh|thousand|percent|k|years?|months?)\s*$/i.test(t)) return true;
  return false;
}

/** A short, complete answer ("yes", "okay, deal", "sounds good"). */
export function looksShortAndComplete(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .replace(/[.,!?…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const w = t.split(" ").filter(Boolean);
  if (w.length === 0 || w.length > 4) return false;
  return SHORT_COMPLETE.test(t) || w.every((x) => ACK_WORDS.has(x));
}
