/**
 * Real-model conversation scenarios for the realtime layer. Plays The Counter
 * Offer against the configured provider (in-memory DB per scenario) and prints,
 * for each: the transcript as the player heard it, the recorded offer, speech
 * gate events, Emma's relationship change and the next quest state.
 *
 *   npx tsx --env-file=.env.local scripts/conversation-scenarios.ts            # all
 *   npx tsx --env-file=.env.local scripts/conversation-scenarios.ts interrupt,pause
 *   SKIP_CONCLUDE=1 ... → scene only (no evaluation; fast)
 *
 * Scenario steps are either a player line, or an interruption: the player cuts
 * Emma off after the first N sentences of her last line and then speaks.
 */
import "dotenv/config";
import { createTestDb } from "../src/db/client";
import { getLLMProvider } from "../src/ai/registry";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService, type AttemptView } from "../src/server/orchestrator";
import { loadPlayerState, saveWorldState } from "../src/server/player";
import { onboardPlayer, registerAccount } from "../src/server/account";
import { applyConsequences } from "../src/engine/world";
import { defaultEnv, formatINR } from "../src/engine/util";
import { splitSentences } from "../src/engine/parsing/sentences";

type Step = string | { cutAfterSentences: number; then: string };

const SCENARIOS: Record<string, Step[]> = {
  normal: [
    "Thanks for the call, Emma. Before numbers, what does the band look like for this level?",
    "In my current role I led a migration that cut infra spend by thirty percent, and the market range is around ten lakh. I'd like ten.",
    "If base is capped, could we close the gap with a joining bonus?",
    "That works for me. I accept.",
  ],
  rapid: ["Hi.", "What's the band?", "Okay.", "And bonus?", "Right.", "So what's the most you can do on base?", "Fine, deal."],
  interrupt: [
    "In my current role I led a migration that cut infra spend by thirty percent, and the market range is around ten lakh. I'd like ten.",
    { cutAfterSentences: 1, then: "What about a signing bonus instead?" },
    { cutAfterSentences: 0, then: "Sorry, go on." },
    "Okay, I accept.",
  ],
  pause: [
    "I was hoping for something around",
    "ten lakh. Sorry, I lost my thread there. Ten lakh, based on the market range for this profile.",
    "Okay, that's fair. I accept.",
  ],
  self_correct: [
    "I'd need twelve lakh... no wait, I mean nine point five lakh, sorry.",
    "Yes, nine point five. I led the platform migration last year that cut infra spend by thirty percent.",
    "Okay, I accept.",
  ],
  contradiction: [
    "Honestly the lowest I could accept is nine lakh. Anything above that and I'm in.",
    "Actually I can't go below ten lakh. Ten is my floor.",
    "Fine, nine point two then. I accept.",
  ],
  accept_now: ["That sounds great, I accept the offer as it is. Thank you!"],
  aggressive: ["Honestly this offer is an insult. I want twelve lakh or I walk.", "I don't care about your band. Twelve. Take it or leave it.", "You're wasting my time."],
  discovery: [
    "Before I react to the base, can you walk me through the whole package: bonus, joining bonus, review cycle?",
    "What's driving the timeline on your side? How soon does the team need someone?",
    "Is there another candidate in the running, or is it just me?",
    "If you can do a joining bonus of sixty thousand, I can sign today.",
  ],
  natural_end: [
    "Thanks Emma. I'm excited about the team. Is there any room at all on base?",
    "Understood. Then I'm happy with what's on the table. Let's go ahead.",
    "Thanks for your time, talk soon.",
  ],
};

const skipConclude = process.env.SKIP_CONCLUDE === "1";

