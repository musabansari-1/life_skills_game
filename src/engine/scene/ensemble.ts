import { z } from "zod";
import type { DialogueTurn, SceneState } from "../types/scene";

export interface SemanticFeature { id: string; description: string }
export interface EnsembleParticipant {
  npcId: string; name: string; goal: string; privateConstraint: string;
  interests: string[]; supports: string[]; challenges: string[];
  relationships: { npcId: string; stance: string }[];
}
export interface EnsembleProfile { participants: EnsembleParticipant[]; leadId: string }
export const EvidenceSchema = z.object({ feature: z.string().max(80), quote: z.string().min(8).max(500), revoked: z.boolean().default(false) });
export type SceneEvidence = z.infer<typeof EvidenceSchema> & { turnIndex: number };
export const SemanticReadSchema = z.object({ evidence: z.array(EvidenceSchema).max(8), addressedTo: z.string().nullable().default(null) }).strict();
export type SemanticRead = z.infer<typeof SemanticReadSchema>;
export interface FloorDecision { npcId: string; addressedTo: string; kind: "answer" | "support" | "challenge" | "interjection"; reason: string; pauseForPlayer: true }
export const TurnIdentitySchema = z.object({ npcId: z.string(), name: z.string(), addressedTo: z.string(), kind: z.enum(["answer", "support", "challenge", "interjection"]), autonomous: z.boolean().optional() });
export type TurnIdentity = z.infer<typeof TurnIdentitySchema>;
export const PendingReactionSchema = TurnIdentitySchema.extend({ sourceTurnIndex: z.number().int() });
export function pendingReaction(scene: SceneState) {
  const parsed = PendingReactionSchema.safeParse(scene.custom._reaction);
  return parsed.success ? parsed.data : null;
}
export function scheduleReaction(profile: EnsembleProfile, scene: SceneState, identity: TurnIdentity, playerIndex: number): SceneState {
  const fresh = sceneEvidence(scene).filter((e) => e.turnIndex === playerIndex && !e.revoked).map((e) => e.feature);
  const candidate = profile.participants.find((p) => p.npcId !== identity.npcId && p.challenges.some((s) => fresh.includes(s)))
    ?? profile.participants.find((p) => p.npcId !== identity.npcId && p.supports.some((s) => fresh.includes(s)) && fresh.includes("team_care"));
  if (!candidate || scene.ended) return scene;
  return { ...scene, custom: { ...scene.custom, _reaction: { npcId: candidate.npcId, name: candidate.name, addressedTo: identity.npcId,
    kind: candidate.challenges.some((s) => fresh.includes(s)) ? "interjection" : "support", autonomous: true, sourceTurnIndex: playerIndex + 1 } } };
}

export function validateSceneRead(raw: SemanticRead, text: string, features: SemanticFeature[], participants: string[], turnIndex: number): { evidence: SceneEvidence[]; addressedTo: string | null } {
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  const evidence = raw.evidence.filter((e) => features.some((f) => f.id === e.feature)
    && normalized(text).includes(normalized(e.quote)) && !seen.has(e.feature) && !!seen.add(e.feature))
    .map((e) => ({ ...e, turnIndex }));
  return { evidence, addressedTo: raw.addressedTo && participants.includes(raw.addressedTo) ? raw.addressedTo : null };
}
export function sceneEvidence(scene: SceneState): SceneEvidence[] {
  const result = z.array(EvidenceSchema.extend({ turnIndex: z.number().int() })).safeParse(scene.custom._evidence ?? []);
  return result.success ? result.data : [];
}
export function addSceneEvidence(scene: SceneState, evidence: SceneEvidence[]): SceneState {
  const previous = sceneEvidence(scene);
  const next = [...previous.filter((e) => !evidence.some((n) => n.feature === e.feature)), ...evidence].slice(-24);
  return { ...scene, custom: { ...scene.custom, _evidence: next } };
}
export function hasEvidence(scene: SceneState, feature: string): boolean {
  return sceneEvidence(scene).some((e) => e.feature === feature && !e.revoked);
}

/** One floor holder per exchange. Addressing someone wins except for a concrete unresolved safety objection.
 * A reaction replaces an answer, never starts an unbounded NPC loop. Everyone else listens. */
export function selectFloor(profile: EnsembleProfile, scene: SceneState, turns: DialogueTurn[], addressedTo: string | null): FloorDecision {
  const previous = turns.filter((t) => t.speaker === "npc").at(-1)?.identity;
  const evidence = sceneEvidence(scene).filter((e) => !e.revoked);
  const fresh = evidence.filter((e) => e.turnIndex === turns.at(-1)?.index).map((e) => e.feature);
  const scored = profile.participants.map((p, i) => {
    const objection = p.challenges.some((s) => fresh.includes(s));
    const supportive = p.supports.some((s) => fresh.includes(s));
    let score = p.npcId === addressedTo ? 100 : p.npcId === profile.leadId ? 12 : 0;
    score += p.interests.filter((s) => fresh.includes(s)).length * 22 + (objection ? 70 : 0) + (supportive ? 25 : 0);
    if (p.npcId === previous?.npcId) score -= 10;
    return { p, score, objection, supportive, i };
  }).sort((a, b) => b.score - a.score || a.i - b.i);
  const selected = scored[0];
  const reacts = selected.p.npcId !== previous?.npcId && (selected.objection || selected.supportive) && !addressedTo;
  return { npcId: selected.p.npcId, addressedTo: reacts ? previous?.npcId ?? "player" : "player",
    kind: selected.objection ? (reacts ? "interjection" : "challenge") : reacts ? "support" : "answer",
    reason: selected.objection ? "A concrete constraint needs a response before the plan can advance." : selected.supportive ? "This proposal protects a concern this participant owns." : "This participant owns the question or the next decision.", pauseForPlayer: true };
}
export function participantDirection(profile: EnsembleProfile, floor: FloorDecision, scene: SceneState): string[] {
  const p = profile.participants.find((p) => p.npcId === floor.npcId)!;
  const position = p.challenges.some((s) => hasEvidence(scene, s)) ? "Challenge the unsafe assumption" : p.supports.some((s) => hasEvidence(scene, s)) ? "Support the feasible part, while keeping your constraint" : "Test the proposal";
  return [`Only you speak this exchange. Address ${floor.addressedTo}; then leave room for the player. ${floor.reason}`,
    `Your scene goal: ${p.goal}. Your private constraint: ${p.privateConstraint}. ${position}.`,
    `Your relationships in this room: ${p.relationships.map((r) => `${r.npcId}: ${r.stance}`).join("; ")}.`,
    "You may disagree with another participant without treating the player as hostile. Do not impersonate the others or invent their assent."];
}
