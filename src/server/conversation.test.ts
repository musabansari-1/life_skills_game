/**
 * Conversation-layer guarantees on the full loop (in-memory DB + fake provider):
 *   - the speech gate keeps audible speech, caption text, transcript and scene state in agreement
 *   - an interrupted NPC line is recorded as what was heard, and the scene is re-derived from it
 *   - evaluation and memory extraction see only the canonical (heard) transcript
 *   - duplicate / stale delivery reports and duplicate turns are harmless
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { players, users, worldStates } from "@/db/schema";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { MOVES_CLOSE, MOVES_OPEN, SPEECH_CLOSE, SPEECH_OPEN } from "@/ai/format";
import { createEmptyProfile } from "@/engine/competency";
import { createInitialWorldState } from "@/engine/types/world";
import { formatINR, makeTestEnv } from "@/engine/util";
import { spokenRupees } from "@/engine/parsing/numbers";
import { MemoryAnalytics } from "./analytics";
import { GameError, GameService } from "./orchestrator";
import { toClientAttempt } from "./queries";

let db: Db;
let analytics: MemoryAnalytics;
const playerId = "p1";

async function seed() {
  const now = "2026-01-01T00:00:00.000Z";
  await db.insert(users).values({ id: "u1", email: "a@b.c", passwordHash: "x", createdAt: now });
  await db.insert(players).values({ id: playerId, userId: "u1", displayName: "Asha", onboardingCompletedAt: now, competencies: createEmptyProfile(), createdAt: now, updatedAt: now });
  const world = createInitialWorldState();
  world.career.status = "offer_received";
  world.unlockedQuests.push("counter_offer");
  await db.insert(worldStates).values({ playerId, state: world, version: 1, updatedAt: now });
}

function service(provider: FakeProvider) {
  analytics = new MemoryAnalytics();
  return new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics, env: makeTestEnv() });
}

const wire = (speech: string, moves: Record<string, unknown>) => `${SPEECH_OPEN}${speech}${SPEECH_CLOSE}\n${MOVES_OPEN}${JSON.stringify(moves)}${MOVES_CLOSE}`;
const EVIDENCE_LINE = "In my current role I led a migration that cut infra spend by 30%, and the market range is 10 lakh. I'd like 10 lakh.";

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seed();
});

describe("speech gate: audible speech always agrees with the rules", () => {
  it("lowers an over-cap figure before it is streamed, and records exactly what was said", async () => {
    // The model tries to say 9.5 lakh; the rules allow 9.2 lakh this turn.
    const provider = new FakeProvider({
      scripted: { npc_turn: () => wire("The specifics help. I can take base to nine point five lakh. That's a real stretch for us.", { noticed: ["evidence_provided", "clear_ask"], proposal: { base: 950000 } }) },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const streamed: { text: string; done: boolean }[] = [];
    const r = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice", (text, done) => streamed.push({ text, done }));

    const cap = r.attempt.scene.custom.turnCap as number;
    expect(cap).toBeLessThan(950000);
    expect(r.npcText).toBe(`The specifics help. I can take base to ${spokenRupees(cap)}. That's a real stretch for us.`);
    // Nothing above the cap ever reached the stream (so it was never spoken or captioned).
    for (const s of streamed) expect(s.text).not.toMatch(/nine point five/);
    // Stream ends with the definitive text, sentences arrive as they complete.
    expect(streamed.at(-1)).toEqual({ text: r.npcText, done: true });
    expect(streamed[0].text).toBe("The specifics help.");
    // Recorded state == spoken figure, and the transcript holds the same line.
    expect(r.attempt.scene.custom.currentBase).toBe(cap);
    expect(r.attempt.turns.at(-1)!.text).toBe(r.npcText);
    expect(r.attempt.visibleStatus[0]).toEqual({ label: "Base on the table", value: formatINR(cap) });
    expect(analytics.events.some((e) => e.type === "npc_speech_gated")).toBe(true);
  });

  it("a figure in the moves JSON that was never said out loud is not an offer", async () => {
    const provider = new FakeProvider({
      scripted: { npc_turn: () => wire("Help me understand what's behind that number.", { noticed: ["clear_ask"], proposal: { base: 950000 } }) },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer");
    const r = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "text");
    expect(r.attempt.scene.custom.currentBase).toBe(850000);
    expect(r.attempt.visibleStatus[0].value).toBe("₹8.5L");
  });

  it("the opening line is gated too", async () => {
    const provider = new FakeProvider({
      scripted: { npc_opening: () => wire("Hi Asha. We can go to nine point seven lakh if you want, so where are you at?", { noticed: [] }) },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer");
    expect(a.turns[0].text).toBe("Hi Asha. We can go to eight point five lakh if you want, so where are you at?");
    expect(a.scene.custom.currentBase).toBe(850000);
  });
});

describe("interruption: only what was heard is canon", () => {
  it("truncates the line, un-does the unheard offer, and tells the NPC it was cut off", async () => {
    const provider = new FakeProvider();
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const t1 = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice");
    const npcLine = t1.attempt.turns.at(-1)!;
    expect(npcLine.text).toMatch(/I could take base to 9\.1 lakh/);
    expect(t1.attempt.scene.custom.currentBase).toBe(910000);

    // The player cuts in after the first sentence; the figure was in the second.
    const heard = "That's a fair point, and the specifics help.";
    const t2 = await game.submitPlayerTurn(playerId, a.id, "What about a signing bonus?", "voice", undefined, { expectedTurnCount: 3, interrupted: { turnIndex: npcLine.index, heardText: heard } });
    const turns = t2.attempt.turns;
    const cut = turns.find((t) => t.index === npcLine.index)!;
    expect(cut.text).toBe(heard);
    expect(cut.interrupted).toBe(true);
    expect(cut.generatedText).toBe(npcLine.text);
    // The unheard base move never happened; the following turn (a bonus ask) is reduced from the un-moved scene.
    expect(t2.attempt.scene.custom.currentBase).toBe(850000);
    expect(t2.attempt.scene.custom.currentSigningBonus).toBe(40000);
    expect(t2.attempt.scene.turnCount).toBe(2);
    expect(analytics.events.filter((e) => e.type === "npc_interrupted")).toHaveLength(1);

    // The NPC model saw the interruption in context and in its direction for the turn.
    const call = provider.calls.filter((c) => c.task === "npc_turn").at(-1)!;
    const assistant = call.messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.content).toBe(`${heard}—`);
    expect(call.messages.at(-1)!.content).toBe("(cutting in) What about a signing bonus?");
    expect(call.systemVolatile).toMatch(/cut you off mid-sentence/);
    expect(call.systemVolatile).not.toMatch(/9\.1 lakh/);

    // The client sees canonical text only.
    const client = toClientAttempt(t2.attempt);
    expect(client.turns.find((t) => t.index === npcLine.index)).toMatchObject({ text: heard, interrupted: true });
    expect(JSON.stringify(client)).not.toMatch(/9\.1 lakh/);
  });

  it("evaluation and memory extraction receive the heard transcript, never the unheard rest", async () => {
    const provider = new FakeProvider();
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const t1 = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice");
    const npcLine = t1.attempt.turns.at(-1)!;
    await game.reportDelivery(playerId, a.id, { turnIndex: npcLine.index, heardText: "That's a fair point," });
    await game.concludeQuest(playerId, a.id);
    for (const task of ["evaluate", "extract_memory"] as const) {
      const call = provider.calls.find((c) => c.task === task)!;
      const transcript = call.messages.map((m) => m.content).join("\n");
      expect(transcript).toMatch(/Emma: That's a fair point— \[Asha cut in here; the rest was never said\]/);
      expect(transcript).not.toMatch(/9\.1 lakh/);
    }
  });

  it("reportDelivery alone (silence after cutting in) truncates and re-derives; repeats and stale reports are no-ops", async () => {
    const provider = new FakeProvider();
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const t1 = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice");
    const npcLine = t1.attempt.turns.at(-1)!;

    const first = await game.reportDelivery(playerId, a.id, { turnIndex: npcLine.index, heardText: "That's a fair point, and the specifics" });
    expect(first.turns.at(-1)!.text).toBe("That's a fair point, and the specifics");
    expect(first.scene.custom.currentBase).toBe(850000);
    expect(first.visibleStatus[0].value).toBe("₹8.5L");

    // A duplicate report (client retry) changes nothing further.
    const again = await game.reportDelivery(playerId, a.id, { turnIndex: npcLine.index, heardText: "That's" });
    expect(again.turns.at(-1)!.text).toBe("That's a fair point, and the specifics");
    // A report for an older line is ignored.
    const stale = await game.reportDelivery(playerId, a.id, { turnIndex: 0, heardText: "Hi" });
    expect(stale.turns[0].text).toBe(a.turns[0].text);
    expect(analytics.events.filter((e) => e.type === "npc_interrupted")).toHaveLength(1);
  });

  it("a report that matches the whole line is a no-op (nothing was missed)", async () => {
    const game = service(new FakeProvider());
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const t1 = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice");
    const npcLine = t1.attempt.turns.at(-1)!;
    const r = await game.reportDelivery(playerId, a.id, { turnIndex: npcLine.index, heardText: `  ${npcLine.text}  ` });
    expect(r.turns.at(-1)!.interrupted).toBeUndefined();
    expect(r.scene.custom.currentBase).toBe(910000);
  });

  it("an interrupted opening line is recorded as heard and the scene is untouched", async () => {
    const game = service(new FakeProvider());
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const r = await game.submitPlayerTurn(playerId, a.id, "Before you go on, can I ask about the team?", "voice", undefined, { interrupted: { turnIndex: 0, heardText: "Hi, thanks for making time." } });
    expect(r.attempt.turns[0]).toMatchObject({ text: "Hi, thanks for making time.", interrupted: true });
    expect(r.attempt.scene.turnCount).toBe(1);
  });
});

describe("duplicate turn protection", () => {
  it("a retried submission with a stale expectedTurnCount is rejected as a conflict, not appended twice", async () => {
    const game = service(new FakeProvider());
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    await game.submitPlayerTurn(playerId, a.id, "Hi Emma, thanks for the call.", "voice", undefined, { expectedTurnCount: 1 });
    const err = await game.submitPlayerTurn(playerId, a.id, "Hi Emma, thanks for the call.", "voice", undefined, { expectedTurnCount: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(GameError);
    expect((err as GameError).code).toBe("conflict");
    const attempt = await game.getAttempt(playerId, a.id);
    expect(attempt.turns).toHaveLength(3);
  });
});

describe("live-run regressions", () => {
  it("'nine point two then, I accept' is a counter: the scene stays open and what Emma says is what is recorded", async () => {
    // Emma (as the real model did) answers "nine point two it is" although the rules allow less.
    const provider = new FakeProvider({
      scripted: { npc_turn: () => wire("Great, nine point two it is, Asha. I'll send the revised offer today.", { noticed: ["accepted_terms"], wantsToEnd: true }) },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const r = await game.submitPlayerTurn(playerId, a.id, "Fine, nine point two then. I accept.", "voice");
    // Not treated as acceptance of what's on the table (neither the rules' read nor the model's).
    expect(r.attempt.scene.signalCounts.accepted_terms).toBeUndefined();
    expect(r.attempt.scene.custom.accepted).toBe(false);
    // Whatever figure she ends up saying is exactly what the game records.
    const cap = r.attempt.scene.custom.turnCap as number;
    expect(cap).toBeLessThan(920000);
    expect(r.npcText).toBe(`Great, ${spokenRupees(cap).replace(/ lakh$/, "")} it is, Asha. I'll send the revised offer today.`);
    expect(r.attempt.scene.custom.currentBase).toBe(cap);
    expect(r.attempt.visibleStatus[0].value).toBe(formatINR(cap));
    const call = provider.calls.filter((c) => c.task === "npc_turn").at(-1)!;
    expect(call.systemVolatile).toMatch(/That's a counter, not a deal/);
  });

  it("a line that trails off is hesitation, not filler: no patience penalty, and Emma is told to prompt", async () => {
    const provider = new FakeProvider({
      scripted: { npc_turn: () => wire("Around what?", { noticed: ["silence_or_filler", "vague_claim"] }) },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const r = await game.submitPlayerTurn(playerId, a.id, "I was hoping for something around", "voice");
    expect(r.attempt.scene.signalCounts.silence_or_filler).toBeUndefined();
    expect(r.attempt.scene.signalCounts.vague_claim).toBeUndefined();
    expect(r.attempt.scene.patience).toBeGreaterThanOrEqual(a.scene.patience - 1.5);
    const call = provider.calls.filter((c) => c.task === "npc_turn").at(-1)!;
    expect(call.systemVolatile).toMatch(/trailed off mid-thought/);
  });

  it("an over-long reply is cut at the spoken-length ceiling before anything is sent", async () => {
    const provider = new FakeProvider({ scripted: { npc_turn: () => wire("One. Two. Three. Four. Five. Six.", { noticed: [] }) } });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const r = await game.submitPlayerTurn(playerId, a.id, "Tell me about the team.", "voice");
    expect(r.npcText).toBe("One. Two. Three. Four.");
  });
});

describe("live-run regressions, second pass", () => {
  it("never repeats an earlier line: a reply that only repeats is regenerated once", async () => {
    let calls = 0;
    const opening = "Hi Asha, good to speak again. So, the eight and a half lakh base offer for the Platform role — where are you on it?";
    const provider = new FakeProvider({
      scripted: {
        npc_opening: () => wire(opening, {}),
        npc_turn: () => (++calls === 1 ? wire(opening, {}) : wire("Hi. Take your time.", {})),
      },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const streamed: string[] = [];
    const r = await game.submitPlayerTurn(playerId, a.id, "Hi.", "voice", (s) => streamed.push(s));
    expect(r.npcText).toBe("Hi. Take your time.");
    expect(streamed.join(" ")).not.toMatch(/eight and a half lakh base offer/);
    expect(calls).toBe(2);
    const call = provider.calls.filter((c) => c.task === "npc_turn").at(-1)!;
    expect(call.systemVolatile).toMatch(/about to repeat something you already said/);
  });

  it("a character who audibly walks out ends the scene, even early, and it counts as walking out", async () => {
    const provider = new FakeProvider({
      scripted: {
        npc_turn: (req) =>
          req.messages.filter((m) => m.role === "user").length <= 1
            ? wire("Twelve is not happening at this level. What's driving that number?", { noticed: ["aggressive_tone", "ultimatum"] })
            : wire("I'm not here to waste anyone's time. If twelve is a hard line, then we're done here. I wish you the best.", { noticed: ["aggressive_tone", "ultimatum"] }),
      },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    let r = await game.submitPlayerTurn(playerId, a.id, "This offer is an insult. Twelve lakh, take it or leave it.", "voice");
    if (!r.attempt.scene.ended) r = await game.submitPlayerTurn(playerId, a.id, "You're wasting my time. Take it or leave it.", "voice");
    expect(r.attempt.scene.ended?.by).toBe("npc");
    expect(r.attempt.scene.patience).toBe(0);
    expect(r.attempt.scene.turnCount).toBeLessThan(4); // before minTurns
    const done = await game.concludeQuest(playerId, a.id);
    expect(done.result?.outcomeId).toBe("walked_away");
  });

  it("the offer she made in her own words is what the player accepts", async () => {
    let turn = 0;
    const provider = new FakeProvider({
      scripted: {
        npc_turn: () =>
          ++turn === 1
            ? wire("That's a real result. I can meet you partway — nine point two.", { noticed: ["evidence_provided"] })
            : wire("Great. Nine point two lakh base it is. I'll send it over today.", { noticed: ["accepted_terms"] }),
      },
    });
    const game = service(provider);
    const a = await game.startQuest(playerId, "counter_offer", "voice");
    const t1 = await game.submitPlayerTurn(playerId, a.id, EVIDENCE_LINE, "voice");
    const cap = t1.attempt.scene.custom.turnCap as number;
    const said = cap >= 920000 ? 920000 : cap;
    expect(t1.attempt.scene.custom.currentBase).toBe(said);
    const t2 = await game.submitPlayerTurn(playerId, a.id, "Okay, I accept.", "voice");
    expect(t2.attempt.scene.custom.accepted).toBe(true);
    expect(t2.attempt.scene.custom.currentBase).toBe(said);
    expect(t2.npcText.toLowerCase()).toContain(spokenRupees(said).replace(" lakh", ""));
  });
});
