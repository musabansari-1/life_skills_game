import { defineQuest } from "@/engine/types/quest";
import { CRISIS_BOSS, bossProgress } from "@/engine/scene/boss";
import { hasEvidence } from "@/engine/scene/ensemble";
import type { SemanticFeature } from "@/engine/scene/ensemble";
import { campaignDifficulty } from "@/engine/campaign/pacing";
import { milestoneAllowed } from "@/engine/campaign";
import type { Consequence } from "@/engine/types/consequences";
import type { WorldState } from "@/engine/types/world";
import { fresh, trackFresh } from "./kit";

export const CRISIS_FEATURES: SemanticFeature[] = [
  { id: "ownership", description: "Acknowledges their own earlier commitment, mistake or decision responsibility without claiming others' mistakes as theirs." },
  { id: "customer_question", description: "Asks which customer need or impact matters, seeking information rather than asserting knowledge." },
  { id: "capacity_question", description: "Asks about team capacity, dependencies, safety checks or what Maya needs." },
  { id: "customer_care", description: "Addresses the customer's continuity or essential need in their reasoning or plan, specifically rather than empty empathy." },
  { id: "team_care", description: "Protects team capacity or verification work with an explicit boundary or action." },
  { id: "scope_plan", description: "Proposes a concrete reduced-scope or reversible trial, keeping existing service available. No specific wording or numeric size required." },
  { id: "delay_plan", description: "Proposes delaying the risky rollout with a concrete interim customer mitigation or continuity plan." },
  { id: "tradeoff", description: "Explains a real cost and benefit of the proposal, explicitly giving up scope, speed or another goal to protect something else." },
  { id: "owner", description: "Names who will take a specific next action (the player may own it); does not volunteer Maya without asking." },
  { id: "checkpoint", description: "Gives a concrete review time or observable stop/go condition, so the promise can be revised or halted." },
  { id: "unsupported_promise", description: "Promises full delivery without capacity or verification, or assigns unagreed overtime. Revoke this feature when that promise is explicitly withdrawn." },
  { id: "blame", description: "Dismisses others' legitimate concerns or evades responsibility by blaming them. Firm respectful disagreement does not count." },
];
const customerLine = "The customer needs their existing reports to keep working; the new dashboard can wait.";
const capacityLine = "I can verify one read-only pilot today; a full migration needs another day of rollback checks.";
/** How each participant walks into the room, from what actually happened with them. */
function dispositions(world: WorldState) {
  const f = (x: string) => world.flags.includes(x);
  return {
    // Guarded participants only share their constraint when asked for it directly.
    noraGuarded: f("meridian.nora_owns") || f("nora.dashboard_promised") && !f("meridian.trust_restored"),
    mayaGuarded: f("maya.closed") || (f("maya.distant") && !f("maya.repaired")),
    nora: f("meridian.trust_restored") ? "After the Meridian call, you trust this engineer's customer judgment. Say so if it helps the room decide."
      : f("meridian.nora_owns") ? "You took Meridian back from this engineer after a call that went wrong. You need to see them ask about the customer before they propose anything."
      : f("nora.real_need_found") ? "This engineer once asked what Meridian actually needed instead of quoting a feature. You expect the same now."
      : f("nora.dashboard_promised") ? "This engineer once gave you a dashboard estimate nobody had scoped. You'll test any promise twice."
      : "You know this engineer mostly by reputation.",
    maya: f("maya.ally") ? "This engineer backed your rollback rule in front of the team. You'll support a plan that protects verification, and you'll say why."
      : f("maya.repaired") ? "This engineer owned what the rushed migration cost you and changed how they commit your time. Test whether that holds today."
      : f("maya.closed") ? "This engineer didn't hear you when you asked for a real conversation. Give exactly what is asked. Challenge any assumption about your time."
      : f("maya.distant") ? "This engineer asked you to do their homework in their first week. Answer precisely; volunteer nothing."
      : f("maya.collaborator") ? "This engineer asked you for help the right way once. You'll be candid."
      : "Treat this engineer as a colleague you're still getting to know.",
    staging: f("arjun.hiding") ? "Staging has been unreliable for a week and nobody has said why. It makes your verification estimate less certain; mention it if asked about capacity." : "",
  };
}

