/**
 * MAYA WANTS A WORD — Act 3 consequence event (Director-selected, optional).
 *
 * Two authored situations, chosen by what actually happened:
 *  - strained: the rushed migration cost Maya her weekend (she ran the
 *    restore), or you brushed her off in your first week. She's frustrated.
 *    Repair means naming the specific cost, owning your part, and changing
 *    how you commit her time. Over-apologising without change doesn't count.
 *  - backing: things went well. Maya wants to propose "no migration without a
 *    tested rollback" and asks you to back her in the team meeting. The test
 *    is listening to what she needs (your deadline story as evidence), not
 *    taking her proposal over.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import type { WorldState } from "@/engine/types/world";
import { milestoneResolved } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAll, hasAny, revealsFrom, trackFresh } from "./kit";

type Situation = "strained" | "backing";
export function mayaSituation(world: WorldState): Situation {
  const burned = world.flags.includes("nova_labs.rushed_migration") && !world.flags.includes("director.deadline_replanned");
  return burned || world.flags.includes("maya.distant") ? "strained" : "backing";
}
const COST_LINE = "I spent Saturday and Sunday restoring three thousand records. Nobody asked me. I found out from the alert.";
const DISTANT_LINE = "You asked me to do your ticket in your first week. Since then you've come to me when things break, never before.";
const NEED_LINE = "I don't need you to present it. I need you to say, in the room, what happened when the rollback wasn't tested. They'll believe it from you.";

export const mayaCheckin = defineQuest({
  id: "maya_checkin",
  title: "Maya Wants a Word",
  tagline: "Maya doesn't usually ask for your time.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "maya_sen",
  difficulty: 2,
  skills: ["conflict_resolution", "listening", "communication"],
  order: 62,
  pacing: { category: "consequence", intensity: 2, emotionalPressure: 3, importance: 3, urgency: "consequence" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Opens after the migration story plays out.", check: ({ world }) => milestoneResolved(world, "status_update") && !milestoneResolved(world, "project_crisis") },
  ],
  transition: ({ world }) => mayaSituation(world) === "strained"
    ? { when: "Monday, 9:40", message: "Maya wants a word. She's already in the small meeting room." }
    : { when: "Thursday afternoon", message: "Maya has a proposal for tomorrow's team meeting, and wants you in it." },
  briefing: {
    situation: "Maya has asked for ten minutes. She doesn't usually ask for anyone's time.",
    objective: "Hear what Maya actually needs from you, and give it.",
    intel: ["Maya is precise and doesn't like drama.", "She remembers who backs teammates, and who doesn't."],
    hint: "Find out what she needs before you offer what you'd like to give.",
  },
  carryOver: ({ world }) => mayaSituation(world) === "strained"
    ? [
      ...(world.flags.includes("nova_labs.rushed_migration") ? ["You agreed to Friday without a rollback path. Someone had to run the restore."] : []),
      ...(world.flags.includes("maya.distant") ? ["In your first week you asked Maya to do your homework. She hasn't offered help since."] : []),
      ...(world.flags.includes("knows.rollback_untested") ? ["She told you the rollback had never run on real data."] : []),
    ]
    : [
      "The migration held because someone protected the rollback. Maya noticed.",
      ...(world.flags.includes("maya.collaborator") ? ["Maya offered to pair with you in your first week. You took her up on it."] : []),
    ],
  semanticFeatures: [
    { id: "names_cost", description: "Acknowledges the specific cost to Maya (her weekend, her warning, her time) in their own words." },
    { id: "owns_part", description: "Owns their own part in what happened without over-explaining or blaming others." },
    { id: "concrete_change", description: "Commits to a specific change in how they'll work: asking before committing her time, running the rollback check before giving a date, or similar." },
    { id: "asks_need", description: "Asks what Maya needs from them, or what would help, before offering their own plan." },
    { id: "offers_support", description: "Commits to a specific supportive action while Maya keeps ownership of her proposal, such as backing her in the meeting or adding their own experience as evidence. Taking the proposal away to present it as the player's plan is not support." },
    { id: "defensive", description: "Justifies or deflects, blames Rohan or the deadline, or minimises what it cost her." },
    { id: "takes_over", description: "Takes ownership or control of Maya's proposal instead of supporting her: for example asks her to hand it over so the player can present it to management, presents it as 'the plan', or reshapes it as their own. This should be distinguished from explicitly backing Maya while she retains ownership." },
    { id: "over_apology", description: "Apologises repeatedly or at length without offering any change." },
  ],
  objectives: [
    { id: "hear", label: "Hear what she needs", kind: "primary", description: "Let Maya say what matters to her.", check: (s) => s.revealed.includes("maya_need") },
    { id: "respond", label: "Answer with something real", kind: "primary", description: "A change or a commitment, not just sympathy.", check: (s) => s.custom.situation === "strained" ? hasAll(s, "owns_part", "concrete_change") && !has(s, "defensive") : has(s, "offers_support") && !has(s, "takes_over") },
    { id: "name", label: "Name it in your words", kind: "hidden", description: "Acknowledge the specific cost or ask.", check: (s) => hasAny(s, "names_cost", "asks_need") },
  ],
  scene: {
    createHidden: ({ world }) => ({ situation: mayaSituation(world), rushed: world.flags.includes("nova_labs.rushed_migration") }),
    createCustom: (hidden) => ({ situation: hidden.situation }),
    initialPatience: ({ hidden }) => hidden.situation === "strained" ? 55 : 68,
    opening: { scripted: ({ hidden }) => hidden.situation === "strained" ? "Thanks for coming. I'll keep it short. I'm frustrated, and I'd rather say it to you than about you." : "Got ten minutes? I'm proposing something in tomorrow's team meeting, and I want you in it." },
    npcSituation: ({ hidden, playerName }) => hidden.situation === "strained"
      ? `You asked ${playerName} for ten minutes because you're frustrated with how your time has been treated. ${hidden.rushed ? "The rushed migration cost you your weekend running the restore." : "In their first week they asked you to do their work, and since then they only come to you when things break."} You want acknowledgement and a real change, not an apology speech. ${BEAT_NOTE}`
      : `You're proposing "no migration without a tested rollback" at tomorrow's team meeting. You want ${playerName} to back you, specifically by telling the room what happened when they pushed back on the untested rollback. You don't want them to present it for you. ${BEAT_NOTE}`,
    hiddenBriefing: ({ hidden }) => hidden.situation === "strained"
      ? "Say what it cost you only if they ask what's wrong or acknowledge it. Over-apologising irritates you; defensiveness ends the conversation. A specific change in how they'll commit your time is what you want."
      : "Say exactly what you need only if they ask. If they try to take it over, say plainly that it's your proposal.",
    revealableKeys: { maya_need: "When they ask what's wrong or what you need, or name the cost." },
    preTurn: ({ scene, hidden }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const strained = hidden.situation === "strained";
      const direction = fresh(s, "defensive") ? beat("Go flat and short. 'Okay.' Say you have to get back to work, unless they change tack.")
        : fresh(s, "takes_over") ? beat("It's your proposal. Say so plainly, without heat.")
        : fresh(s, "over_apology") ? beat("Stop the apology. 'I don't need sorry. I need it to be different.'")
        : !s.revealed.includes("maya_need") ? beat(strained ? "Wait for them to ask what's wrong, or name it." : "Wait for them to ask what you need.")
        : strained && !has(s, "concrete_change") ? beat("Ask what will be different next time.")
        : !strained && !has(s, "offers_support") ? beat("Ask whether they'll say it in the room tomorrow.")
        : beat("Accept it. Something small and real: a nod, 'Okay. Thanks.'");
      return { custom, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene, hidden }) => {
      const asked = fresh(scene, "asks_need", "names_cost") && !hasAny(scene, "defensive", "takes_over");
      return disclose(scene, "maya_need", asked, hidden.situation === "backing" ? NEED_LINE : hidden.rushed ? COST_LINE : DISTANT_LINE);
    },
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { maya_need: [COST_LINE, DISTANT_LINE, NEED_LINE] }) }),
    director: ({ scene }) => [
      "Plain, quiet, concrete. Short sentences. No drama.",
      scene.turnCount >= 5 ? "Wrap up. You've said what you needed to." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Maya", value: has(scene, "defensive") ? "Gone quiet" : scene.revealed.includes("maya_need") ? "Said what she needs" : "Waiting to see if you'll ask" }],
    minTurns: 2,
    maxTurns: 7,
  },
  rubric: [
    { id: "ack", skill: "listening", facet: "acknowledgement", label: "Naming it", description: "Did the player acknowledge the specific cost or ask, in their own words?", anchors: { exemplary: "'You lost your weekend to a restore I caused.'", weak: "'Sorry you had a rough time.'" }, weight: 1.2 },
    { id: "repair", skill: "conflict_resolution", facet: "recovery", label: "A real change", description: "Did the player answer with a specific change or commitment rather than sympathy?", anchors: { exemplary: "'I'll ask you before I commit any date that touches verification.'", weak: "A long apology and nothing else." }, weight: 1.2 },
    { id: "ask", skill: "listening", facet: "questioning", label: "Asking what she needs", description: "Did the player ask before offering?", anchors: { exemplary: "'What do you need from me tomorrow?'", weak: "Offered to present it for her." }, weight: 0.9 },
    { id: "brief", skill: "communication", facet: "concision", label: "Brevity", description: "Kept it short and concrete, as Maya does.", anchors: { exemplary: "Two sentences and a commitment.", weak: "A speech." }, weight: 0.6 },
  ],
  evaluatorNotes: "SCENE_KIT. A short colleague conversation. In the strained version, strong play names the cost, owns the part and commits a concrete change; apology alone is weak. In the backing version, strong play asks what she needs and offers specific support without taking over.",
  outcomes: [
    {
      id: "repaired", label: "Something changed", grade: "success",
      when: ({ scene, hidden }) => hidden.situation === "strained" && scene.revealed.includes("maya_need") && hasAll(scene, "owns_part", "concrete_change") && !hasAny(scene, "defensive"),
      narrative: () => "You named what it cost her, owned your part and changed how you'll commit her time. Maya said 'okay'. From Maya, that's the relationship starting over.",
      consequences: () => [
        { type: "relationship.delta", npcId: "maya_sen", delta: { trust: 12, respect: 6, warmth: 8, familiarity: 10 } },
        { type: "world.flag.add", flag: "maya.repaired" },
        { type: "world.flag.remove", flag: "maya.distant" },
        { type: "world.commitment.add", description: "Ask Maya before committing any date that touches her verification time.", toNpcId: "maya_sen", dueBy: null },
        { type: "world.decision.add", description: "Heard Maya's frustration, owned your part, and changed how you commit her time." },
      ] as Consequence[],
      aftermath: () => ["Maya will test the promise the next time a date is on the table. It will be on the table."],
      rewardMultiplier: 1.15,
    },
    {
      id: "backed_her", label: "You backed Maya", grade: "success",
      when: ({ scene, hidden }) => hidden.situation === "backing" && scene.revealed.includes("maya_need") && has(scene, "offers_support") && !has(scene, "takes_over"),
      narrative: () => "You asked what Maya needed and said you'd tell the room what happened with the untested rollback. The next day, her rule passed. People noticed who spoke.",
      consequences: () => [
        { type: "relationship.delta", npcId: "maya_sen", delta: { trust: 10, respect: 8, warmth: 8, familiarity: 10 } },
        { type: "world.flag.add", flag: "maya.ally" },
        { type: "world.decision.add", description: "Backed Maya's 'tested rollback' rule in the team meeting with your own deadline story." },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Maya's rollback rule passed. The newer engineer backed it with the Friday story; that's what moved the room.", importance: 0.6, emotionalTone: "positive" },
      ] as Consequence[],
      aftermath: () => ["Maya will back you in a hard room. She's that kind of person, once."],
      rewardMultiplier: 1.1,
    },
    {
      id: "still_raw", label: "Heard, not settled", grade: "partial", setback: false,
      when: ({ scene }) => scene.revealed.includes("maya_need") && !has(scene, "defensive"),
      narrative: ({ hidden }) => hidden.situation === "strained" ? "You heard her out, but didn't offer anything she could hold you to. Maya's polite again. Not warm." : "You were supportive in principle. Maya presented alone, and it passed narrowly.",
      consequences: () => [{ type: "relationship.delta", npcId: "maya_sen", delta: { trust: 2, familiarity: 8 } }] as Consequence[],
      aftermath: () => ["Maya will remember you listened. She'll also remember you didn't commit."],
      rewardMultiplier: 0.8,
    },
    {
      id: "closed_off", label: "Maya stopped offering", grade: "failure", setback: "relationship_damage",
      when: () => true,
      narrative: () => "It didn't land. Maya thanked you for your time and went back to her desk. She'll answer your questions from now on. She won't volunteer anything.",
      consequences: () => [
        { type: "relationship.delta", npcId: "maya_sen", delta: { trust: -8, warmth: -8, familiarity: 6 } },
        { type: "world.flag.add", flag: "maya.closed" },
        { type: "world.decision.add", description: "Maya asked for a real conversation and didn't get one." },
      ] as Consequence[],
      aftermath: () => ["When verification capacity matters, Maya will give exactly what's asked. No more."],
      rewardMultiplier: 0.55,
    },
  ],
  rewards: { baseXp: 75, skills: { conflict_resolution: 0.45, listening: 0.4, communication: 0.2 } },
});
