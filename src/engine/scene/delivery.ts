/**
 * Canonical transcript after an interruption.
 *
 * When the player cuts an NPC line off, only the part they heard is canon. The
 * scene must be re-derived from that part: an offer in the unheard tail was
 * never made, a reveal in it never happened, and the NPC never got to "wrap
 * up". This module turns the moves the model reported for the FULL line into
 * the moves supported by the HEARD prefix. Pure; the orchestrator then re-runs
 * the scene reducer from the state the turn started in.
 *
 * Attribution rules (conservative by design):
 *   - `noticed`, `stance`, `patienceDelta`: about the player's line → kept.
 *   - `wantsToEnd`: dropped (the NPC did not finish).
 *   - `reveal`: only what the quest's speech inference reads in the heard text.
 *   - `proposal`: what speech inference reads in the heard text, plus any
 *     numeric model proposal whose figure is audibly present in it. Keys that
 *     describe the player's words (prefix `player`) are kept.
 */
import type { NPCMoves } from "../types/scene";
import type { QuestScene, SceneContext } from "../types/quest";
import { extractRupeeAmounts } from "../parsing/numbers";

/** Two rupee figures within this distance are the same figure (rounding, "nine point two" vs 920000). */
const SAME_FIGURE = 2500;

export function movesForHeardSpeech<H, S extends Record<string, unknown>>(moves: NPCMoves, heard: string, scene: QuestScene<H, S>, ctx: SceneContext<H, S>): NPCMoves {
  const inferred = heard.trim() && scene.inferMovesFromSpeech ? scene.inferMovesFromSpeech(heard, ctx) : {};
  const spoken = extractRupeeAmounts(heard, { salaryContext: true }).map((a) => a.amount);
  const proposal: NPCMoves["proposal"] = { ...(inferred.proposal ?? {}) };
  for (const [key, value] of Object.entries(moves.proposal)) {
    if (key in proposal) continue;
    if (key.startsWith("player")) {
      proposal[key] = value;
      continue;
    }
    if (typeof value === "number" && value >= 1000 && spoken.some((a) => Math.abs(a - value) < SAME_FIGURE)) proposal[key] = value;
  }
  return { ...moves, reveal: [...(inferred.reveal ?? [])], proposal, wantsToEnd: false, endReason: undefined };
}

/**
 * Numbers the NPC did not say out loud are not offers. Applied to the model's
 * structured moves for a fully delivered line as well, so speech is binding in
 * both directions: a figure in the JSON but not in the speech is dropped.
 * Returns the keys removed (for diagnostics).
 */
export function dropUnspokenFigures(moves: NPCMoves, speech: string): string[] {
  const spoken = extractRupeeAmounts(speech, { salaryContext: true }).map((a) => a.amount);
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(moves.proposal)) {
    if (key.startsWith("player") || typeof value !== "number" || value < 1000) continue;
    if (!spoken.some((a) => Math.abs(a - value) < SAME_FIGURE)) {
      delete moves.proposal[key];
      dropped.push(`${key}=${value}`);
    }
  }
  return dropped;
}
