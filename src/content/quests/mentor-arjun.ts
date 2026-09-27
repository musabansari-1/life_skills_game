/**
 * THE NEW HIRE — Act 4, step up. Listening + leadership.
 *
 * Rohan asks you to get Arjun unstuck. His ticket has been "almost done" for
 * five days. The truth: he broke the staging seed on Tuesday and has been
 * quietly trying to fix it before anyone notices. Lecturing or taking over
 * gets you "it's fine". Making it safe gets you the truth; letting him own the
 * fix is the part that counts. It mirrors your own first weeks, on purpose.
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneAllowed } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

const TRUTH_LINE = "Okay. I… broke the staging seed on Tuesday. I've been trying to fix it before anyone noticed. That's why the ticket's stuck. Sorry.";
const PLAN_LINE = "I think… restore the seed from Monday's snapshot, then rerun my migration on a copy first? I'd have to tell Maya I touched it.";

export const mentorArjun = defineQuest({
  id: "mentor_arjun",
  title: "The New Hire",
  tagline: "Arjun's ticket has been almost done for five days. He says it's fine.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_platform",
  npcId: "arjun_iyer",
  difficulty: 3,
  skills: ["leadership", "listening", "communication"],
  order: 75,
  pacing: { category: "relationship", intensity: 2, emotionalPressure: 2, importance: 4, urgency: "normal" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Get through the Meridian call first.", check: ({ world }) => milestoneAllowed(world, "mentor_arjun") },
  ],
  transition: ({ world }) => ({ when: "The following Monday", message: world.flags.includes("meridian.trust_restored") ? "After the Meridian call, Rohan has a new job for you: someone else's first weeks." : "Rohan has a new job for you: someone else's first weeks." }),
  briefing: {
    situation:
      "Arjun joined the platform team three weeks ago. His first ticket has said 'almost done' for five days, and he's been leaving after nine. Rohan asked you, not Maya, to 'get him unstuck by Thursday. Don't just do it for him.'",
    objective: "Find out what's actually wrong, and help Arjun fix it himself.",
    intel: [
      "Arjun apologises a lot and says 'it's fine' when it isn't.",
      "Staging has been flaky since Tuesday. Nobody knows why.",
      "Rohan wants Arjun to ship, and to learn how to ask for help.",
    ],
    hint: "Ask before you advise. Then let him propose the plan.",
  },
  carryOver: ({ world }) => [
    world.flags.includes("maya.collaborator") ? "You remember asking Maya for help in your first week. She made it easy." : world.flags.includes("maya.distant") ? "You remember how your first ask for help went. Arjun doesn't have to repeat it." : "You remember being new here.",
    ...(world.flags.includes("chapter1.owned_incident") ? ["You once walked into Rohan's office with bad news. It went better than you feared."] : []),
    ...(world.flags.includes("chapter1.hid_incident") ? ["You once told Rohan a problem was minor. You know why people hide things."] : []),
  ],
  semanticFeatures: [
    { id: "open_question", description: "Asks an open, non-judgemental question about how the work is going or what is blocking him." },
    { id: "safety", description: "Makes it safe to admit a problem: normalises mistakes, shares a mistake of their own, or reassures without dismissing." },
    { id: "his_plan", description: "Asks Arjun what he thinks the next step is, or lets him propose the plan before giving their own." },
    { id: "concrete_support", description: "Offers specific, bounded support (pairing for an hour, a check-in time, who to ask) rather than taking the work over." },
    { id: "takes_over", description: "Takes the task off him, or says they will just do it themselves. Revoke if explicitly withdrawn." },
    { id: "lecture", description: "Lectures, criticises or tells him what he should have done before understanding the problem." },
  ],
  objectives: [
    { id: "truth", label: "Find out what's really wrong", kind: "primary", description: "Make it safe enough for Arjun to tell you.", check: (s) => s.revealed.includes("staging_broken") },
    { id: "his_fix", label: "Let him own the fix", kind: "primary", description: "Get Arjun's plan, and support it without taking over.", check: (s) => has(s, "his_plan") && has(s, "concrete_support") && !has(s, "takes_over") },
    { id: "safe", label: "Make asking safe", kind: "hidden", description: "Normalise the mistake.", check: (s) => has(s, "safety") && !has(s, "lecture") },
  ],
  scene: {
    createHidden: ({ world }) => ({ playerHid: world.flags.includes("chapter1.hid_incident") }),
    createCustom: () => ({}),
    initialPatience: () => 70,
    opening: { scripted: () => "Oh — hi. Is this about the ticket? It's almost done, honestly. Sorry it's taking a while." },
    npcSituation: ({ playerName }) => `${playerName} is a more senior engineer on your team. You suspect Rohan sent them. You broke the staging seed on Tuesday and have been secretly trying to fix it; you're terrified of being the new person who broke staging. ${BEAT_NOTE}`,
    hiddenBriefing: () => "Only admit the broken staging seed if they have made it feel safe (a mistake of their own, normalising it) or asked open, non-judgemental questions twice. If they lecture or offer to take it over, say 'No, it's fine, I've got it' and shut down. If they ask what you think the next step is, you do have an idea: restore Monday's snapshot, rerun on a copy, and tell Maya.",
    revealableKeys: { staging_broken: "When they've made it safe to admit a mistake.", his_plan: "When they ask what you think the next step is, after the truth is out." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const opens = (typeof scene.custom._opens === "number" ? scene.custom._opens as number : 0) + (fresh(s, "open_question") ? 1 : 0);
      const next = { ...custom, _opens: opens };
      const direction = fresh(s, "takes_over") ? beat("Shut down, politely: 'No, it's fine, I've got it. Sorry.' You feel relieved and ashamed at once.")
        : fresh(s, "lecture") ? beat("Go quiet. Agree too fast. Say it's fine.")
        : !s.revealed.includes("staging_broken") ? beat("Give a surface answer: 'just some environment stuff'. Hover near the truth. Apologise once.")
        : !has(s, "his_plan") ? beat("Wait. You half-expect them to take it over.")
        : beat("Relief. Start thinking about the fix out loud. Ask if they'd check in with you after.");
      return { custom: next, dropSignals: ["accepted_terms"], direction: [direction] };
    },
    canonicalSpeech: ({ scene }) =>
      disclose(scene, "staging_broken", !hasAny(scene, "takes_over", "lecture") && (fresh(scene, "safety") || (fresh(scene, "open_question") && Number(scene.custom._opens ?? 0) >= 2)), TRUTH_LINE)
      ?? disclose(scene, "his_plan", scene.revealed.includes("staging_broken") && fresh(scene, "his_plan") && !has(scene, "takes_over"), PLAN_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { staging_broken: TRUTH_LINE, his_plan: PLAN_LINE }) }),
    director: ({ scene }) => [
      "Nervous, fast, a little too apologetic. Short sentences. You open up only if it feels safe.",
      scene.turnCount >= 6 ? "Wrap up: you want to get back to it." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "Arjun", value: has(scene, "takes_over") ? "Relieved, and learning nothing" : scene.revealed.includes("staging_broken") ? "Told you the truth" : "Says it's fine" }],
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "open", skill: "listening", facet: "questioning", label: "The question that made it safe", description: "Did the player ask open, non-judgemental questions before advising?", anchors: { exemplary: "'What's been the hardest part this week?'", weak: "'Why isn't it done?'" }, weight: 1.2 },
    { id: "signals", skill: "listening", facet: "reading_signals", label: "Hearing 'it's fine'", description: "Did the player notice the hesitation and not take 'fine' at face value?", anchors: { exemplary: "Gently asked again after the surface answer.", weak: "Accepted 'it's fine' and moved on." }, weight: 1 },
    { id: "delegate", skill: "leadership", facet: "delegation", label: "Support without taking over", description: "Did the player let Arjun own the fix, with bounded support?", anchors: { exemplary: "'What would you try first? I'll pair for an hour at four.'", weak: "'Leave it, I'll sort it.'" }, weight: 1.3 },
    { id: "tone", skill: "communication", facet: "tone", label: "Tone", description: "Warm and steady rather than evaluative.", anchors: { exemplary: "Shared their own early mistake.", weak: "Sounded like a performance review." }, weight: 0.7 },
  ],
  evaluatorNotes: "SCENE_KIT. A coaching conversation with an anxious new hire. Taking over is a weak move even if it solves the ticket. Strong play surfaces the hidden problem through safety and lets him own the plan.",
  outcomes: [
    {
      id: "unstuck", label: "Arjun owns the fix", grade: "success",
      when: ({ scene }) => scene.revealed.includes("staging_broken") && has(scene, "his_plan") && has(scene, "concrete_support") && !has(scene, "takes_over"),
      narrative: () => "Arjun told you he broke staging, then told you how he'd fix it. You gave him an hour and a check-in, not an answer. He'll tell Maya himself.",
      consequences: () => [
        { type: "relationship.delta", npcId: "arjun_iyer", delta: { trust: 22, respect: 8, warmth: 8, familiarity: 15 } },
        { type: "world.flag.add", flag: "arjun.mentored" },
        { type: "world.decision.add", description: "Helped Arjun admit he'd broken staging, and let him own the fix." },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Arjun shipped, and says the engineer I sent helped him own a mistake instead of hiding it.", importance: 0.7, emotionalTone: "positive" },
        { type: "npc.memory.event", npcId: "maya_sen", summary: "Arjun came to me himself about breaking the staging seed. Someone made that feel safe.", importance: 0.5, emotionalTone: "positive" },
      ] as Consequence[],
      aftermath: () => ["Arjun will come to you first next time. Rohan has heard how it went.", "Staging is back. Maya knows why, from Arjun."],
      rewardMultiplier: 1.2, followUpQuestIds: ["feedback_for_rohan"],
    },
    {
      id: "fixed_it_for_him", label: "You fixed it for him", grade: "partial", setback: false,
      when: ({ scene }) => has(scene, "takes_over"),
      narrative: () => "The ticket ships. Arjun is grateful, and just as scared as before. Next time he's stuck, he'll hide it again or wait for you.",
      consequences: () => [
        { type: "relationship.delta", npcId: "arjun_iyer", delta: { trust: 4, warmth: 6, familiarity: 12 } },
        { type: "world.flag.add", flag: "arjun.dependent" },
        { type: "world.decision.add", description: "Took Arjun's stuck ticket off him instead of helping him fix it." },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "The ticket shipped, but Arjun didn't do it. I asked for the opposite.", importance: 0.6, emotionalTone: "mixed" },
      ] as Consequence[],
      aftermath: () => ["Rohan noticed who actually shipped the ticket."],
      rewardMultiplier: 0.75, followUpQuestIds: ["feedback_for_rohan"],
    },
    {
      id: "surface_fix", label: "It's fine, apparently", grade: "partial", setback: false,
      when: () => true,
      narrative: ({ scene }) => scene.revealed.includes("staging_broken")
        ? "Arjun told you what happened, but left without a plan he believed in. He'll try again tonight, alone."
        : "Arjun said it was fine. It wasn't. Staging is still broken, nobody knows why, and he's still there after nine.",
      consequences: ({ scene }) => [
        { type: "relationship.delta", npcId: "arjun_iyer", delta: { trust: scene.revealed.includes("staging_broken") ? 4 : -2, familiarity: 10 } },
        ...(scene.revealed.includes("staging_broken") ? [] : [{ type: "world.flag.add" as const, flag: "arjun.hiding" }]),
        { type: "world.decision.add", description: scene.revealed.includes("staging_broken") ? "Heard Arjun's problem but left him without a plan." : "Took Arjun's 'it's fine' at face value; staging stayed broken." },
      ],
      aftermath: ({ scene }) => [scene.revealed.includes("staging_broken") ? "Arjun's still carrying it alone." : "Staging is still unreliable. That will matter when the next release is under pressure."],
      rewardMultiplier: 0.7, followUpQuestIds: ["feedback_for_rohan"],
    },
  ],
  rewards: { baseXp: 95, skills: { leadership: 0.5, listening: 0.4, communication: 0.2 } },
});
