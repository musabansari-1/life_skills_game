/**
 * Offline season harness. Nine personas play Career City from the screening
 * call to the ending through the real GameService (fake provider, real
 * reducers, real Director). Persona skill/reputation baselines are explicit
 * fixtures; every story record is produced by a saved attempt, including
 * failures, recoveries and Director-selected events. Nothing is injected.
 *
 * Personas differ in what they say (scripts below), whether they take the
 * Director's optional events, and how they repair. The acceptance test checks
 * that they do NOT all live the same campaign.
 */
import type { Db } from "@/db/client";
import { FakeProvider } from "@/ai/providers/fake";
import { MemoryAILogSink } from "@/ai/logger";
import { makeTestEnv } from "@/engine/util";
import { SKILL_IDS, type SkillId } from "@/engine/types/skills";
import { CAREER_MILESTONES, CONTINUES_ON_FAILURE, recoveryId } from "@/engine/campaign";
import type { PlayerGoal } from "@/engine/director/types";
import { GameService } from "./orchestrator";
import { MemoryAnalytics } from "./analytics";
import { registerAccount } from "./account";
import { loadPlayerState, saveCompetencies, saveWorldState } from "./player";

export const CRISIS_PLAN = [
  "Rohan, I own my responsibility for the earlier estimate. I should have checked the assumptions.",
  "Nora, which customer reports matter most?",
  "Maya, what verification capacity and checks do you need?",
  "I propose a smaller read-only pilot instead of the full rollout. Keep the existing reports available; the new dashboard can wait. No overtime: protect the rollback checks.",
  "I'll own the customer message and coordinate the pilot. We will review it tomorrow at noon and stop if the rollback checks fail.",
];
const CRISIS_PARTIAL = ["I own my part. A smaller read-only pilot instead of the full rollout is my proposal.", "I'll own the decision and review it tomorrow at noon."];
const CRISIS_FAIL = ["I own my part. I promise the full migration today and everyone can do overtime.", "I want everyone to be happy. We can do it all."];
const REPAIR = ["I own my mistake in how I handled that conversation.", "I'll send a revised plan and review it tomorrow at noon. I will limit the scope rather than promise everything."];
const INSULTS = ["This is an insult, take it or leave it.", "Unacceptable. Non-negotiable. Final offer.", "You're wasting my time. Final offer.", "Take it or leave it.", "Unacceptable. Final offer."];

