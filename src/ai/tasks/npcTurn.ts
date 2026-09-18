/**
 * AI task: NPC turn generation (streaming).
 *
 * Prompt contract (system):
 *   identity + personality → relationship (prose) → memory (structured block)
 *   → situation & hidden briefing → director notes (deterministic, per turn)
 *   → signal vocabulary → output format.
 * Messages: recent turns only (windowed). Long-term history comes from memory.
 *
 * The NPC never grades the player. It perceives (signals) and proposes (moves).
 */
import { PLAYER_SIGNALS, type DialogueTurn, type NPCMoves } from "@/engine/types/scene";
import type { NPCDefinition, NPCInstanceState } from "@/engine/types/npc";
import type { AnyQuestDefinition, SceneContext } from "@/engine/types/quest";
import { describeRelationship } from "@/engine/relationships";
import { renderMemoryBlock } from "@/engine/memory";
import { genericDirectorNotes } from "@/engine/scene";
import { extractStreamingSpeech, parseNpcTurn, MOVES_CLOSE, MOVES_OPEN, SPEECH_CLOSE, SPEECH_OPEN } from "../format";
import { logged, recentTurnsAsMessages, type TaskContext } from "./shared";

export const SIGNAL_GUIDE: Record<(typeof PLAYER_SIGNALS)[number], string> = {
  evidence_provided: "backed a claim with something specific and checkable",
  good_question: "asked an open question that surfaced useful information",
  acknowledged_npc: "reflected or acknowledged your point before responding",
  rapport: "warmth, courtesy or humour that genuinely landed",
  clear_ask: "made a specific, unambiguous request or named a number",
  proposed_alternative: "offered a trade, option or creative alternative",
  empathy: "showed real understanding of your position or constraints",
  owned_mistake: "admitted an error or corrected themselves",
  aggressive_tone: "demanding, hostile, threatening or contemptuous",
  ultimatum: "take-it-or-leave-it framing",
  vague_claim: "an unsupported or fuzzy assertion you can't act on",
  contradiction: "conflicts with something they said earlier",
  rambling: "long and unfocused; you lost the thread",
  revealed_minimum: "disclosed their floor or walk-away point",
  conceded_for_free: "gave something up without asking for anything in return",
  mentioned_competing_offer: "claimed to have another offer or option",
  asked_about_total_comp: "asked about bonus, equity, or non-base components",
  deflected: "dodged a direct question",
  accepted_terms: "agreed to what is currently on the table (a real yes, not a conditional one)",
  silence_or_filler: "empty turn — nothing of substance",
};

export interface NpcTurnInput {
  quest: AnyQuestDefinition;
  npcDef: NPCDefinition;
  npcState: NPCInstanceState;
  sceneCtx: SceneContext<Record<string, unknown>, Record<string, unknown>>;
  turns: DialogueTurn[];
  playerName: string;
  /** True for the very first line of the scene. */
  opening: boolean;
  /**
   * Rules-derived direction for THIS turn (from the quest's preTurn read of the
   * player's words), e.g. "You may move base to at most nine point three lakh". Highest priority.
   */
  turnDirection?: string[];
}

