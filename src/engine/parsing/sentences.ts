/**
 * Sentence segmentation for spoken dialogue. Pure and platform-neutral.
 *
 * Used in two places that must agree:
 *   - the server, to gate NPC speech sentence by sentence before it is sent
 *     (so a figure the rules forbid is never streamed, spoken or recorded);
 *   - clients, to feed text-to-speech one sentence at a time so audio starts
 *     before generation finishes and interruption can be tracked per sentence.
 *
 * "Complete" means the sentence ends with terminal punctuation. Abbreviations
 * are rare in spoken lines; decimals ("9.2") are protected explicitly.
 */
const SENTENCE_RE = /[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g;
const COMPLETE_RE = /[.!?…]["')\]]*\s*$/;
/** A full stop between digits ("9.2") is a decimal point, not a sentence end. Same-length stand-in keeps indices aligned. */
const protectDecimals = (s: string) => s.replace(/(\d)\.(?=\d)/g, "$1");

export interface SentenceTake {
  /** Sentences ready to use, trimmed, in order. */
  chunks: string[];
  /** New offset into the source string (characters consumed). */
  consumed: number;
}

/**
 * Given text received so far and how much of it was already consumed, return
 * the complete sentences that are newly available. When `done`, the trailing
 * fragment (if any) is released as well.
 */
export function takeCompleteSentences(textSoFar: string, alreadyConsumed: number, done: boolean): SentenceTake {
  const unread = textSoFar.slice(alreadyConsumed);
  const sentences = protectDecimals(unread).match(SENTENCE_RE) ?? [];
  const ready = done ? sentences : sentences.filter((s) => COMPLETE_RE.test(s));
  let consumed = alreadyConsumed;
  const chunks: string[] = [];
  for (const s of ready) {
    const original = textSoFar.slice(consumed, consumed + s.length);
    consumed += s.length;
    const t = original.trim();
    if (t) chunks.push(t);
  }
  return { chunks, consumed };
}

/** Split a finished text into trimmed sentences. */
export function splitSentences(text: string): string[] {
  return takeCompleteSentences(text, 0, true).chunks;
}

/** Whitespace-insensitive comparison helper used when matching delivered speech to generated speech. */
export function normalizeSpoken(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The longest prefix of `generated` that `heard` accounts for, measured in
 * whole words. Clients report what was audibly delivered; this keeps the
 * canonical text an exact prefix of what was generated even if the client's
 * report is slightly off (different whitespace, a trailing partial word).
 */
export function heardPrefix(generated: string, heard: string): string {
  const g = normalizeSpoken(generated);
  const h = normalizeSpoken(heard);
  if (!h) return "";
  // A cut-off line ends where the voice stopped; trailing dashes or commas are not speech.
  const tidy = (x: string) => x.replace(/[\s—–\-,;:]+$/u, "");
  if (g.startsWith(h) && (g.length === h.length || g[h.length] === " ")) return g.length === h.length ? h : tidy(h);
  const gw = g.split(" ");
  const hw = h.split(" ");
  let n = 0;
  while (n < gw.length && n < hw.length && gw[n].toLowerCase() === hw[n].toLowerCase()) n++;
  return tidy(gw.slice(0, n).join(" "));
}
