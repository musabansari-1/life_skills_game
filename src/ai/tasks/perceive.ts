/**
 * AI task: perception fallback.
 *
 * Strong models return speech + moves in one pass. Weaker models often speak
 * well but leave the moves block empty. When that happens, this focused
 * structured call reads the last exchange and reports the moves. It is only
 * invoked when the primary moves are empty, so strong providers never pay for it.
 */
import { NPCMovesSchema, PLAYER_SIGNALS, type NPCMoves } from "@/engine/types/scene";
import type { AnyQuestDefinition, SceneContext } from "@/engine/types/quest";
import type { NPCDefinition } from "@/engine/types/npc";
import { SIGNAL_GUIDE } from "./npcTurn";
import { runStructuredTask, type TaskContext } from "./shared";

export interface PerceiveInput {
  quest: AnyQuestDefinition;
  npcDef: NPCDefinition;
  sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>;
  playerText: string;
  npcSpeech: string;
  playerName: string;
}

export async function perceiveMoves(ctx: TaskContext, input: PerceiveInput): Promise<{ moves: NPCMoves; problems: string[] }> {
  const { quest, npcDef, playerName, sceneCtx } = input;
  const revealable = Object.entries(quest.scene.revealableKeys)
    .map(([k, v]) => `- ${k}: ${v.split(".")[0]}`)
    .join("\n");
  const proposals = quest.scene.proposalKeys
    ? Object.entries(quest.scene.proposalKeys)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "(none)";
  const system = `You annotate one exchange in a role-play between ${playerName} (player) and ${npcDef.name} (${npcDef.role}). You do not write dialogue. Output only JSON describing what happened.

Hidden context ${npcDef.shortName} is working with:
${quest.scene.hiddenBriefing(sceneCtx)}

"noticed": things ${playerName} clearly did in their message (0-4), from exactly this list. Be strict: only tag what is plainly present; a market benchmark is evidence, not a competing offer.
${PLAYER_SIGNALS.map((s) => `- ${s}: ${SIGNAL_GUIDE[s]}`).join("\n")}
"reveal": keys from this list that ${npcDef.shortName}'s reply disclosed:
${revealable}
"proposal": concrete moves ${npcDef.shortName}'s reply made, using only these keys (numbers as integers in rupees; omit keys not present):
${proposals}
"wantsToEnd": true only if ${npcDef.shortName} is clearly closing the conversation.

Return ONLY: {"noticed":[],"reveal":[],"proposal":{},"patienceDelta":0,"wantsToEnd":false}`;
  const user = `${playerName} said:\n"""${input.playerText}"""\n\n${npcDef.shortName} replied:\n"""${input.npcSpeech}"""\n\nAnnotate this exchange.`;
  try {
    const { value, problems } = await runStructuredTask(
      ctx,
      { task: "perceive", system, messages: [{ role: "user", content: user }], maxTokens: 600, temperature: 0, effort: "low", jsonMode: true },
      NPCMovesSchema,
      { maxAttempts: 1 },
    );
    return { moves: value, problems };
  } catch (err) {
    // Perception is best-effort; the deterministic reducer still runs.
    return { moves: NPCMovesSchema.parse({}), problems: [`perceive failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** Union of two move sets: signals/reveals merged, proposals filled where missing. */
export function mergeMoves(primary: NPCMoves, extra: Partial<NPCMoves>): NPCMoves {
  return {
    noticed: [...new Set([...primary.noticed, ...(extra.noticed ?? [])])].slice(0, 6),
    reveal: [...new Set([...primary.reveal, ...(extra.reveal ?? [])])],
    proposal: { ...(extra.proposal ?? {}), ...primary.proposal },
    stance: primary.stance ?? extra.stance,
    patienceDelta: primary.patienceDelta ?? extra.patienceDelta,
    wantsToEnd: primary.wantsToEnd || !!extra.wantsToEnd,
    endReason: primary.endReason ?? extra.endReason,
  };
}

export function movesAreEmpty(m: NPCMoves): boolean {
  return m.noticed.length === 0 && m.reveal.length === 0 && Object.keys(m.proposal).length === 0 && !m.wantsToEnd;
}
