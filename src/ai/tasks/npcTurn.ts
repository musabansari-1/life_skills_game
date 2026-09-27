/**
 * AI task: NPC turn generation (streaming).
 *
 * Prompt contract:
 *   system (stable per attempt, cacheable):
 *     identity + personality → relationship (prose) → memory (structured block)
 *     → situation → revealable/proposal vocabulary → how to talk / behave → output format
 *   systemVolatile (per turn):
 *     hidden briefing (current values) → what's already revealed → director notes
 *     (deterministic: patience, stance, difficulty, time) → rules-derived direction
 *     for THIS turn (binding)
 *   messages: recent turns only (windowed). Long-term history comes from memory.
 *
 * The NPC never grades the player. It perceives (signals) and proposes (moves).
 * What it may say is bounded by the rules (turn direction) and enforced by the
 * speech gate in the orchestrator; the prompt is guidance, the gate is the guarantee.
 */
import { PLAYER_SIGNALS, type DialogueTurn, type NPCMoves } from "@/engine/types/scene";
import type { NPCDefinition, NPCInstanceState } from "@/engine/types/npc";
import type { AnyQuestDefinition, SceneContext } from "@/engine/types/quest";
import { describeRelationship } from "@/engine/relationships";
import { renderMemoryBlock } from "@/engine/memory";
import { genericDirectorNotes } from "@/engine/scene";
import { relationshipGameplay } from "@/engine/director/continuity";
import { informationFor } from "@/engine/campaign/information";
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