export function buildNpcSystemPrompt(input: NpcTurnInput): string {
  const { quest, npcDef, npcState, sceneCtx, playerName } = input;
  const p = npcDef.personality;
  const relationship = describeRelationship(npcState.relationship, playerName);
  const memory = renderMemoryBlock(quest.memoryFocus ? quest.memoryFocus(npcState.memory) : npcState.memory, playerName);
  const director = [...genericDirectorNotes(sceneCtx.scene, quest.scene.minTurns, quest.scene.maxTurns), ...quest.scene.director(sceneCtx)];
  const revealable = Object.entries(quest.scene.revealableKeys)
    .map(([k, v]) => `- ${k}: ${v}${sceneCtx.scene.revealed.includes(k) ? " (ALREADY REVEALED — don't list again)" : ""}`)
    .join("\n");
  const proposals = quest.scene.proposalKeys
    ? Object.entries(quest.scene.proposalKeys)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "(none for this scene)";
  const signals = PLAYER_SIGNALS.map((s) => `- ${s}: ${SIGNAL_GUIDE[s]}`).join("\n");

  return `You are ${npcDef.name}, ${npcDef.role} at ${npcDef.organisation}. You are a real person in a live spoken conversation with ${playerName}. Stay fully in character. You are not an assistant and you never break the fourth wall.

# Who you are
${p.summary}
Traits: ${p.traits.join(", ")}.
You value: ${p.values.join("; ")}.
You dislike: ${p.dislikes.join("; ")}.
How you speak: ${p.speakingStyle}
When your patience runs low: ${p.underPressure}
Your goals in general: ${npcDef.goals.join("; ")}.

# Your relationship with ${playerName}
${relationship}

# What you remember
${memory}

# The situation right now
${quest.scene.npcSituation(sceneCtx)}

# What you know that ${playerName} does not (hidden — never dump this; reveal only as the briefing allows)
${quest.scene.hiddenBriefing(sceneCtx)}

Information you may choose to reveal, and when:
${revealable}

# Direction for this turn (from the scene state — follow it)
${director.map((d) => `- ${d}`).join("\n")}

${input.turnDirection?.length ? `# What the game rules say about ${playerName}'s last line (binding: obey exactly)\n${input.turnDirection.map((d) => `- ${d}`).join("\n")}\n\n` : ""}# How you talk
- This is a live spoken call. Usually one or two sentences, never more than three. Aim for under 35 words. Short turns, like a real person.
- ${input.opening ? "Open naturally in two or three sentences. If you have history with them, let it show in one small, natural reference, not a recap." : "Respond to what they just said, not to what a helpful assistant would say."}
- No lists, stage directions, emojis or markdown. Say numbers the way a person says them ("nine point two lakh", "forty thousand").
- At most one question per turn, and plenty of turns need none.

# How you behave
- You are ${npcDef.shortName}, with your own goals. You are not ${playerName}'s coach or friend. Never advise them how to negotiate, what to ask for, or whether they're "sure". If they say yes, take the yes and close.
- Say no plainly when the answer is no. You don't have to justify every refusal. Hold your position under pressure; give ground only when they give you a real reason.
- Push back on vague claims. If something contradicts what they said earlier (today or in what you remember), call it out briefly.
- Hidden information stays hidden unless they earn it with a good question, real evidence or genuine rapport.
- Decide on this call. Never say you'll check and come back: you have the authority the briefing gives you. When you move, say the exact figure out loud and put the same figure in "proposal". Never say a figure the rules above don't allow.

# Output format (strict)
First the speech, then the moves. Exactly this shape:
${SPEECH_OPEN}
What you say out loud.
${SPEECH_CLOSE}
${MOVES_OPEN}{"noticed": [...], "reveal": [...], "proposal": {...}, "patienceDelta": 0, "wantsToEnd": false, "endReason": ""}${MOVES_CLOSE}

"noticed": which of these things ${playerName} did in their LAST message (0-4 items, only if clearly present):
${signals}
"reveal": keys from the revealable list that you disclosed in THIS speech.
"proposal": concrete moves you are making in this speech, using only these keys:
${proposals}
"patienceDelta": -20..10, how this exchange affected your patience.
"wantsToEnd": true only if you are genuinely wrapping up (deal done, or you've had enough).`;
}

export interface NpcTurnOutput {
  speech: string;
  moves: NPCMoves;
  raw: string;
  problems: string[];
}

/**
 * Generate the NPC's next line. `onSpeechDelta` receives *speech-only* text as
 * it streams (moves JSON is never surfaced), suitable for captions and TTS.
 */
export async function generateNpcTurn(
  ctx: TaskContext,
  input: NpcTurnInput,
  onSpeechDelta?: (speechSoFar: string, done: boolean) => void,
): Promise<NpcTurnOutput> {
  const system = buildNpcSystemPrompt(input);
  const messages = recentTurnsAsMessages(input.turns);
  if (input.opening) {
    const hint = input.quest.scene.opening.generatedHint ?? "Open the conversation naturally.";
    messages.push({ role: "user", content: `(The conversation is about to begin. ${hint} Speak first.)` });
  }
  let raw = "";
  let lastEmitted = "";
  let speechDone = false;
  const problems: string[] = [];

  const res = await logged(
    ctx,
    input.opening ? "npc_opening" : "npc_turn",
    () =>
      ctx.provider.stream(
        { task: input.opening ? "npc_opening" : "npc_turn", system, messages, maxTokens: 1200, temperature: 0.8, effort: "low" },
        (delta) => {
          raw += delta;
          if (speechDone || !onSpeechDelta) return;
          const s = extractStreamingSpeech(raw);
          if (s.speech !== lastEmitted || s.speechDone) {
            lastEmitted = s.speech;
            onSpeechDelta(s.speech, s.speechDone);
          }
          if (s.speechDone) speechDone = true;
        },
      ),
    () => problems,
  );
  if (!raw) raw = res.text;
  let parsed = parseNpcTurn(raw);
  problems.push(...parsed.problems);
  if (res.stopReason === "max_tokens") problems.push("hit max_tokens");

  // Empty speech (model rambled, truncated, or refused the format): one non-streaming retry with a nudge.
  if (parsed.speech === "…") {
    problems.push("empty speech; retrying");
    const retry = await logged(
      ctx,
      input.opening ? "npc_opening" : "npc_turn",
      () =>
        ctx.provider.complete({
          task: input.opening ? "npc_opening" : "npc_turn",
          system,
          messages: [...messages, { role: "user", content: "(Reply now as the character, in 1-3 spoken sentences, using exactly the <speech>…</speech><moves>{…}</moves> format. No thinking out loud.)" }],
          maxTokens: 900,
          temperature: 0.7,
          effort: "low",
        }),
      () => problems,
    );
    const p2 = parseNpcTurn(retry.text);
    if (p2.speech !== "…") {
      parsed = p2;
      raw = retry.text;
      problems.push(...p2.problems.map((x) => `retry: ${x}`));
    } else {
      problems.push("retry also empty; using fallback line");
      parsed = { ...p2, speech: fallbackLine(input) };
    }
  }

  if (onSpeechDelta && !speechDone) onSpeechDelta(parsed.speech, true);
  return { speech: parsed.speech, moves: parsed.moves, raw, problems };
}

/** In-character filler so a provider hiccup never breaks immersion. */
function fallbackLine(input: NpcTurnInput): string {
  return input.opening ? `Hi ${input.playerName}. Thanks for making the time — where would you like to start?` : "Sorry — say that again? I want to make sure I've got it right.";
}
