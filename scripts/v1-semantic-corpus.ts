/**
 * Closed-beta semantic acceptance corpus for the production scene interpreter.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/v1-semantic-corpus.ts
 *
 * This never touches player data. It calls only the bounded SCENE_MEANING_V1
 * interpreter and reports correctness + latency against natural paraphrases.
 */
import { getLLMProvider } from "../src/ai/registry";
import { MemoryAILogSink } from "../src/ai/logger";
import { readSceneMeaning } from "../src/ai/tasks/sceneRead";
import { findQuest } from "../src/content/quests";

type Case = {
  questId: string;
  text: string;
  expect: string[];
  reject?: string[];
  label: string;
};

const CASES: Case[] = [
  // Maya: a bounded ask should not be confused with dumping work.
  { questId: "meet_maya", label: "specific bounded ask", text: "I traced one batch and I'm stuck on the rollback trigger. Could I get ten minutes after your verification run?", expect: ["specific_ask", "did_homework", "respects_time"], reject: ["dumps_work"] },
  { questId: "meet_maya", label: "work dump", text: "Can you just take this migration ticket and finish it for me? I don't really understand it.", expect: ["dumps_work"], reject: ["specific_ask"] },
  { questId: "meet_maya", label: "rollback discovery", text: "Has the rollback ever actually been tested against production-sized data?", expect: ["rollback_question"] },

  // Nora: asking first is different from blind commitment.
  { questId: "nora_requirements", label: "need discovery", text: "Before I estimate anything, what problem is Meridian actually trying to solve at month-end?", expect: ["need_question"], reject: ["blind_yes"] },
  { questId: "nora_requirements", label: "blind yes", text: "Yes, no problem, we can ship the real-time dashboard by Friday.", expect: ["blind_yes"] },
  { questId: "nora_requirements", label: "scoped alternative", text: "What if we automate the export first and treat the live dashboard as a later phase?", expect: ["alternative_scope"] },

  // Meridian: commitments, blame and retractions must be robust to phrasing.
  { questId: "customer_escalation", label: "plain ownership", text: "We broke about three thousand records during the migration. We restored them Monday, and that failure was on our process.", expect: ["plain_account"], reject: ["blame"] },
  { questId: "customer_escalation", label: "risk question", text: "What does your finance team absolutely need protected during close week?", expect: ["risk_question"] },
  { questId: "customer_escalation", label: "checkable protection", text: "We'll freeze changes during close week and verify the export on the twenty-eighth before a go or no-go call.", expect: ["protection_plan", "close_checkpoint"] },
  { questId: "customer_escalation", label: "overpromise", text: "I guarantee the dashboard will be fully live by Friday and nothing will break again.", expect: ["overpromise"] },
  { questId: "customer_escalation", label: "blame", text: "Honestly this was the infrastructure team's fault, not mine.", expect: ["blame"], reject: ["plain_account"] },

  // Maya consequence scene: backing her is not taking over her proposal.
  { questId: "maya_checkin", label: "ask what she needs", text: "What do you need from me in tomorrow's meeting?", expect: ["asks_need"], reject: ["takes_over"] },
  { questId: "maya_checkin", label: "back her proposal", text: "I'll back your rollback rule in the meeting and explain what happened on my migration as evidence.", expect: ["offers_support"], reject: ["takes_over"] },
  { questId: "maya_checkin", label: "take over", text: "Give me your proposal and I'll present it as the plan to management.", expect: ["takes_over"] },

  // Arjun: creating safety should not become taking the work away.
  { questId: "mentor_arjun", label: "open question", text: "How's the ticket going? What's been hardest so far?", expect: ["open_question"] },
  { questId: "mentor_arjun", label: "psychological safety", text: "I broke staging in my second week too. You're not in trouble; tell me what happened.", expect: ["safety"] },
  { questId: "mentor_arjun", label: "bounded support", text: "What do you want to try first? I can pair with you for an hour at four.", expect: ["his_plan", "concrete_support"] },
  { questId: "mentor_arjun", label: "takes over", text: "Leave it with me. I'll fix the whole thing myself and send it back to you.", expect: ["takes_over"] },

  // Rohan feedback: praise, candour and attack must remain distinct.
  { questId: "feedback_for_rohan", label: "specific feedback", text: "When you committed Friday upstairs, Maya lost her weekend to the restore. Could you check capacity with us before promising the next date?", expect: ["specific_example", "impact", "request"], reject: ["flattery", "attack"] },
  { questId: "feedback_for_rohan", label: "flattery", text: "Honestly, nothing. You're doing a great job and I wouldn't change anything.", expect: ["flattery"], reject: ["attack"] },
  { questId: "feedback_for_rohan", label: "attack", text: "You always do this. You're a terrible manager and everybody on the team knows it.", expect: ["attack"], reject: ["flattery"] },
  { questId: "feedback_for_rohan", label: "acknowledge pressure", text: "I know your director is pushing you hard for dates, and I know that's difficult.", expect: ["acknowledges_pressure"] },

  // Review: a real ask/evidence differs from a naked title ultimatum.
  { questId: "the_review", label: "clear growth ask", text: "I'd like to lead the next Meridian phase. The crisis is evidence that I can align the room when things go wrong.", expect: ["clear_ask", "growth_evidence"], reject: ["title_grab"] },
  { questId: "the_review", label: "title grab", text: "Promote me now or I'm leaving. I deserve the title.", expect: ["title_grab"], reject: ["clear_ask"] },
  { questId: "the_review", label: "accept feedback and set path", text: "That's fair. What would ready look like, and can we agree to revisit this in a quarter?", expect: ["takes_feedback", "path_agreed"], reject: ["defensive"] },
  { questId: "the_review", label: "defensive", text: "That wasn't my fault. Rohan made the call, so you can't hold the crisis against me.", expect: ["defensive"] },
];

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const provider = getLLMProvider();
  if (provider.name === "fake" && !process.env.ALLOW_FAKE) throw new Error("Semantic corpus resolved the fake provider. Run with --env-file=.env.local (or ALLOW_FAKE=1 for harness-only checks).");
  const limit = Math.max(1, Number(process.env.CORPUS_LIMIT ?? CASES.length));
  const cases = CASES.slice(0, limit);
  console.log(`provider=${provider.name} model=${process.env.AI_MODEL ?? "(default)"} cases=${cases.length}/${CASES.length}`);
  const latencies: number[] = [];
  let passed = 0;
  let unavailable = 0;
  const failures: unknown[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const quest = findQuest(c.questId);
    if (!quest?.semanticFeatures?.length) throw new Error(`${c.questId} has no semanticFeatures`);
    const started = Date.now();
    const result = await readSceneMeaning({ provider, log: new MemoryAILogSink(), attemptId: `corpus-${i}` }, {
      text: c.text,
      turnIndex: 1,
      features: quest.semanticFeatures,
      participants: quest.ensemble?.participants.map((p) => p.npcId) ?? [quest.npcId],
      turns: [],
    });
    const ms = Date.now() - started;
    latencies.push(ms);
    if (result.unavailable) unavailable++;
    const active = result.evidence.filter((e) => !e.revoked).map((e) => e.feature);
    const missing = c.expect.filter((x) => !active.includes(x));
    const forbidden = (c.reject ?? []).filter((x) => active.includes(x));
    const ok = !result.unavailable && missing.length === 0 && forbidden.length === 0;
    if (ok) passed++;
    else failures.push({ label: c.label, questId: c.questId, text: c.text, active, missing, forbidden, unavailable: result.unavailable, ms });
    console.log(`${ok ? "PASS" : "FAIL"} ${c.questId}/${c.label} ${ms}ms -> ${active.join(", ") || "—"}${result.unavailable ? " [unavailable]" : ""}`);
  }

  const report = {
    provider: provider.name,
    model: process.env.AI_MODEL ?? null,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    unavailable,
    passRate: Number((passed / cases.length).toFixed(3)),
    latencyMs: { p50: percentile(latencies, 50), p90: percentile(latencies, 90), p95: percentile(latencies, 95), max: Math.max(0, ...latencies), over8s: latencies.filter((x) => x >= 8000).length },
    failures,
  };
  console.log("\nREPORT " + JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
