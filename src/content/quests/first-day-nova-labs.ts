/**
 * FIRST DAY AT NOVA LABS — the follow-up that proves persistence.
 *
 * Emma remembers how the negotiation went (memory + relationship), and the
 * world state (salary, "emma.bruised" flag) shapes the scene. A lighter quest:
 * rapport, listening, and a small ask (which team, who to meet).
 */
import { defineQuest } from "@/engine/types/quest";
import { formatINR } from "@/engine/util";

interface Hidden extends Record<string, unknown> {
  bruised: boolean;
  baseSalary: number;
  managerName: string;
  teamProblem: string;
}
interface Scene extends Record<string, unknown> {
  introducedToManager: boolean;
  learnedTeamProblem: boolean;
  askedAboutEmma: boolean;
}

export const firstDayNovaLabs = defineQuest<Hidden, Scene>({
  id: "first_day_nova_labs",
  title: "First Day at Nova Labs",
  tagline: "Emma remembers how the negotiation went.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "emma_kapoor",
  difficulty: 1,
  skills: ["communication", "listening", "confidence"],
  order: 20,
  briefing: {
    situation: "It's 9:10 on your first morning. Emma is walking you from reception to the platform floor. This is a five-minute conversation, and she's the person who knows everyone.",
    objective: "Start the relationship well and find out something useful about the team before you meet your manager.",
    intel: ["Emma remembers your negotiation — all of it.", "Your manager is on the platform team.", "First impressions here travel fast."],
    hint: "Ask about people, not perks.",
  },
  prerequisites: [
    { type: "quest_completed", questId: "counter_offer" },
    { type: "world_flag", flag: "nova_labs.joined" },
  ],
  objectives: [
    { id: "learn_manager", label: "Learn who your manager is", kind: "primary", description: "Find out the manager's name.", check: (s) => (s.custom as Scene).introducedToManager },
    { id: "learn_problem", label: "Learn what the team is struggling with", kind: "hidden", description: "Discover the team's current problem.", check: (s) => (s.custom as Scene).learnedTeamProblem },
    { id: "reciprocate", label: "Ask Emma something about herself", kind: "optional", description: "Player asked Emma a genuine question about her, not the job.", check: (s) => (s.custom as Scene).askedAboutEmma },
  ],
  scene: {
    createHidden: ({ world }) => ({
      bruised: world.flags.includes("emma.bruised"),
      baseSalary: world.career.baseSalary ?? 850000,
      managerName: "Rohan Mehta",
      teamProblem: "the release is three weeks late and Rohan is covering for two people who left",
    }),
    createCustom: () => ({ introducedToManager: false, learnedTeamProblem: false, askedAboutEmma: false }),
    initialPatience: ({ hidden, npc }) => (hidden.bruised ? 45 : 70) + Math.round(npc.relationship.warmth / 6),
    opening: {
      generatedHint: "You're walking them in on their first day. Greet them by name. Reference, in your own words, how the negotiation went — warmly if it went well, a little cool if they were aggressive. Ask how they're feeling.",
    },
    npcSituation: ({ hidden, playerName }) =>
      `It's ${playerName}'s first day. You are walking them to the platform floor. They joined at ${formatINR(hidden.baseSalary)} base. Their manager is ${hidden.managerName}. ${hidden.bruised ? "The negotiation left a bad taste; you're professional but not warm." : "You liked how the negotiation went and you're glad they're here."}`,
    hiddenBriefing: ({ hidden }) =>
      [
        `The manager is ${hidden.managerName}. Say the name if they ask who they report to, or naturally when you reach the floor.`,
        `The team's real problem: ${hidden.teamProblem}. Only share this if they ask about the team, what to expect, or how things are going — and only if you feel warm toward them.`,
        `You have a story about yourself (you used to be an engineer before recruiting) that you share if they show genuine interest in you.`,
      ].join("\n"),
    revealableKeys: {
      manager_name: "you told them their manager's name",
      team_problem: "you told them about the late release / short-staffed team",
      emma_backstory: "you shared something personal about yourself",
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
      if (hidden.bruised) notes.push("You remember them being aggressive in the negotiation. Be courteous but don't volunteer extra help unless they're genuinely warm now.");
      if (scene.turnCount >= 2 && !scene.revealed.includes("manager_name")) notes.push("You're nearly at the floor; it's natural to mention who they'll report to soon.");
      if (scene.turnCount >= 4) notes.push("You're arriving at the floor. Wrap up within a turn or two and hand them over.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 7,
  },
  rubric: [
    { id: "warmth", skill: "communication", facet: "tone", label: "Tone", description: "Did the player read the room and match Emma's energy?", anchors: { exemplary: "Warm, brief, appropriate to a corridor chat.", weak: "Stiff, over-formal, or launched into demands." }, weight: 1 },
    { id: "questions", skill: "listening", facet: "questioning", label: "Questioning", description: "Did the player ask questions that surfaced useful information about the team?", anchors: { exemplary: "Asked about the team, the manager, and what's hard right now.", weak: "Only talked about themselves or logistics." }, weight: 1.2 },
    { id: "composure", skill: "confidence", facet: "composure", label: "Composure", description: "Did the player handle any coolness from Emma without over-apologising or getting defensive?", anchors: { exemplary: "Acknowledged the negotiation lightly and moved on.", weak: "Grovelled or ignored obvious coolness." }, weight: 0.8 },
  ],
  outcomes: [
    {
      id: "well_started",
      label: "Well started",
      grade: "success",
      when: ({ objectivesAchieved, scene }) => objectivesAchieved.has("learn_manager") && scene.patience >= 40,
      narrative: ({ scene }) => `Emma hands you over to Rohan with a good word. ${scene.custom.learnedTeamProblem ? "You also know the release is late — Rohan will appreciate that you're not surprised." : "You'll find out about the late release soon enough."}`,
      consequences: ({ scene }) => [
        { type: "world.person.met", npcId: "rohan_mehta" },
        { type: "world.unlock.quest", questId: "push_back_on_deadline" },
        { type: "world.var.set", key: "nova_labs.knows_release_late", value: scene.custom.learnedTeamProblem },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { warmth: 6, familiarity: 10, trust: 3 } },
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
      rewardMultiplier: 0.8,
      followUpQuestIds: ["push_back_on_deadline"],
    },
  ],
  rewards: { baseXp: 50, skills: { communication: 1, listening: 0.9, confidence: 0.5 } },
});