type Style = "good" | "ok" | "poor" | "hostile";
/** Per-quest lines by style. Missing styles fall back to "ok", then "good". */
const SCRIPTS: Record<string, Partial<Record<Style, string[]>>> = {
  introduce_yourself: { good: ["Hi! I just moved into 3A for a job at Nova Labs. I've already got lost twice.", "What about you, how long have you been here?"] },
  recruiter_screening: {
    good: ["I led a migration that cut infra spend by 30% last year.", "I'd rather understand the role first. What range do you have budgeted?", "What is the team working on right now?"],
    ok: ["I led a migration that cut infra spend by 30% last year.", "Honestly I'd be happy with eight lakh.", "What is the team working on right now?"],
    hostile: INSULTS,
  },
  hiring_manager_interview: {
    good: ["Last year I shipped a migration late because I underestimated testing; I missed it and now I plan buffers and flag risk early.", "Realistically, a month to be properly productive, with a small fix shipped in week two."],
    ok: ["Last year I shipped a migration late because I underestimated testing; I missed it and now I plan buffers and flag risk early.", "I'll be shipping real work in my first week, no ramp-up needed."],
    hostile: INSULTS,
  },
  counter_offer: {
    good: ["Thanks Emma. Given the migration I delivered and the market benchmark I'd like 9.5 lakh.", "What flexibility is there on a joining bonus?", "I accept."],
    ok: ["Okay, I accept."],
    hostile: ["The market benchmark supports ten lakh. I'd like ten lakh.", "I accept."],
  },
  first_day_nova_labs: { good: ["Morning Emma! Who will I be reporting to?", "What's the team struggling with right now?"] },
  meet_maya: {
    good: ["I've read the runner README and traced one batch. I'm stuck on exactly where rollback is triggered. Do you have ten minutes after your run?", "Has the rollback been tested on real data?"],
    ok: ["I'm stuck on exactly where rollback is triggered, can you show me?"],
    poor: ["Can you just do my migration ticket? I don't get any of it.", "Could you just finish it for me?"],
  },
  push_back_on_deadline: {
    good: ["Friday isn't safe without a rollback. By Friday I can ship the schema changes, and the full migration with rollback by Monday."],
    ok: ["I'm not sure Friday is realistic."],
    poor: ["Sure, Friday is fine."],
  },
  nora_requirements: {
    good: ["Before I estimate, what problem are they trying to solve? Who uses it?", "So their real problem is the manual export at month-end. A scheduled export refresh before the thirtieth, instead of a dashboard?"],
    ok: ["That's about a quarter of work, rough estimate."],
    poor: ["Yes, we can build the real-time dashboard by Friday, no problem.", "Two weeks, tops."],
    hostile: ["Honestly that's not our problem. They don't need that.", "It's just a nice-to-have."],
  },
  status_update: {
    good: ["That's on me: I rushed it. About 3,000 records failed; restore runs tonight, all accounts back by Monday 10am.", "Here's the plan: I'll have it done by Thursday noon."],
    ok: ["I messed up, that's on me. We'll look at it."],
    poor: ["There was a minor issue with the migration, nothing serious, should be fine."],
  },
  customer_escalation: {
    good: ["Vikram, what happened is we missed: the migration went wrong on our side, and I own that.", "Vikram, what does your team need at month-end?", "Here's the protection: a change freeze in close week and a verified export on the 28th, with a go/no-go call. The dashboard isn't coming this quarter; you get the verified export instead."],
    ok: ["Vikram, what happened is we missed, and I own that.", "We'll add a manual export fallback for your team."],
    poor: ["It won't happen again, I guarantee it.", "We'll have the dashboard by next week."],
    hostile: ["That was the other team's fault, honestly, not my problem.", "You people need to test your own reports."],
  },
  mentor_arjun: {
    good: ["How's it going with the ticket? What's been hard?", "Honestly, I broke staging in my second week too. It happens to everyone.", "What would you try first?", "I'll pair with you for an hour at four, and we can check in tomorrow."],
    ok: ["Leave it with me, I'll just fix it."],
    poor: ["Is it done yet? Rohan's asking."],
    hostile: ["You should have asked days ago. Why didn't you?", "Leave it with me, I'll just fix it."],
  },
  feedback_for_rohan: {
    good: ["When you agreed the Friday deadline upstairs, Maya lost her weekend to the restore.", "I know your director puts pressure on you.", "Could you check capacity with the team before committing a date? I'll give you a real number in time."],
    ok: ["Honestly, nothing really. You're doing great."],
    hostile: ["You always volunteer us. Everyone thinks you're a bad manager."],
  },
  project_crisis: { good: CRISIS_PLAN, ok: CRISIS_PARTIAL, poor: CRISIS_FAIL, hostile: CRISIS_PARTIAL },
  the_review: {
    good: ["I'd like to lead the next Meridian phase. In the crisis I owned the estimate and aligned the room.", "I'd need Maya's verification time agreed up front and a review at the end of the quarter."],
    ok: ["That's fair. What would ready look like to you?", "Let's revisit it in a quarter, with a checkpoint."],
    poor: ["Whatever you think is best.", "Okay."],
    hostile: ["That wasn't my fault, Rohan made the call. Promote me or I'll leave."],
  },
  // Optional and Director-selected scenes.
  maya_checkin: { good: ["What do you need from me? I know it cost you your weekend. That's on me.", "I'll ask you before I commit any date that touches verification. In the meeting I'll tell them what happened when the rollback wasn't tested."] },
  emma_check_in: { good: ["Honestly, the migration went badly at first and I owned it.", "How do people grow here? What are you seeing across Nova?"] },
  priya_interlude: { good: ["How are you feeling about it? What's really bothering you?", "Sounds like it's less about Kabir and more about family."] },
  director_checkpoint: { good: ["What does your director need for Friday?", "I understand the pressure from your director and the risk to your credibility.", "The rollback test failed, so the full migration risks losing accounts.", "I delivered the read-only prototype for 3000 accounts yesterday.", "I propose a smaller read-only demonstration Friday instead, with a rollback checkpoint Monday."] },
  director_introduction: { good: ["What support and capacity would make this work for the team?", "I understand your reputation is at risk if the plan goes wrong.", "I delivered a migration for 3000 accounts last month.", "I reduced the backup time by 30 percent.", "I propose a smaller two-week pilot with a written checkpoint."] },
};

interface Persona {
  id: string;
  /** Style per milestone; anything unlisted uses `base`. */
  base: Style;
  styles: Partial<Record<string, Style>>;
  /** Plays the Director's optional events and side scenes when they are recommended. */
  takesOptional: boolean;
  startsWithPriya?: boolean;
  skills: (id: SkillId) => number;
  reputation: Partial<Record<"reliable" | "assertive" | "diplomatic" | "credible" | "empathetic", number>>;
  goals: PlayerGoal[];
}

