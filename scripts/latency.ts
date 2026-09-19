/**
 * Latency probe for the conversation loop against the configured provider.
 * Measures, per NPC turn:
 *   - model first token   (provider stream → first delta)
 *   - first speakable     (first gated sentence handed to the client; what TTS can start on)
 *   - total turn          (reply committed)
 *   - words / sentences   (spoken length)
 * and, for the conclusion, time to each progress stage.
 *
 *   npx tsx --env-file=.env.local scripts/latency.ts
 *   npx tsx --env-file=.env.local scripts/latency.ts 3     # repeat 3 times
 */
import "dotenv/config";
import { createTestDb } from "../src/db/client";
import { getLLMProvider } from "../src/ai/registry";
import type { LLMProvider } from "../src/ai/provider";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService } from "../src/server/orchestrator";
import { loadPlayerState, saveWorldState } from "../src/server/player";
import { onboardPlayer, registerAccount } from "../src/server/account";
import { splitSentences } from "../src/engine/parsing/sentences";

const LINES = [
  "Thanks for the call. Before numbers, what does the band look like, and is there anything beyond base?",
  "In my current role I led a migration that cut infra spend by 30%, and the market range is ten lakh. I'd like ten lakh.",
  "If base is capped, could we close the gap with a joining bonus?",
];

/** Wraps a provider to timestamp the first streamed token of each call. */
function instrument(inner: LLMProvider, marks: { firstToken: number | null }): LLMProvider {
  return {
    name: inner.name,
    complete: (req) => inner.complete(req),
    stream: (req, onDelta) => {
      const started = Date.now();
      let seen = false;
      return inner.stream(req, (d) => {
        if (!seen && d.trim()) {
          seen = true;
          marks.firstToken = Date.now() - started;
        }
        onDelta(d);
      });
    },
  };
}

async function once(runIndex: number) {
  const { db } = await createTestDb();
  const log = new MemoryAILogSink();
  const marks = { firstToken: null as number | null };
  const game = new GameService({ db, provider: instrument(getLLMProvider(), marks), aiLog: log, analytics: new MemoryAnalytics() });
  const s = await registerAccount(db, { email: `lat_${Date.now()}_${runIndex}@t.local`, password: "password123" });
  await onboardPlayer(db, s.player.playerId, { displayName: "Asha" });
  const st = await loadPlayerState(db, s.player.playerId);
  st.world.career.status = "offer_received";
  st.world.unlockedQuests.push("counter_offer");
  await saveWorldState(db, s.player.playerId, st.world);

  const t0 = Date.now();
  const a = await game.startQuest(s.player.playerId, "counter_offer");
  console.log(`opening line: ${Date.now() - t0} ms (model first token ${marks.firstToken} ms), ${a.turns[0].text.split(/\s+/).length} words`);
  const rows: { firstToken: number | null; firstSpeakable: number; total: number; words: number; sentences: number }[] = [];
  for (const line of LINES) {
    marks.firstToken = null;
    const start = Date.now();
    let first = 0;
    const r = await game.submitPlayerTurn(s.player.playerId, a.id, line, "text", (speech) => {
      if (!first && speech.trim()) first = Date.now() - start;
    });
    const row = { firstToken: marks.firstToken, firstSpeakable: first, total: Date.now() - start, words: r.npcText.split(/\s+/).length, sentences: splitSentences(r.npcText).length };
    rows.push(row);
    console.log(`turn: model first token ${row.firstToken} ms, first speakable sentence ${row.firstSpeakable} ms, total ${row.total} ms, ${row.words} words / ${row.sentences} sentences`);
  }
  const cStart = Date.now();
  const stages: string[] = [];
  await game.concludeQuest(s.player.playerId, a.id, (stage) => stages.push(`${stage}@${((Date.now() - cStart) / 1000).toFixed(1)}s`));
  console.log(`conclude: ${((Date.now() - cStart) / 1000).toFixed(1)} s  [${stages.join(", ")}]`);
  console.log("ai calls:", log.entries.map((e) => `${e.task}:${e.latencyMs}ms${e.ok ? "" : "(fail)"}${e.problems?.length ? `[${e.problems.join(";").slice(0, 60)}]` : ""}`).join(" "));
  return rows;
}

async function main() {
  const repeats = Math.max(1, parseInt(process.argv[2] ?? "1", 10) || 1);
  const all: Awaited<ReturnType<typeof once>> = [];
  for (let i = 0; i < repeats; i++) all.push(...(await once(i)));
  if (all.length > 1) {
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(
      `\nmedian over ${all.length} turns: model first token ${med(all.map((r) => r.firstToken ?? 0))} ms, first speakable ${med(all.map((r) => r.firstSpeakable))} ms, total ${med(all.map((r) => r.total))} ms, ${med(all.map((r) => r.words))} words`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
