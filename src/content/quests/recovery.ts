import { defineQuest, type AnyQuestDefinition } from "@/engine/types/quest";
import type { Consequence } from "@/engine/types/consequences";
import type { WorldState } from "@/engine/types/world";
import { CAREER_MILESTONES, CONTINUES_ON_FAILURE, milestoneResolved, recoveryId, reconcileCampaign } from "@/engine/campaign";
import { hasEvidence, sceneEvidence } from "@/engine/scene/ensemble";

/**
 * Authored voice for each recovery. The grammar (own it → concrete repair →
 * credible boundary) is shared; the people, stakes and words are not.
 */
interface RecoveryText {
  title: string; tagline: string; when: string; message: string;
  situation: string; objective: string; intel: string[];
  opening: (summary: string) => string;
  npcSituation: string;
  /** What a real repair looks like here, for the NPC. */
  repairLooksLike: string;
  repaired: string; unresolved: string; aftermath: string;
}
const TEXT: Record<string, RecoveryText> = {
  recruiter_screening: {
    title: "One More Call", tagline: "Emma said no. You're asking for five more minutes.",
    when: "Two days later", message: "You've written the email three times. Emma agreed to a short call.",
    situation: "Emma didn't put you forward after the screening. You asked for a short follow-up call, and she said yes, which she doesn't always do.",
    objective: "Own what went wrong in the screen, show her the specific example you didn't give, and ask for one clear next step.",
    intel: ["The original screening result stands.", "Emma doesn't reopen doors for charm. She reopens them for evidence.", "A strong repair gets you to the hiring manager, with some doubt still attached."],
    opening: () => "You asked for five minutes. You've got five. What's different from last time?",
    npcSituation: "A short follow-up call with a candidate you didn't put forward after screening. You'll reconsider only for a concrete example of their work and a sense that they understand what went wrong.",
    repairLooksLike: "One specific example of their work with a result, an honest line about what went wrong in the screen, and a bounded ask (one conversation with the hiring manager).",
    repaired: "You owned the screen and gave Emma the example she needed. She'll put you forward to Rohan, with a note that the first call was rough.",
    unresolved: "Emma heard you out, but didn't hear anything new. The door stays closed for now.",
    aftermath: "Rohan will hear that you needed a second call. It's yours to make that irrelevant.",
  },
  hiring_manager_interview: {
    title: "The Follow-Up", tagline: "Rohan passed. You asked for ten minutes anyway.",
    when: "The next week", message: "Rohan agreed to a ten-minute follow-up. He's blocked exactly ten.",
    situation: "Rohan didn't recommend an offer after your interview. He's agreed to a ten-minute follow-up call, mostly because Emma asked him to.",
    objective: "Own what you got wrong in the interview, give him the honest story you didn't, and ask for a realistic next step.",
    intel: ["The interview result stands.", "Rohan respects ownership and realistic commitments more than enthusiasm.", "A strong repair gets an offer, with Rohan's doubts written into it."],
    opening: () => "Ten minutes. I said no for a reason. Tell me what you'd say differently.",
    npcSituation: "A ten-minute follow-up with a candidate you turned down. You'll reconsider for honest ownership of something that went wrong and a realistic answer about ramp-up, not a sales pitch.",
    repairLooksLike: "An honest failure story with their own part owned, a realistic first milestone instead of a big promise, and a check-in they'll offer.",
    repaired: "You gave Rohan the honest version and a realistic first month. He'll approve an offer, and he'll watch the first month closely.",
    unresolved: "Rohan heard a better pitch, not a better answer. The no stands.",
    aftermath: "Rohan will remember that his first answer was no. Your first month is the argument.",
  },
  counter_offer: {
    title: "The Call You Have to Make", tagline: "Emma withdrew the offer. You're calling to ask for it back.",
    when: "Three days later", message: "Emma picks up on the fourth ring.",
    situation: "Emma withdrew the Nova Labs offer after the negotiation turned into a fight. She's agreed to take your call. The lost negotiation isn't coming back.",
    objective: "Own how the negotiation went, and ask to reopen the original offer with a limit you'll keep.",
    intel: ["The withdrawn offer stays in your history.", "Emma can reopen the original offer at ₹8.5L base, without a joining bonus. The lost negotiation is not undone.", "Pushing for more now ends the call."],
    opening: () => "I'm surprised you called. I'll be honest, I'm not sure what's left to say.",
    npcSituation: "A call from a candidate whose offer you withdrew after they turned the negotiation into a fight. You can reopen the original offer at eight and a half lakh base, no joining bonus, but only if they own how it went and don't reopen the negotiation.",
    repairLooksLike: "A plain acknowledgement of how they behaved, an explicit acceptance of the original terms, and no new asks.",
    repaired: "You owned the call and accepted the original terms. Emma reopened the offer at ₹8.5L. The negotiation you lost stays lost; the job doesn't.",
    unresolved: "Emma listened, but didn't hear enough to put her name back on the offer.",
    aftermath: "You're in, at the original terms. Emma will remember both calls.",
  },
  first_day_nova_labs: {
    title: "Start Again", tagline: "The first day went badly. Tomorrow is also a day.",
    when: "The next morning", message: "Emma's by the coffee machine again.",
    situation: "Your first day didn't go well. Emma is by the coffee machine again this morning.",
    objective: "Acknowledge yesterday lightly, and ask the questions you should have asked.",
    intel: ["Yesterday stays yesterday.", "Emma wants you to succeed; she brought you in."],
    opening: () => "Morning. Second go?",
    npcSituation: "A second morning with a new hire whose first day went badly. You're willing to help if they're genuine.",
    repairLooksLike: "A light acknowledgement of yesterday, a real question about the team, and a small commitment.",
    repaired: "You reset the tone and got what you needed. Emma introduced you to Rohan properly.",
    unresolved: "Still awkward. You'll find your own way to the platform team.",
    aftermath: "First impressions stick, but second ones count too.",
  },
  push_back_on_deadline: {
    title: "Before Friday Arrives", tagline: "You said yes to Friday. There's still time to say something else.",
    when: "Wednesday", message: "Rohan has a gap between meetings. You asked for it.",
    situation: "You agreed to a Friday migration without a rollback path. It's Wednesday. Rohan hasn't repeated the date to his director yet.",
    objective: "Own the commitment you made, bring a safer plan, and set a check-in you'll keep.",
    intel: ["The original promise stays in your history.", "Rohan hates surprises more than bad news.", "A good repair changes Friday. It doesn't erase that you promised it."],
    opening: () => "You wanted a word about Friday. I've got five minutes before I tell my director it's on.",
    npcSituation: "A second conversation with an engineer who agreed to Friday without a rollback path. You haven't told your director yet. You'll accept a safer plan if they own the change and bring something concrete.",
    repairLooksLike: "Owning that Friday was a mistake, a narrower Friday deliverable plus a real completion date with rollback, and a check-in before the date.",
    repaired: "You went back before it was too late. Rohan has a safer plan, and he knows you'll tell him early next time.",
    unresolved: "Rohan heard doubt, not a plan. Friday stands.",
    aftermath: "Friday is now a plan you can defend. Rohan will remember you changed it early.",
  },
  status_update: {
    title: "The Honest Version", tagline: "You told Rohan it was minor. You're going back to tell him the rest.",
    when: "The next morning", message: "Rohan already knows more than you told him.",
    situation: "Your status update didn't hold. Rohan now has a clearer picture than the one you gave him. You've asked for ten minutes.",
    objective: "Give Rohan the full picture, own the part you minimised, and bring a plan with a check-in.",
    intel: ["What you said yesterday stays said.", "Rohan cares more about hearing it from you than about the size of the problem.", "A good repair rebuilds some trust. It doesn't restore all of it."],
    opening: (summary) => `${summary} I've heard more since. From other people. Go on.`,
    npcSituation: "A follow-up with an engineer whose status update didn't tell you the whole story. You've heard more from others. You want the full picture from them, their part owned, and a plan with a time.",
    repairLooksLike: "The real size of the problem stated plainly, the minimising owned in one sentence, and a fix with a time and a check-in.",
    repaired: "You gave Rohan the honest version. It cost you something to say. It will cost you less next time.",
    unresolved: "Still not the whole story. Rohan stops asking you for status and starts asking other people.",
    aftermath: "Rohan will check your next update against other sources. For a while.",
  },
  customer_escalation: {
    title: "Nora's Debrief", tagline: "The Meridian call went wrong. Nora has the account. You have ten minutes.",
    when: "The day after the call", message: "Nora agreed to a debrief. She's brought her notes.",
    situation: "Nora took the Meridian account back after the call. She's agreed to a short debrief, mostly to understand what happened from your side.",
    objective: "Own what went wrong on the call, offer something concrete Nora can use with Meridian, and don't promise to fix it all.",
    intel: ["Nora keeps the account. This won't reopen the call.", "She wants something she can actually take to Vikram.", "A good repair rebuilds some credibility with Nora."],
    opening: () => "I'll be honest, I needed to understand that call. What happened, from where you sat?",
    npcSituation: "A debrief with the engineer from the Meridian call that went wrong. You keep the account. You'll rebuild some trust for honest ownership and one concrete thing you can take to Vikram (for example, a verified export before the thirtieth).",
    repairLooksLike: "Owning what went wrong on the call without blaming anyone, one concrete protection for Meridian's close Nora can offer, and a check-in rather than a big promise.",
    repaired: "You owned the call and gave Nora something concrete for Vikram. She still owns Meridian. She'll bring you back in when it's useful.",
    unresolved: "Nora heard an explanation, not a repair. She'll handle Meridian alone.",
    aftermath: "Nora will give you another chance with a customer. Not this one, yet.",
  },
};

