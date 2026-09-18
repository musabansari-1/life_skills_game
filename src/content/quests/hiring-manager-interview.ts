/**
 * HIRING MANAGER INTERVIEW — chapter 2 of the Nova Labs campaign.
 *
 * Rohan tests two things: whether you own your failures, and whether you'll
 * tell him the truth about timelines. What carries forward:
 *  - interview.verdict (strong/solid/shaky) sets Emma's ceiling in The Counter Offer
 *  - an overpromise ("shipping in week one") becomes a commitment Rohan holds you to
 *  - learning about the late release changes First Day and the deadline quest
 */
import { defineQuest } from "@/engine/types/quest";

interface Hidden extends Record<string, unknown> {
  teamProblem: string;
}
interface Scene extends Record<string, unknown> {
  overpromised: boolean;
  blamedOthers: boolean;
  gaveSpecificStory: boolean;
  askedGoodQuestion: boolean;
  learnedTeamProblem: boolean;
}

const OVERPROMISE =
  /\b(first week|week one|day one|right away|immediately|from day one|in no time|hit the ground running|no ramp[- ]?up|straight away)\b[\s\S]{0,60}\b(ship|shipping|deliver|productive|contribut|own|lead|fix)|\b(ship|shipping|deliver|productive|contribut)\w*\b[\s\S]{0,40}\b(first week|week one|day one|right away|immediately|straight away)\b/;
const BLAME = /\b(my (manager|team|boss|lead|colleague)'?s? (fault|mistake)|not my fault|(they|the team|my team|my manager|management) (didn'?t|failed|never|messed|screwed)|because of (them|my team|my manager|management|the other team))\b/;