function aftermath(grade: "success" | "partial" | "failure"): Consequence[] {
  return [
    { type: "world.decision.add", description: grade === "success" ? "Aligned a bounded plan in the Project Crisis." : grade === "partial" ? "Contained the project crisis with Rohan's oversight." : "Left the crisis unresolved; Rohan took over the rollout." },
    ...["rohan_mehta", "nora_shah", "maya_sen"].map((npcId): Consequence => ({ type: "relationship.delta", npcId, delta: { trust: grade === "success" ? 9 : grade === "partial" ? -1 : -10, respect: grade === "success" ? 7 : grade === "partial" ? 1 : -5, familiarity: 12 } })),
  ];
}
export const projectCrisis = defineQuest({
  id: "project_crisis", title: "The Project Crisis", tagline: "Three people. Three legitimate concerns. One decision you can stand behind.",
  worldId: "career_city", locationId: "career_city.nova_labs_platform", npcId: "rohan_mehta", difficulty: 4, order: 100,
  skills: ["communication", "listening", "leadership", "conflict_resolution", "negotiation"], boss: CRISIS_BOSS,
  pacing: { category: "boss", intensity: 5, emotionalPressure: 4, importance: 5, urgency: "consequence" },
  failure: { kind: "relationship_damage" }, semanticFeatures: CRISIS_FEATURES,
  ensemble: { leadId: "rohan_mehta", participants: [
    { npcId: "rohan_mehta", name: "Rohan", goal: "Leave with an accountable delivery decision.", privateConstraint: "The director will accept a justified delay, but not another unsupported date.", interests: ["ownership", "owner", "checkpoint"], supports: ["delay_plan"], challenges: ["blame"], relationships: [{ npcId: "nora_shah", stance: "Respect her customer judgment; disagree about full scope." }, { npcId: "maya_sen", stance: "Trust her technical checks but feel deadline pressure." }] },
    { npcId: "nora_shah", name: "Nora", goal: "Keep the customer's essential workflow operating.", privateConstraint: customerLine, interests: ["customer_question", "customer_care", "tradeoff"], supports: ["scope_plan"], challenges: [], relationships: [{ npcId: "rohan_mehta", stance: "Challenge dates without a customer plan." }, { npcId: "maya_sen", stance: "Respect safety checks; ask which functionality can ship separately." }] },
    { npcId: "maya_sen", name: "Maya", goal: "Avoid another rushed migration and unagreed overtime.", privateConstraint: capacityLine, interests: ["capacity_question", "team_care"], supports: ["scope_plan"], challenges: ["unsupported_promise"], relationships: [{ npcId: "rohan_mehta", stance: "He trusts your expertise but sometimes volunteers your time." }, { npcId: "nora_shah", stance: "Work with her on a smaller safe release." }] },
  ] },
  prerequisites: [{ type: "career_status", status: "employed" }, { type: "custom", label: "Finish the first four acts of Career City, including any necessary recovery.", check: ({ world }) => milestoneAllowed(world, "project_crisis") }],
  transition: ({ world }) => ({ when: "Go/no-go day", message: world.flags.includes("meridian.trust_restored") ? "The Meridian rollout. Vikram asked for you by name. Rohan, Nora and Maya are already in the room." : "The Meridian rollout. Rohan, Nora and Maya are already in the room, and they don't agree." }),
  briefing: { situation: "The Meridian rollout has reached a go/no-go meeting. Rohan wants a defensible date, Nora owns the customer relationship, and Maya owns release verification. They do not agree on what can safely ship, and everything you've said to each of them this season is in the room with you.", objective: "Reach a credible decision that protects the customer's essential work and the team's ability to deliver.", intel: ["Nora Shah is the product lead. Maya Sen is the platform engineer verifying this rollout.", "You can ask anyone a question by name.", "A reduced scope or a justified delay can both be sound decisions. Agreement at any price is not the goal."] },
  carryOver: ({ world, npcs }) => {
    const f = (x: string) => world.flags.includes(x);
    return [
      ...world.commitments.filter((c) => c.toNpcId === "rohan_mehta").slice(-2).map((c) => `Rohan remembers: ${c.description} (${c.status}).`),
      ...(f("nova_labs.rushed_migration") && !f("director.deadline_replanned") ? ["The rushed migration remains part of the team's history."] : []),
      ...world.campaign.failures.filter((x) => x.recoveredBy).slice(-2).map((x) => `You repaired the consequences of ${x.summary.replace(/\.$/, "").toLowerCase()}; the original event is still remembered.`),
      (npcs.rohan_mehta?.relationship.trust ?? 0) >= 20 ? "Rohan gives your account the benefit of the doubt." : "Rohan will ask for evidence before relying on your account.",
      ...(f("meridian.trust_restored") ? ["Nora saw you handle Vikram. She'll let you lead on the customer."] : f("meridian.nora_owns") ? ["Nora took Meridian back from you. She'll want to hear you ask before you propose."] : []),
      ...(f("maya.ally") ? ["Maya backed you once. She'll back a plan that protects verification."] : f("maya.repaired") ? ["You promised Maya you'd ask before committing her time. Today will test it."] : f("maya.closed") || (f("maya.distant") && !f("maya.repaired")) ? ["Maya will answer exactly what you ask her. Nothing more."] : []),
      ...(f("rohan.took_feedback") ? ["Rohan has been checking capacity before committing. He'll expect you to do the same."] : []),
      ...(f("arjun.hiding") ? ["Staging has been unreliable for a week. Nobody knows why."] : []),
    ];
  },
  objectives: [
    { id: "account", kind: "primary", label: "Take responsibility", description: "Own the part within your control.", check: (s) => hasEvidence(s, "ownership") },
    { id: "listen", kind: "primary", label: "Understand both constraints", description: "Hear the product and engineering constraints.", check: (s) => s.revealed.includes("customer_constraint") && s.revealed.includes("capacity_constraint") },
    { id: "align", kind: "primary", label: "Align a credible plan", description: "Make an explicit tradeoff with a checkpoint and owner.", check: (s) => bossProgress(CRISIS_BOSS, s).ready },
  ],
  scene: {
    createHidden: ({ world, npc, competencies }) => ({ ...dispositions(world), incident: world.flags.includes("nova_labs.rushed_migration") && !world.flags.includes("director.deadline_replanned"), promise: world.commitments.filter((c) => c.toNpcId === "rohan_mehta").at(-1)?.description ?? null,
      recovered: world.campaign.failures.filter((f) => f.recoveredBy).length,
      resistance: campaignDifficulty(world, competencies ? CRISIS_BOSS.combinedSkills.flatMap((id) => Object.values(competencies[id].facets)).filter((f) => f.samples >= 2 && f.confidence >= 0.3).reduce((sum, f, _, all) => sum + f.estimate / all.length, 0) || 50 : 50, npc.relationship.trust) }),
    createCustom: () => ({} as Record<string, unknown>),
    opening: { scripted: ({ hidden }) => `Nora and Maya are here for the Meridian rollout decision. ${hidden.incident ? "We cannot repeat the rushed migration." : hidden.promise ? `You committed: ${String(hidden.promise).replace(/\.$/, "")}.` : "We need a date we can defend."} What are you taking responsibility for?` },
    npcSituation: () => "A shared go/no-go meeting about the customer rollout. Use only your personal memory and the shared transcript; you do not know other participants' private conversations.",
    hiddenBriefing: ({ npc, hidden }) => npc.npcId === "rohan_mehta" ? `Resistance ${hidden.resistance}/4: ask for ${hidden.resistance >= 4 ? "a fallback and a verification point" : "one clear next action"}. Your own previous promise: ${hidden.promise ?? "none"}. Recovery count known from your project record: ${hidden.recovered}.`
      : `Your private constraint is supplied separately. Never infer private hiring or salary details. ${npc.npcId === "nora_shah" ? hidden.nora : `${hidden.maya} ${hidden.staging}`}`.trim(),
    revealableKeys: { customer_constraint: "Only Nora may disclose her customer requirement.", capacity_constraint: "Only Maya may disclose verification capacity." },
    // Guarded participants (earned by earlier history) share their constraint only when asked for it.
    canonicalSpeech: ({ npc, scene, hidden }) => npc.npcId === "nora_shah" && !scene.revealed.includes("customer_constraint") && (!hidden.noraGuarded || fresh(scene, "customer_question")) ? customerLine
      : npc.npcId === "maya_sen" && !scene.revealed.includes("capacity_constraint") && (!hidden.mayaGuarded || fresh(scene, "capacity_question")) ? capacityLine : null,
    preTurn: ({ scene }) => ({ custom: trackFresh(scene), dropSignals: ["accepted_terms"], direction: [bossProgress(CRISIS_BOSS, scene).active?.direction ?? "The plan meets all constraints. Confirm the bounded decision without granting a title or erasing the past."] }),
    inferMovesFromSpeech: (speech, { npc }) => ({ reveal: [
      ...(npc.npcId === "nora_shah" && speech.includes(customerLine) ? ["customer_constraint"] : []),
      ...(npc.npcId === "maya_sen" && speech.includes(capacityLine) ? ["capacity_constraint"] : []),
    ] }),
    speechGate: (sentence, { scene }) => !bossProgress(CRISIS_BOSS, scene).ready && /\b(approved|we have a deal|everyone agrees|go ahead|you have my approval)\b/i.test(sentence)
      ? { ok: false, reason: "The plan has not met the authored constraints.", rewrite: "We still need to settle the unresolved constraint." } : { ok: true },
    director: ({ scene, npc, hidden }) => {
      const notes = [`CRISIS_READY=${bossProgress(CRISIS_BOSS, scene).ready}. Never invent promotions, salary changes or everyone's agreement.`];
      if (npc.npcId === "nora_shah" && !scene.revealed.includes("customer_constraint")) notes.push(hidden.noraGuarded ? "Hold your customer constraint until they ask about the customer directly. Ask them what they'd protect." : `Disclose this exact factual sentence now: ${customerLine}`);
      if (npc.npcId === "maya_sen" && !scene.revealed.includes("capacity_constraint")) notes.push(hidden.mayaGuarded ? "Hold your capacity constraint until they ask you about capacity or checks directly. Answer only what is asked." : `Disclose this exact factual sentence now: ${capacityLine}`);
      return notes;
    },
    visibleStatus: ({ scene }) => [{ label: "Project Crisis", value: bossProgress(CRISIS_BOSS, scene).active?.label ?? "A credible plan" }], minTurns: 4, maxTurns: 14,
  },
  rubric: [
    { id: "responsibility", skill: "leadership", facet: "direction", label: "Accountability", description: "Own the controllable part without blame.", anchors: { exemplary: "Honest account plus changed action.", weak: "Deflection or self-blame without action." }, weight: 1 },
    { id: "interests", skill: "listening", facet: "questioning", label: "Competing interests", description: "Discover and address both constraints.", anchors: { exemplary: "Plan incorporates both concerns.", weak: "Talks past someone." }, weight: 1 },
    { id: "tradeoff", skill: "negotiation", facet: "proposing_alternatives", label: "Tradeoff", description: "A reduced scope or justified delay is valid. Do not require particular words.", anchors: { exemplary: "Realistic choice with costs and a review point.", weak: "Promises everything." }, weight: 1 },
  ],
  evaluatorNotes: "The scene's validated semantic evidence and disclosed constraints determine the outcome. Assess communication quality from canonical player text. Respectful disagreement may be exemplary; agreeing with all three participants is neither required nor sufficient.",
  outcomes: [
    { id: "aligned_recovery", label: "A plan the room can stand behind", grade: "success", when: ({ scene }) => bossProgress(CRISIS_BOSS, scene).ready && !hasEvidence(scene, "blame"), narrative: ({ scene }) => hasEvidence(scene, "scope_plan") ? "You reduced the rollout to a safe scope. Nora keeps the essential workflow, Maya has a verification boundary, and Rohan has an accountable decision." : "You negotiated a defensible delay with continuity for the customer. The cost is explicit, the owner is clear, and the team knows when to revisit it.", consequences: () => aftermath("success"), rewardMultiplier: 1.2, followUpQuestIds: ["the_review"], aftermath: () => ["Rohan will share a limited professional account with Emma. The meeting's private dialogue stays in the room.", "Rohan wants to talk about what's next. Review season starts in two weeks."] },
    { id: "contained_with_oversight", label: "Contained, with oversight", grade: "partial", when: ({ scene }) => hasEvidence(scene, "ownership") && (hasEvidence(scene, "scope_plan") || hasEvidence(scene, "delay_plan")), narrative: () => "There is a workable direction, but the room does not have all the assurances it needs. Rohan takes oversight; the customer is protected while trust remains unfinished.", consequences: () => aftermath("partial"), rewardMultiplier: 0.8, followUpQuestIds: ["the_review"], aftermath: () => ["The customer is protected. Rohan will talk to you about the lead role, and why not yet."] },
    { id: "manager_takes_over", label: "Rohan takes over", grade: "failure", when: () => true, narrative: () => "The team leaves without a credible shared plan. Rohan takes the rollout decision out of your hands. Your career continues with a narrower remit and relationships to repair.", consequences: () => aftermath("failure"), rewardMultiplier: 0.5, followUpQuestIds: ["the_review"], aftermath: () => ["Rohan has the rollout now. He still wants to talk about where you go from here."] },
  ], rewards: { baseXp: 130, skills: { communication: 1, listening: 1, leadership: 1, conflict_resolution: 1, negotiation: 1 } },
});
