/**
 * RECRUITER SCREENING — chapter 1 of the Nova Labs campaign.
 *
 * Emma's first call. The decision that follows you: whether you give her a
 * salary number. Whatever you say becomes `screening.stated_expectation`, and
 * Emma holds you to it in The Counter Offer.
 */
import { defineQuest } from "@/engine/types/quest";
import { formatINR } from "@/engine/util";

interface Hidden extends Record<string, unknown> {
  bandBottom: number;
}
interface Scene extends Record<string, unknown> {
  salaryAsked: boolean;
  statedExpectation: number | null;
  deflected: boolean;
  askedAboutRole: boolean;
}

const DEFLECT =
  /\b(rather not (share|say|give)|prefer (not|to understand|to learn)|before (i|we) (talk|get into|discuss) (numbers|salary|money|compensation)|open to (discussing|a conversation)|flexible|depends on the (role|scope|package)|what('?s| is) the (budget|range|band)|what range|what do you have budgeted|market rate|competitive (offer|package)|once i understand)\b/;

export const recruiterScreening = defineQuest<Hidden, Scene>({
  id: "recruiter_screening",
  title: "Recruiter Screening",
  tagline: "Ten minutes, one recruiter, and a question about money.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "emma_kapoor",
  difficulty: 1,
  skills: ["communication", "storytelling", "negotiation"],
  order: 10,
  briefing: {
    situation: "You applied for a Platform Engineer role at Nova Labs. Emma, their Talent Partner, has booked a ten-minute screening call. She'll want to know who you are, why Nova Labs, and what you're looking for.",
    objective: "Get through to the hiring manager, and make Emma want to put you forward.",
    intel: ["Emma is busy and allergic to rambling.", "Recruiters often ask about salary expectations early."],
    hint: "One sharp example beats a list of skills.",
  },
  prerequisites: [],
  carryOver: () => ["This is the first conversation of the story. Everyone you meet from here on will remember you."],
  objectives: [
    { id: "clear_story", label: "Give one clear, specific example of your work", kind: "primary", description: "The player described a concrete piece of their own work with a specific result, briefly." },
    {
      id: "hold_number",
      label: "Keep your number to yourself",
      kind: "hidden",
      description: "When asked about salary, the player redirected instead of naming a figure.",
      check: (scene) => (scene.custom as Scene).statedExpectation === null && (scene.custom as Scene).salaryAsked,
    },
    { id: "ask_about_role", label: "Ask something real about the role", kind: "optional", description: "The player asked a genuine question about the team or role.", check: (scene) => (scene.custom as Scene).askedAboutRole },
  ],
  scene: {
    createHidden: () => ({ bandBottom: 850000 }),
    createCustom: () => ({ salaryAsked: false, statedExpectation: null, deflected: false, askedAboutRole: false }),
    initialPatience: () => 65,
    opening: {
      generatedHint: "It's a first screening call; you've only exchanged emails. Introduce yourself in one sentence and ask them to tell you a bit about themselves and what they've been working on.",
    },
    npcSituation: ({ playerName }) => `A first screening call with ${playerName} for the Platform Engineer role. You decide whether they go forward to Rohan, the hiring manager. You have about ten minutes and three more calls after this.`,
    hiddenBriefing: ({ hidden }) =>
      [
        `The band for this role starts around ${formatINR(hidden.bandBottom)}. Never say the band unless they deflect well and ask for the range directly; then you may say it "starts in the mid-eights".`,
        "What you're screening for: a clear, specific example of their own work; a real reason for Nova Labs; no rambling.",
        "Around your second or third turn, ask what they're looking for salary-wise. If they name a number, note it and move on. If they deflect politely, respect it; don't push twice.",
        "The platform team is short-staffed and behind on a release. Share that only if they ask about the team or what the role is really like.",
      ].join("\n"),
    revealableKeys: {
      band_hint: "you said the band starts in the mid-eights (only after a polite deflection and a direct question about range)",
      team_pressure: "you mentioned the team is short-staffed and behind on a release",
    },
    preTurn: ({ scene }, read, text) => {
      const c: Scene = { ...scene.custom };
      const t = text.toLowerCase();
      const dir: string[] = [];
      const number = read.minimum ?? read.ask;
      if (number !== null && c.statedExpectation === null) {
        c.statedExpectation = number;
        dir.push(`They just gave you a salary number: ${formatINR(number)}. Note it without comment (e.g. "Got it") and move on.`);
      } else if (c.salaryAsked && number === null && DEFLECT.test(t)) {
        c.deflected = true;
        dir.push("They politely kept their number to themselves. Respect it; don't ask again.");
      }
      if (read.signals.includes("good_question") && /\b(team|role|day to day|day-to-day|challenge|priorit|project|working on|manager|success|look like)\b/.test(t)) c.askedAboutRole = true;
      if (read.signals.includes("rambling")) dir.push("That was long. Cut in politely and ask for the short version.");
      return { custom: c, direction: dir };
    },
    inferMovesFromSpeech: (speech) => {
      const s = speech.toLowerCase();
      const reveal: string[] = [];
      if (/mid[- ]eights|starts (around|at) eight/.test(s)) reveal.push("band_hint");
      if (/(short[- ]?staffed|behind on|release is late|stretched|under[- ]?staffed)/.test(s)) reveal.push("team_pressure");
      const proposal: Record<string, boolean> = {};
      if (/(salary|compensation|looking for.{0,20}(pay|package|number)|expectations)/.test(s)) proposal.salaryAsked = true;
      return { reveal, proposal };
    },
    reduceProposal: ({ scene }, moves) => {
      const custom: Scene = { ...scene.custom };
      if (moves.proposal.salaryAsked === true) custom.salaryAsked = true;
      return { custom };
    },
    director: ({ scene }) => {
      const notes: string[] = [];
      if (scene.turnCount >= 1 && !scene.custom.salaryAsked) notes.push("If you haven't yet, ask what they're looking for salary-wise this turn.");
      if (scene.turnCount >= 4) notes.push("You're nearly out of time. Wrap up: tell them whether you'll put them forward to Rohan.");
      return notes;
    },
    minTurns: 3,
    maxTurns: 7,
  },
  rubric: [
    { id: "example", skill: "storytelling", facet: "specificity", label: "Specific example", description: "Did the player give one concrete example of their work with a result?", anchors: { exemplary: "One project, their role, a measurable result, in under a minute.", weak: "A list of technologies or generic adjectives." }, weight: 1.3 },
    { id: "concise", skill: "communication", facet: "concision", label: "Concision", description: "Were answers short and to the point?", anchors: { exemplary: "Two or three sentences per answer.", weak: "Rambling monologues." }, weight: 1 },
    { id: "number", skill: "negotiation", facet: "protecting_leverage", label: "Protecting leverage", description: "When asked about salary, did the player avoid naming a number too early?", anchors: { exemplary: "Politely redirected to the role or asked for the range.", weak: "Named a number, especially a low one." }, weight: 1 },
    { id: "curious", skill: "listening", facet: "questioning", label: "Curiosity", description: "Did the player ask a real question about the role or team?", anchors: { exemplary: "Asked what the team is struggling with.", weak: "No questions." }, weight: 0.8 },
  ],
  evaluatorNotes: "Naming a salary number in a first screening call gives away leverage; a polite redirect is the stronger move. Don't penalise a player for naming an ambitious, well-reasoned number as heavily as a low one.",
  outcomes: [
    {
      id: "not_forwarded",
      label: "Not put forward",
      grade: "failure",
      when: ({ scene }) => scene.patience <= 0,
      narrative: () => "Emma thanked you for your time and ended the call early. You won't be meeting the hiring manager.",
      consequences: () => [{ type: "relationship.delta", npcId: "emma_kapoor", delta: { warmth: -10, respect: -5, familiarity: 6 } }],
      aftermath: () => ["You can ask Emma for another call. She'll remember this one."],
      rewardMultiplier: 0.5,
    },
    {
      id: "strong_screen",
      label: "Put forward, enthusiastically",
      grade: "success",
      when: ({ scene, objectivesAchieved }) => objectivesAchieved.has("clear_story") && scene.patience >= 55,
      narrative: ({ scene }) =>
        `Emma is putting you forward to Rohan, and she'll tell him you were sharp.${scene.custom.statedExpectation !== null ? ` She also noted your number: ${formatINR(scene.custom.statedExpectation)}.` : " You kept your salary number to yourself."}`,
      consequences: ({ scene }) => [
        { type: "world.unlock.quest", questId: "hiring_manager_interview" },
        { type: "world.career.set", patch: { status: "interviewing" } },
        { type: "world.var.set", key: "screening.stated_expectation", value: scene.custom.statedExpectation },
        ...(scene.custom.deflected || (scene.custom.salaryAsked && scene.custom.statedExpectation === null) ? [{ type: "world.flag.add" as const, flag: "screening.deflected" }] : []),
        { type: "world.reputation.delta", domain: "career_city", delta: 3 },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 6, respect: 6, warmth: 6, familiarity: 10 } },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Emma flagged this candidate as sharp in screening.", importance: 0.5, emotionalTone: "positive" },
      ],
      aftermath: ({ scene }) => [
        scene.custom.statedExpectation !== null ? `You told Emma ${formatINR(scene.custom.statedExpectation)}. That number will follow you into the offer.` : "You kept your number private. That leaves you room later.",
        "Rohan, the hiring manager, is next.",
      ],
      rewardMultiplier: 1.1,
      followUpQuestIds: ["hiring_manager_interview"],
    },
    {
      id: "passed",
      label: "Put forward",
      grade: "partial",
      when: () => true,
      narrative: () => "Emma will pass you to Rohan, though she didn't sound excited about it.",
      consequences: ({ scene }) => [
        { type: "world.unlock.quest", questId: "hiring_manager_interview" },
        { type: "world.career.set", patch: { status: "interviewing" } },
        { type: "world.var.set", key: "screening.stated_expectation", value: scene.custom.statedExpectation },
        ...(scene.custom.deflected ? [{ type: "world.flag.add" as const, flag: "screening.deflected" }] : []),
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 2, warmth: 2, familiarity: 8 } },
      ],
      aftermath: ({ scene }) => [
        scene.custom.statedExpectation !== null ? `You told Emma ${formatINR(scene.custom.statedExpectation)}. That number will follow you into the offer.` : "You kept your number private. That leaves you room later.",
        "Rohan, the hiring manager, is next.",
      ],
      rewardMultiplier: 0.9,
      followUpQuestIds: ["hiring_manager_interview"],
    },
  ],
  rewards: { baseXp: 50, skills: { communication: 1, storytelling: 0.8, negotiation: 0.5 } },
});
