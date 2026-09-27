/**
 * Small helpers for semantic-feature encounters (Maya, Nora, Arjun, the
 * Review…). Every quest built with these is still an ordinary `defineQuest`
 * definition run by the same orchestrator; this file only removes repetition.
 *
 * The pattern:
 *  - authored `SemanticFeature`s describe behaviour (never a phrase);
 *  - `trackFresh` in `preTurn` records which features the LATEST player line
 *    produced, so an authored disclosure fires once, in response to the right
 *    question, and never from stale evidence;
 *  - `disclose` is used from `canonicalSpeech` for facts that gate progress:
 *    the character says an exact authored line, and `revealsFrom` records the
 *    reveal only if that line was actually delivered;
 *  - `beat` gives the NPC model the gist of its next move each turn.
 */
import type { SceneState } from "@/engine/types/scene";
import type { WorldState } from "@/engine/types/world";
import { hasEvidence, sceneEvidence } from "@/engine/scene/ensemble";

type Custom = Record<string, unknown>;

/** Call at the top of `preTurn`. Returns the next custom state with `_fresh` set. */
export function trackFresh<S extends Custom>(scene: SceneState & { custom: S }): S & { _seen: number; _fresh: string[] } {
  const evidence = sceneEvidence(scene).filter((e) => !e.revoked);
  const seen = typeof scene.custom._seen === "number" ? (scene.custom._seen as number) : -1;
  const latest = evidence.reduce((max, e) => Math.max(max, e.turnIndex), -1);
  const fresh = latest > seen ? evidence.filter((e) => e.turnIndex === latest).map((e) => e.feature) : [];
  return { ...scene.custom, _seen: Math.max(seen, latest), _fresh: fresh };
}

/** Did the player's latest line produce this feature? */
export function fresh(scene: SceneState, ...features: string[]): boolean {
  const list = Array.isArray(scene.custom._fresh) ? (scene.custom._fresh as string[]) : [];
  return features.some((f) => list.includes(f));
}

export const has = hasEvidence;
export const hasAll = (scene: SceneState, ...features: string[]) => features.every((f) => hasEvidence(scene, f));
export const hasAny = (scene: SceneState, ...features: string[]) => features.some((f) => hasEvidence(scene, f));

/** Distinct player lines that produced any non-revoked evidence. A plan needs more than one breath. */
export function evidenceTurns(scene: SceneState): number {
  return new Set(sceneEvidence(scene).filter((e) => !e.revoked).map((e) => e.turnIndex)).size;
}

/** An authored, binding disclosure: say `line` once, when `when` holds and it hasn't been said. */
export function disclose(scene: SceneState, key: string, when: boolean, line: string): string | null {
  return when && !scene.revealed.includes(key) ? line : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
/** Reveals are grounded in delivered speech: a key counts only if its exact line was said. */
export function revealsFrom(speech: string, lines: Record<string, string | string[]>): string[] {
  const said = norm(speech);
  return Object.entries(lines).filter(([, l]) => (Array.isArray(l) ? l : [l]).some((x) => said.includes(norm(x)))).map(([k]) => k);
}

/** The gist of the NPC's next move. Say it in character; never read it verbatim to a real player. */
export const beat = (gist: string) => `NEXT_BEAT: ${gist}`;

/** Standard instruction for semantic encounters, appended to `npcSituation`. */
export const BEAT_NOTE = "Each turn, the NEXT_BEAT note gives the gist of your next move. Say it your own way, in your own voice, briefly. Never grade the player or mention objectives.";

export const flag = (world: WorldState, f: string) => world.flags.includes(f);
export const outcomeOf = (world: WorldState, questId: string) =>
  [...world.completedQuests, ...world.failedQuests].filter((r) => r.questId === questId).at(-1)?.outcomeId ?? null;
