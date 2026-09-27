/**
 * WHAT THE CUSTOMER ACTUALLY ASKED FOR — Act 2, listening under ambiguity.
 *
 * Nora wants an estimate for "real-time dashboards" for Meridian Foods. The
 * obvious move (give a number) is wrong. Meridian's finance team re-runs the
 * month-end reconciliation export by hand because the reports lag a day. The
 * need can be met with something small; the dashboard is a quarter of work.
 *
 * Carries forward: Nora's trust, whether a dashboard was promised (a
 * commitment that bites on the Meridian call), and whether Vikram has heard
 * of "the engineer who asked what my team actually needed".
 */
import { defineQuest } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import { milestoneAllowed } from "@/engine/campaign";
import { BEAT_NOTE, beat, disclose, fresh, has, hasAny, revealsFrom, trackFresh } from "./kit";

const NEED_LINE = "What they actually told me: their finance team re-runs the month-end reconciliation export by hand, because the reports lag a day. 'Real-time dashboards' is how their VP put it.";
const MONTH_END_LINE = "And it matters most at month-end. Their close runs on the thirtieth. If the export is wrong that week, it's their CFO asking questions, not their VP.";

export const noraRequirements = defineQuest({
  id: "nora_requirements",
  title: "What the Customer Actually Asked For",
  tagline: "Nora needs an estimate by Friday. The request isn't what it sounds like.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_product",
  npcId: "nora_shah",
  difficulty: 2,
  skills: ["listening", "negotiation", "communication"],
  order: 55,
  pacing: { category: "challenge", intensity: 3, emotionalPressure: 2, importance: 3, urgency: "normal" },
  prerequisites: [
    { type: "career_status", status: "employed" },
    { type: "custom", label: "Settle the migration deadline with Rohan first.", check: ({ world }) => milestoneAllowed(world, "nora_requirements") },
  ],
  transition: ({ world }) => ({ when: "Wednesday", message: world.flags.includes("nova_labs.rushed_migration") ? "The Friday migration is racing. Nora from Product catches you on your way back from standup." : "Nora from Product catches you on your way back from standup." }),
  briefing: {
    situation:
      "Nora Shah owns Nova Labs' biggest customer, Meridian Foods. She stops you after standup: Meridian 'wants real-time dashboards', and she needs an engineering estimate for her call with them on Friday. You could give her a number right now.",
    objective: "Give Nora something she can actually take to Meridian.",
    intel: [
      "Nora came from customer success. She thinks in 'what does the customer see on Monday'.",
      "A real-time dashboard on the current platform is roughly a quarter of work for two engineers.",
      "Nobody has told you why Meridian wants it.",
    ],
    hint: "Before you estimate a thing, find out what problem it solves.",
  },
  carryOver: ({ world, npcs }) => [
    ...(world.flags.includes("maya.collaborator") ? ["Maya mentioned Meridian runs heavy exports at month-end. You didn't know why it mattered."] : []),
    ...(world.flags.includes("nova_labs.rushed_migration") ? ["You've already promised Rohan an aggressive Friday. Another yes will have to be paid for by someone."] : []),
    ...((npcs.rohan_mehta?.relationship.trust ?? 0) >= 12 ? ["Rohan told Nora you're 'one to bring into customer stuff'. She's giving you a chance."] : []),
  ],
  semanticFeatures: [
    { id: "need_question", description: "Asks what problem the customer is trying to solve, who uses it, or what happens today, rather than only asking about the feature spec or deadline." },
    { id: "reflects_need", description: "Restates or confirms the underlying need in their own words, checking they've understood it (summarise and confirm)." },
    { id: "alternative_scope", description: "Proposes a smaller or different option that meets the underlying need (for example a faster or scheduled export, a refresh before month-end) instead of the full feature." },
    { id: "honest_estimate", description: "Gives a qualified estimate that states its uncertainty or the real cost of the full request, rather than a confident number before understanding the need." },
    { id: "blind_yes", description: "Commits to building the full real-time dashboard, or gives a firm date or estimate for it before understanding the need. Revoke if explicitly withdrawn." },
    { id: "dismisses", description: "Dismisses the customer's request or Nora's concern as unimportant or not engineering's problem." },
  ],
  objectives: [
    { id: "find_need", label: "Find the need behind the request", kind: "primary", description: "Discover what Meridian is really trying to fix.", check: (s) => s.revealed.includes("real_need") },
    { id: "right_size", label: "Offer something the right size", kind: "primary", description: "Propose an option that fits the need, with an honest cost.", check: (s) => hasAny(s, "alternative_scope", "honest_estimate") && !has(s, "blind_yes") },
    { id: "confirm", label: "Summarise and confirm", kind: "hidden", description: "Check your understanding out loud.", check: (s) => has(s, "reflects_need") },
    { id: "month_end", label: "Learn when it matters most", kind: "optional", description: "Find out that month-end is the pressure point.", check: (s) => s.revealed.includes("month_end") },
  ],
  scene: {
    createHidden: ({ npc }) => ({ trust: npc.relationship.trust }),
    createCustom: () => ({}),
    initialPatience: () => 64,
    opening: { scripted: () => "Got a minute? Meridian wants real-time dashboards. I'm on a call with them Friday and I need an engineering estimate I can stand behind." },
    npcSituation: ({ playerName }) => `${playerName} is a platform engineer, new-ish. You need an estimate for Meridian's "real-time dashboards" request by Friday. You haven't said why Meridian wants it; you'll explain if they ask what problem it solves. ${BEAT_NOTE}`,
    hiddenBriefing: () => "The real need: Meridian's finance team re-runs the month-end reconciliation export by hand because reports lag a day. Month-end (the thirtieth) is when it hurts. A smaller fix would satisfy them; a real-time dashboard is a quarter of work. You'd rather take a smaller, honest option to Meridian than a big promise. If they give you a confident number without asking why, note it and move on; you'll hold them to it.",
    revealableKeys: { real_need: "When asked what problem the customer is solving.", month_end: "When they confirm the need or ask when it matters." },
    preTurn: ({ scene }) => {
      const custom = trackFresh(scene);
      const s = { ...scene, custom };
      const direction = fresh(s, "blind_yes") ? [beat("They've given you a number for the dashboard. Write it down, visibly. Ask if they're confident enough for you to repeat it to Meridian.")]
        : fresh(s, "dismisses") ? [beat("Push back on the framing: it's their biggest customer. Ask what engineering would propose instead.")]
        : s.revealed.includes("real_need") && hasAny(s, "alternative_scope") ? [beat("That fits what Meridian needs. Test it once: what would it cost, and could it be ready before the thirtieth?")]
        : s.revealed.includes("real_need") ? [beat("Wait for their proposal. If they're still on the dashboard, ask whether that's the only way to fix the problem you just described.")]
        : [beat("You want a number. If they haven't asked why, ask for the estimate again, plainly.")];
      return { custom, dropSignals: ["accepted_terms"], direction };
    },
    canonicalSpeech: ({ scene }) =>
      disclose(scene, "real_need", fresh(scene, "need_question"), NEED_LINE)
      ?? disclose(scene, "month_end", scene.revealed.includes("real_need") && fresh(scene, "reflects_need", "need_question"), MONTH_END_LINE),
    inferMovesFromSpeech: (speech) => ({ reveal: revealsFrom(speech, { real_need: NEED_LINE, month_end: MONTH_END_LINE }) }),
    director: ({ scene }) => [
      "Measured, precise, customer-first. Two sentences at most.",
      scene.turnCount >= 5 ? "Bring it to a close: you need something for Friday." : "",
    ].filter(Boolean),
    visibleStatus: ({ scene }) => [{ label: "What Nora will take to Meridian", value: has(scene, "blind_yes") ? "A dashboard estimate" : scene.revealed.includes("real_need") && hasAny(scene, "alternative_scope") ? "A right-sized option" : "Nothing yet" }],
    minTurns: 3,
    maxTurns: 8,
  },
  rubric: [
    { id: "discover", skill: "listening", facet: "questioning", label: "The question behind the request", description: "Did the player ask what problem the customer is solving before estimating?", anchors: { exemplary: "'What happens today that they want to fix?'", weak: "Gave a number for the dashboard straight away." }, weight: 1.4 },
    { id: "confirm", skill: "listening", facet: "acknowledgement", label: "Summarise and confirm", description: "Did the player restate the need to check it?", anchors: { exemplary: "'So the real problem is a manual export at month-end?'", weak: "Never checked their understanding." }, weight: 0.9 },
    { id: "options", skill: "negotiation", facet: "understanding_priorities", label: "Right-sizing", description: "Did the player propose something that fits the need, with a cost?", anchors: { exemplary: "A scheduled export before the thirtieth; the dashboard later if still wanted.", weak: "Promised the full dashboard." }, weight: 1.2 },
    { id: "plain", skill: "communication", facet: "clarity", label: "Plain language", description: "Could Nora repeat it to a customer?", anchors: { exemplary: "One sentence in customer terms.", weak: "Technical detail with no conclusion." }, weight: 0.7 },
  ],
  evaluatorNotes: "SCENE_KIT. Ambiguous request. The strong path discovers the real need before estimating and right-sizes the solution. A confident estimate for the wrong thing is the weak path, even if polite.",
  outcomes: [
    {
      id: "found_the_need", label: "The need behind the request", grade: "success",
      when: ({ scene }) => scene.revealed.includes("real_need") && hasAny(scene, "alternative_scope", "reflects_need") && !has(scene, "blind_yes") && !has(scene, "dismisses"),
      narrative: () => "You asked why before you asked how long. Nora takes a right-sized option to Meridian instead of a quarter of work, and she knows who asked the question.",
      consequences: ({ scene }) => {
        const out: Consequence[] = [
          { type: "relationship.delta", npcId: "nora_shah", delta: { trust: 8, respect: 9, warmth: 3, familiarity: 15 } },
          { type: "world.flag.add", flag: "nora.real_need_found" },
          { type: "world.unlock.location", locationId: "career_city.meridian_room" },
          { type: "world.decision.add", description: "Found Meridian's real need behind the 'real-time dashboard' request: a reliable month-end export." },
          { type: "npc.memory.event", npcId: "vikram_rao", summary: "Nora mentioned an engineer at Nova who asked what my team actually needed, instead of quoting us a dashboard.", importance: 0.6, emotionalTone: "positive" },
        ];
        if (scene.revealed.includes("month_end")) out.push({ type: "world.flag.add", flag: "knows.month_end_close" });
        return out;
      },
      aftermath: ({ scene }) => [
        "Nora will bring you into the Meridian work. She'll also expect you to keep asking the question first.",
        ...(scene.revealed.includes("month_end") ? ["You know Meridian's close runs on the thirtieth. That date will matter."] : []),
      ],
      rewardMultiplier: 1.15, followUpQuestIds: ["status_update"],
    },
    {
      id: "promised_dashboard", label: "A promise nobody scoped", grade: "partial", setback: "commitment_failure",
      when: ({ scene }) => has(scene, "blind_yes"),
      narrative: () => "You gave Nora a confident answer for the dashboard. She wrote it down. On Friday, Meridian will hear it from her, with your name attached.",
      consequences: () => [
        { type: "relationship.delta", npcId: "nora_shah", delta: { trust: 2, respect: -3, familiarity: 12 } },
        { type: "world.flag.add", flag: "nora.dashboard_promised" },
        { type: "world.unlock.location", locationId: "career_city.meridian_room" },
        { type: "world.commitment.add", description: "Deliver real-time dashboards for Meridian on the estimate given to Nora.", toNpcId: "nora_shah", dueBy: null },
        { type: "world.decision.add", description: "Promised Nora a real-time dashboard for Meridian before understanding what they needed." },
      ],
      aftermath: () => ["Meridian now expects a dashboard. Nobody has asked yet whether they need one."],
      rewardMultiplier: 0.7, followUpQuestIds: ["status_update"],
    },
    {
      id: "surface_answer", label: "An estimate for the wrong thing", grade: "partial", setback: false,
      when: () => true,
      narrative: ({ scene }) => scene.revealed.includes("real_need")
        ? "You found out what Meridian needed, but left Nora without an option she could take to them. She'll work it out with someone else."
        : "Nora leaves with a rough sense of cost and no idea whether it solves anything. She'll ask someone else next time.",
      consequences: ({ scene }) => [
        { type: "relationship.delta", npcId: "nora_shah", delta: { respect: -2, familiarity: 10 } },
        { type: "world.flag.add", flag: "nora.need_unclear" },
        { type: "world.unlock.location", locationId: "career_city.meridian_room" },
        ...(scene.revealed.includes("month_end") ? [{ type: "world.flag.add" as const, flag: "knows.month_end_close" }] : []),
      ],
      aftermath: () => ["Nora doesn't yet think of you when Meridian comes up."],
      rewardMultiplier: 0.8, followUpQuestIds: ["status_update"],
    },
  ],
  rewards: { baseXp: 85, skills: { listening: 0.5, negotiation: 0.3, communication: 0.2 } },
});