/** One recovery grammar, with explicit authored continuations. No new canonical run of the original quest. */
export function createRecovery(source: AnyQuestDefinition): AnyQuestDefinition {
  const index = CAREER_MILESTONES.indexOf(source.id);
  const next = CONTINUES_ON_FAILURE.includes(source.id) ? undefined : CAREER_MILESTONES[index + 1];
  const t = TEXT[source.id];
  // The Friday promise can be repaired until Friday's consequences land in the status update.
  const following = source.id === "push_back_on_deadline" ? "status_update" : CAREER_MILESTONES[index + 1];
  const target = (world: WorldState) => {
    const reconciled = reconcileCampaign(world);
    // "The next morning" stops being the next morning once the story has moved a chapter on.
    if (following && milestoneResolved(reconciled, source.id) && milestoneResolved(reconciled, following)) return null;
    return reconciled.campaign.failures.find((f) => f.questId === source.id && !f.recoveredBy)?.id ?? null;
  };
  const ready = (scene: Parameters<typeof hasEvidence>[0]) => ["ownership", "repair", "boundary"].every((id) => hasEvidence(scene, id)) && new Set(sceneEvidence(scene).filter((e) => !e.revoked).map((e) => e.turnIndex)).size >= 2;
  const continuation = (world: WorldState): Consequence[] => [
    // Repairing the Friday promise before the migration ships changes what ships. Afterwards, it can't.
    ...(source.id === "push_back_on_deadline" && !world.completedQuests.some((r) => r.questId === "status_update") ? [
      { type: "world.flag.add" as const, flag: "director.deadline_replanned" },
      ...world.commitments.filter((c) => c.madeInQuestId === "push_back_on_deadline" && c.status === "open").map((c) => ({ type: "world.commitment.resolve" as const, commitmentId: c.id, status: "superseded" as const })),
      { type: "world.commitment.add" as const, description: "Partial delivery Friday; full migration after the rollback test.", toNpcId: "rohan_mehta", dueBy: null },
    ] : []),
    ...(next ? [{ type: "world.unlock.quest" as const, questId: next }] : []),
    ...(source.id === "hiring_manager_interview" ? [{ type: "world.career.set" as const, patch: { status: "offer_received" } }, { type: "world.var.set" as const, key: "interview.verdict", value: "shaky" }] : []),
    ...(source.id === "counter_offer" ? [{ type: "world.career.set" as const, patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: 850000, signingBonus: 0 } }, { type: "world.flag.add" as const, flag: "nova_labs.joined" }, { type: "world.flag.remove" as const, flag: "nova_labs.offer_withdrawn" }, { type: "world.unlock.location" as const, locationId: "career_city.nova_labs_platform" }] : []),
    ...(source.id === "status_update" ? [{ type: "world.flag.add" as const, flag: "chapter1.complete" }, { type: "world.flag.add" as const, flag: "status.repaired" }] : []),
    ...(source.id === "customer_escalation" ? [{ type: "world.flag.add" as const, flag: "meridian.debrief_repaired" }] : []),
  ];
  return defineQuest({
    id: recoveryId(source.id), title: t?.title ?? `Own the Miss: ${source.title}`, tagline: t?.tagline ?? "Repair what happens next. Keep an honest record of what happened.", worldId: source.worldId, locationId: source.locationId,
    npcId: source.npcId, difficulty: 2, skills: ["communication", "conflict_resolution", "leadership"], order: source.order + 0.5,
    pacing: { category: "recovery", intensity: 2, emotionalPressure: 3, importance: 4, urgency: "consequence" }, recovery: { target },
    prerequisites: [{ type: "custom", label: "This recovery opens after an unresolved setback in the original conversation.", check: ({ world }) => !!target(world) }],
    transition: t ? () => ({ when: t.when, message: t.message }) : undefined,
    briefing: t
      ? { situation: t.situation, objective: t.objective, intel: t.intel, hint: "Own it in one sentence. Then the repair. Then a limit you'll actually keep." }
      : { situation: `The outcome of ${source.title} is still part of your story. A separate follow-up can change the next decision if you acknowledge what happened and offer a credible repair.`, objective: "Own your part, offer a specific repair, and set a limit you can keep.", intel: ["The original result remains canonical.", "A strong repair opens the next milestone with some trust still to earn.", "A weak repair may leave this branch unresolved. Practice does not repair it."] },
    carryOver: ({ world }) => {
      const f = reconcileCampaign(world).campaign.failures.find((x) => x.id === target(world));
      return [f ? `What happened: ${f.summary}.` : "", f && f.recoveryAttempts.length ? "You've tried to repair this once already. That attempt is remembered too." : ""].filter(Boolean);
    },
    semanticFeatures: [
      { id: "ownership", description: "Acknowledges the concrete mistake or their own responsibility without deflection." },
      { id: "repair", description: "Proposes a specific feasible action that addresses the harm or missing information, not only an apology." },
      { id: "boundary", description: "Sets a credible limit or check-in for the repair, avoiding another unlimited promise." },
    ],
    objectives: ["ownership", "repair", "boundary"].map((id) => ({ id, label: id === "ownership" ? "Own the miss" : id === "repair" ? "Offer a concrete repair" : "Set a credible boundary", kind: "primary" as const, description: "Use sound reasoning, in your own words.", check: (s) => hasEvidence(s, id) })),
    scene: {
      createHidden: ({ world }) => ({ target: target(world), summary: reconcileCampaign(world).campaign.failures.find((f) => f.id === target(world))?.summary ?? "The earlier conversation did not work out." }),
      createCustom: () => ({} as Record<string, unknown>),
      opening: { scripted: ({ hidden }) => t ? t.opening(String(hidden.summary).replace(/\.?$/, ".")) : `${hidden.summary} That happened. What would you do differently now, and what can I actually rely on?` },
      npcSituation: () => `A separate recovery after ${source.title}. ${t?.npcSituation ?? "Listen to a credible repair without pretending the earlier result changed."} Never pretend the earlier result changed.`,
      hiddenBriefing: () => `${t ? `A real repair here: ${t.repairLooksLike} ` : ""}A specific repair and bounded next commitment can reopen the next step. You cannot undo the earlier record.`, revealableKeys: {},
      preTurn: () => ({ dropSignals: ["accepted_terms"] }),
      director: ({ scene }) => [ready(scene) ? "The repair meets the requirements; acknowledge the next step, with trust still to rebuild." : "Ask about one missing element: responsibility, concrete repair, or a credible limit. Do not demand perfect wording."], minTurns: 2, maxTurns: 8,
    },
    rubric: [{ id: "repair", skill: "conflict_resolution", facet: "de_escalation", label: "Repair", description: "Does the player change the next action without erasing the past?", anchors: { exemplary: "Owns a specific mistake and proposes a feasible repair.", weak: "Apology without a changed action." }, weight: 1 }],
    outcomes: [
      { id: "repaired", label: "A repair, not a reset", grade: "success", when: ({ scene }) => ready(scene), narrative: () => t?.repaired ?? "You changed what happens next. Some trust returns, and the next story milestone opens. The original setback stays in your history.", consequences: ({ world }) => [...continuation(world), { type: "relationship.delta", npcId: source.npcId, delta: { trust: 6, respect: 4, familiarity: 5 } }, { type: "world.decision.add", description: `Repaired the consequences of ${source.title}.` }], aftermath: () => t ? [t.aftermath] : [], rewardMultiplier: 1, followUpQuestIds: next ? [next] : [] },
      { id: "repair_unresolved", label: "The repair remains unresolved", grade: "failure", when: () => true, narrative: () => t ? `${t.unresolved} The original result and this attempt both remain in your story.` : "The follow-up did not produce a credible repair. Trust falls further. The original result and this attempt both remain in your story.", consequences: () => [{ type: "relationship.delta", npcId: source.npcId, delta: { trust: -4, familiarity: 4 } }], rewardMultiplier: 0.5 },
    ], rewards: { baseXp: 45, skills: { communication: 1, conflict_resolution: 1, leadership: 0.5 } },
  });
}
