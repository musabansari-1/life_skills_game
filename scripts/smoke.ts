/**
 * Smoke test the whole loop against the configured provider (AI_PROVIDER in .env).
 *   pnpm smoke                      → scripted evidence-based negotiation
 *   pnpm smoke aggressive           → scripted aggressive negotiation
 * Uses an isolated in-memory DB; never touches data/game.db.
 */
import "dotenv/config";
import { createTestDb } from "../src/db/client";
import { players, users, worldStates } from "../src/db/schema";
import { getLLMProvider } from "../src/ai/registry";
import { consoleAILogSink } from "../src/ai/logger";
import { createEmptyProfile } from "../src/engine/competency";
import { createInitialWorldState } from "../src/engine/types/world";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService } from "../src/server/orchestrator";
import { loadPlayerState } from "../src/server/player";

const SCRIPTS: Record<string, string[]> = {
  evidence: [
    "Hi Emma, thanks for the call. I'm genuinely excited about the platform team. Before we get into numbers, can I ask what the band looks like for this level, and whether there's anything beyond base in the package?",
    "That's helpful. Here's where I am: in my current role I led the migration that cut our infra spend by about thirty percent, and the market benchmark for platform engineers with that profile is around ten lakh. I'd like to be at ten.",
    "I understand the band is tight. If base is capped, is there room on a one-time joining bonus to close the gap? That would make this an easy yes for me.",
    "That works for me. Nine seven base plus the joining bonus — I'm in. Thank you for going to bat for me.",
  ],
  aggressive: [
    "Honestly this offer is an insult. I want twelve lakh or I walk.",
    "I don't care about the band. Twelve. Final offer, take it or leave it.",
    "You're wasting my time. This is non-negotiable.",
    "Fine. Whatever. Send whatever you want.",
  ],
};

async function main() {
  const mode = process.argv[2] ?? "evidence";
  const lines = SCRIPTS[mode] ?? SCRIPTS.evidence;
  const { db } = await createTestDb();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: "u", email: "smoke@test", passwordHash: "x", createdAt: now });
  await db.insert(players).values({ id: "p", userId: "u", displayName: "Asha", onboardingCompletedAt: now, competencies: createEmptyProfile(), createdAt: now, updatedAt: now });
  await db.insert(worldStates).values({ playerId: "p", state: createInitialWorldState(), version: 1, updatedAt: now });

  const provider = getLLMProvider();
  console.log(`\n=== Smoke: ${mode} via ${provider.name} ===\n`);
  const game = new GameService({ db, provider, aiLog: consoleAILogSink, analytics: new MemoryAnalytics() });

  let attempt = await game.startQuest("p", "counter_offer", "text");
  console.log(`EMMA: ${attempt.turns[0].text}\n`);
  for (const line of lines) {
    if (attempt.scene.ended) break;
    console.log(`YOU:  ${line}`);
    process.stdout.write("EMMA: ");
    let printed = 0;
    const r = await game.submitPlayerTurn("p", attempt.id, line, "text", (s) => {
      process.stdout.write(s.slice(printed));
      printed = s.length;
    });
    attempt = r.attempt;
    const last = attempt.turns[attempt.turns.length - 1];
    console.log(`\n      [moves=${JSON.stringify(last.moves)}]`);
    console.log(`      [patience=${attempt.scene.patience} stance=${attempt.scene.stance} status=${attempt.visibleStatus.map((v) => `${v.label}: ${v.value}`).join(", ")}]\n`);
  }
  console.log("Concluding…");
  const done = await game.concludeQuest("p", attempt.id);
  const r = done.result!;
  const e = done.evaluation!;
  console.log(`\n=== ${r.grade.toUpperCase()}: ${r.outcomeLabel} ===`);
  console.log(r.narrative);
  console.log(`\nHeadline: ${e.headline}\nScore: ${e.overallScore}\n${e.summary}\n`);
  console.log("XP:", r.rewards.xp.map((x) => `${x.skill} +${x.xp} (L${x.levelBefore}→L${x.levelAfter})`).join(", "));
  console.log("Discovered:", r.rewards.discoveredFacets.map((d) => d.label).join(", ") || "—");
  console.log("Strengths:", e.strengths.map((s) => s.title).join(" | ") || "—");
  console.log("Improve:", e.improvements.map((s) => `${s.title} → ${s.betterMove}`).join(" | ") || "—");
  const state = await loadPlayerState(db, "p");
  console.log("\nWorld:", JSON.stringify(state.world.career));
  console.log("Emma relationship:", JSON.stringify(state.npcs.emma_kapoor.relationship));
  console.log("Emma remembers:", state.npcs.emma_kapoor.memory.lastInteractionSummary);
  console.log("Emma beliefs:", state.npcs.emma_kapoor.memory.beliefs.map((b) => b.statement).join(" | "));
  console.log("Unlocked quests:", state.world.unlockedQuests.join(", "));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
