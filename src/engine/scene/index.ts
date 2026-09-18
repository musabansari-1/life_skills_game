/**
 * Scene reducer (deterministic).
 *
 * Runs once per NPC turn. Takes the NPC's *perception* (signals it noticed)
 * and *proposals*, and decides what actually happens to the scene:
 *   1. patience shifts from signals (+ the model's suggested delta, clamped)
 *   2. stance is derived from patience and recent behaviour
 *   3. reveals are validated against the quest's revealable keys
 *   4. the quest's own reducer handles proposals under hidden constraints
 *   5. ending conditions are applied (turn limit, NPC walking away)
 *
 * NPC generation is probabilistic; this file is where it becomes a game.
 */
import type { NPCMoves, PlayerSignal, SceneState, Stance } from "../types/scene";
import type { QuestScene, SceneContext } from "../types/quest";
import { clamp, round } from "../util";

/** How each signal moves patience. Positive = NPC is more willing to keep engaging. */
export const SIGNAL_PATIENCE: Record<PlayerSignal, number> = {
  evidence_provided: 4,
  good_question: 3,
  acknowledged_npc: 2,
  rapport: 3,
  clear_ask: 2,
  proposed_alternative: 3,
  empathy: 2,
  owned_mistake: 3,
  aggressive_tone: -12,
  ultimatum: -15,
  vague_claim: -4,
  contradiction: -8,
  rambling: -5,
  revealed_minimum: 0,
  conceded_for_free: 0,
  mentioned_competing_offer: 0,
  asked_about_total_comp: 1,
  deflected: -5,
  silence_or_filler: -6,
};

const HOSTILE: PlayerSignal[] = ["aggressive_tone", "ultimatum", "contradiction"];
const WARM: PlayerSignal[] = ["rapport", "empathy", "acknowledged_npc", "owned_mistake"];

export interface ReduceInput<H, S> {
  scene: QuestScene<H, S>;
  ctx: SceneContext<H, S>;
  moves: NPCMoves;
}

export interface ReduceResult<S> {
  scene: SceneState & { custom: S };
  /** Reveal keys that were rejected because the quest does not allow them. */
  rejectedReveals: string[];
  patienceDelta: number;
}

export function reduceNpcTurn<H, S extends Record<string, unknown>>(input: ReduceInput<H, S>): ReduceResult<S> {
  const { moves, ctx } = input;
  const prev = ctx.scene;
  const next: SceneState & { custom: S } = structuredClone(prev);

  // 1. Patience: signal-driven plus a clamped model suggestion.
  let delta = 0;
  for (const s of moves.noticed) {
    delta += SIGNAL_PATIENCE[s] ?? 0;
    next.signalCounts[s] = (next.signalCounts[s] ?? 0) + 1;
  }
  delta += clamp(moves.patienceDelta ?? 0, -25, 10) * 0.5; // model suggestion counts half
  // Every turn costs a little patience so conversations converge.
  delta -= 1.5;
  delta = clamp(delta, -30, 12);
  next.patience = round(clamp(prev.patience + delta, 0, 100), 1);

  // 2. Stance.
  next.stance = deriveStance(next, moves);

  // 3. Reveals.
  const rejectedReveals: string[] = [];
  for (const key of moves.reveal) {
    if (key in input.scene.revealableKeys) {
      if (!next.revealed.includes(key)) next.revealed.push(key);
    } else {
      rejectedReveals.push(key);
    }
  }

  // 4. Quest-specific proposals under hidden constraints.
  if (input.scene.reduceProposal) {
    const r = input.scene.reduceProposal({ ...ctx, scene: next }, moves);
    next.custom = r.custom;
    for (const f of r.flags ?? []) if (!next.flags.includes(f)) next.flags.push(f);
  }

  // 5. Turn accounting & endings.
  next.turnCount = prev.turnCount + 1;
  if (!next.ended) {
    if (next.patience <= 0) {
      next.ended = { by: "npc", reason: moves.endReason || "They have run out of patience." };
      next.stance = "done";
    } else if (moves.wantsToEnd && next.turnCount >= input.scene.minTurns) {
      next.ended = { by: "npc", reason: moves.endReason || "They brought the conversation to a close." };
      next.stance = "done";
    } else if (next.turnCount >= input.scene.maxTurns) {
      next.ended = { by: "turn_limit", reason: "They have to go — the conversation is over." };
      next.stance = "done";
    }
  }

  return { scene: next, rejectedReveals, patienceDelta: round(delta, 1) };
}

