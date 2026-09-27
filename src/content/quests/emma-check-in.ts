/**
 * NINETY DAYS IN — Act 3 relationship interlude (optional, Director-selected).
 *
 * Emma runs every new hire's ninety-day check-in. She has heard things: what
 * Rohan passed on, and her own memory of the offer call. The test is candour
 * (not a sales pitch about how perfect it's been) and a genuine question. A
 * good question earns a real piece of information: Rohan will soon name a
 * lead for the next Meridian phase. Low pressure on purpose: breathing room
 * after the Meridian call.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneResolved } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, outcomeOf, revealsFrom, trackFresh } from "./kit";

const LEAD_LINE = "Between us: Rohan's been asked to name someone to lead the next phase of the Meridian work. He hasn't decided.";
const HONEST_LINE = "Honestly? That's the most useful thing anyone's said in one of these all month.";

export const emmaCheckIn = defineQuest({
  id: "emma_check_in",
  title: "Ninety Days In",
  tagline: "Emma's standard check-in. Nothing with Emma is quite standard.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "emma_kapoor",
  difficulty: 1,
  skills: ["communication", "listening", "confidence"],
  order: 68,
  pacing: { category: "reflection", intensity: 1, emotionalPressure: 1, importance: 2, urgency: "optional" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Opens around your ninety-day mark.", check: ({ world }) => milestoneResolved(world, "status_update") && !milestoneResolved(world, "project_crisis") },
  ],
  transition: () => ({ when: "Ninety days in", message: "A calendar invite from Emma: 'Quick check-in. Coffee's on me.'" }),
  briefing: {
    situation: "Emma Kapoor runs a ninety-day check-in with every hire she brings in. It's short and optional, and she's heard things since the offer.",
    objective: "Tell Emma how it's actually going, and leave knowing something you didn't.",
    intel: ["Emma can tell when someone is performing.", "She knows more about what's happening across Nova than most people."],
    hint: "Honesty about a hard moment tends to go further with Emma than a highlight reel.",
  },
  carryOver: ({ world }) => {
    const offer = outcomeOf(world, "counter_offer");
    const lines: string[] = [];
    if (offer === "strong_deal") lines.push("Emma remembers your negotiation as sharp and fair.");
    else if (offer === "hardball_deal") lines.push("Emma remembers the negotiation. It was bruising, and she hasn't quite forgotten.");
    else if (offer === "took_first_offer") lines.push("Emma remembers you took the first offer without a question.");
    else if (offer === "walked_away") lines.push("Emma reopened an offer she'd withdrawn from you. She's been waiting to see if that was the right call.");
    if (world.flags.includes("chapter1.owned_incident")) lines.push("Rohan mentioned to Emma that you came to him with bad news and a plan.");
    if (world.flags.includes("chapter1.hid_incident")) lines.push("Emma has heard, vaguely, that the migration didn't go smoothly.");
    return lines;
  },
  semanticFeatures: [
    { id: "candid", description: "Gives an honest account of how the first months have gone, including a real difficulty or mistake." },
    { id: "oversell", description: "Claims everything is going perfectly, or spins an obvious setback into a success." },
    { id: "curious_ask", description: "Asks Emma a genuine question about the organisation, growth, or what she's seeing across Nova." },
    { id: "specific_growth", description: "Names something specific they want to grow into or learn next." },
  ],
  objectives: [
    { id: "honest", label: "Tell her how it's really going", kind: "primary", description: "Include something hard.", check: (s) => has(s, "candid") && !has(s, "oversell") },
    { id: "learn", label: "Leave knowing something new", kind: "primary", description: "Ask Emma something real.", check: (s) => s.revealed.includes("lead_opening") },
    { id: "direction", label: "Say what you want next", kind: "optional", description: "Name a specific next step.", check: (s) => has(s, "specific_growth") },
  ],
  scene: {
    createHidden: ({ npc }) => ({ trust: npc.relationship.trust }),
    createCustom: () => ({}),
    initialPatience: () => 72,
    opening: { scripted: ({ hidden }) => (hidden.trust as number) >= 15 ? "Ninety days. Look at you. So, honestly, how's it going?" : "Thanks for making time. This is just a check-in. How's it actually going?" },
    npcSituation: ({ playerName }) => `Ninety-day check-in with ${playerName}, a hire you brought in. It's informal. You've heard things from Rohan. You can tell when someone's performing. ${BEAT_NOTE}`,
    hiddenBriefing: ({ hidden }) => `You know Rohan's been asked to name a lead for the next Meridian phase. ${(hidden.trust as number) >= 10 ? "You'll share that if they ask you a genuine question about growth or what's happening across Nova." : "You'll share that only if they've been candid with you first and then ask a genuine question."} If they oversell, raise an eyebrow: 'Everything's perfect? In ninety days?'`,
    revealableKeys: { lead_opening: "When they've asked a genuine question.", honest_note: "When they're candid about something hard." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const direction = fresh(s, "oversell") ? beat("Gently call it: everything's perfect, in ninety days? Ask what's actually been hard.")
        : fresh(s, "candid") ? beat("Appreciate the honesty, briefly. Ask what they'd do differently.")
        : s.revealed.includes("lead_opening") ? beat("Let them react. Ask whether it's something they'd want.")
        : beat("Keep it light. Ask a short follow-up about how the team's treating them.");
      return { custom, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene, hidden }) =>
      disclose(scene, "lead_opening", fresh(scene, "curious_ask", "specific_growth") && !has(scene, "oversell") && ((hidden.trust as number) >= 10 || has(scene, "candid")), LEAD_LINE)
      ?? disclose(scene, "honest_note", fresh(scene, "candid") && !has(scene, "oversell") && !scene.revealed.includes("lead_opening"), HONEST_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { lead_opening: LEAD_LINE, honest_note: HONEST_LINE }) }),
    director: ({ scene }) => [
      "Warm, brief, a little dry. One or two sentences.",
      scene.turnCount >= 5 ? "Wrap up: you've got another check-in in ten minutes." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Emma", value: scene.revealed.includes("lead_opening") ? "Shared something she didn't have to" : has(scene, "oversell") ? "Eyebrow raised" : "Listening" }],
    minTurns: 2,
    maxTurns: 7,
  },
  rubric: [
    { id: "candour", skill: "communication", facet: "relevance", label: "Candour", description: "Did the player give an honest picture, including something hard?", anchors: { exemplary: "'The migration went badly and I owned it. That was the week I learned the most.'", weak: "'It's all been amazing.'" }, weight: 1.2 },
    { id: "curious", skill: "listening", facet: "questioning", label: "A real question", description: "Did the player ask Emma something genuine?", anchors: { exemplary: "'What do people who grow fast here do differently?'", weak: "No questions." }, weight: 1 },
    { id: "direction", skill: "confidence", facet: "decisiveness", label: "Knowing what you want", description: "Did the player name a direction?", anchors: { exemplary: "Named a specific next step.", weak: "'I'm open to anything.'" }, weight: 0.7 },
  ],
  evaluatorNotes: "SCENE_KIT. A low-pressure check-in. Reward candour over polish, and one genuine question. Overselling is weak even if confident.",
  outcomes: [
    {
      id: "open_door", label: "Emma opened a door", grade: "success",
      when: ({ scene }) => scene.revealed.includes("lead_opening") && has(scene, "candid") && !has(scene, "oversell"),
      narrative: () => "You told Emma the truth about your first ninety days, and asked her something real. She told you something she didn't have to: Rohan will soon name a lead for the next Meridian phase.",
      consequences: ({ scene }) => [
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 7, warmth: 6, familiarity: 10 } },
        { type: "world.flag.add", flag: "emma.knows_ambition" },
        { type: "world.opportunity.add", description: "Rohan will name a lead for the next Meridian phase. Nobody's been asked yet.", sourceNpcId: "emma_kapoor", questId: null },
        { type: "world.decision.add", description: has(scene, "specific_growth") ? "Told Emma honestly how the first ninety days went, and what you want next." : "Told Emma honestly how the first ninety days went." },
      ] as Consequence[],
      aftermath: () => ["You know the lead role is coming before most people do. What you do with that is up to you."],
      rewardMultiplier: 1.1,
    },
    {
      id: "pleasant", label: "A pleasant coffee", grade: "partial", setback: false,
      when: () => true,
      narrative: ({ scene }) => has(scene, "oversell") ? "You told Emma it's all been great. She smiled, finished her coffee, and didn't tell you anything you didn't know." : "A nice coffee with Emma. You left knowing about as much as you arrived with.",
      consequences: () => [{ type: "relationship.delta", npcId: "emma_kapoor", delta: { warmth: 2, familiarity: 8 } }] as Consequence[],
      aftermath: () => ["Emma will check in again next quarter."],
      rewardMultiplier: 0.8,
    },
  ],
  rewards: { baseXp: 55, skills: { communication: 0.45, listening: 0.35, confidence: 0.2 } },
});
