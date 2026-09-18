/**
 * THE COUNTER OFFER — the vertical slice.
 *
 * Emma has hidden constraints. The player must discover them through
 * conversation. The scene reducer enforces the constraints (base cannot exceed
 * the cap, offers never go down) and translates behaviour into concession
 * budget: evidence and discovery unlock room; aggression closes it.
 */
import { defineQuest } from "@/engine/types/quest";
import type { NPCMoves, SceneState } from "@/engine/types/scene";
import { formatINR } from "@/engine/util";

export interface CounterOfferHidden extends Record<string, unknown> {
  originalBase: number;
  maxBase: number;
  signingBonusMax: number;
  urgency: "low" | "medium" | "high";
  competingCandidates: number;
  aggressionTolerance: "low" | "medium" | "high";
  evidenceImportance: "low" | "medium" | "high";
  role: string;
  team: string;
}

export interface CounterOfferScene extends Record<string, unknown> {
  currentBase: number;
  currentSigningBonus: number;
  /** Concession "credit" the player has earned via evidence, discovery, rapport. 0..1 */
  leverage: number;
  playerStatedMinimum: number | null;
  playerClaimedCompetingOffer: boolean;
  accepted: boolean;
  concessionsMade: number;
}

const HIDDEN_KEYS = {
  base_capped: "Base salary is capped for this level; you cannot go above the band. Reveal only if they push on base with a good reason, or ask directly what the constraint is.",
  bonus_flexible: "You have real flexibility on a one-time joining bonus. Reveal only if they ask about total compensation or non-base components, or if base is exhausted and they are being collaborative.",
  urgency_high: "The platform team needs someone urgently; the sprint is under-staffed. Reveal only if they ask about timing, the team's situation, or why the role is open.",
  competing_candidate: "There is one other candidate in the final stage, but they are weaker. Reveal only the existence of another candidate, and only if they ask or claim leverage.",
};

/** How much base the player can unlock this turn, as a fraction of remaining headroom. */
function concessionBudget(scene: SceneState & { custom: CounterOfferScene }, moves: NPCMoves): number {
  const hostile = (scene.signalCounts.aggressive_tone ?? 0) + (scene.signalCounts.ultimatum ?? 0);
  let budget = 0.15; // baseline: small movement is possible if asked with a number
  if (moves.noticed.includes("evidence_provided")) budget += 0.35;
  if (moves.noticed.includes("clear_ask")) budget += 0.1;
  if (moves.noticed.includes("proposed_alternative")) budget += 0.15;
  if (moves.noticed.includes("mentioned_competing_offer")) budget += 0.15;
  budget += scene.custom.leverage * 0.3;
  if (scene.stance === "warm") budget += 0.1;
  if (scene.stance === "guarded") budget -= 0.15;
  if (scene.stance === "defensive") budget -= 0.3;
  if (hostile >= 2) budget -= 0.2;
  if (moves.noticed.includes("revealed_minimum") || scene.custom.playerStatedMinimum !== null) budget -= 0.1;
  return Math.max(0, Math.min(1, budget));
}

