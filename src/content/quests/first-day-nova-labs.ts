/**
 * FIRST DAY AT NOVA LABS — chapter 4. Proves persistence.
 *
 * Emma remembers how the negotiation went (memory + relationship) and the
 * world state shapes her attitude: collaborative, hardball, took-the-first-offer
 * and told-her-your-floor each produce a different Emma. A light quest:
 * rapport, listening, and finding out what the team is really dealing with.
 */
import { defineQuest } from "@/engine/types/quest";
import type { WorldState } from "@/engine/types/world";
import { formatINR } from "@/engine/util";

type Style = "collaborative" | "hardball" | "accepted_immediately" | "revealed_floor" | "modest" | "no_change" | null;

interface Hidden extends Record<string, unknown> {
  bruised: boolean;
  style: Style;
  baseSalary: number;
  managerName: string;
  teamProblem: string;
  alreadyKnowsProblem: boolean;
  rohanImpressed: boolean;
}
interface Scene extends Record<string, unknown> {
  introducedToManager: boolean;
  learnedTeamProblem: boolean;
  askedAboutEmma: boolean;
}

function styleOf(world: WorldState): Style {
  const s = world.vars["counter_offer.style"];
  return typeof s === "string" ? (s as Style) : null;
}

const EMMA_ATTITUDE: Record<Exclude<Style, null>, string> = {
  collaborative: "You liked how the negotiation went: they did their homework and stayed decent. You're glad they're here and it shows.",
  hardball: "The negotiation left a bad taste. You're professional, but cool, and you don't volunteer extra help unless they're genuinely warm now.",
  accepted_immediately: "They took your first offer without a single question. You're friendly, and privately think they left money on the table. You might tease them about it, once, lightly.",
  revealed_floor: "In the negotiation they told you their floor and you met it exactly. You're friendly; you know exactly what they'll accept.",
  modest: "The negotiation was fine. Unremarkable. You're friendly.",
  no_change: "They didn't really negotiate. You're friendly.",
};

