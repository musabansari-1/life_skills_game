/**
 * Targeted live playtest of the V1 Career City encounters against the configured
 * provider (AI_PROVIDER in .env.local). Isolated in-memory DB; never touches game data.
 *   npx tsx scripts/v1-live-playtest.ts                 → all scenes
 *   npx tsx scripts/v1-live-playtest.ts meet_maya,the_review
 *   SKIP_CONCLUDE=1 …                                     → scene only (no evaluation cost)
 * Always pass --env-file=.env.local to tsx so the provider settings load before the env module parses.
 * Lines are natural paraphrases, not the offline fixture phrasings, so semantic reading is exercised.
 */
// Run with: npx tsx --env-file=.env.local scripts/v1-live-playtest.ts (env must load before src/lib/env parses it).
import { createTestDb } from "../src/db/client";
import { getLLMProvider } from "../src/ai/registry";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";
import { GameService } from "../src/server/orchestrator";
import { registerAccount, onboardPlayer } from "../src/server/account";
import { loadPlayerState, saveWorldState, saveNpcState } from "../src/server/player";
import { findQuest } from "../src/content/quests";
import { CAREER_MILESTONES } from "../src/engine/campaign";
import { sceneEvidence } from "../src/engine/scene/ensemble";
import { getOrCreateNpcState } from "../src/server/player";

const SCENES: Record<string, { flags?: string[]; grades?: Record<string, "success" | "partial" | "failure">; trust?: Record<string, number>; lines: string[] }> = {
  meet_maya: { lines: [
    "Hey Maya, sorry to interrupt. I went through the runner docs and walked one batch by hand, but I can't work out what actually kicks off a rollback. Could I grab ten minutes whenever your verification run is done?",
    "Also, honest question: has that rollback ever been exercised against real production volumes?",
    "That's really useful, thanks. I'll write up what I learn so the next person doesn't have to bug you.",
  ] },
  nora_requirements: { lines: [
    "Happy to help. Before I put a number on it, what's the problem Meridian is actually trying to fix? Who would be looking at these dashboards?",
    "Got it, so it's really about the finance team not having to redo the month-end export by hand. Is that right?",
    "Then could we start with an automated export that refreshes before their close, and treat the real-time dashboard as a later phase? The export is days of work; the dashboard is more like a quarter.",
  ] },
  customer_escalation: { flags: ["nova_labs.rushed_migration", "chapter1.owned_incident", "chapter1.complete"], lines: [
    "Vikram, I'll give it to you straight. Our migration broke about three thousand of your records, we restored them by Monday, and the gap in our release process was mine.",
    "Before I promise anything, what does your team most need from us around month-end?",
    "Then here's what I can commit to: no changes to your environment during close week, and I'll personally verify the reconciliation export on the twenty-eighth, with a go or no-go call with your team that afternoon.",
  ] },
  mentor_arjun: { lines: [
    "Hey Arjun, got a minute? No rush on anything. How's the first ticket treating you?",
    "For what it's worth, in my first month I took down staging for half a day. Everyone breaks something. What's actually going on?",
    "Okay, thanks for telling me. What would you want to try first?",
    "Sounds right. Want to pair on it for an hour at four? And you tell Maya yourself afterwards.",
  ] },
  feedback_for_rohan: { trust: { rohan_mehta: 20 }, lines: [
    "Okay, one real thing. When the Friday migration date got agreed upstairs, Maya ended up spending her whole weekend on the restore.",
    "I know your director is leaning on you for dates, and that's not easy.",
    "Could you check capacity with the team before you commit a date upstairs? And I'll make sure you get a real estimate from me early enough to use it.",
  ] },
  the_review: { lines: [
    "I'd like to lead the next phase of the Meridian work. In the crisis room I owned the estimate and got Nora and Maya to a plan they could both live with.",
    "To make it work, I'd want Maya's verification time agreed up front, and a proper review at the end of the quarter.",
  ] },
};
const BANNED = /great question|that's a great point|i appreciate your honesty|i understand your concern|absolutely|certainly|i hear you|let me explain|to be transparent/i;

