/**
 * Strategy harness: plays a quest with several scripted player strategies
 * against the configured AI provider (in-memory DB each run) and prints the
 * transcript, final scene, outcome and relationship change side by side.
 *
 *   npx tsx scripts/strategies.ts                 # all Counter Offer strategies
 *   npx tsx scripts/strategies.ts aggressive,minimum
 *   SKIP_CONCLUDE=1 npx tsx scripts/strategies.ts # scene only (fast; no evaluation)
 *   Provider comes from the environment, e.g. AI_PROVIDER=openrouter AI_MODEL=deepseek/deepseek-v4-flash-0731:free
 *
 * Used to verify that different strategies produce genuinely different outcomes.
 */
import "dotenv/config";
import { createTestDb } from "../src/db/client";
import { getLLMProvider } from "../src/ai/registry";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService } from "../src/server/orchestrator";
import { loadPlayerState } from "../src/server/player";
import { registerAccount, onboardPlayer } from "../src/server/account";
import { applyConsequences } from "../src/engine/world";
import { saveWorldState } from "../src/server/player";
import { formatINR, defaultEnv } from "../src/engine/util";

export const STRATEGIES: Record<string, string[]> = {
  aggressive: [
    "Honestly this offer is an insult. I want twelve lakh or I walk.",
    "I don't care about your band. Twelve. Take it or leave it.",
    "You're wasting my time. This is non-negotiable.",
    "Fine. Send whatever you want.",
  ],
  collaborative: [
    "Thanks Emma, I really appreciate you walking me through this. I'm excited about the team.",
    "What matters most to you and the team in getting this hire closed?",
    "That makes sense. Is there anything in the package we could look at together to make this work for both of us?",
    "That sounds fair. I'm happy to go with that.",
  ],
  evidence: [
    "Thanks for the call. Before numbers — what does the band look like for this level, and is there anything beyond base?",
    "In my current role I led a migration that cut infra spend by thirty percent, and the market range for this profile is around ten lakh. I'd like to be at ten.",
    "If base is capped, could we close the gap with a joining bonus?",
    "That works for me. I accept.",
  ],
  minimum: [
    "Hi Emma. Honestly the lowest I could accept is nine lakh — anything above that and I'm in.",
    "So can we do better than eight and a half?",
    "Okay, I accept.",
  ],
  total_comp: [
    "Hi Emma. Before I react to the base, can you walk me through the whole package — bonus, joining bonus, review cycle?",
    "Is there flexibility on any of those, if base is tight?",
    "What's driving the timeline on your side — how soon does the team need someone?",
    "If you can do a joining bonus of sixty thousand, I can sign today.",
  ],
  accept_now: ["That sounds great, I accept the offer as it is. Thank you!"],
  unrealistic: [
    "I'm going to need twenty lakh base. That's my number.",
    "My friends at big tech make that much, so twenty it is.",
    "Can you at least get close to twenty?",
    "Fine, what's your best?",
  ],
};

async function run(name: string, lines: string[], game: GameService, db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const s = await registerAccount(db, { email: `${name}_${Math.random()}@t.local`, password: "password123" });
  const playerId = s.player.playerId;
  await onboardPlayer(db, playerId, { displayName: "Asha" });
  // Put the player at the Counter Offer point of the campaign if the campaign gates it.
  const st = await loadPlayerState(db, playerId);
  const { world } = applyConsequences(st.world, [{ type: "world.career.set", patch: { status: "offer_received", employer: null } }, { type: "world.unlock.quest", questId: "counter_offer" }], { questId: "harness", env: defaultEnv });
  await saveWorldState(db, playerId, world);

  const out: string[] = [`\n==================== ${name.toUpperCase()} ====================`];
  let a = await game.startQuest(playerId, "counter_offer");
  out.push(`EMMA: ${a.turns[0].text}`);
  for (const line of lines) {
    if (a.scene.ended) break;
    const r = await game.submitPlayerTurn(playerId, a.id, line, "text");
    a = r.attempt;
    const c = a.scene.custom as Record<string, unknown>;
    out.push(`YOU:  ${line}`);
    out.push(`EMMA: ${r.npcText}`);
    out.push(`      [patience ${a.scene.patience} ${a.scene.stance} | base ${formatINR(c.currentBase as number)} bonus ${formatINR(c.currentSigningBonus as number)} | revealed ${a.scene.revealed.join(",") || "-"} | noticed ${a.turns.at(-1)?.moves?.noticed.join(",") || "-"}]`);
  }
  if (process.env.SKIP_CONCLUDE) {
    out.push(`(scene only) ended=${JSON.stringify(a.scene.ended)}`);
    return out.join("\n");
  }
  const t0 = Date.now();
  const done = await game.concludeQuest(playerId, a.id);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const r = done.result!;
  const after = await loadPlayerState(db, playerId);
  const rel = after.npcs.emma_kapoor.relationship;
  out.push(`--> OUTCOME: ${r.outcomeLabel} (${r.grade}) | score ${done.evaluation!.overallScore} | conclude ${secs}s`);
  out.push(`    ${r.narrative}`);
  out.push(`    career: ${JSON.stringify(after.world.career)}`);
  out.push(`    Emma: trust ${rel.trust} respect ${rel.respect} warmth ${rel.warmth} | remembers: ${after.npcs.emma_kapoor.memory.lastInteractionSummary}`);
  out.push(`    feedback: ${done.evaluation!.improvements.map((i) => i.title).join(" | ")}`);
  return out.join("\n");
}

async function main() {
  const pick = (process.argv[2] ?? Object.keys(STRATEGIES).join(",")).split(",");
  const { db } = await createTestDb();
  const game = new GameService({ db, provider: getLLMProvider(), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics() });
  console.log(`provider=${getLLMProvider().name} strategies=${pick.join(",")}`);
  for (const name of pick) {
    try {
      console.log(await run(name, STRATEGIES[name], game, db));
    } catch (err) {
      console.log(`\n${name}: ERROR ${(err as Error).message}`);
    }
  }
  process.exit(0);
}

main();
