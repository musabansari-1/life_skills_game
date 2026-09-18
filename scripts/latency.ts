/**
 * Latency probe for the conversation loop against the configured provider.
 * Measures, per NPC turn: time to first speech (what the player perceives) and
 * total turn time; and, for the conclusion: time to each progress stage.
 *
 *   AI_PROVIDER=openrouter AI_MODEL=... npx tsx scripts/latency.ts
 */
import "dotenv/config";
import { createTestDb } from "../src/db/client";
import { getLLMProvider } from "../src/ai/registry";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService } from "../src/server/orchestrator";
import { loadPlayerState, saveWorldState } from "../src/server/player";
import { onboardPlayer, registerAccount } from "../src/server/account";

const LINES = [
  "Thanks for the call. Before numbers, what does the band look like, and is there anything beyond base?",
  "In my current role I led a migration that cut infra spend by 30%, and the market range is ten lakh. I'd like ten lakh.",
  "If base is capped, could we close the gap with a joining bonus?",
];

async function main() {
  const { db } = await createTestDb();
  const log = new MemoryAILogSink();
  const game = new GameService({ db, provider: getLLMProvider(), aiLog: log, analytics: new MemoryAnalytics() });
  const s = await registerAccount(db, { email: `lat_${Date.now()}@t.local`, password: "password123" });
  await onboardPlayer(db, s.player.playerId, { displayName: "Asha" });
  const st = await loadPlayerState(db, s.player.playerId);
  st.world.career.status = "offer_received";
  st.world.unlockedQuests.push("counter_offer");
  await saveWorldState(db, s.player.playerId, st.world);

  const t0 = Date.now();
  const a = await game.startQuest(s.player.playerId, "counter_offer");
  console.log(`opening line: ${Date.now() - t0} ms`);
  for (const line of LINES) {
    const start = Date.now();
    let first = 0;
    const r = await game.submitPlayerTurn(s.player.playerId, a.id, line, "text", (speech) => {
      if (!first && speech.trim()) first = Date.now() - start;
    });
    const words = r.npcText.split(/\s+/).length;
    console.log(`turn: first speech ${first} ms, total ${Date.now() - start} ms, ${words} words`);
  }
  const cStart = Date.now();
  const stages: string[] = [];
  await game.concludeQuest(s.player.playerId, a.id, (stage) => stages.push(`${stage}@${((Date.now() - cStart) / 1000).toFixed(1)}s`));
  console.log(`conclude: ${((Date.now() - cStart) / 1000).toFixed(1)} s  [${stages.join(", ")}]`);
  console.log("ai calls:", log.entries.map((e) => `${e.task}:${e.latencyMs}ms${e.ok ? "" : "(fail)"}`).join(" "));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
