/**
 * What the client is allowed to see about an attempt. Hidden NPC state never
 * crosses this boundary; the player must discover it in conversation.
 */
import type { AttemptView } from "@/server/orchestrator";
import type { DialogueTurn } from "@/engine/types/scene";

export interface ClientTurn {
  id: string;
  index: number;
  speaker: DialogueTurn["speaker"];
  text: string;
}

export interface ClientAttempt {
  id: string;
  questId: string;
  npcId: string;
  status: AttemptView["status"];
  turns: ClientTurn[];
  visibleStatus: { label: string; value: string }[];
  /** Coarse, diegetic read of the NPC's mood. Never the raw number. */
  mood: "warm" | "neutral" | "guarded" | "defensive" | "done";
  ended: { by: string; reason: string } | null;
  turnCount: number;
  maxTurns: number;
}

export function toClientAttempt(a: AttemptView, maxTurns = 12): ClientAttempt {
  return {
    id: a.id,
    questId: a.questId,
    npcId: a.npcId,
    status: a.status,
    turns: a.turns.map((t) => ({ id: t.id, index: t.index, speaker: t.speaker, text: t.text })),
    visibleStatus: a.visibleStatus,
    mood: a.scene.stance,
    ended: a.scene.ended,
    turnCount: a.scene.turnCount,
    maxTurns,
  };
}
