/**
 * PUSH BACK ON A DEADLINE — chapter 5. Rohan, commitments, and a choice that
 * comes back in chapter 6.
 *
 * Rohan wants the migration by Friday. Done properly (with a rollback path) it
 * isn't possible. What you agree here decides what goes wrong in "The Status
 * Update": caving creates a production incident; a plan creates a smaller slip.
 * Earlier chapters shape Rohan: an interview overpromise ("shipping in week
 * one") and anything Emma told him about your negotiation.
 */
import { defineQuest } from "@/engine/types/quest";
import type { WorldState } from "@/engine/types/world";
import { formatINR } from "@/engine/util";

interface Hidden extends Record<string, unknown> {
  realDeadline: string;
  knowsReleaseLate: boolean;
  overpromised: boolean;
  negotiationStyle: string | null;
  salary: number | null;
}
interface Scene extends Record<string, unknown> {
  agreedDate: "friday" | "monday" | "wednesday" | null;
  scopeNarrowed: boolean;
  alternativeProposed: boolean;
  capitulated: boolean;
}

const NEGATION = /\b(not|can'?t|cannot|won'?t|isn'?t|without|no way|unsafe|risky)\b/;
const YES = /\b(ok(ay)?|fine|sure|yes|yeah|will do|can do|no problem|i'?ll (get|have|do) it|done by friday|consider it done)\b/;
const ALTERNATIVE = /\b(by friday i can|i can (do|have|ship|deliver|get)|partial|first (part|phase|half)|narrow|scope (it|down)|phase (it|one)|(monday|tuesday|wednesday)\b.{0,40}\b(full|rest|complete|rollback)|(full|rest|complete|rollback).{0,40}\b(monday|tuesday|wednesday))\b/;

function style(world: WorldState): string | null {
  const s = world.vars["counter_offer.style"];
  return typeof s === "string" ? s : null;
}

export const pushBackOnDeadline = defineQuest<Hidden, Scene>({
  id: "push_back_on_deadline",
  title: "Push Back on a Deadline",
  tagline: "Rohan wants it Friday. It can't be done well by Friday.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "rohan_mehta",
  difficulty: 2,
  skills: ["conflict_resolution", "communication", "confidence", "negotiation"],
  order: 50,
  briefing: {
    situation: "Week two. Rohan drops by your desk: the database migration needs to be done by Friday for the release. You've scoped it: done properly, it's Wednesday next week. Rushing it means skipping the rollback path.",
    objective: "Protect the quality of the work without becoming the person who says no.",
    intel: ["Rohan respects plans and hates surprises.", "Nobody has told Rohan about the rollback risk yet."],
    hint: "Say what you can do by Friday, not just what you can't.",
  },
  prerequisites: [{ type: "world_unlocked_quest", questId: "push_back_on_deadline" }, { type: "world_flag", flag: "nova_labs.joined" }],
  carryOver: ({ world }) => {
    const lines: string[] = [];
    if (world.flags.includes("interview.overpromised")) lines.push("In your interview you promised Rohan you'd be shipping in week one. It's week two.");
    const s = style(world);
    if (s === "hardball" || s === "walked_away") lines.push("Emma told Rohan you negotiate hard. He's expecting a fight.");
    if (s === "collaborative") lines.push("Emma told Rohan you were sharp but fair in the negotiation.");
    if (world.vars["nova_labs.knows_release_late"] === true) lines.push("You already know the release is late. Rohan's pressure makes sense.");
    return lines;
  },
  objectives: [
    { id: "protect_quality", label: "Protect the rollback path", kind: "primary", description: "Don't agree to ship without a rollback path.", check: (s) => !(s.custom as Scene).capitulated },
    { id: "offer_alternative", label: "Propose a concrete alternative", kind: "hidden", description: "Offer a narrower Friday deliverable plus a real completion date.", check: (s) => (s.custom as Scene).alternativeProposed },
    { id: "commit_date", label: "Agree a specific date", kind: "optional", description: "End with an agreed, specific completion date.", check: (s) => (s.custom as Scene).agreedDate !== null },
  ],
  scene: {
    createHidden: ({ world }) => ({
      realDeadline: "The release demo is Tuesday; Monday would actually be fine.",
      knowsReleaseLate: world.vars["nova_labs.knows_release_late"] === true,
      overpromised: world.flags.includes("interview.overpromised"),
      negotiationStyle: style(world),
      salary: world.career.baseSalary ?? null,
    }),
    createCustom: () => ({ agreedDate: null, scopeNarrowed: false, alternativeProposed: false, capitulated: false }),
    initialPatience: ({ hidden, npc }) => 55 - (hidden.overpromised ? 10 : 0) + Math.round(npc.relationship.trust / 5),
    opening: {
      generatedHint: "You're stopping by their desk, in a hurry. Tell them you need the migration done by Friday for the release. Be direct, not rude. If you remember something relevant about them (a promise, what Emma told you), let it colour one phrase.",
    },
    npcSituation: ({ hidden, playerName }) =>
      [
        `You need ${playerName}'s database migration in by Friday for the release. Your director is on your back.`,
        hidden.knowsReleaseLate ? `${playerName} already knows the release is late.` : "",
        hidden.overpromised ? `In their interview they promised they'd be shipping in week one. It's week two.` : "",
        hidden.negotiationStyle === "hardball" ? "Emma warned you they negotiate hard. You half expect a fight." : "",
        hidden.salary && hidden.salary >= 950000 ? `You're paying them ${formatINR(hidden.salary)}; you expect them to carry weight.` : "",
        "You don't yet know that rushing skips the rollback path.",
      ]
        .filter(Boolean)
        .join(" "),
    hiddenBriefing: ({ hidden }) =>
      [
        `The truth: ${hidden.realDeadline} You say Friday because you want buffer. Reveal this only if they ask what Friday is actually driven by, or propose a credible plan that lands Monday.`,
        "If they tell you rushing skips the rollback path, that genuinely worries you: you've been burned before. You'll accept a later date if there's a concrete plan.",
        `If they just say "it can't be done" with no alternative, you get irritated and say you'll find someone who can.`,
        "If they cave and say Friday is fine, accept it, but you'll remember if it goes wrong.",
        hidden.overpromised ? "If they push back hard, remind them, briefly, of their week-one promise." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    revealableKeys: {
      real_deadline: "you admitted the demo is Tuesday and Monday would do",
      burned_before: "you mentioned a previous migration that went wrong without a rollback",
    },
    proposalKeys: {
      agreedDate: "one of 'friday' | 'monday' | 'wednesday' if you and the player have agreed a completion date in this speech",
      capitulated: "true if the player agreed to the Friday deadline without protecting quality",
      alternativeProposed: "true if the player proposed a narrower Friday deliverable plus a later full completion",
    },
    preTurn: ({ scene }, read, text) => {
      const c: Scene = { ...scene.custom };
      const t = text.toLowerCase();
      const dir: string[] = [];
      const noticed: ("proposed_alternative" | "conceded_for_free")[] = [];
      if (/\bfriday\b/.test(t) && (YES.test(t) || read.signals.includes("accepted_terms")) && !NEGATION.test(t) && !ALTERNATIVE.test(t)) {
        c.capitulated = true;
        c.agreedDate = "friday";
        noticed.push("conceded_for_free");
        dir.push("They just agreed to Friday with no conditions. Take it, say you're relying on them, and go.");
      } else if (ALTERNATIVE.test(t)) {
        c.alternativeProposed = true;
        noticed.push("proposed_alternative");
      }
      return { custom: c, direction: dir, moves: { noticed } };
    },
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      const flags: string[] = [];
      const d = moves.proposal.agreedDate;
      if (d === "friday" || d === "monday" || d === "wednesday") custom.agreedDate = d;
      if (moves.proposal.capitulated === true) custom.capitulated = true;
      if (moves.proposal.alternativeProposed === true || moves.noticed.includes("proposed_alternative")) {
        custom.alternativeProposed = true;
        flags.push("alternative_proposed");
      }
      return { custom, flags };
    },
    inferMovesFromSpeech: (speech, { scene }) => {
      const s = speech.toLowerCase();
      const proposal: Record<string, string | boolean> = {};
      const reveal: string[] = [];
      if (/\b(tuesday|demo is tuesday|monday would (do|work|be fine))\b/.test(s)) reveal.push("real_deadline");
      if (/\b(burned|last time|went wrong).{0,40}\b(rollback|migration)\b/.test(s)) reveal.push("burned_before");
      if (scene.custom.alternativeProposed && /\b(fine|ok(ay)?|deal|agreed|let'?s do|works)\b/.test(s)) {
        if (/\bmonday\b/.test(s)) proposal.agreedDate = "monday";
        else if (/\bwednesday\b/.test(s)) proposal.agreedDate = "wednesday";
      }
      return { reveal, proposal };
    },
    director: ({ scene }) => {
      const notes: string[] = [];
      if (!scene.custom.alternativeProposed && scene.turnCount >= 2) notes.push("They haven't offered a plan yet. Press: 'So what CAN you do by Friday?'");
      if (scene.custom.alternativeProposed && !scene.custom.agreedDate) notes.push("They've offered a plan. If it's concrete, agree a date out loud (Monday or Wednesday) and put it in proposal.agreedDate.");
      if (scene.custom.agreedDate) notes.push("A date is agreed. Wrap up briskly; you have other fires.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "disagree", skill: "conflict_resolution", facet: "respectful_disagreement", label: "Respectful disagreement", description: "Did the player say no to Friday clearly without hostility or apology spirals?", anchors: { exemplary: "'Friday isn't safe, and here's why': calm and specific.", weak: "Either caved, or got defensive." }, weight: 1.2 },
    { id: "alternative", skill: "negotiation", facet: "proposing_alternatives", label: "Proposing alternatives", description: "Did the player propose what could be done by Friday plus a real completion date?", anchors: { exemplary: "Narrower Friday deliverable, full migration Monday with rollback.", weak: "Only said what couldn't be done." }, weight: 1.3 },
    { id: "clarity", skill: "communication", facet: "clarity", label: "Clarity", description: "Was the risk explained in plain terms Rohan could repeat to his director?", anchors: { exemplary: "One sentence on the rollback risk and its consequence.", weak: "Technical rambling or vague 'it's risky'." }, weight: 1 },
    { id: "questions", skill: "listening", facet: "questioning", label: "Questioning", description: "Did the player ask what Friday was actually driven by?", anchors: { exemplary: "Asked what depends on Friday and discovered Monday works.", weak: "Never asked." }, weight: 0.9 },
    { id: "assert", skill: "confidence", facet: "assertiveness", label: "Assertiveness", description: "Did the player hold their position under pressure?", anchors: { exemplary: "Held the line on rollback while staying flexible on scope.", weak: "Folded when Rohan pushed." }, weight: 0.9 },
  ],
  outcomes: [
    {
      id: "plan_agreed",
      label: "Plan agreed",
      grade: "success",
      when: ({ scene }) => !scene.custom.capitulated && scene.custom.alternativeProposed && scene.custom.agreedDate !== null && scene.custom.agreedDate !== "friday",
      narrative: ({ scene }) => `Rohan agreed to ${scene.custom.agreedDate === "monday" ? "Monday" : "Wednesday"} with a narrower Friday deliverable. He's holding you to it.`,
      consequences: ({ scene }) => [
        { type: "world.commitment.add", description: `Deliver the full migration with rollback by ${scene.custom.agreedDate === "monday" ? "Monday" : "Wednesday"}; partial deliverable Friday.`, toNpcId: "rohan_mehta", dueBy: null },
        { type: "world.unlock.quest", questId: "status_update" },
        { type: "world.reputation.delta", domain: "career_city", delta: 5 },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: 12, trust: 8, familiarity: 15, warmth: 4 } },
      ],
      aftermath: ({ scene }) => [`You promised Rohan the full migration by ${scene.custom.agreedDate === "monday" ? "Monday" : "Wednesday"}. He'll hold you to that date.`, "Rohan respects a plan. It showed."],
      rewardMultiplier: 1.2,
      followUpQuestIds: ["status_update"],
    },
    {
      id: "capitulated",
      label: "Agreed to Friday",
      grade: "partial",
      when: ({ scene }) => scene.custom.capitulated || scene.custom.agreedDate === "friday",
      narrative: () => "You said Friday. Rohan walked off satisfied. The rollback path is not going to exist.",
      consequences: () => [
        { type: "world.commitment.add", description: "Ship the migration by Friday (without rollback path).", toNpcId: "rohan_mehta", dueBy: null },
        { type: "world.flag.add", flag: "nova_labs.rushed_migration" },
        { type: "world.unlock.quest", questId: "status_update" },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -4, trust: 2, familiarity: 12 } },
      ],
      aftermath: () => ["You're shipping Friday without a rollback path. If anything goes wrong, there's no undo.", "Rohan is counting on Friday."],
      rewardMultiplier: 0.6,
      followUpQuestIds: ["status_update"],
    },
    {
      id: "stalemate",
      label: "Unresolved",
      grade: "partial",
      when: () => true,
      narrative: () => "Rohan left without a decision. He'll escalate, and you'll have the same conversation with less goodwill.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -2, familiarity: 10, warmth: -3 } },
        { type: "world.flag.add", flag: "nova_labs.deadline_unresolved" },
        { type: "world.unlock.quest", questId: "status_update" },
      ],
      aftermath: () => ["Nobody owns the migration date now. That will come back to you."],
      rewardMultiplier: 0.8,
      followUpQuestIds: ["status_update"],
    },
  ],
  rewards: { baseXp: 80, skills: { conflict_resolution: 1, communication: 0.7, confidence: 0.6, negotiation: 0.5 } },
});
