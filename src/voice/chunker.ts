/**
 * Sentence chunking for streamed TTS. Pure and platform-neutral: given the
 * NPC speech received so far and how much has already been queued, return the
 * complete sentences that are ready to be spoken. Speaking sentence by sentence
 * lets audio start before the model has finished generating.
 */
const SENTENCE_RE = /[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g;
const COMPLETE_RE = /[.!?…]["')\]]*\s*$/;

export interface ChunkResult {
  /** Sentences ready to speak, trimmed. */
  chunks: string[];
  /** New offset into the speech string (characters consumed). */
  consumed: number;
}

export function takeSpeakableChunks(speechSoFar: string, alreadyConsumed: number, done: boolean): ChunkResult {
  const unread = speechSoFar.slice(alreadyConsumed);
  const sentences = unread.match(SENTENCE_RE) ?? [];
  const ready = done ? sentences : sentences.filter((s) => COMPLETE_RE.test(s));
  let consumed = alreadyConsumed;
  const chunks: string[] = [];
  for (const s of ready) {
    consumed += s.length;
    const t = s.trim();
    if (t) chunks.push(t);
  }
  return { chunks, consumed };
}
