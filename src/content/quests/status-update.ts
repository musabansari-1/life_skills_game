/**
 * THE STATUS UPDATE — chapter 6, the payoff of the Nova Labs campaign.
 *
 * What went wrong depends on what you agreed in "Push Back on a Deadline":
 *  - caved to Friday  → the rushed migration broke 2% of customer records in production
 *  - agreed a plan    → you've found an edge case and will miss your own agreed date by a day
 *  - left it vague    → the director is asking Rohan for a date nobody owns
 * Rohan already has a partial picture in the incident case. Owning it vs.
 * minimising it is the choice that sticks.
 */
import { defineQuest } from "@/engine/types/quest";
import type { WorldState } from "@/engine/types/world";

type Situation = "incident" | "slip" | "unowned";

interface Hidden extends Record<string, unknown> {
  situation: Situation;
  impact: string;
  rohanKnows: string;
  overpromised: boolean;
}
interface Scene extends Record<string, unknown> {
  admitted: boolean;
  minimized: boolean;
  blamed: boolean;
  gaveImpact: boolean;
  proposedFix: boolean;
}

const ADMIT = /\b(my (fault|mistake|call|bad|responsibility)|i (messed|screwed) up|that'?s on me|i should (have|'?ve)|i made (a|the) (mistake|call)|i own (this|it|that)|i was wrong|i take (full )?responsibility|i rushed)\b/;
const MINIMIZE = /\b(not (a )?big deal|minor|small (issue|thing|problem|glitch)|nothing (serious|major)|should be fine|only a (few|couple|handful)|barely|no real impact|it'?s fine|not that bad|blip)\b/;
const BLAME = /\b((qa|ops|infra|the other team|product|they|devops|on[- ]call)('s)? (fault|missed|didn'?t|should have)|not my fault|because (they|someone|the other team))\b/;
const IMPACT = /(\d+(\.\d+)?\s*(%|percent|records|accounts|customers|users|rows|tables|hours|days)|\b(two|three|few|several) (percent|thousand|hundred)\b)/;
const FIX = /\b(roll ?back|restore|backfill|re-?run|patch|fix|script|plan is|here'?s (the|my) plan|i'?ll (have|get|ship|send|fix|finish|restore)|by (tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|eod|end of (day|week)|noon|\d{1,2}\s?(am|pm)))\b/;

function situationOf(world: WorldState): Situation {
  if (world.flags.includes("nova_labs.rushed_migration")) return "incident";
  if (world.commitments.some((c) => c.toNpcId === "rohan_mehta" && c.status === "open" && /migration/i.test(c.description))) return "slip";
  return "unowned";
}

const SITUATIONS: Record<Situation, { briefing: string; impact: string; rohanKnows: string }> = {
  incident: {
    briefing:
      "You shipped the migration Friday, as you promised Rohan, without the rollback path. Saturday morning you found it: about 2% of customer records (roughly 3,000 accounts) didn't migrate cleanly. You can restore them, but it'll take until Monday. Rohan is at his desk. You need to tell him.",
    impact: "about 2% of customer records (roughly 3,000 accounts) failed to migrate; a restore is possible but takes until Monday",
    rohanKnows: "You saw an on-call alert about errors on the accounts service this morning, but you don't know the cause or the size yet.",
  },
  slip: {
    briefing: "You agreed a plan with Rohan: partial delivery Friday, full migration with rollback after. Tuesday night you found an edge case in the rollback path. The full migration will be a day late. Rohan doesn't know yet, and he hates surprises.",
    impact: "an edge case in the rollback path means the full migration lands one day after the agreed date",
    rohanKnows: "You don't know anything is wrong. As far as you know, the plan is on track.",
  },
  unowned: {
    briefing: "The deadline conversation with Rohan never reached a decision. Now his director wants a date for the migration, and Rohan has stopped at your desk to ask you for one.",
    impact: "no agreed date; the migration is about three days from done if nothing goes wrong",
    rohanKnows: "Your director wants a date by end of day. You don't have one because nobody agreed it last time.",
  },
};

export const statusUpdate = defineQuest<Hidden, Scene>({
  id: "status_update",
  title: "The Status Update",
  tagline: "Something went wrong. Rohan needs to hear it from you.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "rohan_mehta",
  difficulty: 3,
  skills: ["confidence", "communication", "conflict_resolution", "leadership"],
  order: 60,
  briefing: {
    situation: "What happens here depends on what you agreed with Rohan about the migration deadline.",
    objective: "Tell Rohan the truth, with the impact and a plan, before he hears it from someone else.",
    intel: ["Rohan hates surprises more than he hates bad news.", "He has a director asking him questions too."],
    hint: "Lead with the impact. Then the plan. Then what you'll do differently.",
  },
  prerequisites: [{ type: "world_unlocked_quest", questId: "status_update" }],
  carryOver: ({ world, npcs }) => {
    const s = situationOf(world);
    const lines = [SITUATIONS[s].briefing];
    if (world.flags.includes("interview.overpromised")) lines.push("In your interview you promised Rohan you'd be shipping in week one. He hasn't forgotten.");
    if (world.flags.includes("interview.blamed_others")) lines.push("Rohan watched you blame others in your interview. He's waiting to see if you do it again.");
    if ((npcs.rohan_mehta?.relationship.trust ?? 0) >= 15) lines.push("Rohan trusts you. That buys you a hearing, not a pass.");
    return lines;
  },
  objectives: [
    { id: "own_it", label: "Own it", kind: "primary", description: "The player clearly owned their part.", check: (s) => (s.custom as Scene).admitted && !(s.custom as Scene).blamed },
    { id: "state_impact", label: "State the impact plainly", kind: "hidden", description: "The player gave the real size of the problem, with numbers.", check: (s) => (s.custom as Scene).gaveImpact && !(s.custom as Scene).minimized },
    { id: "bring_plan", label: "Bring a plan with a time", kind: "hidden", description: "The player proposed a concrete fix with a timeline.", check: (s) => (s.custom as Scene).proposedFix },
  ],
  scene: {
    createHidden: ({ world }) => {
      const s = situationOf(world);
      return { situation: s, impact: SITUATIONS[s].impact, rohanKnows: SITUATIONS[s].rohanKnows, overpromised: world.flags.includes("interview.overpromised") };
    },
    createCustom: () => ({ admitted: false, minimized: false, blamed: false, gaveImpact: false, proposedFix: false }),
    initialPatience: ({ hidden, npc }) => (hidden.situation === "incident" ? 50 : 60) + Math.round(npc.relationship.trust / 4),
    opening: {
      generatedHint: "They've asked for a quick word, or you've stopped at their desk. You're busy. One short line: ask what's up (or, if the director wants a date, ask for it).",
    },
    npcSituation: ({ hidden, playerName }) => `${playerName} works on your team and owns the database migration. ${hidden.rohanKnows}`,
    hiddenBriefing: ({ hidden }) =>
      [
        `What's actually going on (only ${hidden.situation === "incident" ? "partly " : "not "}known to you): ${hidden.impact}.`,
        hidden.situation === "incident" ? "If they downplay it, you notice: the alert you saw didn't look minor. Call it out." : "",
        "What you respect: the size of the problem stated plainly, their part owned, a plan with a time. What you hate: surprises, spin, blame.",
        hidden.overpromised ? "In their interview they promised to be shipping in week one. If they're vague about timing, remind them." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    revealableKeys: { director_pressure: "you told them your director is asking and what you need from them" },
    preTurn: ({ scene, hidden }, read, text) => {
      const c: Scene = { ...scene.custom };
      const t = text.toLowerCase();
      const dir: string[] = [];
      const moves: { noticed: ("owned_mistake" | "contradiction")[] } = { noticed: [] };
      if (ADMIT.test(t)) {
        c.admitted = true;
        moves.noticed.push("owned_mistake");
      }
      if (MINIMIZE.test(t)) {
        c.minimized = true;
        if (hidden.situation === "incident") {
          moves.noticed.push("contradiction");
          dir.push("They just played it down. The alert you saw this morning didn't look minor. Say so, sharply.");
        }
      }
      if (BLAME.test(t)) {
        c.blamed = true;
        dir.push("They just pointed at someone else. Ask what they own in this.");
      }
      if (IMPACT.test(t)) c.gaveImpact = true;
      if (FIX.test(t)) c.proposedFix = true;
      if (c.admitted && c.proposedFix && !c.minimized) dir.push("They've owned it and brought a plan. You're still unhappy about the problem, but this is how you want bad news delivered. Agree the plan and say so, briefly.");
      return { custom: c, direction: dir, moves };
    },
    director: ({ scene }) => {
      const notes: string[] = [];
      if (scene.turnCount >= 2 && !scene.custom.proposedFix) notes.push("Ask directly: what's the plan, and when?");
      if (scene.turnCount >= 5) notes.push("You need to go update your director. Wrap up.");
      return notes;
    },
    minTurns: 2,
    maxTurns: 7,
  },
  rubric: [
    { id: "own", skill: "confidence", facet: "ownership", label: "Ownership", description: "Did the player own their part without spin or blame?", anchors: { exemplary: "'I shipped without the rollback. That's on me.'", weak: "Blamed others or talked around it." }, weight: 1.3 },
    { id: "impact", skill: "communication", facet: "clarity", label: "Impact, plainly", description: "Did the player state the real size of the problem up front?", anchors: { exemplary: "Numbers first: how many, how bad, since when.", weak: "'A small issue' when it wasn't." }, weight: 1.2 },
    { id: "plan", skill: "leadership", facet: "direction", label: "A plan with a time", description: "Did the player bring a concrete fix and a timeline?", anchors: { exemplary: "'Restore runs tonight, all accounts back by Monday 10am.'", weak: "'We'll look into it.'" }, weight: 1.2 },
    { id: "calm", skill: "conflict_resolution", facet: "de_escalation", label: "Staying steady", description: "Did the player stay calm when Rohan reacted?", anchors: { exemplary: "Acknowledged his frustration and kept to facts.", weak: "Got defensive or over-apologised." }, weight: 0.8 },
  ],
  evaluatorNotes: "Minimising a real problem is the worst move here, worse than a clumsy admission. Over-apologising without a plan is weak. The strongest updates lead with impact, own the cause, and give a time-bound plan.",
  outcomes: [
    {
      id: "owned_it",
      label: "Owned it",
      grade: "success",
      when: ({ scene }) => scene.custom.admitted && scene.custom.proposedFix && !scene.custom.minimized && !scene.custom.blamed,
      narrative: ({ hidden }) =>
        hidden.situation === "incident"
          ? "Rohan was angry for about ten seconds. Then he asked what you needed. The restore ran overnight; he told his director before anyone else could."
          : "Rohan didn't love the news, but he got it early, with a plan. He moved the date himself.",
      consequences: ({ world }) => [
        ...resolveRohanCommitments(world, "broken"),
        { type: "world.flag.add", flag: "chapter1.owned_incident" },
        { type: "world.flag.add", flag: "chapter1.complete" },
        { type: "world.reputation.delta", domain: "career_city", delta: 6 },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 12, respect: 8, familiarity: 10 } },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "They came to me with bad news, owned it, and brought a plan. That's the person I want on this team.", importance: 0.9, emotionalTone: "positive" },
      ],
      aftermath: () => ["Rohan trusts your bad news now. That's rare, and it compounds.", "Chapter One is complete."],
      rewardMultiplier: 1.3,
    },
    {
      id: "covered_up",
      label: "Played it down",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.minimized || scene.custom.blamed || (hidden.situation === "incident" && !scene.custom.admitted),
      narrative: ({ hidden }) =>
        hidden.situation === "incident"
          ? "You called it minor. By Monday, support had 400 tickets and Rohan's director had the real number before Rohan did."
          : "You talked around it. When the date slipped, Rohan found out from the dashboard, not from you.",
      consequences: ({ world }) => [
        ...resolveRohanCommitments(world, "broken"),
        { type: "world.flag.add", flag: "chapter1.hid_incident" },
        { type: "world.flag.add", flag: "chapter1.complete" },
        { type: "world.reputation.delta", domain: "career_city", delta: -8 },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: -18, respect: -6, familiarity: 10 } },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "They told me it was minor. It wasn't. I found out from someone else.", importance: 0.95, emotionalTone: "negative" },
      ],
      aftermath: () => ["Rohan found out the real size of it from someone else. He'll double-check everything you tell him now.", "Chapter One is complete."],
      rewardMultiplier: 0.7,
    },
    {
      id: "messy",
      label: "Got there, eventually",
      grade: "partial",
      when: () => true,
      narrative: () => "Rohan got the picture in the end, but he had to drag it out of you.",
      consequences: ({ world }) => [
        ...resolveRohanCommitments(world, "broken"),
        { type: "world.flag.add", flag: "chapter1.complete" },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 2, respect: 0, familiarity: 10 } },
      ],
      aftermath: () => ["Next time, lead with the impact and a plan. Rohan noticed he had to ask.", "Chapter One is complete."],
      rewardMultiplier: 0.9,
    },
  ],
  rewards: { baseXp: 90, skills: { confidence: 1, communication: 0.8, conflict_resolution: 0.7, leadership: 0.6 } },
});

function resolveRohanCommitments(world: WorldState, status: "fulfilled" | "broken") {
  return world.commitments
    .filter((c) => c.toNpcId === "rohan_mehta" && c.status === "open")
    .map((c) => ({ type: "world.commitment.resolve" as const, commitmentId: c.id, status }));
}