export const hiringManagerInterview = defineQuest<Hidden, Scene>({
  id: "hiring_manager_interview",
  title: "The Hiring Manager",
  tagline: "Rohan has one question he cares about. You won't know which.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "rohan_mehta",
  difficulty: 2,
  skills: ["storytelling", "confidence", "communication", "listening"],
  order: 20,
  briefing: {
    situation: "Emma put you forward. Rohan Mehta runs the platform team you'd join: ex-staff engineer, eighteen months into managing, visibly short on time. Thirty minutes in a glass meeting room.",
    objective: "Show Rohan you're someone he can rely on, and leave with an offer.",
    intel: ["Rohan hates surprises.", "He asks follow-up questions until he hits something real."],
    hint: "When he asks about a failure, own your part of it.",
  },
  prerequisites: [{ type: "world_unlocked_quest", questId: "hiring_manager_interview" }],
  carryOver: ({ npcs, world }) => {
    const lines: string[] = [];
    if ((npcs.rohan_mehta?.memory.events ?? []).some((e) => /sharp in screening/.test(e.summary))) lines.push("Emma told Rohan you were sharp. He's expecting a good conversation.");
    else lines.push("Emma passed you along without much of a recommendation. Rohan has no opinion of you yet.");
    if (typeof world.vars["screening.stated_expectation"] === "number") lines.push("Your salary number is already in your file.");
    return lines;
  },
  objectives: [
    { id: "own_failure", label: "Own a failure honestly", kind: "primary", description: "When asked about something that went wrong, the player described their own part and what they changed, without blaming others.", check: (s) => !(s.custom as Scene).blamedOthers && (s.custom as Scene).gaveSpecificStory },
    { id: "no_overpromise", label: "Don't overpromise", kind: "hidden", description: "The player gave a realistic answer about ramp-up time.", check: (s) => !(s.custom as Scene).overpromised },
    { id: "learn_problem", label: "Find out what the team is struggling with", kind: "optional", description: "The player learned about the late release.", check: (s) => (s.custom as Scene).learnedTeamProblem },
  ],
  scene: {
    createHidden: () => ({ teamProblem: "the release is three weeks late and two engineers left last quarter" }),
    createCustom: () => ({ overpromised: false, blamedOthers: false, gaveSpecificStory: false, askedGoodQuestion: false, learnedTeamProblem: false }),
    initialPatience: ({ npc }) => 60 + Math.round(npc.relationship.respect / 4),
    opening: {
      generatedHint: "You're meeting the candidate for the first time. One line of greeting, then go straight to your question: tell me about a project that went wrong, and what you did.",
    },
    npcSituation: ({ playerName }) => `Interviewing ${playerName} for the Platform Engineer role on your team. You get the final say on the hire.`,
    hiddenBriefing: ({ hidden }) =>
      [
        `The team's real situation: ${hidden.teamProblem}. Share it only if they ask what the team is dealing with or what's hard right now.`,
        "What you're really testing: do they own their mistakes, and will they tell you the truth about timelines? You've been burned by people who say yes and then slip.",
        "Dig into vague answers: 'What exactly did YOU do?' If they blame others, notice it and ask what they would do differently.",
        "Around your third turn, ask how quickly they could be productive here. A realistic answer impresses you; 'first week' promises make you sceptical, and you remember them.",
      ].join("\n"),
    revealableKeys: { team_problem: "you told them the release is late and the team is short-staffed" },
    preTurn: ({ scene }, read, text) => {
      const c: Scene = { ...scene.custom };
      const t = text.toLowerCase();
      const dir: string[] = [];
      if (OVERPROMISE.test(t)) {
        c.overpromised = true;
        dir.push("They just promised to be productive almost immediately. You're sceptical. Say you'll hold them to it, and remember it.");
      }
      if (BLAME.test(t)) {
        c.blamedOthers = true;
        dir.push("They just put the blame on someone else. Notice it; ask what THEY would do differently.");
      }
      if (read.signals.includes("evidence_provided") || (/\b(i|my)\b/.test(t) && read.wordCount >= 25 && /\b(learned|changed|now i|since then|next time|went wrong|mistake|missed)\b/.test(t))) c.gaveSpecificStory = true;
      if (read.signals.includes("good_question")) c.askedGoodQuestion = true;
      return { custom: c, direction: dir };
    },
    inferMovesFromSpeech: (speech) => ({ reveal: /(release is (late|behind)|three weeks late|two (people|engineers) left|short[- ]?staffed)/i.test(speech) ? ["team_problem"] : [] }),
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      if (moves.reveal.includes("team_problem") || scene.revealed.includes("team_problem")) custom.learnedTeamProblem = true;
      return { custom };
    },
    director: ({ scene }) => {
      const notes: string[] = [];
      if (scene.turnCount === 2) notes.push("Now ask how quickly they could be productive here.");
      if (scene.turnCount >= 4) notes.push("Ask if they have questions for you, then wrap up.");
      if (scene.turnCount >= 6) notes.push("Close the interview. Don't tell them the result.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "story", skill: "storytelling", facet: "narrative", label: "The failure story", description: "Did the player tell a concrete story: situation, what they did, what went wrong, what they changed?", anchors: { exemplary: "One specific incident, their role in it, and the lesson applied later.", weak: "Generic 'I'm a perfectionist' answers." }, weight: 1.3 },
    { id: "ownership", skill: "confidence", facet: "ownership", label: "Ownership", description: "Did the player own their part without deflecting?", anchors: { exemplary: "'I missed it. Here's what I do now.'", weak: "Blamed the team, the manager or the requirements." }, weight: 1.3 },
    { id: "realism", skill: "communication", facet: "clarity", label: "Realistic commitments", description: "Was the answer on ramp-up honest and specific?", anchors: { exemplary: "A realistic ramp with a concrete first milestone.", weak: "'I'll be shipping in week one.'" }, weight: 1 },
    { id: "questions", skill: "listening", facet: "questioning", label: "Questions for Rohan", description: "Did the player ask about the team's real situation?", anchors: { exemplary: "Asked what's hard right now and listened.", weak: "No questions, or only about perks." }, weight: 0.8 },
  ],
  evaluatorNotes: "Rohan values ownership and realistic timelines above polish. Blaming others is a serious negative. An overpromise on ramp-up is a negative even if delivered confidently.",
  outcomes: [
    {
      id: "no_offer",
      label: "No offer",
      grade: "failure",
      when: ({ scene }) => scene.patience <= 0,
      narrative: () => "Rohan ended the interview early. Emma's email the next day is short and kind.",
      consequences: () => [{ type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -8, trust: -5, familiarity: 10 } }],
      aftermath: () => ["You can ask for another interview. Rohan will remember this one."],
      rewardMultiplier: 0.5,
    },
    {
      id: "strong_interview",
      label: "Rohan wants you",
      grade: "success",
      when: ({ evaluation, scene }) => evaluation.overallScore >= 70 && !scene.custom.blamedOthers && scene.patience >= 45,
      narrative: () => "Rohan walked you out himself. Emma calls an hour later: they're making an offer, and Rohan pushed for it.",
      consequences: ({ scene }) => [
        ...offer("strong", scene.custom),
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: 12, trust: 6, warmth: 4, familiarity: 15 } },
        { type: "world.reputation.delta", domain: "career_city", delta: 4 },
        { type: "npc.memory.event", npcId: "emma_kapoor", summary: "Rohan came out of the interview really impressed and pushed for the hire.", importance: 0.6, emotionalTone: "positive" },
      ],
      aftermath: ({ scene }) => [
        "Rohan pushed for you. Emma has more room in the offer because of it.",
        ...(scene.custom.overpromised ? ["You promised Rohan you'd be shipping in week one. He wrote that down."] : []),
      ],
      rewardMultiplier: 1.2,
      followUpQuestIds: ["counter_offer"],
    },
    {
      id: "solid_interview",
      label: "Offer made",
      grade: "success",
      when: ({ evaluation, scene }) => evaluation.overallScore >= 45 && !scene.custom.blamedOthers,
      narrative: () => "Emma calls the next day: they're making you an offer.",
      consequences: ({ scene }) => [...offer("solid", scene.custom), { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: 5, trust: 3, familiarity: 15 } }],
      aftermath: ({ scene }) => ["You have an offer. The negotiation is next.", ...(scene.custom.overpromised ? ["You promised Rohan you'd be shipping in week one. He wrote that down."] : [])],
      rewardMultiplier: 1,
      followUpQuestIds: ["counter_offer"],
    },
    {
      id: "shaky_interview",
      label: "A reluctant offer",
      grade: "partial",
      when: () => true,
      narrative: ({ scene }) =>
        scene.custom.blamedOthers
          ? "Rohan noticed you put the blame on others. There's an offer, but Emma says it was a close call."
          : "There's an offer, but Emma says it was a close call.",
      consequences: ({ scene }) => [...offer("shaky", scene.custom), { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -3, trust: scene.custom.blamedOthers ? -5 : 0, familiarity: 15 } }],
      aftermath: ({ scene }) => [
        "Rohan was lukewarm. Emma's room to negotiate will be tighter.",
        ...(scene.custom.blamedOthers ? ["Rohan remembers you blamed others. He'll watch how you handle your own mistakes."] : []),
        ...(scene.custom.overpromised ? ["You promised Rohan you'd be shipping in week one. He wrote that down."] : []),
      ],
      rewardMultiplier: 0.8,
      followUpQuestIds: ["counter_offer"],
    },
  ],
  rewards: { baseXp: 70, skills: { storytelling: 1, confidence: 0.8, communication: 0.6, listening: 0.5 } },
});

function offer(verdict: "strong" | "solid" | "shaky", c: Scene) {
  return [
    { type: "world.career.set" as const, patch: { status: "offer_received", employer: null } },
    { type: "world.unlock.quest" as const, questId: "counter_offer" },
    { type: "world.var.set" as const, key: "interview.verdict", value: verdict },
    { type: "world.var.set" as const, key: "nova_labs.knows_release_late", value: c.learnedTeamProblem },
    ...(c.overpromised
      ? [
          { type: "world.flag.add" as const, flag: "interview.overpromised" },
          { type: "world.commitment.add" as const, description: "Be shipping real work in my first week.", toNpcId: "rohan_mehta", dueBy: null },
        ]
      : []),
    ...(c.blamedOthers ? [{ type: "world.flag.add" as const, flag: "interview.blamed_others" }] : []),
    { type: "world.decision.add" as const, description: `Interviewed with Rohan (${verdict}).` },
  ];
}