async function main() {
  const only = process.argv[2]?.split(",");
  const provider = getLLMProvider();
  if (provider.name === "fake" && !process.env.ALLOW_FAKE) throw new Error("Live playtest resolved the fake provider. Run with --env-file=.env.local (or ALLOW_FAKE=1).");
  console.log(`provider=${provider.name} model=${process.env.AI_MODEL ?? "(default)"}`);
  const { db } = await createTestDb();
  const summary: Record<string, unknown>[] = [];
  for (const [questId, spec] of Object.entries(SCENES).filter(([id]) => !only || only.includes(id))) {
    const acct = await registerAccount(db, { email: `${questId}_${Date.now()}@live.local`, password: "live-playtest-only" });
    const playerId = acct.player.playerId;
    await onboardPlayer(db, playerId, { displayName: "Asha" });
    const state = await loadPlayerState(db, playerId);
    const w = state.world;
    w.career = { ...w.career, status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: 920000, signingBonus: 40000 };
    w.flags.push("nova_labs.joined", ...(spec.flags ?? []));
    w.unlockedLocations.push("career_city.nova_labs_platform", "career_city.nova_labs_product", "career_city.meridian_room");
    w.unlockedQuests.push("push_back_on_deadline", "status_update");
    w.peopleMet.push("emma_kapoor", "rohan_mehta");
    CAREER_MILESTONES.slice(0, CAREER_MILESTONES.indexOf(questId) < 0 ? 0 : CAREER_MILESTONES.indexOf(questId)).forEach((id, i) => {
      const q = findQuest(id)!;
      const o = q.outcomes.find((x) => x.grade === (spec.grades?.[id] ?? "success"))!;
      const rec = { questId: id, attemptId: `seed_${id}`, outcomeId: o.id, at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z` };
      (o.grade === "failure" ? w.failedQuests : w.completedQuests).push(rec);
      w.campaign.milestones[id] = { attemptId: rec.attemptId, grade: o.grade, outcomeId: o.id };
    });
    await saveWorldState(db, playerId, w);
    for (const [npcId, trust] of Object.entries(spec.trust ?? {})) { const n = getOrCreateNpcState(await loadPlayerState(db, playerId), npcId); n.relationship.trust = trust; n.timesMet = 3; await saveNpcState(db, playerId, n); }

    const game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics() });
    console.log(`\n=== ${questId} (${findQuest(questId)!.title})`);
    const t0 = Date.now();
    let a = await game.startQuest(playerId, questId, "text");
    console.log(`  ${a.turns[0].identity?.name ?? findQuest(questId)!.npcId}: ${a.turns[0].text}`);
    const npcLines: string[] = [];
    for (const line of spec.lines) {
      if (a.scene.ended) break;
      const t = Date.now();
      if (process.env.PACE_MS) await new Promise((r) => setTimeout(r, Number(process.env.PACE_MS))); // respect free-tier per-minute caps
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        try { a = (await game.submitPlayerTurn(playerId, a.id, line, "text")).attempt; sent = true; }
        catch (e) { console.log(`  !! turn failed (try ${attempt + 1}): ${(e as Error).message.slice(0, 120)}`); await new Promise((r) => setTimeout(r, 6000)); }
      }
      if (!sent) continue;
      const npc = a.turns.at(-1)!;
      const fresh = sceneEvidence(a.scene).filter((e) => e.turnIndex === a.turns.at(-2)!.index).map((e) => e.feature);
      console.log(`  You: ${line}\n    [read: ${fresh.join(", ") || "—"}] (${((Date.now() - t) / 1000).toFixed(1)}s)\n  ${npc.identity?.name ?? "NPC"}: ${npc.text}`);
      npcLines.push(npc.text);
      if (a.scene.custom._reaction && !a.scene.ended) { a = await game.continueEnsemble(playerId, a.id, a.turns.length); const r = a.turns.at(-1)!; console.log(`  ${r.identity?.name} (reaction): ${r.text}`); npcLines.push(r.text); }
    }
    const words = npcLines.map((l) => l.split(/\s+/).length);
    const report: Record<string, unknown> = { questId, revealed: a.scene.revealed, avgWords: Math.round(words.reduce((x, y) => x + y, 0) / Math.max(1, words.length)), maxWords: Math.max(0, ...words), banned: npcLines.filter((l) => BANNED.test(l)), sceneSeconds: Math.round((Date.now() - t0) / 1000) };
    if (!process.env.SKIP_CONCLUDE) {
      const tc = Date.now();
      try {
        const done = await game.concludeQuest(playerId, a.id);
        report.outcome = done.result?.outcomeId; report.grade = done.result?.grade; report.headline = done.evaluation?.headline; report.concludeSeconds = Math.round((Date.now() - tc) / 1000);
        console.log(`  → ${done.result?.outcomeLabel} (${done.result?.grade}) — "${done.evaluation?.headline}" [${report.concludeSeconds}s]`);
        console.log(`    feedback: ${done.evaluation?.summary}`);
      } catch (e) { report.concludeError = (e as Error).message; console.log(`  !! conclude failed: ${(e as Error).message}`); }
    }
    summary.push(report);
  }
  console.log("\nSUMMARY " + JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
