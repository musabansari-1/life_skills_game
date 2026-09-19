/**
 * Hands-free barge-in support. Pure and platform-neutral.
 *
 * While the NPC is speaking, the recognizer keeps listening. On a device with
 * speakers the microphone hears the NPC too, and the recognizer mis-hears that
 * audio ("platform" → "plat form", "nine point two" → "nine point to"). These
 * helpers decide whether an interim result is the player cutting in, and strip
 * echoed NPC words from the front of the final transcript so they don't become
 * the player's line. Matching is fuzzy on purpose: a false barge-in cuts the
 * character off for nothing, which is worse than a slightly late real one
 * (tapping always cuts in instantly).
 */
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "is", "it", "that", "i", "you", "we", "on", "in", "at", "for", "so", "but", "be", "do", "this"]);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance, capped (we only care whether it is ≤ 2). */
function distance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) >= cap) return cap;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin >= cap) return cap;
    prev = cur;
  }
  return Math.min(cap, prev[b.length]);
}

/** A heard word that plausibly is (a mis-recognition of) one of the NPC's words. */
function echoesWord(w: string, npc: Set<string>, npcList: string[]): boolean {
  if (npc.has(w)) return true;
  if (w.length < 4) return false;
  return npcList.some((n) => n.length >= 4 && (distance(w, n) <= (w.length >= 7 ? 2 : 1) || (w.length >= 5 && n.startsWith(w.slice(0, 5)))));
}

/**
 * True when `interim` looks like the NPC's own speech picked up by the mic:
 * at least half of its content words (fuzzily) appear in the NPC's recent text.
 */
export function isLikelyEcho(interim: string, npcRecentText: string): boolean {
  const iw = words(interim).filter((w) => !STOP.has(w));
  if (iw.length === 0) return true; // nothing substantive yet
  const npcList = words(npcRecentText);
  const npc = new Set(npcList);
  const hits = iw.filter((w) => echoesWord(w, npc, npcList)).length;
  return hits / iw.length >= 0.5;
}

/**
 * Player speech is a barge-in once, after any leading echo of the NPC, it has
 * a couple of words of its own that don't sound like the NPC's line. Echo
 * arrives first (the mic hears the NPC before the player opens their mouth),
 * so the player's words are at the end. Callers should also require the
 * candidate to persist (see BargeInDetector) before cutting the NPC off.
 */
export function isBargeIn(interim: string, npcRecentText: string, minWords = 2): boolean {
  const own = stripLeadingEcho(interim, npcRecentText, 1);
  return words(own).length >= minWords && !isLikelyEcho(own, npcRecentText);
}

/**
 * Remove leading words that echo the NPC's line ("the base can't move what
 * about a signing bonus" → "what about a signing bonus"). Only a run at the
 * very start is removed, at least `minRun` words long, and only if something
 * remains.
 */
export function stripLeadingEcho(finalText: string, npcRecentText: string, minRun = 2): string {
  const original = finalText.trim().split(/\s+/).filter(Boolean);
  const npcList = words(npcRecentText);
  const npc = new Set(npcList);
  let i = 0;
  let echoed = 0; // content words in the run; stop words ride along but don't count
  let lastEcho = 0; // never strip trailing stop words that belong to the player ("… move | I need")
  while (i < original.length) {
    const w = words(original[i])[0];
    if (w === undefined) break;
    if (!STOP.has(w)) {
      if (!echoesWord(w, npc, npcList)) break;
      echoed += 1;
      lastEcho = i + 1;
    }
    i++;
  }
  if (echoed < minRun || lastEcho >= original.length) return finalText.trim();
  return original.slice(lastEcho).join(" ");
}

/**
 * Debounces barge-in: the player's own words must be seen in at least
 * `minUpdates` consecutive interim results spanning `minMs`. A single stray
 * mis-recognition of speaker audio never cuts the character off.
 */
export class BargeInDetector {
  private since: number | null = null;
  private count = 0;

  constructor(private readonly opts: { minUpdates: number; minMs: number; minWords: number } = { minUpdates: 2, minMs: 350, minWords: 2 }) {}

  /** Feed an interim result; returns true when the barge-in is confirmed. */
  observe(interim: string, npcRecentText: string, now: number): boolean {
    if (!isBargeIn(interim, npcRecentText, this.opts.minWords)) {
      this.reset();
      return false;
    }
    if (this.since === null) this.since = now;
    this.count += 1;
    return this.count >= this.opts.minUpdates && now - this.since >= this.opts.minMs;
  }

  reset() {
    this.since = null;
    this.count = 0;
  }
}