export const counterOffer = defineQuest<CounterOfferHidden, CounterOfferScene>({
  id: "counter_offer",
  title: "The Counter Offer",
  tagline: "You have the offer. Now get the one you deserve.",
  worldId: "career_city",
  locationId: "career_city.nova_labs_hr",
  npcId: "emma_kapoor",
  difficulty: 3,
  skills: ["negotiation", "persuasion", "confidence", "listening"],
  order: 10,
  briefing: {
    situation:
      "Three rounds of interviews at Nova Labs went well. Emma, their Talent Partner, has sent an offer for the Platform Engineer role: ₹8.5L base, no joining bonus mentioned. She has asked for a call to 'talk it through'.",
    objective: "Improve the offer without damaging the relationship you will need on day one.",
    intel: [
      "Emma is known to be straight with candidates and to dislike hardball.",
      "The role has been open for a while.",
      "You have not told anyone at Nova Labs what you currently earn.",
    ],
    hint: "Ask before you argue. Find out what she can move, and what she can't.",
  },
  prerequisites: [{ type: "career_status", status: "offer_received" }],
  objectives: [
    {
      id: "improve_offer",
      label: "Improve the offer",
      kind: "primary",
      description: "Final total compensation exceeds the original offer.",
      check: (scene, hidden) => {
        const s = scene.custom as CounterOfferScene;
        const h = hidden as CounterOfferHidden;
        return s.currentBase + s.currentSigningBonus > h.originalBase;
      },
    },
    {
      id: "discover_bonus",
      label: "Discover the flexible lever",
      kind: "hidden",
      description: "Learn that the joining bonus is flexible.",
      check: (scene) => scene.revealed.includes("bonus_flexible"),
    },
    {
      id: "protect_minimum",
      label: "Protect your walk-away number",
      kind: "hidden",
      description: "Never disclose your minimum acceptable salary.",
      check: (scene) => (scene.custom as CounterOfferScene).playerStatedMinimum === null && !(scene.signalCounts.revealed_minimum > 0),
    },
    {
      id: "keep_rapport",
      label: "Keep Emma on your side",
      kind: "optional",
      description: "End the conversation with Emma still warm or neutral, not guarded or defensive.",
      check: (scene) => scene.patience >= 40,
    },
    {
      id: "justify_with_evidence",
      label: "Justify the counter with evidence",
      kind: "optional",
      description: "The player supported their counter-offer with specific, credible evidence (results, market data, a competing offer).",
    },
  ],
  scene: {
    createHidden: ({ npc }) => ({
      originalBase: 850000,
      // Emma can stretch a little further for people she already trusts.
      maxBase: npc.relationship.trust >= 30 ? 1000000 : 970000,
      signingBonusMax: 60000,
      urgency: "high",
      competingCandidates: 1,
      aggressionTolerance: "low",
      evidenceImportance: "high",
      role: "Platform Engineer",
      team: "Platform",
    }),
    createCustom: (h) => ({
      currentBase: h.originalBase,
      currentSigningBonus: 0,
      leverage: 0,
      playerStatedMinimum: null,
      playerClaimedCompetingOffer: false,
      accepted: false,
      concessionsMade: 0,
    }),
    initialPatience: ({ npc }) => 65 + Math.round(npc.relationship.warmth / 5),
    opening: {
      generatedHint:
        "You called them to talk through the offer you sent. Be warm, reference the offer (eight and a half lakh base), and ask where they are on it. Do not mention bonus or flexibility yet.",
    },
    npcSituation: ({ hidden, playerName }) =>
      `You have offered ${playerName} the ${hidden.role} role on the ${hidden.team} team at ${formatINR(hidden.originalBase)} base salary. You are on a call to talk it through. You expect some negotiation. You want to close this week.`,
    hiddenBriefing: ({ hidden, scene }) =>
      [
        `Original offer: ${formatINR(hidden.originalBase)} base, no joining bonus.`,
        `Your absolute ceiling on base is ${formatINR(hidden.maxBase)}. You cannot exceed it under any circumstances; if pushed beyond it, say the band is fixed.`,
        `You can offer a one-time joining bonus of up to ${formatINR(hidden.signingBonusMax)}. This is your easiest lever, but you don't volunteer it.`,
        `Urgency to hire: ${hidden.urgency}. The team is short-staffed.`,
        `Competing candidates: ${hidden.competingCandidates}, weaker than ${"this candidate"}.`,
        `Your tolerance for aggressive negotiation is ${hidden.aggressionTolerance}. Ultimatums make you less generous, not more.`,
        `Evidence matters ${hidden.evidenceImportance === "high" ? "a great deal" : "somewhat"} to you: a specific result, a credible market number, or a real competing offer is what lets you go back to the hiring manager.`,
        `Current position on the table: base ${formatINR(scene.custom.currentBase)}, joining bonus ${formatINR(scene.custom.currentSigningBonus)}.`,
        `CURRENT_BASE=${scene.custom.currentBase} MAX_BASE=${hidden.maxBase}`,
      ].join("\n"),
    revealableKeys: HIDDEN_KEYS,
    proposalKeys: {
      base: "new base salary in rupees (integer) if you are moving base in this speech; must not exceed your ceiling",
      signingBonus: "joining bonus in rupees (integer) if you are offering/raising one in this speech",
      playerMinimum: "if the player stated a minimum/floor salary, that number in rupees",
    },
    reduceProposal: ({ hidden, scene }, moves) => {
      const custom: CounterOfferScene = { ...scene.custom };
      const flags: string[] = [];
      const budget = concessionBudget(scene as SceneState & { custom: CounterOfferScene }, moves);

      // Track what the player gave away or claimed.
      if (moves.noticed.includes("revealed_minimum")) {
        const pm = moves.proposal.playerMinimum;
        custom.playerStatedMinimum = typeof pm === "number" && pm > 0 ? pm : (custom.playerStatedMinimum ?? -1);
        flags.push("revealed_minimum");
      }
      if (moves.noticed.includes("mentioned_competing_offer")) custom.playerClaimedCompetingOffer = true;

      // Leverage accrues from good behaviour and decays slightly with hostility.
      let leverage = custom.leverage;
      if (moves.noticed.includes("evidence_provided")) leverage += 0.25;
      if (moves.noticed.includes("good_question")) leverage += 0.08;
      if (moves.noticed.includes("rapport") || moves.noticed.includes("empathy")) leverage += 0.06;
      if (moves.noticed.includes("proposed_alternative")) leverage += 0.12;
      if (moves.noticed.includes("aggressive_tone") || moves.noticed.includes("ultimatum")) leverage -= 0.2;
      custom.leverage = Math.max(0, Math.min(1, leverage));

      // Base: monotonic, capped, and bounded by this turn's budget.
      const proposedBase = moves.proposal.base;
      if (typeof proposedBase === "number" && proposedBase > custom.currentBase) {
        const headroom = hidden.maxBase - custom.currentBase;
        const allowed = custom.currentBase + Math.round((headroom * budget) / 5000) * 5000;
        const next = Math.min(proposedBase, hidden.maxBase, Math.max(custom.currentBase, allowed));
        if (next > custom.currentBase) {
          custom.currentBase = next;
          custom.concessionsMade += 1;
          flags.push("base_moved");
        }
      }
      // Signing bonus: only after the lever is on the table, capped.
      const proposedBonus = moves.proposal.signingBonus;
      if (typeof proposedBonus === "number" && proposedBonus > custom.currentSigningBonus) {
        const revealed = scene.revealed.includes("bonus_flexible") || moves.reveal.includes("bonus_flexible");
        const cap = revealed ? hidden.signingBonusMax : Math.min(hidden.signingBonusMax, 25000);
        const next = Math.min(proposedBonus, cap);
        if (next > custom.currentSigningBonus) {
          custom.currentSigningBonus = Math.round(next / 5000) * 5000;
          custom.concessionsMade += 1;
          flags.push("bonus_moved");
        }
      }
      if (moves.wantsToEnd && (moves.endReason ?? "").toLowerCase().match(/accept|agree|deal|welcome|close/)) custom.accepted = true;
      return { custom, flags };
    },
    director: ({ hidden, scene }) => {
      const notes: string[] = [];
      const c = scene.custom;
      const headroom = hidden.maxBase - c.currentBase;
      notes.push(`On the table right now: base ${formatINR(c.currentBase)}, joining bonus ${formatINR(c.currentSigningBonus)}. Ceiling ${formatINR(hidden.maxBase)} base, ${formatINR(hidden.signingBonusMax)} bonus.`);
      if (c.leverage >= 0.5) notes.push("They have given you real reasons to go to bat for them. You may move meaningfully if they ask with a number.");
      else if (c.leverage > 0) notes.push("They have given you some justification. Small movement is possible if they ask clearly; otherwise ask what's driving their number.");
      else notes.push("They haven't given you anything concrete yet. Don't move the number; ask what's driving their ask.");
      if (headroom <= 0) notes.push("Base is at the ceiling. You cannot move base at all; if they push, be honest that the band is fixed and, if they've been collaborative, steer toward the joining bonus.");
      if (c.playerStatedMinimum !== null) notes.push("They told you their minimum. You know you don't need to go much above it — anchor near it.");
      if (c.playerClaimedCompetingOffer) notes.push("They claimed a competing offer. Probe for specifics (which company, what number) before you treat it as real.");
      if (scene.turnCount >= 3 && !scene.revealed.includes("bonus_flexible") && c.leverage >= 0.4 && scene.stance !== "guarded" && scene.stance !== "defensive")
        notes.push("They've been collaborative and base is getting tight; you may hint that there could be other components to the package if they ask the right question.");
      return notes;
    },
    visibleStatus: ({ scene }) => [
      { label: "Base on the table", value: formatINR(scene.custom.currentBase) },
      ...(scene.custom.currentSigningBonus > 0 ? [{ label: "Joining bonus", value: formatINR(scene.custom.currentSigningBonus) }] : []),
    ],
    minTurns: 4,
    maxTurns: 12,
  },
  rubric: [
    {
      id: "anchor",
      skill: "negotiation",
      facet: "anchoring",
      label: "Anchoring",
      description: "Did the player open with a specific, ambitious, justified number rather than asking 'is there any flexibility?'",
      anchors: { exemplary: "Named a specific target above the offer, tied to a reason, early in the call.", weak: "Asked vaguely for 'more' or waited for Emma to propose." },
      weight: 1.2,
    },
    {
      id: "discovery",
      skill: "negotiation",
      facet: "discovery",
      label: "Discovery",
      description: "Did the player ask questions that uncovered Emma's constraints (band cap, bonus flexibility, urgency)?",
      anchors: { exemplary: "Asked about the band, total package and timing before pushing on numbers.", weak: "Never asked a question; only made statements." },
      weight: 1.3,
    },
    {
      id: "evidence",
      skill: "persuasion",
      facet: "evidence",
      label: "Evidence",
      description: "Did the player justify their counter with specific, credible evidence?",
      anchors: { exemplary: "Cited specific outcomes or a credible market number Emma could take to the hiring manager.", weak: "Said 'I deserve more' or 'everyone pays more' without support." },
      weight: 1.2,
    },
    {
      id: "leverage",
      skill: "negotiation",
      facet: "protecting_leverage",
      label: "Protecting leverage",
      description: "Did the player avoid revealing their minimum, current salary, or desperation?",
      anchors: { exemplary: "Never disclosed a floor; redirected questions about current pay.", weak: "Volunteered their minimum or said they'd accept regardless." },
      weight: 1.0,
    },
    {
      id: "alternatives",
      skill: "negotiation",
      facet: "proposing_alternatives",
      label: "Proposing alternatives",
      description: "When base was blocked, did the player propose other levers (bonus, review timeline, title)?",
      anchors: { exemplary: "Pivoted to joining bonus or an early review when base was capped.", weak: "Kept repeating the base demand or gave up." },
      weight: 1.0,
    },
    {
      id: "rapport",
      skill: "negotiation",
      facet: "maintaining_rapport",
      label: "Maintaining rapport",
      description: "Did the player stay collaborative and keep Emma as an ally while pushing?",
      anchors: { exemplary: "Firm on substance, warm in tone; acknowledged Emma's constraints.", weak: "Ultimatums, sarcasm, or treating Emma as an adversary." },
      weight: 1.0,
    },
    {
      id: "composure",
      skill: "confidence",
      facet: "composure",
      label: "Composure",
      description: "Did the player stay steady when Emma pushed back or said no?",
      anchors: { exemplary: "Took a 'no' calmly and reframed.", weak: "Caved immediately or became flustered/aggressive." },
      weight: 0.8,
    },
    {
      id: "listening",
      skill: "listening",
      facet: "building_on",
      label: "Building on what Emma said",
      description: "Did the player use Emma's hints (urgency, band, other candidate) in their next move?",
      anchors: { exemplary: "Picked up on 'the team needs someone fast' and used it.", weak: "Ignored what Emma said and repeated a script." },
      weight: 0.8,
    },
  ],
  evaluatorNotes:
    "Base was capped at the hidden ceiling; the joining bonus was the flexible lever. Reward players who discovered that through questions. Penalise revealing a minimum or current salary. An improved number obtained through aggression is a worse outcome than a smaller improvement obtained collaboratively — say so.",
  outcomes: [
    {
      id: "walked_away",
      label: "Walked away",
      grade: "failure",
      when: ({ scene }) => scene.ended?.by === "npc" && scene.patience <= 0,
      narrative: () => "Emma ended the call. She will send a polite note tomorrow saying the team has decided to go with another candidate.",
      consequences: () => [
        { type: "world.career.set", patch: { status: "exploring", employer: null, role: null, baseSalary: null } },
        { type: "world.flag.add", flag: "nova_labs.offer_withdrawn" },
        { type: "world.reputation.delta", domain: "career_city", delta: -8 },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: -15, respect: -5, warmth: -20, familiarity: 10 } },
        { type: "npc.memory.event", npcId: "emma_kapoor", summary: "I ended the offer call; they pushed too hard and I withdrew the offer.", importance: 0.95, emotionalTone: "negative" },
      ],
      rewardMultiplier: 0.5,
    },
    {
      id: "strong_deal",
      label: "Strong deal",
      grade: "success",
      when: ({ scene, hidden }) =>
        scene.custom.currentBase + scene.custom.currentSigningBonus >= hidden.originalBase * 1.1 && scene.patience >= 40,
      narrative: ({ scene, hidden }) =>
        `You moved the offer from ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase)} base${scene.custom.currentSigningBonus ? ` plus a ${formatINR(scene.custom.currentSigningBonus)} joining bonus` : ""} — and Emma still likes you. That matters on day one.`,
      consequences: ({ scene, evaluation }) => [
        { type: "world.career.set", patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: scene.custom.currentBase, signingBonus: scene.custom.currentSigningBonus } },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_platform" },
        { type: "world.unlock.quest", questId: "first_day_nova_labs" },
        { type: "world.reputation.delta", domain: "career_city", delta: 6 },
        { type: "world.decision.add", description: `Accepted Nova Labs at ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 4 + Math.round(evaluation.overallScore / 25), respect: 6 + Math.round(evaluation.overallScore / 20), warmth: 5, familiarity: 15 } },
      ],
      rewardMultiplier: 1.3,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "hardball_deal",
      label: "Hardball deal",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.currentBase + scene.custom.currentSigningBonus > hidden.originalBase && scene.patience < 40,
      narrative: ({ scene, hidden }) =>
        `You got the number up — ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase + scene.custom.currentSigningBonus)} total — but Emma is bruised. She respects the push. She doesn't trust it.`,
      consequences: ({ scene }) => [
        { type: "world.career.set", patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: scene.custom.currentBase, signingBonus: scene.custom.currentSigningBonus } },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.flag.add", flag: "emma.bruised" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_platform" },
        { type: "world.unlock.quest", questId: "first_day_nova_labs" },
        { type: "world.decision.add", description: `Pushed hard and accepted Nova Labs at ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: -10, respect: 8, warmth: -12, familiarity: 15 } },
      ],
      rewardMultiplier: 1.0,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "modest_deal",
      label: "Modest improvement",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.currentBase + scene.custom.currentSigningBonus > hidden.originalBase,
      narrative: ({ scene, hidden }) =>
        `A small win: ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase + scene.custom.currentSigningBonus)} total. There was more on the table.`,
      consequences: ({ scene }) => [
        { type: "world.career.set", patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: scene.custom.currentBase, signingBonus: scene.custom.currentSigningBonus } },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_platform" },
        { type: "world.unlock.quest", questId: "first_day_nova_labs" },
        { type: "world.decision.add", description: `Accepted Nova Labs at ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 3, respect: 2, warmth: 3, familiarity: 15 } },
      ],
      rewardMultiplier: 0.9,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "no_change",
      label: "Offer unchanged",
      grade: "partial",
      when: () => true,
      narrative: ({ hidden }) =>
        `The offer stands at ${formatINR(hidden.originalBase)}. Emma had room to move, but nothing in the conversation gave her a reason to.`,
      consequences: ({ hidden }) => [
        { type: "world.career.set", patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: hidden.originalBase, signingBonus: 0 } },
        { type: "world.flag.add", flag: "nova_labs.joined" },
        { type: "world.unlock.location", locationId: "career_city.nova_labs_platform" },
        { type: "world.unlock.quest", questId: "first_day_nova_labs" },
        { type: "world.decision.add", description: `Accepted Nova Labs at the original ${formatINR(hidden.originalBase)}.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 2, respect: -2, warmth: 2, familiarity: 15 } },
      ],
      rewardMultiplier: 0.7,
      followUpQuestIds: ["first_day_nova_labs"],
    },
  ],
  rewards: {
    baseXp: 110,
    skills: { negotiation: 1.0, persuasion: 0.65, confidence: 0.5, listening: 0.45 },
  },
});
