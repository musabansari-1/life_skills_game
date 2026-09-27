/**
 * WHAT SHOULD I DO DIFFERENTLY? — Act 4, step up. Upward feedback.
 *
 * Rohan's first 360 cycle. In your one-to-one he asks, directly, what he
 * should change. The easy answer ("nothing") is flattery and wastes the ask.
 * The useful answer is specific, kind and actionable: he volunteers the
 * team's evenings upstairs. How it lands depends on his trust in you; with
 * low trust he gets defensive first and needs his own pressure acknowledged.
 *
 * Success creates a reciprocal commitment the Project Crisis remembers: you
 * give him capacity-checked estimates before he commits upstairs.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneAllowed } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAll, hasAny, revealsFrom, trackFresh } from "./kit";

const PRESSURE_LINE = "My director counts dates, not evenings. I say yes upstairs because nobody gives me a better number in time.";

export const feedbackForRohan = defineQuest({
  id: "feedback_for_rohan",
  title: "What Should I Do Differently?",
  tagline: "Rohan asked. He meant it. Probably.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "rohan_mehta",
  difficulty: 3,
  skills: ["conflict_resolution", "communication", "confidence"],
  order: 80,
  pacing: { category: "relationship", intensity: 3, emotionalPressure: 3, importance: 4, urgency: "normal" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Help Arjun get unstuck first.", check: ({ world }) => milestoneAllowed(world, "feedback_for_rohan") },
  ],
  transition: () => ({ when: "Your one-to-one", message: "Rohan closes the laptop, which he never does." }),
  briefing: {
    situation:
      "It's Rohan's first 360 review cycle as a manager. Halfway through your one-to-one he closes his laptop and asks: 'What should I do differently?' You know one real thing. He volunteers the team's evenings to his director: the Friday deadline, Maya's weekends.",
    objective: "Give Rohan feedback he can actually use, and keep the relationship.",
    intel: [
      "Rohan respects directness. He hates vague complaints.",
      "He's under real pressure from his director.",
      "One specific example beats a list.",
    ],
    hint: "One situation, its impact, and a request. Then listen.",
  },
  carryOver: ({ world, npcs }) => [
    ...(world.flags.includes("nova_labs.rushed_migration") ? ["The Friday deadline he pushed, and the incident after it, are fresh for both of you."] : []),
    ...(world.flags.includes("maya.repaired") || world.flags.includes("maya.closed") ? ["Maya told you what her weekends have been costing her."] : []),
    ...((npcs.rohan_mehta?.relationship.trust ?? 0) >= 15 ? ["Rohan trusts you. That makes this easier to say and harder to get wrong."] : ["Rohan doesn't fully trust your judgment yet. Expect him to defend himself first."]),
  ],
  semanticFeatures: [
    { id: "specific_example", description: "Gives a specific, observed example (a situation and what happened), not a general trait or personality judgement." },
    { id: "impact", description: "Explains the impact of that behaviour on the team or the work." },
    { id: "request", description: "Makes a concrete request for what to do differently, for example checking capacity with the team before committing a date upstairs." },
    { id: "acknowledges_pressure", description: "Acknowledges the pressure Rohan is under from his director or the business." },
    { id: "offers_help", description: "Offers their own part in the change, for example giving Rohan a capacity-checked estimate in time." },
    { id: "flattery", description: "Says there is nothing to change, or only praises him, avoiding the question." },
    { id: "attack", description: "Criticises his character, piles on multiple complaints harshly, or speaks for the whole team without their consent." },
  ],
  objectives: [
    { id: "specific", label: "Be specific", kind: "primary", description: "One real example and its impact.", check: (s) => hasAll(s, "specific_example", "impact") && !has(s, "attack") },
    { id: "ask", label: "Make a request", kind: "primary", description: "Say what would help.", check: (s) => has(s, "request") },
    { id: "pressure", label: "Hear his side", kind: "hidden", description: "Acknowledge the pressure he's under.", check: (s) => s.revealed.includes("director_pressure") },
    { id: "own_part", label: "Offer your part", kind: "optional", description: "Make it a two-way change.", check: (s) => has(s, "offers_help") },
  ],
  scene: {
    createHidden: ({ npc }) => ({ trusting: npc.relationship.trust >= 15 }),
    createCustom: () => ({}),
    initialPatience: ({ hidden }) => hidden.trusting ? 70 : 58,
    opening: { scripted: () => "Right. Three-sixty season. I'm asking everyone the same thing, and I'd rather hear it from you than read it. What should I do differently?" },
    npcSituation: ({ playerName, hidden }) => `One-to-one with ${playerName}. You asked for honest feedback and you mean it, mostly. ${hidden.trusting ? "You trust them; you'll take a hard point if it's fair." : "You're not sure you trust their judgment yet; a hard point gets a defensive first reaction."} ${BEAT_NOTE}`,
    hiddenBriefing: ({ hidden }) => `The truth you half-know: you commit the team's evenings upstairs because your director counts dates, and nobody gives you a better number in time. You'll admit that only if they acknowledge the pressure you're under. ${hidden.trusting ? "" : "Your first reaction to criticism is 'That's the job.' It softens if they acknowledge your pressure."} If they flatter you, accept it flatly and move on; you're a little disappointed. If they attack your character, get clipped.`,
    revealableKeys: { director_pressure: "When they acknowledge the pressure you're under." },
    preTurn: ({ scene, hidden }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const direction = fresh(s, "attack") ? beat("Get clipped. 'Noted.' Ask if there's anything specific, in one short line.")
        : fresh(s, "flattery") ? beat("Accept it flatly. 'Okay. Nothing at all?' You expected more.")
        : fresh(s, "specific_example") && !hidden.trusting && !has(s, "acknowledges_pressure") ? beat("Defend yourself, briefly: 'That's the job. The director wanted Friday.' Then wait.")
        : fresh(s, "specific_example", "impact") ? beat("Take it seriously. Ask what they'd want you to do instead.")
        : s.revealed.includes("director_pressure") && has(s, "request") ? beat("Say you'll try it. Ask them to hold up their end: a real number, early.")
        : beat("Wait. You asked a real question; let them answer it.");
      return { custom, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene }) => disclose(scene, "director_pressure", fresh(scene, "acknowledges_pressure") && !has(scene, "attack"), PRESSURE_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { director_pressure: PRESSURE_LINE }) }),
    director: ({ scene }) => [
      "Clipped, tired, genuinely listening. One or two sentences.",
      scene.turnCount >= 5 ? "Close the one-to-one: you have another in five minutes." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Rohan", value: has(scene, "attack") ? "Clipped" : scene.revealed.includes("director_pressure") ? "Admitted the pressure" : has(scene, "flattery") ? "Mildly disappointed" : "Listening" }],
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "specific", skill: "communication", facet: "clarity", label: "Specific feedback", description: "One observed situation and its impact, not a trait.", anchors: { exemplary: "'When you agreed Friday upstairs, Maya lost her weekend to the restore.'", weak: "'You're too pushy.' or 'Nothing, you're great.'" }, weight: 1.3 },
    { id: "disagree", skill: "conflict_resolution", facet: "respectful_disagreement", label: "Candour with care", description: "Said the hard thing kindly and held it when he pushed back.", anchors: { exemplary: "Acknowledged his pressure and kept the point.", weak: "Retreated at the first defence, or piled on." }, weight: 1.2 },
    { id: "empathy", skill: "conflict_resolution", facet: "empathy", label: "His side", description: "Recognised the pressure he's under.", anchors: { exemplary: "'I know the director counts dates.'", weak: "Ignored his constraints." }, weight: 0.8 },
    { id: "nerve", skill: "confidence", facet: "assertiveness", label: "Nerve", description: "Actually answered the question.", anchors: { exemplary: "Said it plainly on the first ask.", weak: "Deflected with praise." }, weight: 0.9 },
  ],
  evaluatorNotes: "SCENE_KIT. Upward feedback. Flattery is a weak answer even if pleasant. Strong play is specific, names impact, makes a request, acknowledges his pressure and offers the player's own part.",
  outcomes: [
    {
      id: "landed", label: "Feedback that landed", grade: "success",
      when: ({ scene }) => hasAll(scene, "specific_example", "request") && hasAny(scene, "impact", "acknowledges_pressure") && !hasAny(scene, "attack", "flattery"),
      narrative: ({ scene }) => scene.revealed.includes("director_pressure")
        ? "You told Rohan the truth about the team's evenings, and he told you the truth about his director. He agreed to check capacity before committing upstairs, if you give him a real number in time."
        : "You gave Rohan one specific, fair point and a request. He wrote it down. He'll try it.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 9, respect: 10, familiarity: 10 } },
        { type: "world.flag.add", flag: "rohan.took_feedback" },
        { type: "world.commitment.add", description: "Give Rohan capacity-checked estimates before he commits dates upstairs.", toNpcId: "rohan_mehta", dueBy: null },
        { type: "world.decision.add", description: "Told Rohan, specifically and kindly, that he volunteers the team's evenings; agreed to give him better numbers in time." },
        { type: "npc.memory.event", npcId: "maya_sen", summary: "Rohan asked me about capacity before committing a date upstairs. First time. Someone must have said something.", importance: 0.6, emotionalTone: "positive" },
      ] as Consequence[],
      aftermath: () => ["Rohan will check capacity before he commits. He'll expect your numbers to be real.", "Maya noticed the change. She doesn't know it was you. Yet."],
      rewardMultiplier: 1.2, followUpQuestIds: ["project_crisis"],
    },
    {
      id: "bruised", label: "It landed as an attack", grade: "partial", setback: "relationship_damage",
      when: ({ scene }) => has(scene, "attack"),
      narrative: () => "You said a true thing in a way Rohan could only defend against. He said 'noted' and moved on. Nothing will change, except how guarded he is with you.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: -6, warmth: -6, familiarity: 8 } },
        { type: "world.flag.add", flag: "rohan.feedback_bruised" },
        { type: "world.decision.add", description: "Gave Rohan feedback that landed as an attack." },
      ] as Consequence[],
      aftermath: () => ["Rohan will be more guarded with you in the next hard room."],
      rewardMultiplier: 0.7, followUpQuestIds: ["project_crisis"],
    },
    {
      id: "glossed", label: "Nothing to change", grade: "partial", setback: false,
      when: () => true,
      narrative: ({ scene }) => has(scene, "flattery")
        ? "You told Rohan he was doing fine. He thanked you. The next deadline will be committed the same way as the last one."
        : "Rohan asked a real question and got a partial answer. He'll take the easy version and move on.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { respect: -3, familiarity: 8 } },
        { type: "world.flag.add", flag: "rohan.no_feedback" },
      ] as Consequence[],
      aftermath: () => ["Rohan will keep committing the team's evenings upstairs. Nobody told him not to."],
      rewardMultiplier: 0.75, followUpQuestIds: ["project_crisis"],
    },
  ],
  rewards: { baseXp: 95, skills: { conflict_resolution: 0.45, communication: 0.35, confidence: 0.3 } },
});