export function deriveStance(scene: SceneState, moves: NPCMoves): Stance {
  if (scene.ended) return "done";
  const hostileRecent = moves.noticed.some((s) => HOSTILE.includes(s));
  const warmRecent = moves.noticed.some((s) => WARM.includes(s));
  const hostileTotal = HOSTILE.reduce((n, s) => n + (scene.signalCounts[s] ?? 0), 0);

  let stance: Stance;
  if (scene.patience < 20 || (hostileRecent && scene.patience < 45)) stance = "defensive";
  else if (scene.patience < 40 || hostileRecent || hostileTotal >= 3) stance = "guarded";
  else if (scene.patience >= 70 && warmRecent) stance = "warm";
  else if (scene.patience >= 80) stance = "warm";
  else stance = "neutral";

  // The model may only *harden* stance relative to what the numbers say, never soften it.
  const order: Stance[] = ["warm", "neutral", "guarded", "defensive", "done"];
  if (moves.stance && order.indexOf(moves.stance) > order.indexOf(stance) && moves.stance !== "done") {
    stance = moves.stance;
  }
  return stance;
}

/** Player-initiated end. */
export function endSceneByPlayer(scene: SceneState, reason = "You closed the conversation."): SceneState {
  if (scene.ended) return scene;
  return { ...scene, ended: { by: "player", reason }, stance: "done" };
}

export function abandonScene(scene: SceneState): SceneState {
  if (scene.ended) return scene;
  return { ...scene, ended: { by: "abandoned", reason: "You left the conversation." }, stance: "done" };
}

/** Generic director notes derived from scene state; quests add their own. */
export function genericDirectorNotes(scene: SceneState, minTurns: number, maxTurns: number): string[] {
  const notes: string[] = [];
  const p = scene.patience;
  if (p >= 75) notes.push("You are in a good mood and have time. Be generous with attention, but stay in character.");
  else if (p >= 50) notes.push("You are engaged but busy. Keep answers focused.");
  else if (p >= 30) notes.push("Your patience is wearing thin. Be briefer, more direct, and less accommodating.");
  else if (p > 0) notes.push("You are close to ending this. Be curt. Signal that you need to wrap up. Do not give anything more away.");
  switch (scene.stance) {
    case "warm":
      notes.push("Stance: warm — you like how this is going; you can volunteer a little more.");
      break;
    case "guarded":
      notes.push("Stance: guarded — be careful with information; make the player work for it.");
      break;
    case "defensive":
      notes.push("Stance: defensive — you feel pushed; hold your position firmly and consider closing the conversation.");
      break;
    default:
      notes.push("Stance: neutral — professional and measured.");
  }
  const remaining = maxTurns - scene.turnCount;
  if (remaining <= 2) notes.push(`You have very little time left (about ${remaining} exchange${remaining === 1 ? "" : "s"}). Move to a conclusion.`);
  else if (scene.turnCount >= minTurns) notes.push("If the matter is settled, you may naturally close the conversation (set wantsToEnd).");
  const hostile = (scene.signalCounts.aggressive_tone ?? 0) + (scene.signalCounts.ultimatum ?? 0);
  if (hostile >= 2) notes.push("The player has been aggressive more than once. You remember that and it colours your tone.");
  return notes;
}