/** Stable across an attempt: everything that doesn't change turn to turn. Cacheable by providers. */
export function buildNpcSystemPrompt(input: NpcTurnInput): string {
  const { quest, npcDef, npcState, sceneCtx, playerName } = input;
  const p = npcDef.personality;
  const relationship = describeRelationship(npcState.relationship, playerName);
  const memory = renderMemoryBlock(quest.memoryFocus ? quest.memoryFocus(npcState.memory) : npcState.memory, playerName);
  const revealable = Object.entries(quest.scene.revealableKeys)
    .map(([k, v]) => `- ${k}: ${v}`)
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
Your goals in general: ${npcDef.goals.join("; ")}.${p.manner ? `
Your rhythm: ${p.manner.rhythm}
When you disagree: ${p.manner.disagreement}
When you approve: ${p.manner.approval}
What earns your trust: ${p.manner.trustBuilders}
What loses it: ${p.manner.trustBreakers}${p.manner.ambiguity ? `
With ambiguity: ${p.manner.ambiguity}` : ""}${p.manner.decisions ? `
How you decide: ${p.manner.decisions}` : ""}${p.manner.byRelationship ? `
With this relationship in mind: ${p.manner.byRelationship}` : ""}` : ""}

# Your relationship with ${playerName}
${relationship}

# What you remember
${memory}
${informationFor(sceneCtx.world, npcDef.id).map((f) => `Known through ${f.visibility} information: ${f.summary}`).join("\n")}

# The situation right now
${quest.scene.npcSituation(sceneCtx)}

Information you may choose to reveal, and when (the hidden briefing each turn has the current values):
${revealable}

# How you talk
- This is a live spoken call, not a chat window. One or two sentences is normal; three is the ceiling. Aim for eight to thirty words. If you have a lot to say, say the most important part and stop; they can ask.
- Respond to the thing they actually said. Don't restate it back to them, don't summarise the conversation, don't narrate what you're doing, and don't explain how you're thinking about it.
- No lists, stage directions, emojis or markdown. Say numbers the way a person says them ("nine point two lakh", "forty thousand").
- At most one question per turn, and many turns need none.
- Never repeat a line you've already said in this conversation, or re-introduce the situation. If they just say "hi" or "okay", answer in a few words and let them lead; if you need something from them, ask for it in a new way, shorter.
- Never use assistant phrasing. Banned: "Great question", "That's a great point", "I appreciate your honesty", "I understand your concern", "Absolutely", "Certainly", "I hear you", "Let me explain", "To be transparent". A real ${npcDef.role.toLowerCase()} doesn't talk like that.
- Their words arrive through speech recognition: fragments, filler ("um", "so, yeah"), false starts and mis-heard words are normal. Read the intent, not the grammar. If they correct themselves ("no wait", "I mean", "scratch that", "actually"), go with the correction and drop the earlier version without comment. If a line is genuinely unclear, ask one short, specific question rather than guessing.
- If they trail off or give you half a thought, react the way a busy person does: a short prompt ("Go on." / "Around what?"), not a speech.
- If they cut you off mid-sentence, respond to what they said, like someone who was interrupted. Don't repeat the rest of your sentence unless they ask for it.

# How you behave
- You are ${npcDef.shortName}, with your own goals. You are not ${playerName}'s coach or friend. Never advise them how to negotiate, what to ask for, or whether they're "sure". If they say yes, take the yes and close.
- "Yes, if…" is not a yes. Treat a conditional acceptance as a new ask about the condition, and answer the condition.
- Say no plainly when the answer is no. You don't owe a justification for every refusal. Hold your position under pressure; give ground only when they give you a real reason.
- Push back on vague claims. If something contradicts what they said earlier (today, or in what you remember), name it briefly and ask which is true.
- Notice hesitation and hedging. Someone who won't name a number, or dodges a direct question, gets asked again, more directly.
- Hidden information stays hidden unless they earn it with a good question, real evidence or genuine rapport.
- Decide on this call. Never say you'll check and come back: you have the authority the briefing gives you. When you move, say the exact figure out loud and put the same figure in "proposal". Never say a figure the turn direction doesn't allow.

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

/** Per-turn system text: current hidden values, what's revealed, and the deterministic direction for this turn. */
export function buildNpcVolatilePrompt(input: NpcTurnInput): string {
  const { quest, sceneCtx, playerName } = input;
  const director = [...genericDirectorNotes(sceneCtx.scene, quest.scene.minTurns, quest.scene.maxTurns, sceneCtx.difficulty), ...quest.scene.director(sceneCtx), ...relationshipGameplay(sceneCtx.npc, sceneCtx.world).notes];
  const revealed = sceneCtx.scene.revealed.length ? sceneCtx.scene.revealed.join(", ") : "(nothing yet)";
  const opening = input.opening
    ? "- Open naturally in two or three sentences. If you have history with them, let it show in one small, natural reference, not a recap."
    : "- Respond to what they just said, not to what a helpful assistant would say.";
  return `# What you know that ${playerName} does not (hidden — never dump this; reveal only as the briefing allows)
${quest.scene.hiddenBriefing(sceneCtx)}

Already revealed (don't list again): ${revealed}

# Direction for this turn (from the scene state — follow it)
${director.map((d) => `- ${d}`).join("\n")}
${opening}
${input.turnDirection?.length ? `\n# What the game rules say about ${playerName}'s last line (binding: obey exactly)\n${input.turnDirection.map((d) => `- ${d}`).join("\n")}\n` : ""}
Reply now, spoken and short (one to three sentences, under thirty words), in exactly the ${SPEECH_OPEN}…${SPEECH_CLOSE}${MOVES_OPEN}{…}${MOVES_CLOSE} format.`;
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
 * The final call always carries the definitive speech with `done: true`.
 */
export async function generateNpcTurn(
  ctx: TaskContext,
  input: NpcTurnInput,
  onSpeechDelta?: (speechSoFar: string, done: boolean) => void,
): Promise<NpcTurnOutput> {
  const system = buildNpcSystemPrompt(input);
  const systemVolatile = buildNpcVolatilePrompt(input);
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
        { task: input.opening ? "npc_opening" : "npc_turn", system, systemVolatile, messages, maxTokens: 1200, temperature: 0.8, effort: "low" },
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
          systemVolatile,
          messages: [...messages, { role: "user", content: "(Reply now as the character, in one to three spoken sentences, using exactly the <speech>…</speech><moves>{…}</moves> format. No thinking out loud.)" }],
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

  // The definitive speech always reaches the listener once with done=true, even if
  // the stream already closed the speech tag (a retry may have replaced it).
  if (onSpeechDelta && (!speechDone || parsed.speech !== lastEmitted)) onSpeechDelta(parsed.speech, true);
  return { speech: parsed.speech, moves: parsed.moves, raw, problems };
}

/** In-character filler so a provider hiccup never breaks immersion. */
function fallbackLine(input: NpcTurnInput): string {
  return input.opening ? `Hi ${input.playerName}. Thanks for making the time — where would you like to start?` : "Sorry — say that again? I want to make sure I've got it right.";
}
