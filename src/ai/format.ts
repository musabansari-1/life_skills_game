/**
 * NPC turn wire format.
 *
 * The NPC model streams *speech first* so TTS can start immediately, then a
 * small JSON block of structured "moves". Format:
 *
 *   <speech>
 *   ...what the character says out loud...
 *   </speech>
 *   <moves>{ "noticed": [...], "reveal": [...], "proposal": {...}, "wantsToEnd": false }</moves>
 *
 * This parser is deliberately forgiving: missing tags → whole text is speech;
 * broken moves JSON → empty moves (the game still proceeds). Nothing the NPC
 * model emits can crash a turn.
 */
import { NPCMovesSchema, PlayerSignalSchema, type NPCMoves, type NPCTurn, type PlayerSignal } from "@/engine/types/scene";
import { z } from "zod";
import { parseJsonWithSchema } from "./json";

export const SPEECH_OPEN = "<speech>";
export const SPEECH_CLOSE = "</speech>";
export const MOVES_OPEN = "<moves>";
export const MOVES_CLOSE = "</moves>";

export interface ParsedNpcTurn extends NPCTurn {
  /** Diagnostics for logging. */
  problems: string[];
}

export function parseNpcTurn(raw: string): ParsedNpcTurn {
  const problems: string[] = [];
  let speech = "";
  let movesText: string | null = null;

  const sOpen = raw.indexOf(SPEECH_OPEN);
  const sClose = raw.indexOf(SPEECH_CLOSE);
  const mOpen = raw.indexOf(MOVES_OPEN);
  const mClose = raw.indexOf(MOVES_CLOSE);

  if (sOpen >= 0 && sClose > sOpen) {
    speech = raw.slice(sOpen + SPEECH_OPEN.length, sClose);
  } else if (sOpen >= 0) {
    // Unterminated speech: take everything after <speech> up to <moves> if present.
    speech = raw.slice(sOpen + SPEECH_OPEN.length, mOpen > sOpen ? mOpen : undefined);
    problems.push("speech tag not closed");
  } else {
    // No tags at all: strip any moves block and a leading JSON blob.
    speech = mOpen >= 0 ? raw.slice(0, mOpen) : raw;
    problems.push("no speech tag");
  }

  if (mOpen >= 0) {
    movesText = raw.slice(mOpen + MOVES_OPEN.length, mClose > mOpen ? mClose : undefined);
  } else {
    // Model may have emitted bare JSON after the speech.
    const tail = sClose >= 0 ? raw.slice(sClose + SPEECH_CLOSE.length) : "";
    if (tail.includes("{")) movesText = tail;
  }

  let moves: NPCMoves = NPCMovesSchema.parse({});
  if (movesText) {
    const parsed = parseJsonWithSchema(movesText, NPCMovesSchema);
    if (parsed.ok) {
      moves = parsed.value;
      if (parsed.repaired) problems.push("moves JSON repaired");
    } else {
      problems.push(`moves invalid: ${parsed.error}`);
      // Salvage partial: try to at least keep valid enum values from a loose parse.
      moves = salvageMoves(movesText);
    }
  } else {
    problems.push("no moves block");
  }

  speech = cleanSpeech(speech);
  if (!speech) {
    problems.push("empty speech");
    speech = "…";
  }
  return { speech, moves, problems };
}

function salvageMoves(text: string): NPCMoves {
  const out = NPCMovesSchema.parse({});
  const loose = parseJsonWithSchema(text, z.record(z.string(), z.unknown()));
  if (!loose.ok) return out;
  const v = loose.value;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);
  out.noticed = arr(v.noticed).filter((s): s is PlayerSignal => PlayerSignalSchema.safeParse(s).success);
  out.reveal = arr(v.reveal) as string[];
  if (typeof v.wantsToEnd === "boolean") out.wantsToEnd = v.wantsToEnd;
  if (v.proposal && typeof v.proposal === "object") {
    for (const [k, val] of Object.entries(v.proposal as Record<string, unknown>)) {
      if (["number", "string", "boolean"].includes(typeof val)) out.proposal[k] = val as number | string | boolean;
    }
  }
  return out;
}

/** Strip stage directions, markdown and stray tags so TTS reads only dialogue. */
export function cleanSpeech(s: string): string {
  return s
    .replace(/<\/?[a-z]+>/gi, "")
    .replace(/\*[^*\n]{0,80}\*/g, "") // *smiles*, *pauses*
    .replace(/\((?![^)]*[\d₹$])[^)]{0,40}\)/g, "") // (leans back) — but keep "(about ten lakh)"-style content with numbers
    .replace(/^[A-Z][a-z]+:\s+/gm, "") // "Emma: ..."
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Incremental speech extraction for streaming: given the raw text so far,
 * returns the speech portion that is safe to surface (everything inside the
 * speech tag, excluding any partial closing/moves tag at the very end).
 */
export function extractStreamingSpeech(rawSoFar: string): { speech: string; speechDone: boolean } {
  const sOpen = rawSoFar.indexOf(SPEECH_OPEN);
  let body = sOpen >= 0 ? rawSoFar.slice(sOpen + SPEECH_OPEN.length) : rawSoFar;
  if (sOpen < 0 && rawSoFar.length < SPEECH_OPEN.length && SPEECH_OPEN.startsWith(rawSoFar)) {
    return { speech: "", speechDone: false };
  }
  const sClose = body.indexOf(SPEECH_CLOSE);
  const mOpen = body.indexOf(MOVES_OPEN);
  if (sClose >= 0) return { speech: cleanSpeech(body.slice(0, sClose)), speechDone: true };
  if (mOpen >= 0) return { speech: cleanSpeech(body.slice(0, mOpen)), speechDone: true };
  // Hold back a possible partial tag at the end ("</spe", "<mo").
  const lt = body.lastIndexOf("<");
  if (lt >= 0 && lt > body.length - 10) body = body.slice(0, lt);
  return { speech: cleanSpeech(body), speechDone: false };
}