async function run(name: string, steps: Step[]) {
  const { db } = await createTestDb();
  const log = new MemoryAILogSink();
  const analytics = new MemoryAnalytics();
  const game = new GameService({ db, provider: getLLMProvider(), aiLog: log, analytics });
  const s = await registerAccount(db, { email: `${name}_${Math.random()}@t.local`, password: "password123" });
  const playerId = s.player.playerId;
  await onboardPlayer(db, playerId, { displayName: "Asha" });
  const st = await loadPlayerState(db, playerId);
  const { world } = applyConsequences(st.world, [{ type: "world.career.set", patch: { status: "offer_received", employer: null } }, { type: "world.unlock.quest", questId: "counter_offer" }], { questId: "harness", env: defaultEnv });
  await saveWorldState(db, playerId, world);
  const before = (await loadPlayerState(db, playerId)).npcs["emma_kapoor"]?.relationship;

  const out: string[] = [`\n==================== ${name.toUpperCase()} ====================`];
  let a: AttemptView = await game.startQuest(playerId, "counter_offer", "voice");
  out.push(`EMMA: ${a.turns[0].text}`);
  const offer = (x: AttemptView) => {
    const c = x.scene.custom as Record<string, number>;
    return `${formatINR(c.currentBase)}${c.currentSigningBonus ? ` + ${formatINR(c.currentSigningBonus)} bonus` : ""}`;
  };
  for (const step of steps) {
    if (a.scene.ended) break;
    let text: string;
    let interrupted: { turnIndex: number; heardText: string } | undefined;
    if (typeof step === "string") text = step;
    else {
      const last = a.turns.at(-1)!;
      const heard = splitSentences(last.text).slice(0, step.cutAfterSentences).join(" ");
      interrupted = { turnIndex: last.index, heardText: heard };
      text = step.then;
      out.push(`   ↯ Asha cuts in after: "${heard || "(nothing)"}"`);
    }
    const t0 = Date.now();
    let first = 0;
    const r = await game.submitPlayerTurn(playerId, a.id, text, "voice", (sp) => {
      if (!first && sp.trim()) first = Date.now() - t0;
    }, { interrupted });
    a = r.attempt;
    const prevNpc = a.turns.at(-3);
    if (prevNpc?.speaker === "npc" && prevNpc.interrupted) out.push(`   (recorded Emma line ${prevNpc.index}: "${prevNpc.text}—" interrupted; offer now ${offer(a)})`);
    out.push(`ASHA: ${text}`);
    out.push(`EMMA: ${r.npcText}   [first sentence ${first} ms, ${Date.now() - t0} ms total, ${r.npcText.split(/\s+/).length} words, ${splitSentences(r.npcText).length} sentences; offer ${offer(a)}; mood ${a.scene.stance}; patience ${a.scene.patience}]`);
  }
  const gated = analytics.events.filter((e) => e.type === "npc_speech_gated");
  const cuts = analytics.events.filter((e) => e.type === "npc_interrupted");
  out.push(`scene: ${a.scene.ended ? `ended by ${a.scene.ended.by} — ${a.scene.ended.reason}` : "still open"}; final offer ${offer(a)}; revealed [${a.scene.revealed.join(", ")}]; signals ${JSON.stringify(a.scene.signalCounts)}`);
  out.push(`speech gate events: ${gated.length}${gated.length ? " " + JSON.stringify(gated.map((g) => g.payload.reasons)) : ""}; interruptions recorded: ${cuts.length}`);
  if (!skipConclude) {
    const c0 = Date.now();
    const done = await game.concludeQuest(playerId, a.id);
    const after = (await loadPlayerState(db, playerId));
    const rel = after.npcs["emma_kapoor"]?.relationship;
    out.push(`outcome: ${done.result?.outcomeLabel} (${done.result?.grade}) in ${((Date.now() - c0) / 1000).toFixed(1)} s; score ${done.evaluation?.overallScore}`);
    out.push(`relationship Emma: trust ${before?.trust ?? 0}→${rel?.trust}, respect ${before?.respect ?? 0}→${rel?.respect}, warmth ${before?.warmth ?? 0}→${rel?.warmth}`);
    out.push(`career: ${after.world.career.status}${after.world.career.baseSalary ? ` @ ${formatINR(after.world.career.baseSalary)}` : ""}; next unlocked: ${done.result?.rewards.unlockedQuestIds.join(", ") || "(none)"}; memory summary: ${after.npcs["emma_kapoor"]?.memory.lastInteractionSummary ?? ""}`);
  }
  out.push(`ai calls: ${log.entries.map((e) => `${e.task}:${e.latencyMs}ms${e.problems?.length ? `(${e.problems.join("; ").slice(0, 80)})` : ""}`).join(" | ")}`);
  console.log(out.join("\n"));
}

async function main() {
  const wanted = process.argv[2]?.split(",").filter(Boolean) ?? Object.keys(SCENARIOS);
  for (const name of wanted) {
    if (!SCENARIOS[name]) {
      console.error(`unknown scenario ${name}`);
      continue;
    }
    await run(name, SCENARIOS[name]);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