export const PERSONAS: Persona[] = [
  { id: "strong", base: "good", styles: {}, takesOptional: true, startsWithPriya: true, skills: () => 82, reputation: { reliable: 22, diplomatic: 20, credible: 22 }, goals: ["leadership"] },
  { id: "average", base: "good", styles: { counter_offer: "ok", meet_maya: "ok", nora_requirements: "ok", customer_escalation: "ok", mentor_arjun: "ok", feedback_for_rohan: "ok", project_crisis: "ok", the_review: "ok" }, takesOptional: false, skills: () => 55, reputation: {}, goals: [] },
  { id: "weak", base: "poor", styles: { recruiter_screening: "hostile", hiring_manager_interview: "ok", counter_offer: "ok", first_day_nova_labs: "good", the_review: "ok" }, takesOptional: false, skills: () => 35, reputation: { reliable: -8, credible: -6 }, goals: ["confidence"] },
  { id: "recovery_heavy", base: "good", styles: { recruiter_screening: "hostile", hiring_manager_interview: "hostile", status_update: "poor" }, takesOptional: true, skills: () => 40, reputation: { reliable: -15, credible: -10 }, goals: ["conflict"] },
  { id: "aggressive", base: "good", styles: { counter_offer: "hostile", meet_maya: "poor", nora_requirements: "hostile", customer_escalation: "hostile", mentor_arjun: "hostile", feedback_for_rohan: "hostile", project_crisis: "hostile", the_review: "hostile" }, takesOptional: true, skills: (id) => id === "listening" ? 20 : id === "negotiation" ? 88 : 55, reputation: { assertive: 25, diplomatic: -15 }, goals: ["listening"] },
  { id: "overcommitter", base: "good", styles: { recruiter_screening: "ok", hiring_manager_interview: "ok", counter_offer: "ok", meet_maya: "ok", push_back_on_deadline: "poor", nora_requirements: "poor", status_update: "poor", customer_escalation: "poor", project_crisis: "poor", the_review: "ok" }, takesOptional: true, skills: (id) => id === "confidence" ? 20 : id === "listening" ? 80 : 45, reputation: { empathetic: 25, reliable: -10 }, goals: ["confidence"] },
  { id: "cautious", base: "good", styles: { counter_offer: "ok", push_back_on_deadline: "ok", nora_requirements: "ok", status_update: "ok", customer_escalation: "ok", feedback_for_rohan: "ok", project_crisis: "ok", the_review: "ok" }, takesOptional: false, skills: (id) => id === "confidence" ? 30 : 60, reputation: { empathetic: 8 }, goals: ["confidence"] },
  { id: "listener", base: "good", styles: { counter_offer: "ok", the_review: "poor" }, takesOptional: true, startsWithPriya: true, skills: (id) => id === "listening" ? 85 : id === "confidence" ? 40 : 60, reputation: { empathetic: 12, diplomatic: 8 }, goals: ["listening"] },
  { id: "ignores_optional", base: "good", styles: { counter_offer: "ok" }, takesOptional: false, skills: () => 65, reputation: { reliable: 6 }, goals: [] },
];
export const CAMPAIGN_PERSONAS = PERSONAS.map((p) => p.id);
export type CampaignPersona = string;

const OPTIONAL = new Set(["maya_checkin", "emma_check_in", "priya_interlude", "director_checkpoint", "director_introduction"]);