export const firstDayNovaLabs = defineQuest<Hidden, Scene>({
  id: "first_day_nova_labs",
  title: "First Day at Nova Labs",
  tagline: "Emma remembers how the negotiation went.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "emma_kapoor",
  difficulty: 1,
  skills: ["communication", "listening", "confidence"],
  order: 40,
  briefing: {
    situation: "It's 9:10 on your first morning. Emma is walking you from reception to the platform floor. It's a five-minute walk, and she's the person who knows everyone.",
    objective: "Start well and find out something useful about the team before you meet your manager.",
    intel: ["Your manager runs the platform team.", "First impressions here travel fast."],
    hint: "Ask about people, not perks.",
  },
  prerequisites: [
    { type: "quest_completed", questId: "counter_offer" },
    { type: "world_flag", flag: "nova_labs.joined" },
  ],
  carryOver: ({ world }) => {
    const style = styleOf(world);
    const lines: string[] = [];
    if (style === "collaborative") lines.push("You negotiated well and fairly. Emma walked away liking you.");
    if (style === "hardball") lines.push("You pushed Emma hard in the negotiation. She hasn't forgotten.");
    if (style === "accepted_immediately") lines.push("You took Emma's first offer on the spot. She noticed.");
    if (style === "revealed_floor") lines.push("You told Emma your floor. She met it exactly, and she knows it.");
    if (style === "modest") lines.push("The negotiation was unremarkable. Emma has no strong feelings about you yet. This is your chance.");
    if (style === "no_change") lines.push("You didn't move the offer. Emma thinks you're easy to work with, and maybe easy to overlook.");
    if (world.career.baseSalary) lines.push(`You're starting at ${formatINR(world.career.baseSalary)} base.`);
    if (world.vars["nova_labs.knows_release_late"] === true) lines.push("Rohan told you in the interview that the release is late. You won't be surprised.");
    return lines;
  },
  objectives: [
    { id: "learn_manager", label: "Learn who your manager is", kind: "primary", description: "Find out the manager's name.", check: (s) => (s.custom as Scene).introducedToManager },
    { id: "learn_problem", label: "Learn what the team is struggling with", kind: "hidden", description: "Discover the team's current problem.", check: (s) => (s.custom as Scene).learnedTeamProblem },
    { id: "reciprocate", label: "Ask Emma something about herself", kind: "optional", description: "Player asked Emma a genuine question about her, not the job.", check: (s) => (s.custom as Scene).askedAboutEmma },
  ],
  scene: {
    createHidden: ({ world }) => ({
      bruised: world.flags.includes("emma.bruised"),
      style: styleOf(world),
      baseSalary: world.career.baseSalary ?? 850000,
      managerName: "Rohan Mehta",
      teamProblem: "the release is three weeks late and Rohan is covering for two people who left",
      alreadyKnowsProblem: world.vars["nova_labs.knows_release_late"] === true,
      rohanImpressed: world.vars["interview.verdict"] === "strong",
    }),
    createCustom: (h) => ({ introducedToManager: false, learnedTeamProblem: h.alreadyKnowsProblem, askedAboutEmma: false }),
    initialPatience: ({ hidden, npc }) => (hidden.bruised ? 45 : 70) + Math.round(npc.relationship.warmth / 6),
    opening: {
      generatedHint:
        "You're walking them in on their first day. Greet them by name. Make one small, natural reference to how the negotiation went, in your own words and in keeping with how you feel about it. Then ask how they're feeling.",
    },
    npcSituation: ({ hidden, playerName }) =>
      `It's ${playerName}'s first day. You're walking them to the platform floor. They joined at ${formatINR(hidden.baseSalary)} base. Their manager is ${hidden.managerName}. ${hidden.style ? EMMA_ATTITUDE[hidden.style] : hidden.bruised ? EMMA_ATTITUDE.hardball : EMMA_ATTITUDE.modest}${hidden.rohanImpressed ? " Rohan told you he's expecting big things from them." : ""}`,
    hiddenBriefing: ({ hidden }) =>
      [
        `The manager is ${hidden.managerName}. Say the name if they ask who they report to, or naturally when you reach the floor.`,
        hidden.alreadyKnowsProblem
          ? "Rohan already told them the release is late. If they bring it up, you can add that two people left last quarter and Rohan is covering for them."
          : `The team's real problem: ${hidden.teamProblem}. Only share it if they ask about the team or what to expect, and only if you feel warm toward them.`,
        "You used to be an engineer before recruiting. Share that only if they show genuine interest in you.",
      ].join("\n"),
    revealableKeys: {
      manager_name: "you told them their manager's name",
      team_problem: "you told them about the late release / short-staffed team",
      emma_backstory: "you shared something personal about yourself",
    },
    preTurn: ({ scene }, read, text) => {
      const c: Scene = { ...scene.custom };
      if (read.signals.includes("good_question") && /\b(you|your)\b/.test(text.toLowerCase()) && /\b(how long|what do you|do you like|before|background|how did you|enjoy)\b/.test(text.toLowerCase())) c.askedAboutEmma = true;
      return { custom: c };
    },
    inferMovesFromSpeech: (speech) => {
      const reveal: string[] = [];
      if (/rohan/i.test(speech)) reveal.push("manager_name");
      if (/(release is (late|behind)|three weeks|two (people|engineers) (left|quit)|short[- ]?staffed|covering for)/i.test(speech)) reveal.push("team_problem");
      if (/(i used to|i was an engineer|back when i (was|wrote)|before recruiting)/i.test(speech)) reveal.push("emma_backstory");
      return { reveal };
    },
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      if (moves.reveal.includes("manager_name") || scene.revealed.includes("manager_name")) custom.introducedToManager = true;
      if (moves.reveal.includes("team_problem") || scene.revealed.includes("team_problem")) custom.learnedTeamProblem = true;
      if (moves.reveal.includes("emma_backstory") || scene.revealed.includes("emma_backstory")) custom.askedAboutEmma = true;
      return { custom };
    },
    director: ({ hidden, scene }) => {
      const notes: string[] = [];
      if (hidden.bruised) notes.push("You remember them being aggressive in the negotiation. Courteous, not warm, unless they're genuinely warm now.");
      if (scene.turnCount >= 2 && !scene.revealed.includes("manager_name")) notes.push("You're nearly at the floor; mention who they'll report to.");
      if (scene.turnCount >= 4) notes.push("You're arriving at the floor. Wrap up within a turn and hand them over.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 7,
  },
  rubric: [
    { id: "warmth", skill: "communication", facet: "tone", label: "Tone", description: "Did the player read the room and match Emma's energy?", anchors: { exemplary: "Warm, brief, right for a corridor chat.", weak: "Stiff, over-formal, or launched into demands." }, weight: 1 },
    { id: "questions", skill: "listening", facet: "questioning", label: "Questioning", description: "Did the player ask questions that surfaced useful information about the team?", anchors: { exemplary: "Asked about the team, the manager, and what's hard right now.", weak: "Only talked about themselves or logistics." }, weight: 1.2 },
    { id: "composure", skill: "confidence", facet: "composure", label: "Composure", description: "Did the player handle any coolness from Emma without over-apologising or getting defensive?", anchors: { exemplary: "Acknowledged the negotiation lightly and moved on.", weak: "Grovelled or ignored obvious coolness." }, weight: 0.8 },
  ],
  outcomes: [
    {
      id: "well_started",
      label: "Well started",
      grade: "success",
      when: ({ objectivesAchieved, scene }) => objectivesAchieved.has("learn_manager") && scene.patience >= 40,
      narrative: ({ scene, hidden }) =>
        `Emma hands you over to Rohan with a good word.${hidden.bruised ? " The negotiation is behind you, mostly." : ""} ${scene.custom.learnedTeamProblem ? "You know the release is late. Rohan will appreciate that you're not surprised." : "You'll find out about the late release soon enough."}`,
      consequences: ({ scene }) => [
        { type: "world.person.met", npcId: "rohan_mehta" },
        { type: "world.unlock.quest", questId: "push_back_on_deadline" },
        { type: "world.var.set", key: "nova_labs.knows_release_late", value: scene.custom.learnedTeamProblem },
        { type: "world.flag.remove", flag: "emma.bruised" },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { warmth: 6, familiarity: 10, trust: 3 } },
      ],
      aftermath: ({ hidden }) => [
        hidden.bruised ? "You repaired things with Emma. She'll put in a good word now." : "Emma is on your side at Nova Labs.",
        "Rohan has a deadline for you. It's coming.",
      ],
      rewardMultiplier: 1.1,
      followUpQuestIds: ["push_back_on_deadline"],
    },
    {
      id: "awkward",
      label: "Awkward start",
      grade: "partial",
      when: () => true,
      narrative: () => "You reach the floor. Emma points at a desk and goes back to her day. You'll meet Rohan on your own.",
      consequences: () => [
        { type: "world.person.met", npcId: "rohan_mehta" },
        { type: "world.unlock.quest", questId: "push_back_on_deadline" },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { familiarity: 8, warmth: -2 } },
      ],
      aftermath: () => ["Emma won't be going out of her way for you.", "Rohan has a deadline for you. It's coming."],
      rewardMultiplier: 0.8,
      followUpQuestIds: ["push_back_on_deadline"],
    },
  ],
  rewards: { baseXp: 50, skills: { communication: 1, listening: 0.9, confidence: 0.5 } },
});
