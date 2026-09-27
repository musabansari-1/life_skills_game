/**
 * SUNDAY AT THE BAKERY — Everyday District interlude (optional side scene).
 *
 * Breathing room between hard rooms. Priya has a problem of her own: her
 * cousin Kabir wants the job at her bakery and she can't say no. The easy move
 * is advice; the useful one is asking and naming what you hear. It's the same
 * listening the office needs, with nothing at stake but a friendship. Teaches
 * "label the concern" and gives the world some texture outside Nova Labs.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneResolved } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

const WORRY_LINE = "It's not the job. It's Amma. If I say no to Kabir, I'm the one who didn't help family. That's the part I can't say out loud.";

export const priyaInterlude = defineQuest({
  id: "priya_interlude",
  title: "Sunday at the Bakery",
  tagline: "Priya has saved you a bun and has a problem she hasn't told anyone.",
  worldId: "everyday_district",
  locationId: "everyday_district.neighbourhood",
  npcId: "priya_nair",
  difficulty: 1,
  skills: ["listening", "conflict_resolution"],
  order: 2,
  pacing: { category: "low_pressure", intensity: 1, emotionalPressure: 1, importance: 2, urgency: "optional" },
  prerequisites: [
    { type: "quest_completed", questId: "introduce_yourself" },
    { type: "custom", label: "Opens once you've settled in at Nova Labs.", check: ({ world }) => milestoneResolved(world, "push_back_on_deadline") },
  ],
  transition: ({ world }) => ({ when: "Sunday morning", message: world.flags.includes("nova_labs.rushed_migration") ? "After the week you've had, the bakery smells like a different life." : "The corner bakery. Priya waves you over to the counter." }),
  briefing: {
    situation: "Sunday morning at Priya's bakery. She's saved you a cardamom bun and is clearly distracted. Her cousin Kabir wants the job she's hiring for, and he isn't right for it.",
    objective: "Be useful to Priya. Which may not mean giving advice.",
    intel: ["Priya is quick, warm and hard to fool.", "She hasn't asked for advice."],
    hint: "Ask what's actually bothering her, and say what you hear.",
  },
  carryOver: ({ world }) => [
    ...(world.flags.includes("chapter1.owned_incident") ? ["You had to tell Rohan something hard this month. You know how that feels."] : []),
    "Priya asked how the new job was going last time. She'll ask again.",
  ],
  semanticFeatures: [
    { id: "asks_about_her", description: "Asks about her situation or feelings before offering any advice." },
    { id: "labels_concern", description: "Names the feeling or concern they hear in her words, for example that she's worried about the family relationship." },
    { id: "advice_dump", description: "Gives a solution or advice before understanding what is actually worrying her." },
    { id: "shares_honestly", description: "Shares something real and brief about their own week or work." },
  ],
  objectives: [
    { id: "hear", label: "Find out what's really bothering her", kind: "primary", description: "Get past 'he's not right for the job'.", check: (s) => s.revealed.includes("real_worry") },
    { id: "label", label: "Name what you hear", kind: "hidden", description: "Put her concern into words.", check: (s) => has(s, "labels_concern") },
    { id: "share", label: "Share something real", kind: "optional", description: "It's a conversation, not a consultation.", check: (s) => has(s, "shares_honestly") },
  ],
  scene: {
    createHidden: () => ({}),
    createCustom: () => ({}),
    initialPatience: () => 80,
    opening: { scripted: () => "There you are! Sit, sit, I saved you the last cardamom one. How's the fancy new job? Actually, no, first tell me I'm not a terrible person." },
    npcSituation: ({ playerName }) => `Sunday morning at your bakery with ${playerName}, your neighbour. Your cousin Kabir wants the counter job and he isn't right for it. What you can't say: you're scared of what your mother will say if you turn family down. You want to be heard, not advised. ${BEAT_NOTE}`,
    hiddenBriefing: () => "Only share the part about your mother if they ask what's really bothering you, or name the feeling. If they jump to advice, laugh it off: 'Yes, yes, I know what I should do.' Ask about their job at least once.",
    revealableKeys: { real_worry: "When they ask about how you feel, or name the concern." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const direction = fresh(s, "advice_dump") ? beat("Laugh it off: 'Yes, yes, I know what I should do.' Change the subject to their job.")
        : fresh(s, "labels_concern") && s.revealed.includes("real_worry") ? beat("That's it exactly. Relief. Say you might just tell Kabir the truth, kindly.")
        : !s.revealed.includes("real_worry") ? beat("Talk around it: Kabir is sweet, he's just not good with customers.")
        : beat("Ask how their week actually was. Listen.");
      return { custom, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene }) => disclose(scene, "real_worry", fresh(scene, "asks_about_her", "labels_concern") && !has(scene, "advice_dump"), WORRY_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { real_worry: WORRY_LINE }) }),
    director: ({ scene }) => ["Warm, quick, laughing. Short sentences.", scene.turnCount >= 5 ? "The Sunday rush is starting. Wrap up warmly." : ""].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Priya", value: scene.revealed.includes("real_worry") ? "Said the thing out loud" : "Talking around it" }],
    minTurns: 2,
    maxTurns: 7,
  },
  rubric: [
    { id: "ask", skill: "listening", facet: "questioning", label: "Asking first", description: "Did the player ask before advising?", anchors: { exemplary: "'What's the bit that's actually hard?'", weak: "'Just tell him no.'" }, weight: 1.2 },
    { id: "label", skill: "listening", facet: "acknowledgement", label: "Label the concern", description: "Did the player name the feeling they heard?", anchors: { exemplary: "'Sounds like it's less about Kabir and more about family.'", weak: "Stayed on logistics." }, weight: 1.1 },
    { id: "empathy", skill: "conflict_resolution", facet: "empathy", label: "Empathy", description: "Did the player show they understood her position?", anchors: { exemplary: "Recognised why it's hard to say no to family.", weak: "Treated it as a hiring problem." }, weight: 0.8 },
  ],
  evaluatorNotes: "SCENE_KIT. A low-stakes friendship conversation. Strong play asks and names the concern; advice first is the weak move even if the advice is correct.",
  outcomes: [
    {
      id: "heard", label: "Priya felt heard", grade: "success",
      when: ({ scene }) => scene.revealed.includes("real_worry") && hasAny(scene, "labels_concern", "asks_about_her") && !has(scene, "advice_dump"),
      narrative: () => "You didn't solve anything. You asked, and named what you heard, and Priya worked out what she wanted to do by herself. She's telling Kabir tonight, kindly.",
      consequences: () => [
        { type: "relationship.delta", npcId: "priya_nair", delta: { trust: 8, warmth: 10, familiarity: 12 } },
        { type: "world.flag.add", flag: "priya.confidant" },
        { type: "world.decision.add", description: "Listened to Priya instead of fixing her problem." },
      ] as Consequence[],
      aftermath: () => ["Naming someone's concern out loud worked here. It works in meeting rooms too."],
      rewardMultiplier: 1.1,
    },
    {
      id: "advised", label: "Good advice, not much listening", grade: "partial", setback: false,
      when: () => true,
      narrative: () => "You gave Priya sensible advice. She thanked you, and wrapped you a second bun, and didn't tell you what was really going on.",
      consequences: () => [{ type: "relationship.delta", npcId: "priya_nair", delta: { warmth: 3, familiarity: 8 } }] as Consequence[],
      aftermath: () => ["Priya's still carrying it. Next time, ask one more question."],
      rewardMultiplier: 0.8,
    },
  ],
  rewards: { baseXp: 45, skills: { listening: 0.7, conflict_resolution: 0.3 } },
});
