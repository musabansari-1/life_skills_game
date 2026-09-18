/**
 * INTRODUCE YOURSELF — a warm-up in the Everyday District with no prerequisites.
 * Proves the engine works for low-stakes, rapport-driven scenes.
 */
import { defineQuest } from "@/engine/types/quest";

interface Hidden extends Record<string, unknown> {
  priyaInAHurry: boolean;
}
interface Scene extends Record<string, unknown> {
  learnedAboutPriya: boolean;
  invitedSomewhere: boolean;
}

export const introduceYourself = defineQuest<Hidden, Scene>({
  id: "introduce_yourself",
  title: "Introduce Yourself",
  tagline: "New building. Neighbour in the lift. Thirty seconds.",
  worldId: "everyday_district",
  locationId: "everyday_district.neighbourhood",
  npcId: "priya_nair",
  difficulty: 1,
  skills: ["communication", "storytelling", "listening"],
  order: 1,
  briefing: {
    situation: "You moved into Lakeview Apartments last week. In the lift this morning: Priya from 4B, coffee in hand, clearly on her way somewhere.",
    objective: "Make a genuine first impression and learn something about her.",
    intel: ["She seems to know everyone in the building.", "She's in a hurry most mornings."],
    hint: "Two sentences about you, then a question about her.",
  },
  prerequisites: [],
  objectives: [
    { id: "learn_about_her", label: "Learn something about Priya", kind: "primary", description: "Find out what she does or something personal.", check: (s) => (s.custom as Scene).learnedAboutPriya },
    { id: "be_concise", label: "Keep it lift-sized", kind: "hidden", description: "The player kept their self-introduction short and specific rather than rambling." },
    { id: "invitation", label: "Get an invitation", kind: "optional", description: "Priya invited the player somewhere (bakery, building group, etc.).", check: (s) => (s.custom as Scene).invitedSomewhere },
  ],
  scene: {
    createHidden: () => ({ priyaInAHurry: true }),
    createCustom: () => ({ learnedAboutPriya: false, invitedSomewhere: false }),
    initialPatience: () => 60,
    opening: { generatedHint: "You're in the lift with the new neighbour. Say a quick friendly hello and ask if they're the new one in 6C." },
    npcSituation: () => "You're in the lift, running slightly late to open the bakery. The new neighbour from 6C is here. You're curious but you have about a minute.",
    hiddenBriefing: ({ hidden }) =>
      [
        `You run the bakery on the corner ('Crumb'). Share it if they ask what you do.`,
        `You'll invite them to the bakery or the building's Sunday coffee only if they ask about you and don't just talk about themselves.`,
        hidden.priyaInAHurry ? "You are in a hurry; if they ramble, you politely cut it short at your floor." : "",
      ].join("\n"),
    revealableKeys: {
      bakery: "you told them about your bakery",
      sunday_coffee: "you invited them to the building's Sunday coffee or to the bakery",
    },
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      if (moves.reveal.includes("bakery") || scene.revealed.includes("bakery")) custom.learnedAboutPriya = true;
      if (moves.reveal.includes("sunday_coffee") || scene.revealed.includes("sunday_coffee")) custom.invitedSomewhere = true;
      return { custom };
    },
    director: ({ scene }) => (scene.turnCount >= 3 ? ["The lift is nearly at your floor; wrap up in a turn or two."] : []),
    minTurns: 2,
    maxTurns: 5,
  },
  rubric: [
    { id: "concise", skill: "communication", facet: "concision", label: "Concision", description: "Did the player introduce themselves in a lift-sized way?", anchors: { exemplary: "Two crisp sentences with one memorable detail.", weak: "A CV recital." }, weight: 1.2 },
    { id: "specific", skill: "storytelling", facet: "specificity", label: "Specificity", description: "Did the player use a concrete, memorable detail about themselves?", anchors: { exemplary: "'I moved here for the job at Nova Labs and I've already got lost twice.'", weak: "'I'm a professional, I like travelling.'" }, weight: 1 },
    { id: "curiosity", skill: "listening", facet: "questioning", label: "Curiosity", description: "Did the player ask Priya about herself?", anchors: { exemplary: "Asked a real question and followed up on the answer.", weak: "Never asked." }, weight: 1.2 },
  ],
  outcomes: [
    {
      id: "connected",
      label: "Connected",
      grade: "success",
      when: ({ objectivesAchieved }) => objectivesAchieved.has("learn_about_her"),
      narrative: ({ scene }) => (scene.custom.invitedSomewhere ? "Priya invited you to Crumb. You now know one person in the building — the right one." : "Priya knows your name now, and you know hers. That's how it starts."),
      consequences: ({ scene }) => [
        { type: "world.person.met", npcId: "priya_nair" },
        { type: "relationship.delta", npcId: "priya_nair", delta: { warmth: scene.custom.invitedSomewhere ? 12 : 6, familiarity: 15, trust: 4 } },
        ...(scene.custom.invitedSomewhere ? [{ type: "world.opportunity.add" as const, description: "Sunday coffee at Crumb with Priya", sourceNpcId: "priya_nair", questId: null }] : []),
      ],
      rewardMultiplier: 1,
    },
    {
      id: "forgettable",
      label: "Forgettable",
      grade: "partial",
      when: () => true,
      narrative: () => "The doors opened, she smiled, she left. She'll remember your face, not your name.",
      consequences: () => [
        { type: "world.person.met", npcId: "priya_nair" },
        { type: "relationship.delta", npcId: "priya_nair", delta: { familiarity: 8 } },
      ],
      rewardMultiplier: 0.7,
    },
  ],
  rewards: { baseXp: 40, skills: { communication: 1, storytelling: 0.7, listening: 0.8 } },
});