/** Plays the season for a persona. `stopBefore` leaves the player just before that milestone (for UI fixtures). */
export async function simulateCampaignPath(db: Db, personaId: string, opts: { stopBefore?: string } = {}) {
  const persona = PERSONAS.find((p) => p.id === personaId)!;
  const account = await registerAccount(db, { email: `${persona.id}_${Date.now()}_${Math.random().toString(36).slice(2)}@simulation.local`, password: "simulation-password-only" });
  const playerId = account.player.playerId;
  const clock = makeTestEnv();
  const env = { now: clock.now, id: () => `${playerId}_${clock.id()}` };
  const initial = await loadPlayerState(db, playerId);
  // Explicit persona input, not a claim that these skills were earned during this harness.
  for (const id of SKILL_IDS) for (const facet of Object.values(initial.competencies[id].facets)) Object.assign(facet, { estimate: persona.skills(id), confidence: 0.8, samples: 6 });
  Object.assign(initial.world.director.reputation, persona.reputation);
  initial.world.director.preferences.goals = persona.goals;
  await saveCompetencies(db, playerId, initial.competencies); await saveWorldState(db, playerId, initial.world);
  const provider = new FakeProvider();
  const game = new GameService({ db, provider, aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env });
  const steps: { questId: string; attemptId: string; grade: string; outcome: string; recommended: string | null }[] = [];
  const style = (questId: string): Style => persona.styles[questId] ?? persona.base;
  const linesFor = (questId: string, s = style(questId)) => SCRIPTS[questId]?.[s] ?? SCRIPTS[questId]?.ok ?? SCRIPTS[questId]?.good ?? REPAIR;

  async function play(questId: string, lines: string[]) {
    // Script only facts the generic fake NPC cannot express. These still pass normal speech gates/reducers.
    const spoken = questId === "first_day_nova_labs" ? "Your manager is Rohan Mehta. The release is three weeks late and two people left."
      : questId === "push_back_on_deadline" && style(questId) === "good" ? "Fine, Monday it is, with the partial on Friday. Don't make me regret it." : null;
    const running = spoken ? new GameService({ db, provider: new FakeProvider({ scripted: { npc_turn: () => `<speech>${spoken}</speech><moves>{"noticed":[],"reveal":[],"proposal":{},"wantsToEnd":false}</moves>` } }), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics(), env }) : game;
    let a = await running.startQuest(playerId, questId, "text", "story");
    for (const line of lines) {
      if (a.scene.ended) break;
      a = (await running.submitPlayerTurn(playerId, a.id, line, "text")).attempt;
      // Take an offered NPC-to-NPC reaction, as the client does once a line is delivered.
      if (a.status === "active" && !a.scene.ended && a.scene.custom._reaction) a = await running.continueEnsemble(playerId, a.id, a.turns.length);
    }
    const result = await running.concludeQuest(playerId, a.id);
    const state = await game.getPlayerState(playerId);
    steps.push({ questId, attemptId: a.id, grade: result.result!.grade, outcome: result.result!.outcomeId, recommended: state.world.director.recommended?.questId ?? null });
    return result;
  }

  /** Between chapters: follow the Director into optional scenes this persona would take. */
  async function interlude() {
    if (!persona.takesOptional) return;
    for (let i = 0; i < 2; i++) {
      const state = await game.getPlayerState(playerId);
      if (!state.world.director.recommended) await game.refreshDirector(playerId);
      const rec = (await game.getPlayerState(playerId)).world.director.recommended;
      const repair = rec?.questId.startsWith("recovery_");
      if (!rec || (!OPTIONAL.has(rec.questId) && !repair) || steps.some((s) => s.questId === rec.questId)) return;
      await play(rec.questId, repair ? REPAIR : linesFor(rec.questId, "good"));
    }
  }

  if (persona.startsWithPriya) await play("introduce_yourself", linesFor("introduce_yourself", "good"));
  const recommendedBeforeClimax: (string | null)[] = [];
  for (const milestone of CAREER_MILESTONES) {
    if (milestone === opts.stopBefore) break;
    if (milestone === "project_crisis") recommendedBeforeClimax.push((await game.getPlayerState(playerId)).world.director.recommended?.questId ?? null);
    const result = await play(milestone, linesFor(milestone));
    // A blocking failure needs its separate repair; a failure that continues is simply the story now.
    if (result.result!.grade === "failure" && !CONTINUES_ON_FAILURE.includes(milestone)) await play(recoveryId(milestone), REPAIR);
    else if (result.result!.grade !== "success" && persona.id === "recovery_heavy" && milestone === "status_update") await play(recoveryId(milestone), REPAIR);
    else if (persona.takesOptional && milestone === "customer_escalation" && result.result!.grade === "failure") await play(recoveryId(milestone), REPAIR);
    if (milestone !== "project_crisis" && milestone !== "the_review") await interlude();
  }
  const state = await game.getPlayerState(playerId);
  const boss = steps.find((s) => s.questId === "project_crisis");
  const review = steps.find((s) => s.questId === "the_review");
  return { persona: persona.id, playerId, account, game, provider, state, steps, bossAttemptId: boss?.attemptId ?? "", reviewAttemptId: review?.attemptId ?? "", report: {
    persona: persona.id, played: steps.map((s) => `${s.questId}:${s.outcome}`), recommendedBeforeClimax: recommendedBeforeClimax[0],
    optional: steps.filter((s) => OPTIONAL.has(s.questId)).map((s) => s.questId),
    failures: state.world.campaign.failures.map((f) => ({ questId: f.questId, kind: f.kind, recovered: !!f.recoveredBy })),
    relationships: Object.fromEntries(Object.entries(state.npcs).map(([id, n]) => [id, n.relationship])),
    information: state.world.campaign.communications.map((c) => ({ from: c.from, to: c.to, kind: c.kind })),
    ending: state.world.campaign.ending,
  } };
}
