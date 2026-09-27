/**
 * THE MERIDIAN CALL — Act 3 milestone, Boss 2. Two people, one room.
 *
 * Nora brings you onto a call with Vikram Rao, Meridian's head of finance
 * operations. What he's angry about depends on what actually happened in Act 2:
 * the incident you owned or hid, the slip, or the date nobody owned; and a
 * dashboard you may have promised Nora. His real fear is the month-end close.
 *
 * Phases: give a straight account → find the real risk → protect the close
 * with a checkable commitment (and, if a dashboard was promised, say plainly
 * that it isn't coming yet). Nora interjects if you overpromise; Vikram
 * challenges blame. Failure continues the story: Nora takes the account back.
 * This is also the player's first multi-person scene before the Project Crisis.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import type { WorldState } from "@/engine/types/world";
import type { BossEncounterProfile } from "@/engine/scene/boss";
import { bossProgress } from "@/engine/scene/boss";
import { milestoneAllowed } from "@/engine/campaign";
import { beat, disclose, evidenceTurns, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

const CLOSE_LINE = "Our close runs on the thirtieth. If the reconciliation export is wrong that week, we miss a regulatory filing. That's what I'm protecting.";

type Situation = "incident_owned" | "incident_hidden" | "slip" | "unowned";
function situationOf(world: WorldState): Situation {
  const rushed = world.flags.includes("nova_labs.rushed_migration") && !world.flags.includes("director.deadline_replanned");
  if (rushed) return world.flags.includes("chapter1.hid_incident") ? "incident_hidden" : "incident_owned";
  if (world.flags.includes("nova_labs.deadline_unresolved") && !world.flags.includes("director.deadline_replanned")) return "unowned";
  return "slip";
}
const GRIEVANCE: Record<Situation, string> = {
  incident_owned: "Three thousand of Meridian's records failed to migrate. Nova restored them by Monday and told Vikram the same day. He wants to know why he should believe it won't happen in close week.",
  incident_hidden: "Three thousand of Meridian's records failed to migrate. Vikram's own team found the broken records before anyone at Nova told him. He is not interested in reassurance.",
  slip: "The migration date moved by a day. Vikram's team had planned their close preparation around the old one. He wants a date he can plan around, and a reason to trust it.",
  unowned: "Vikram's team got two different migration dates from Nova in one week. Nobody owned either. He wants one date, and one person accountable for it.",
};

export const MERIDIAN_BOSS: BossEncounterProfile = {
  id: "meridian_escalation",
  stakes: "Meridian's renewal is six weeks out. Vikram decides on this call whether Nova Labs is still a vendor he can plan a month-end close around.",
  combinedSkills: ["communication", "listening", "negotiation", "conflict_resolution"],
  approaches: [
    "Give a plain account, then ask what month-end depends on before you promise anything.",
    "Offer a narrow, checkable protection for the close instead of a big reassurance.",
  ],
  resistance: { opening: "Ask for a straight answer about what happened.", probing: "Test the weakest part of the plan: can it be checked before the thirtieth?", decision: "Accept a plan that protects the close and can be checked. No guarantees beyond it." },
  phases: [
    { id: "account", label: "A straight answer", stakes: "Vikram won't hear a plan until he's heard what happened, in words he can repeat to his CFO.", requires: [], checkpoint: (s) => has(s, "plain_account") && !has(s, "blame"), direction: "Ask what actually happened, in plain words. Challenge jargon or blame once, briefly." },
    { id: "risk", label: "Find what he's protecting", stakes: "The real risk isn't the migration. It's close week.", requires: ["account"], checkpoint: (s) => s.revealed.includes("close_constraint"), direction: "Let them discover what you're protecting. If they ask what matters to your team, answer exactly." },
    { id: "protect", label: "Protect the close", stakes: "A promise he can check beats a promise he has to trust.", requires: ["risk"], checkpoint: (s) => has(s, "protection_plan") && has(s, "close_checkpoint") && !has(s, "overpromise") && (s.custom.dashboard !== true || has(s, "honest_scope")) && evidenceTurns(s) >= 3, direction: "Test whether the plan protects the thirtieth and can be verified before it. If a dashboard was promised earlier, ask about it directly." },
  ],
};

export const customerEscalation = defineQuest({
  id: "customer_escalation",
  title: "The Meridian Call",
  tagline: "The customer wants a straight answer. Nora wants to keep the customer.",
  worldId: "career_city",
  locationId: "career_city.meridian_room",
  npcId: "nora_shah",
  difficulty: 3,
  skills: ["communication", "listening", "negotiation", "conflict_resolution"],
  order: 65,
  boss: MERIDIAN_BOSS,
  pacing: { category: "boss", intensity: 4, emotionalPressure: 4, importance: 5, urgency: "consequence" },
  failure: { kind: "reputation_hit", recoveryQuestId: "recovery_customer_escalation" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Finish Act 2: tell Rohan how the migration went.", check: ({ world }) => milestoneAllowed(world, "customer_escalation") },
  ],
  transition: () => ({ when: "Ten days later", message: "Month-end is six days out. Nora has pulled you into a call with Meridian." }),
  briefing: {
    situation: "Nora Shah has set up a call with Vikram Rao, who runs finance operations at Meridian Foods. He asked to hear from the engineer directly. Nora is on the call to protect the relationship; the answers are yours.",
    objective: "Give Vikram a plan he can plan around, without promising what Nova can't deliver.",
    intel: [
      "Vikram is not technical. He'll ask what things mean for his team.",
      "Nora owns the renewal, which is six weeks away.",
      "You can speak to either of them by name.",
    ],
    hint: "Plain account first. Then find out what he's actually protecting.",
  },
  carryOver: ({ world, npcs }) => {
    const s = situationOf(world);
    const lines = [GRIEVANCE[s]];
    if (world.flags.includes("nora.dashboard_promised")) lines.push("Meridian was told a real-time dashboard is coming, on your estimate. Vikram will ask.");
    if (world.flags.includes("nora.real_need_found")) lines.push("Nora told Vikram about the engineer who asked what his team actually needed. That was you.");
    if (world.flags.includes("knows.month_end_close")) lines.push("You already know Meridian's close runs on the thirtieth.");
    if ((npcs.nora_shah?.relationship.trust ?? 0) >= 8) lines.push("Nora trusts you enough to let you lead the call.");
    else lines.push("Nora will step in if the call goes sideways.");
    return lines;
  },
  semanticFeatures: [
    { id: "plain_account", description: "Explains what happened and what it meant for Meridian in plain, non-technical language, owning Nova's or their own part without blaming a colleague." },
    { id: "risk_question", description: "Asks Vikram what his team needs, what month-end depends on, or what would hurt most." },
    { id: "honest_scope", description: "Tells Meridian plainly what will not be delivered, or not yet (for example the real-time dashboard), and why, with what they get instead." },
    { id: "protection_plan", description: "Proposes a concrete protection for Meridian's month-end close: a change freeze, a verified export before the close, a manual fallback, or a named contact on the day." },
    { id: "close_checkpoint", description: "Gives a concrete check before or during the close, a date or time to verify the export or a go/no-go call, that Meridian can hold them to." },
    { id: "overpromise", description: "Promises the full real-time dashboard, guarantees nothing will ever break, or commits a date without any verification. Revoke if explicitly withdrawn." },
    { id: "blame", description: "Blames a colleague, another team or the customer for what happened. Firm, respectful disagreement does not count." },
  ],
  ensemble: {
    leadId: "nora_shah",
    participants: [
      { npcId: "nora_shah", name: "Nora", goal: "Keep Meridian's renewal without promising what engineering can't deliver.", privateConstraint: "The renewal is in six weeks. Another broken promise would cost more than an honest 'not yet'.", interests: ["plain_account", "honest_scope"], supports: ["protection_plan"], challenges: ["overpromise"], relationships: [{ npcId: "vikram_rao", stance: "Protect the relationship; let the engineer answer technical questions directly." }] },
      { npcId: "vikram_rao", name: "Vikram", goal: "Protect his team's month-end close.", privateConstraint: CLOSE_LINE, interests: ["risk_question", "plain_account", "close_checkpoint"], supports: ["protection_plan"], challenges: ["blame"], relationships: [{ npcId: "nora_shah", stance: "Trusts Nora personally. Doubts Nova's engineering." }] },
    ],
  },
  objectives: [
    { id: "account", kind: "primary", label: "Give a straight answer", description: "Explain what happened plainly, without blame.", check: (s) => has(s, "plain_account") && !has(s, "blame") },
    { id: "risk", kind: "primary", label: "Find what he's protecting", description: "Discover the month-end constraint.", check: (s) => s.revealed.includes("close_constraint") },
    { id: "protect", kind: "primary", label: "Protect the close", description: "A checkable protection, no overpromise.", check: (s) => bossProgress(MERIDIAN_BOSS, s).ready },
    { id: "honest", kind: "hidden", label: "Say what isn't coming", description: "Be honest about scope.", check: (s) => has(s, "honest_scope") },
  ],
  scene: {
    createHidden: ({ world }) => ({ situation: situationOf(world), dashboard: world.flags.includes("nora.dashboard_promised"), noraFoundNeed: world.flags.includes("nora.real_need_found") }),
    createCustom: (hidden) => ({ dashboard: hidden.dashboard === true }),
    initialPatience: ({ hidden }) => hidden.situation === "incident_hidden" ? 46 : 58,
    opening: { scripted: ({ hidden, playerName }) => `Vikram, thanks for making time. ${playerName} ran the migration, and you asked to hear it from them directly.${hidden.situation === "incident_hidden" ? " I know your team found the problem before we told you." : ""} ${playerName}, go ahead.` },
    npcSituation: () => "A customer call about the migration. Use only your own memory and what is said on this call. You do not know the player's private conversations with other people.",
    hiddenBriefing: ({ npc, hidden }) => npc.npcId === "vikram_rao"
      ? `${GRIEVANCE[hidden.situation as Situation]} ${hidden.dashboard ? "You were told a real-time dashboard is coming; ask whether that's still true." : ""} ${hidden.noraFoundNeed ? "Nora mentioned an engineer who asked what your team actually needs; you're willing to give this person a fair hearing." : ""} Your real concern is the close on the thirtieth. Say it plainly only when asked what your team needs or what would hurt most.`
      : `You set up this call. ${hidden.dashboard ? "You told Meridian a dashboard was coming on this engineer's estimate. You'd rather they correct it now than let it break later." : ""} Let the engineer answer; step in only to stop an overpromise or to translate jargon.`,
    revealableKeys: { close_constraint: "Only Vikram may disclose what month-end depends on." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const phase = bossProgress(MERIDIAN_BOSS, s);
      return { custom, dropSignals: ["accepted_terms"], direction: [beat(phase.active?.direction ?? "The plan protects the close and can be checked. Accept it plainly; say you'll hold them to it.")] };
    },
    canonicalSpeech: ({ npc, scene }) => npc.npcId === "vikram_rao" ? disclose(scene, "close_constraint", fresh(scene, "risk_question") || (has(scene, "plain_account") && scene.turnCount >= 3 && fresh(scene, "protection_plan")), CLOSE_LINE) : null,
    inferMovesFromSpeech: (speech, { npc }) => ({ reveal: npc.npcId === "vikram_rao" ? revealsFrom(speech, { close_constraint: CLOSE_LINE }) : [] }),
    speechGate: (sentence, { scene }) => !bossProgress(MERIDIAN_BOSS, scene).ready && /\b(we're good|that works for us|you have my confidence|renewal is safe|we'll renew)\b/i.test(sentence)
      ? { ok: false, reason: "The plan has not met the call's authored conditions.", rewrite: "I'm not there yet. What protects the thirtieth?" } : { ok: true },
    director: ({ scene, npc }) => [
      `MERIDIAN_READY=${bossProgress(MERIDIAN_BOSS, scene).ready}. Never promise a renewal, a discount or forgiveness.`,
      npc.npcId === "vikram_rao" ? "Blunt, short, no jargon. Ask what things mean for your team." : "Measured. Protect the relationship; don't answer for the engineer.",
      hasAny(scene, "overpromise") && npc.npcId === "nora_shah" ? "Gently stop the overpromise: ask them to commit only what they can verify." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "The Meridian call", value: bossProgress(MERIDIAN_BOSS, scene).active?.label ?? "A plan Vikram can check" }],
    minTurns: 3,
    maxTurns: 11,
  },
  rubric: [
    { id: "plain", skill: "communication", facet: "clarity", label: "A straight answer", description: "Plain account of what happened and its impact, owned.", anchors: { exemplary: "'Three thousand records failed; we restored them Monday; that was our process, and here's what changed.'", weak: "Jargon or minimising." }, weight: 1.2 },
    { id: "discover", skill: "listening", facet: "questioning", label: "What he's protecting", description: "Asked what month-end depends on before promising.", anchors: { exemplary: "'What would hurt your team most in close week?'", weak: "Reassured without asking." }, weight: 1.1 },
    { id: "protect", skill: "negotiation", facet: "proposing_alternatives", label: "A checkable protection", description: "A narrow, verifiable plan for the close instead of a big promise.", anchors: { exemplary: "Change freeze plus a verified export on the twenty-eighth.", weak: "'It won't happen again.'" }, weight: 1.2 },
    { id: "steady", skill: "conflict_resolution", facet: "de_escalation", label: "Staying steady", description: "Handled Vikram's frustration without defensiveness or blame.", anchors: { exemplary: "Acknowledged the cost to his team and kept to facts.", weak: "Defended the team or blamed another." }, weight: 0.9 },
  ],
  evaluatorNotes: "SCENE_KIT. A two-person customer escalation. Judge the player's plain account, discovery of the month-end risk and a checkable protection. Honesty about undelivered scope is a strength. Placating promises are weak even if the customer sounds pleased.",
  outcomes: [
    {
      id: "trust_restored", label: "A plan Vikram can check", grade: "success",
      when: ({ scene }) => bossProgress(MERIDIAN_BOSS, scene).ready && !has(scene, "blame"),
      narrative: ({ hidden }) => hidden.dashboard
        ? "You told Vikram the dashboard isn't coming yet, and gave him something better: a protection for the thirtieth he can check. He said he'd hold you to it. From him, that's warm."
        : "You gave Vikram a straight answer and a protection for his close he can verify himself. Nora didn't have to say a word after the first minute.",
      consequences: ({ hidden, world }) => {
        const out: Consequence[] = [
          { type: "relationship.delta", npcId: "vikram_rao", delta: { trust: 14, respect: 9, familiarity: 15 } },
          { type: "relationship.delta", npcId: "nora_shah", delta: { trust: 8, respect: 7, familiarity: 10 } },
          { type: "world.flag.add", flag: "meridian.trust_restored" },
          { type: "world.commitment.add", description: "Verify Meridian's month-end export before the thirtieth and hold a go/no-go call.", toNpcId: "vikram_rao", dueBy: null },
          { type: "world.decision.add", description: "Gave Meridian a straight answer and a checkable protection for their month-end close." },
          { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Nora says the Meridian call went well: a straight answer and a plan Vikram can check. She didn't have to step in.", importance: 0.7, emotionalTone: "positive" },
        ];
        if (hidden.dashboard) for (const c of world.commitments.filter((x) => x.toNpcId === "nora_shah" && x.status === "open")) out.push({ type: "world.commitment.resolve", commitmentId: c.id, status: "superseded" });
        return out;
      },
      aftermath: () => ["Vikram will give Nova Labs another quarter. Your go/no-go call before the thirtieth is now a promise.", "Rohan has heard from Nora how the call went."],
      rewardMultiplier: 1.25, followUpQuestIds: ["mentor_arjun"],
    },
    {
      id: "holding_pattern", label: "On watch", grade: "partial", setback: false,
      when: ({ scene }) => has(scene, "plain_account") && (has(scene, "protection_plan") || scene.revealed.includes("close_constraint")),
      narrative: () => "Vikram heard a fair account and the start of a plan, but not one he can check. He'll wait and watch. Nora keeps the account close.",
      consequences: () => [
        { type: "relationship.delta", npcId: "vikram_rao", delta: { trust: 3, familiarity: 12 } },
        { type: "relationship.delta", npcId: "nora_shah", delta: { trust: 2, familiarity: 8 } },
        { type: "world.flag.add", flag: "meridian.watching" },
        { type: "world.decision.add", description: "Kept Meridian on the line after the migration, but without a plan they could verify." },
      ],
      aftermath: () => ["Meridian is watching the next release closely. So is Nora."],
      rewardMultiplier: 0.85, followUpQuestIds: ["mentor_arjun"],
    },
    {
      id: "nora_takes_over", label: "Nora takes the account back", grade: "failure",
      when: () => true,
      narrative: ({ scene }) => has(scene, "blame")
        ? "Vikram heard blame where he wanted an answer. Nora ended the call politely and took the Meridian relationship back. You'll hear about the renewal from her."
        : "The call ended without an answer Vikram could plan around. Nora took the account back. The story goes on, and Meridian will be harder from here.",
      consequences: () => [
        { type: "relationship.delta", npcId: "vikram_rao", delta: { trust: -10, respect: -4, familiarity: 10 } },
        { type: "relationship.delta", npcId: "nora_shah", delta: { trust: -8, respect: -4, familiarity: 8 } },
        { type: "world.flag.add", flag: "meridian.nora_owns" },
        { type: "world.decision.add", description: "Lost the Meridian call; Nora took the customer relationship back." },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Nora had to take the Meridian call back from the engineer. Vikram is asking about options.", importance: 0.7, emotionalTone: "negative" },
      ],
      aftermath: () => ["Nora owns Meridian now. A debrief with her could still rebuild some credibility; it won't reopen the call."],
      rewardMultiplier: 0.55, followUpQuestIds: ["mentor_arjun"],
    },
  ],
  rewards: { baseXp: 120, skills: { communication: 0.4, listening: 0.35, negotiation: 0.35, conflict_resolution: 0.3 } },
});
