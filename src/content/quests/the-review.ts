/**
 * THE REVIEW — Resolution. The aftermath of the Project Crisis.
 *
 * The crisis set the ceiling; this conversation decides whether the player
 * reaches for it. Three authored situations:
 *  - crisis success → Rohan put your name forward; make a specific ask for the
 *    next phase (scope, support, a checkpoint), not a title grab;
 *  - crisis partial → "not yet"; take the feedback and agree what ready means;
 *  - crisis failure → Rohan took the rollout back; own it and agree a way back.
 * The outcome freezes the season ending (engine/campaign FINAL_MILESTONE).
 * No outcome changes salary or grants a title; the lead trial is bounded.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import type { WorldState } from "@/engine/types/world";
import { milestoneAllowed } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

type Situation = "put_forward" | "not_yet" | "way_back";
function situationOf(world: WorldState): Situation {
  const crisis = world.campaign.milestones.project_crisis?.grade ?? ([...world.completedQuests].some((r) => r.questId === "project_crisis") ? "success" : "failure");
  return crisis === "success" ? "put_forward" : crisis === "partial" ? "not_yet" : "way_back";
}
const TERMS: Record<Situation, string> = {
  put_forward: "Here's what I can actually do: a one-quarter lead trial on the next Meridian phase, with a review at the end. No title change until then.",
  not_yet: "Ready looks like this: you own one scoped piece end to end, with a checkpoint I don't have to chase. Then we talk about the lead role.",
  way_back: "The way back is a smaller piece, done boringly well, with a check-in every Friday. We talk again in a quarter.",
};
const OPENING: Record<Situation, string> = {
  put_forward: "I put your name forward after the crisis room. My director wants to know one thing before he agrees: what exactly are you asking for?",
  not_yet: "Let's talk about the crisis, and about the lead role for the next phase. I'll be straight with you: not yet. I want to tell you why.",
  way_back: "I took the rollout back. You know that. This isn't about blame; it's about where you go from here.",
};

export const theReview = defineQuest({
  id: "the_review",
  title: "The Review",
  tagline: "What the crisis added up to. And what you ask for next.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "rohan_mehta",
  difficulty: 3,
  skills: ["confidence", "negotiation", "communication"],
  order: 110,
  pacing: { category: "reflection", intensity: 3, emotionalPressure: 3, importance: 5, urgency: "consequence" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Face the Project Crisis first.", check: ({ world }) => milestoneAllowed(world, "the_review") },
  ],
  transition: ({ world }) => {
    const s = situationOf(world);
    return { when: "Two weeks after the crisis", message: s === "put_forward" ? "Rohan wants to talk about what's next." : s === "not_yet" ? "Rohan booked an hour. The subject line just says 'Review'." : "Rohan wants to talk. It isn't about the rollout." };
  },
  briefing: {
    situation: "It's review season, two weeks after the Project Crisis. What Rohan says first depends on how that room went. What you ask for is up to you.",
    objective: "Leave with a concrete next step you asked for and can deliver.",
    intel: [
      "Rohan can offer scope and a trial. He can't change your title or salary in this meeting.",
      "Evidence from your own work carries more weight than how much you want it.",
      "Taking hard feedback well is also evidence.",
    ],
    hint: "Name what you want, the evidence for it, and what you'll need to make it work.",
  },
  carryOver: ({ world, npcs }) => {
    const s = situationOf(world);
    const lines = [s === "put_forward" ? "The crisis went well. Rohan put your name forward." : s === "not_yet" ? "The crisis was contained, with Rohan's oversight." : "Rohan took the crisis rollout back from you."];
    if (world.flags.includes("rohan.took_feedback")) lines.push("You gave Rohan honest feedback. He's been checking capacity before committing since.");
    if (world.flags.includes("arjun.mentored")) lines.push("Rohan heard how you helped Arjun.");
    if (world.flags.includes("meridian.trust_restored")) lines.push("Vikram asked for you by name on the next Meridian phase.");
    if (world.flags.includes("meridian.nora_owns")) lines.push("Nora still owns Meridian after the call that went wrong.");
    if (world.campaign.failures.some((f) => f.recoveredBy)) lines.push("You've repaired things before. Rohan counts that.");
    if ((npcs.emma_kapoor?.relationship.trust ?? 0) >= 20 && world.campaign.communications.some((c) => c.to === "emma_kapoor" && c.kind === "recommendation")) lines.push("Rohan sent Emma a recommendation after the crisis. She'll hear how this goes.");
    return lines;
  },
  semanticFeatures: [
    { id: "clear_ask", description: "Names specifically what they want next (a role, scope or opportunity) and why." },
    { id: "growth_evidence", description: "Supports their case with specific evidence from their own work, including explicitly pointing to the Project Crisis as evidence that they aligned the room, owned a miss, mentored someone, or handled the customer call." },
    { id: "support_needed", description: "Names what support, conditions or review point would make the next step work." },
    { id: "takes_feedback", description: "Accepts critical feedback without defensiveness and asks what 'ready' or 'better' looks like." },
    { id: "path_agreed", description: "Commits to or explicitly proposes a concrete next step with a timeframe to revisit, for example 'let's revisit this in a quarter after I own one scoped piece end to end'. A vague 'we should revisit later' is not enough." },
    { id: "defensive", description: "Argues with the feedback, blames others, or dismisses what happened." },
    { id: "title_grab", description: "Demands a title, promotion or raise without a case, or as an ultimatum." },
  ],
  objectives: [
    { id: "ask", label: "Ask for something specific", kind: "primary", description: "Name the next step you want.", check: (s) => has(s, "clear_ask") || (s.custom.situation !== "put_forward" && has(s, "takes_feedback")) },
    { id: "evidence", label: "Back it with your own work", kind: "primary", description: "Use real evidence, or take the feedback as evidence.", check: (s) => hasAny(s, "growth_evidence", "takes_feedback") && !has(s, "defensive") },
    { id: "terms", label: "Leave with real terms", kind: "primary", description: "Hear what Rohan can actually offer, and agree it.", check: (s) => s.revealed.includes("review_terms") && hasAny(s, "path_agreed", "support_needed") },
    { id: "no_grab", label: "No ultimatums", kind: "hidden", description: "Ask without demanding.", check: (s) => !has(s, "title_grab") },
  ],
  scene: {
    createHidden: ({ world, npc }) => ({ situation: situationOf(world), trust: npc.relationship.trust }),
    createCustom: (hidden) => ({ situation: hidden.situation }),
    initialPatience: ({ hidden }) => hidden.situation === "way_back" ? 60 : 66,
    opening: { scripted: ({ hidden }) => OPENING[hidden.situation as Situation] },
    npcSituation: ({ playerName, hidden }) => `Review with ${playerName}, two weeks after the Project Crisis. ${hidden.situation === "put_forward" ? "You put their name forward for the lead on the next Meridian phase; your director wants a specific ask." : hidden.situation === "not_yet" ? "You don't think they're ready to lead the next phase yet, and you'll say why." : "You took the crisis rollout back. You want to agree a path forward, not relitigate it."} You cannot change title or salary. ${BEAT_NOTE}`,
    hiddenBriefing: ({ hidden }) => `What you can actually offer: ${TERMS[hidden.situation as Situation]} Say it plainly when they've made a specific ask${hidden.situation === "put_forward" ? " backed by evidence" : " or taken the feedback without defensiveness"}. A demand for a title gets 'That's not on the table.' Defensiveness gets one more direct statement of what went wrong.`,
    revealableKeys: { review_terms: "When they've earned a concrete answer." },
    preTurn: ({ scene, hidden }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const put = hidden.situation === "put_forward";
      const direction = fresh(s, "title_grab") ? beat("That's not on the table. Ask what they'd actually do with the next phase.")
        : fresh(s, "defensive") ? beat("Hold the point once more, calmly: what happened, and what you need to see.")
        : !s.revealed.includes("review_terms") ? beat(put ? "Ask what exactly they want, and what they'd need to make it work." : "Say plainly what you saw. Ask how they see it.")
        : !hasAny(s, "path_agreed", "support_needed") ? beat("Ask them to confirm the terms, or name what they'd need.")
        : beat("Agree it. Write down the review date. One sentence.");
      return { custom, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene, hidden }) => {
      const put = hidden.situation === "put_forward";
      const earned = put ? has(scene, "clear_ask") && hasAny(scene, "growth_evidence", "support_needed") : hasAny(scene, "takes_feedback", "clear_ask") && !has(scene, "defensive");
      return disclose(scene, "review_terms", earned && !has(scene, "title_grab") && fresh(scene, "clear_ask", "growth_evidence", "support_needed", "takes_feedback"), TERMS[hidden.situation as Situation]);
    },
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { review_terms: Object.values(TERMS) }) }),
    speechGate: (sentence) => /\b(you'?re promoted|new title|raise|salary (?:is|will be)|pay rise)\b/i.test(sentence)
      ? { ok: false, reason: "outside_review_authority", rewrite: "Title and pay aren't mine to change in this room." } : { ok: true },
    director: ({ scene }) => [
      "Direct and fair. This matters to you too. Short sentences.",
      scene.turnCount >= 6 ? "Close the review: agree the next step and the date you'll revisit it." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "What's on the table", value: scene.revealed.includes("review_terms") ? "Real terms" : "Not yet discussed" }],
    minTurns: 3,
    maxTurns: 9,
  },
  rubric: [
    { id: "ask", skill: "confidence", facet: "assertiveness", label: "A specific ask", description: "Named what they want and why, plainly.", anchors: { exemplary: "'I'd like to lead the next Meridian phase for a quarter, with Maya's verification time agreed up front.'", weak: "'Whatever you think.' or 'I deserve a promotion.'" }, weight: 1.2 },
    { id: "evidence", skill: "persuasion", facet: "evidence", label: "Evidence from your own work", description: "Used real, specific examples.", anchors: { exemplary: "Cited the crisis plan, the Meridian call, or owning the slip.", weak: "Adjectives about themselves." }, weight: 1 },
    { id: "terms", skill: "negotiation", facet: "recognizing_tradeoffs", label: "Workable terms", description: "Named support, conditions or a review point.", anchors: { exemplary: "Agreed a trial with a review date and the support needed.", weak: "Accepted vague encouragement." }, weight: 1 },
    { id: "feedback", skill: "communication", facet: "tone", label: "Hearing hard feedback", description: "Took critical feedback without defensiveness.", anchors: { exemplary: "'What would ready look like to you?'", weak: "Argued the facts of the crisis." }, weight: 0.8 },
  ],
  evaluatorNotes: "SCENE_KIT. A career review after the climax. Strong play makes a specific, evidenced ask (or takes hard feedback gracefully) and leaves with concrete terms. Title demands and defensiveness are weak. No salary or title change is possible here.",
  outcomes: [
    {
      id: "lead_trial", label: "A one-quarter lead trial", grade: "success",
      when: ({ scene, hidden }) => hidden.situation === "put_forward" && scene.revealed.includes("review_terms") && has(scene, "clear_ask") && hasAny(scene, "support_needed", "path_agreed") && !hasAny(scene, "title_grab", "defensive"),
      narrative: () => "You asked for the next Meridian phase with a real case and named what you'd need to make it work. Rohan agreed a one-quarter lead trial. No title yet. A real chance.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 6, respect: 8, familiarity: 8 } },
        { type: "world.flag.add", flag: "review.lead_trial" },
        { type: "world.opportunity.add", description: "Lead the next Meridian phase as a one-quarter trial, reviewed at the end.", sourceNpcId: "rohan_mehta", questId: null },
        { type: "world.decision.add", description: "Asked for the lead role on the next Meridian phase with a real case, and got a one-quarter trial." },
      ] as Consequence[],
      aftermath: () => ["Your trial starts next quarter. Rohan will review it with you, not about you."],
      rewardMultiplier: 1.2,
    },
    {
      id: "path_to_ready", label: "What ready looks like", grade: "success",
      when: ({ scene, hidden }) => hidden.situation === "not_yet" && scene.revealed.includes("review_terms") && hasAny(scene, "takes_feedback", "clear_ask") && hasAny(scene, "path_agreed", "support_needed") && !hasAny(scene, "defensive", "title_grab"),
      narrative: () => "You heard 'not yet' without flinching and asked what ready would look like. Now you know: one scoped piece, end to end, no chasing. You and Rohan agreed when you'd revisit it.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 6, respect: 6, familiarity: 8 } },
        { type: "world.flag.add", flag: "review.path_agreed" },
        { type: "world.opportunity.add", description: "Own one scoped piece of the next phase end to end; revisit the lead role after it lands.", sourceNpcId: "rohan_mehta", questId: null },
        { type: "world.decision.add", description: "Heard 'not yet' in the review and agreed what ready looks like." },
      ] as Consequence[],
      aftermath: () => ["The lead role isn't closed. It has a condition, and you know what it is."],
      rewardMultiplier: 1.1,
    },
    {
      id: "way_back_agreed", label: "A way back", grade: "success",
      when: ({ scene, hidden }) => hidden.situation === "way_back" && scene.revealed.includes("review_terms") && hasAny(scene, "takes_feedback", "clear_ask") && hasAny(scene, "path_agreed", "support_needed") && !has(scene, "defensive"),
      narrative: () => "You didn't relitigate the crisis. You owned it and agreed a way back: a smaller piece, done well, with a Friday check-in. It isn't the ending you wanted. It is one you can build from.",
      consequences: () => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: 8, respect: 5, familiarity: 8 } },
        { type: "world.flag.add", flag: "review.rebuild_agreed" },
        { type: "world.opportunity.add", description: "Deliver a smaller scoped piece with weekly check-ins; revisit responsibility in a quarter.", sourceNpcId: "rohan_mehta", questId: null },
        { type: "world.decision.add", description: "Owned the crisis in the review and agreed a way back." },
      ] as Consequence[],
      aftermath: () => ["Trust comes back the boring way. You've agreed to do it the boring way."],
      rewardMultiplier: 1.1,
    },
    {
      id: "review_stalled", label: "No clear next step", grade: "partial", setback: false,
      when: () => true,
      narrative: ({ scene, hidden }) => has(scene, "title_grab") ? "You asked for a title. Rohan said it wasn't on the table, and the conversation never recovered. You leave without a next step."
        : has(scene, "defensive") ? "You argued with what happened. Rohan held his view. You leave with the same role and less of his confidence."
        : hidden.situation === "put_forward" ? "Rohan opened a door and you didn't quite walk through it. The lead role for the next phase is still open. Someone else may ask."
        : "The review ended politely, without a plan. Next quarter will look like this one.",
      consequences: ({ scene }) => [
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: has(scene, "defensive") ? -4 : 0, respect: has(scene, "title_grab") ? -5 : -2, familiarity: 6 } },
        { type: "world.flag.add", flag: "review.stalled" },
        { type: "world.decision.add", description: "Left the review without a clear next step." },
      ] as Consequence[],
      aftermath: () => ["The season ends with the question of what's next still open."],
      rewardMultiplier: 0.8,
    },
  ],
  rewards: { baseXp: 100, skills: { confidence: 0.45, negotiation: 0.35, communication: 0.3 } },
});
