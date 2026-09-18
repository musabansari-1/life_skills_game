/**
 * THE COUNTER OFFER — the vertical slice, now chapter 3 of the Nova Labs campaign.
 *
 * Emma has hidden constraints (ceiling, bonus lever, urgency) shaped by earlier
 * quests: how the interview went sets her ceiling; the number you gave her in
 * screening is something she remembers and uses.
 *
 * Each turn, `preTurn` reads the player's words deterministically (ask, floor,
 * evidence, pressure, acceptance) and decides how far Emma may move BEFORE she
 * speaks. She is told, so what she says matches the rules. Whatever she says
 * out loud is binding, up to her hidden ceiling.
 */
import { defineQuest } from "@/engine/types/quest";
import type { PlayerSignal, SceneState } from "@/engine/types/scene";
import type { WorldState } from "@/engine/types/world";
import { formatINR } from "@/engine/util";
import { extractRupeeAmounts, normalizeMoneyText } from "@/engine/parsing/numbers";

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
  /** From the hiring-manager interview: shapes Emma's ceiling. */
  interviewVerdict: "strong" | "solid" | "shaky" | null;
  /** From recruiter screening: the number the player gave Emma, if any. */
  statedExpectation: number | null;
  /** From a previous failed attempt: Emma withdrew the offer once. */
  secondChance: boolean;
}

export interface CounterOfferScene extends Record<string, unknown> {
  currentBase: number;
  currentSigningBonus: number;
  /** Concession "credit" the player has earned via evidence, discovery, rapport. 0..1 */
  leverage: number;
  playerStatedMinimum: number | null;
  highestAsk: number | null;
  playerClaimedCompetingOffer: boolean;
  accepted: boolean;
  concessionsMade: number;
  /** Highest base Emma was allowed to offer this turn (set by preTurn). */
  turnCap: number | null;
  unrealisticAsks: number;
}

const HIDDEN_KEYS = {
  base_capped: "Base salary is capped for this level. Reveal only if they push on base with a good reason, or ask directly what the constraint is. Never say the ceiling figure.",
  bonus_flexible: "You have real flexibility on a one-time joining bonus. Reveal only if they ask about the package beyond base, or if base is exhausted and they are being collaborative.",
  urgency_high: "The platform team needs someone urgently; the sprint is under-staffed. Reveal only if they ask about timing, the team's situation, or why the role is open.",
  competing_candidate: "There is one other candidate in the final stage, but they are weaker. Reveal only the existence of another candidate, and only if they ask or claim leverage.",
  manager_keen: "Only if your hidden briefing says Rohan loved them in the interview: the hiring manager pushed to make this hire. Reveal only if they ask how the team felt about them. Otherwise never claim this.",
};

const round5k = (n: number) => Math.round(n / 5000) * 5000;

/** How much of the remaining headroom the player can unlock this turn. 0..1 */
function concessionBudget(signals: Set<PlayerSignal>, c: CounterOfferScene, hidden: CounterOfferHidden, scene: SceneState): number {
  const hostile = (scene.signalCounts.aggressive_tone ?? 0) + (scene.signalCounts.ultimatum ?? 0);
  let budget = 0.12;
  if (signals.has("evidence_provided")) budget += 0.4;
  if (signals.has("clear_ask")) budget += 0.08;
  if (signals.has("proposed_alternative")) budget += 0.12;
  if (signals.has("mentioned_competing_offer")) budget += 0.1;
  budget += c.leverage * 0.3;
  if (scene.stance === "warm") budget += 0.08;
  if (scene.stance === "guarded") budget -= 0.15;
  if (scene.stance === "defensive") budget -= 0.35;
  if (hostile >= 2) budget -= 0.2;
  if (c.unrealisticAsks > 0) budget -= 0.15;
  // The player anchored themselves in screening: Emma has a reason to hold.
  if (hidden.statedExpectation !== null && hidden.statedExpectation <= c.currentBase) budget -= 0.15;
  if (hidden.urgency === "high") budget += 0.05;
  return Math.max(0, Math.min(1, budget));
}

function onTable(c: CounterOfferScene): string {
  return `${formatINR(c.currentBase)} base${c.currentSigningBonus > 0 ? ` plus a ${formatINR(c.currentSigningBonus)} joining bonus` : ", no joining bonus"}`;
}

function styleVar(style: string) {
  return { type: "world.var.set" as const, key: "counter_offer.style", value: style };
}

function joined(base: number, bonus: number) {
  return [
    { type: "world.career.set" as const, patch: { status: "employed", employer: "Nova Labs", role: "Platform Engineer", baseSalary: base, signingBonus: bonus } },
    { type: "world.flag.add" as const, flag: "nova_labs.joined" },
    { type: "world.unlock.location" as const, locationId: "career_city.nova_labs_platform" },
    { type: "world.unlock.quest" as const, questId: "first_day_nova_labs" },
  ];
}

function verdictOf(world: WorldState): CounterOfferHidden["interviewVerdict"] {
  const v = world.vars["interview.verdict"];
  return v === "strong" || v === "solid" || v === "shaky" ? v : null;
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
  order: 30,
  briefing: {
    situation:
      "Nova Labs made you an offer for the Platform Engineer role: ₹8.5L base, no joining bonus mentioned. Emma, their Talent Partner, has asked for a call to 'talk it through'.",
    objective: "Improve the offer without damaging the relationship you will need on day one.",
    intel: ["Emma is known to be straight with candidates and to dislike hardball.", "The role has been open for a while."],
    hint: "Ask before you argue. Find out what she can move, and what she can't.",
  },
  prerequisites: [
    {
      type: "custom",
      label: "Requires an offer from Nova Labs",
      check: ({ world }) =>
        world.career.status === "offer_received" || world.completedQuests.some((q) => q.questId === "counter_offer") || world.failedQuests.some((q) => q.questId === "counter_offer"),
    },
  ],
  carryOver: ({ world }) => {
    const lines: string[] = [];
    const x = world.vars["screening.stated_expectation"];
    if (typeof x === "number") lines.push(`In screening you told Emma ${formatINR(x)} would work. She wrote it down.`);
    else if (world.flags.includes("screening.deflected")) lines.push("You kept your number to yourself in screening. Emma doesn't know what you expect.");
    const v = verdictOf(world);
    if (v === "strong") lines.push("Rohan came out of your interview impressed. Emma has more room than usual.");
    if (v === "solid") lines.push("Your interview went fine. Emma has a normal band to work with.");
    if (v === "shaky") lines.push("Your interview was shaky. Emma's room to move is tighter.");
    if (world.failedQuests.some((q) => q.questId === "counter_offer")) lines.push("Last time, Emma withdrew the offer. This is a second conversation, and she remembers the first.");
    return lines;
  },
  objectives: [
    {
      id: "improve_offer",
      label: "Improve the offer",
      kind: "primary",
      description: "Final total compensation exceeds the original offer.",
      check: (scene, hidden) => {
        const s = scene.custom as CounterOfferScene;
        return s.currentBase + s.currentSigningBonus > (hidden as CounterOfferHidden).originalBase;
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
      check: (scene) => (scene.signalCounts.evidence_provided ?? 0) > 0,
    },
  ],
  scene: {
    createHidden: ({ world, npc }) => {
      const verdict = verdictOf(world);
      const stated = world.vars["screening.stated_expectation"];
      return {
        originalBase: 850000,
        maxBase: npc.relationship.trust >= 30 || verdict === "strong" ? 1000000 : verdict === "shaky" ? 920000 : 970000,
        signingBonusMax: verdict === "shaky" ? 40000 : 60000,
        urgency: verdict === "shaky" ? "medium" : "high",
        competingCandidates: 1,
        aggressionTolerance: "low",
        evidenceImportance: "high",
        role: "Platform Engineer",
        team: "Platform",
        interviewVerdict: verdict,
        statedExpectation: typeof stated === "number" ? stated : null,
        secondChance: world.failedQuests.some((q) => q.questId === "counter_offer"),
      };
    },
    createCustom: (h) => ({
      currentBase: h.originalBase,
      currentSigningBonus: 0,
      leverage: 0,
      playerStatedMinimum: null,
      highestAsk: null,
      playerClaimedCompetingOffer: false,
      accepted: false,
      concessionsMade: 0,
      turnCap: null,
      unrealisticAsks: 0,
    }),
    initialPatience: ({ npc, hidden }) => 65 + Math.round(npc.relationship.warmth / 5) - (hidden.secondChance ? 15 : 0),
    opening: {
      generatedHint:
        "You called them to talk through the offer you sent. Be warm but brisk, reference the offer (eight and a half lakh base), and ask where they are on it. Don't mention bonus or flexibility.",
    },
    npcSituation: ({ hidden, playerName }) =>
      `You have offered ${playerName} the ${hidden.role} role on the ${hidden.team} team at ${formatINR(hidden.originalBase)} base. You're on a call to talk it through. You expect some negotiation and want to close this week.${hidden.secondChance ? " The first time you spoke about this offer it went badly and you withdrew it; the team agreed to one more conversation." : ""}`,
    hiddenBriefing: ({ hidden, scene }) =>
      [
        `Original offer: ${formatINR(hidden.originalBase)} base, no joining bonus.`,
        `Your absolute ceiling on base is ${formatINR(hidden.maxBase)}. Never exceed it and never say it out loud.`,
        `You can offer a one-time joining bonus of up to ${formatINR(hidden.signingBonusMax)}. It's your easiest lever, but you don't volunteer it.`,
        `Urgency to hire: ${hidden.urgency}.`,
        `Competing candidates: ${hidden.competingCandidates}, weaker than this one.`,
        `You have little tolerance for hardball. Ultimatums make you less generous, not more.`,
        `Specific evidence (a result, a credible market number, a real competing offer) is what lets you go back to the hiring manager.`,
        hidden.interviewVerdict === "strong" ? "Rohan, the hiring manager, loved them in the interview and pushed for this hire." : "",
        hidden.interviewVerdict === "shaky" ? "Rohan was lukewarm after the interview; you have less room than usual." : "",
        hidden.statedExpectation !== null ? `In the screening call they told you they were looking for around ${formatINR(hidden.statedExpectation)}.` : "",
        `On the table now: ${onTable(scene.custom)}.`,
        `CURRENT_BASE=${scene.custom.currentBase} MAX_BASE=${hidden.maxBase}`,
      ]
        .filter(Boolean)
        .join("\n"),
    revealableKeys: HIDDEN_KEYS,
    proposalKeys: {
      base: "new base salary in rupees (integer) if you are moving base in this speech",
      signingBonus: "joining bonus in rupees (integer) if you are offering/raising one in this speech",
      playerMinimum: "if the player stated a minimum/floor salary, that number in rupees",
    },
    preTurn: ({ hidden, scene }, playerRead, text) => {
      const c: CounterOfferScene = { ...scene.custom };
      let read = playerRead;
      const dir: string[] = [];
      const fmt = formatINR;
      // In a salary negotiation a bare "nine point five" means lakh: re-read with that context.
      if (read.ask === null && read.minimum === null) {
        const salaryAmounts = extractRupeeAmounts(text, { salaryContext: true }).filter((a) => a.unit === "lakh" || a.amount >= 300000);
        if (salaryAmounts.length) read = { ...read, ask: Math.max(...salaryAmounts.map((a) => a.amount)), signals: [...new Set([...read.signals, "clear_ask" as const])] };
      }
      if (read.minimum !== null) c.playerStatedMinimum = read.minimum;
      if (read.ask !== null) c.highestAsk = Math.max(c.highestAsk ?? 0, read.ask);
      const sig = new Set(read.signals);
      if (sig.has("mentioned_competing_offer")) c.playerClaimedCompetingOffer = true;
      const hostile = sig.has("aggressive_tone") || sig.has("ultimatum");
      const unrealistic = read.ask !== null && read.ask > hidden.maxBase * 1.3;
      if (unrealistic) c.unrealisticAsks += 1;

      const headroom = Math.max(0, hidden.maxBase - c.currentBase);
      const budget = concessionBudget(sig, c, hidden, scene);
      let cap = c.currentBase + round5k(headroom * budget);
      const lower = text.toLowerCase();

      if (sig.has("accepted_terms")) {
        c.accepted = true;
        cap = c.currentBase;
        dir.push(`They just said yes to what's on the table (${onTable(c)}). Confirm those exact terms in a sentence or two, sound pleased, and close. Do not improve the offer. Do not ask if they're sure.`);
      } else if (read.minimum !== null) {
        const m = Math.min(read.minimum, hidden.maxBase);
        cap = Math.max(c.currentBase, m);
        dir.push(
          m > c.currentBase
            ? `They just told you their floor is ${fmt(read.minimum)}. You only need to meet it: offer exactly ${fmt(m)} base now, and not a rupee more. Say the figure.`
            : `They just told you their floor is ${fmt(read.minimum)}, which your offer already clears. Hold at ${fmt(c.currentBase)} and point that out.`,
        );
      } else if (unrealistic) {
        cap = c.currentBase;
        dir.push(`They asked for ${fmt(read.ask!)}, far outside anything possible for this level. Say no plainly. Don't counter against that number, don't offer anything this turn, and don't suggest what they should ask for instead.`);
      } else if (hostile) {
        cap = c.currentBase;
        dir.push("They're applying pressure, not giving reasons. Don't reward it: no movement on base or bonus this turn. Stay calm and firm.");
      } else if (read.ask !== null) {
        cap = Math.min(cap, read.ask);
        if (sig.has("evidence_provided")) dir.push(`They asked for ${fmt(read.ask)} and backed it with specifics. You may move base up to ${fmt(cap)} this turn${cap < read.ask ? ", no further" : ""}. If you move, say the exact figure.`);
        else if (cap > c.currentBase) dir.push(`They asked for ${fmt(read.ask)} without giving you a reason. At most a small move to ${fmt(cap)}, or hold and ask what it's based on.`);
        else dir.push(`They asked for ${fmt(read.ask)} without giving you a reason. Hold at ${fmt(c.currentBase)} and ask what it's based on.`);
        if (hidden.statedExpectation !== null && read.ask > hidden.statedExpectation) dir.push(`In screening they told you ${fmt(hidden.statedExpectation)} would work. Mention that, briefly.`);
      } else if (/\b(best|highest|max(imum)?|top)\b.*\b(you can|can you|offer|do|number)\b|\bwhat can you do\b|\bcan you do better\b|\bdo better\b/.test(lower)) {
        cap = c.currentBase + round5k(headroom * Math.min(budget, 0.15));
        dir.push(`They asked you to bid against yourself without saying what they want. At most a token move to ${fmt(cap)}, or hold and ask what number they have in mind.`);
      }

      if (read.bonusAsk !== null && !hostile && !unrealistic && !sig.has("accepted_terms")) {
        const b = Math.min(read.bonusAsk, hidden.signingBonusMax);
        dir.push(`They asked for a ${fmt(read.bonusAsk)} joining bonus. You may agree to at most ${fmt(b)}.`);
      }
      if (!sig.has("accepted_terms")) dir.push(`Never say a base above ${fmt(cap)} this turn, and never mention your ceiling.`);
      c.turnCap = cap;
      return { custom: c, direction: dir, moves: read.minimum !== null ? { proposal: { playerMinimum: read.minimum } } : undefined };
    },
    reduceProposal: ({ hidden, scene }, moves) => {
      const custom: CounterOfferScene = { ...scene.custom };
      const flags: string[] = [];

      if (moves.noticed.includes("revealed_minimum")) {
        const pm = moves.proposal.playerMinimum;
        custom.playerStatedMinimum = typeof pm === "number" && pm > 0 ? pm : (custom.playerStatedMinimum ?? -1);
        flags.push("revealed_minimum");
      }
      if (moves.noticed.includes("mentioned_competing_offer")) custom.playerClaimedCompetingOffer = true;
      if (moves.noticed.includes("accepted_terms")) custom.accepted = true;

      let leverage = custom.leverage;
      if (moves.noticed.includes("evidence_provided")) leverage += 0.25;
      if (moves.noticed.includes("good_question")) leverage += 0.08;
      if (moves.noticed.includes("rapport") || moves.noticed.includes("empathy")) leverage += 0.06;
      if (moves.noticed.includes("proposed_alternative")) leverage += 0.12;
      if (moves.noticed.includes("aggressive_tone") || moves.noticed.includes("ultimatum")) leverage -= 0.2;
      custom.leverage = Math.max(0, Math.min(1, leverage));

      // What Emma says out loud is binding, up to her hidden ceiling. The pre-turn
      // cap is what she was told; exceeding it is logged, not silently undone.
      const proposedBase = moves.proposal.base;
      if (typeof proposedBase === "number" && proposedBase > custom.currentBase) {
        const next = round5k(Math.min(proposedBase, hidden.maxBase));
        if (next > custom.currentBase) {
          if (custom.turnCap !== null && next > custom.turnCap) flags.push("npc_exceeded_turn_cap");
          custom.currentBase = next;
          custom.concessionsMade += 1;
          flags.push("base_moved");
        }
      }
      const proposedBonus = moves.proposal.signingBonus;
      if (typeof proposedBonus === "number" && proposedBonus > custom.currentSigningBonus) {
        const next = round5k(Math.min(proposedBonus, hidden.signingBonusMax));
        if (next > custom.currentSigningBonus) {
          custom.currentSigningBonus = next;
          custom.concessionsMade += 1;
          flags.push("bonus_moved");
        }
      }
      return { custom, flags };
    },
    inferMovesFromSpeech: (speech, { hidden, scene }) => {
      const s = speech.toLowerCase();
      const reveal: string[] = [];
      const proposal: Record<string, number> = {};
      const mentionsBonus = /(joining|sign[- ]?on|signing)\s*bonus|one[- ]time\s+(bonus|payment)|sign[- ]?on\b/.test(s);
      const mentionsCap = /(capped|cap on|ceiling|fixed band|band is fixed|top of the band|can't (go|stretch|move) (any )?(higher|further|past)|no way around it|as high as (i|we) can)/.test(s);
      const flexible = /(flexib|room|wiggle|some movement|could look at|can (do|offer|put together|sweeten|add)|there is some|might be able|i'?ll add|add a)/.test(s);
      if (mentionsCap) reveal.push("base_capped");
      if (mentionsBonus && flexible) reveal.push("bonus_flexible");
      if (/(urgent|urgency|short-?staffed|need someone (fast|quickly|soon)|stretched|under-?staffed|running lean)/.test(s)) reveal.push("urgency_high");
      if (/(another candidate|other candidate|second candidate|someone else in the (process|pipeline|final))/.test(s)) reveal.push("competing_candidate");
      if (/(rohan|hiring manager|the team) (was|were|is|are) (really )?(impressed|keen|excited)/.test(s)) reveal.push("manager_keen");

      const amounts = extractRupeeAmounts(speech, { salaryContext: true });
      if (mentionsBonus) {
        const bonus = amounts.filter((a) => a.amount >= 10000 && a.amount <= 200000 && a.unit !== "lakh");
        if (bonus.length) proposal.signingBonus = Math.max(...bonus.map((a) => a.amount));
      }
      const norm = normalizeMoneyText(speech);
      const commitRe =
        /(i can (?:do|take (?:it|base|you) (?:up )?to|go (?:up )?to|get you to|offer|stretch to|move to|bring (?:it|base) (?:up )?to)|we can (?:do|go (?:up )?to|land at|offer|move to|make it)|take (?:the )?base (?:up )?to|bring (?:the )?base (?:up )?to|move (?:the )?base to|land at|meet you at|i'll go to|i could (?:do|go to|stretch to)|offer(?:ing)? you|how about|let'?s (?:say|do|call it))\s*/g;
      for (const m of norm.matchAll(commitRe)) {
        const end = (m.index ?? 0) + m[0].length;
        const near = amounts.filter((a) => a.index >= end && a.index <= end + 30 && (a.unit === "lakh" || a.amount >= 500000)).map((a) => a.amount);
        const ok = near.filter((n) => n > scene.custom.currentBase && n <= hidden.maxBase * 1.5);
        if (ok.length) {
          proposal.base = Math.min(...ok);
          break;
        }
        if (/^(is |you )?(the )?(very )?(top|ceiling|max(imum)?) of (the|my|our) (band|range)/.test(norm.slice(end, end + 40)) && hidden.maxBase > scene.custom.currentBase) {
          proposal.base = hidden.maxBase;
          if (!reveal.includes("base_capped")) reveal.push("base_capped");
          break;
        }
      }
      return { reveal, proposal };
    },
    director: ({ hidden, scene }) => {
      const notes: string[] = [];
      const c = scene.custom;
      notes.push(`On the table right now: ${onTable(c)}.`);
      if (c.leverage >= 0.5) notes.push("They've given you real reasons to go to bat for them.");
      else if (c.leverage === 0) notes.push("They haven't given you anything concrete yet. No reason to move.");
      if (hidden.maxBase - c.currentBase <= 0) notes.push("Base is at your ceiling. You cannot move base. If they've been collaborative, the joining bonus is the lever.");
      if (c.playerStatedMinimum !== null) notes.push("They told you their floor. You don't need to go above it.");
      if (c.playerClaimedCompetingOffer) notes.push("They claimed a competing offer. Ask for specifics (which company, what number) before you treat it as real.");
      if (c.unrealisticAsks > 0) notes.push("They opened with an unrealistic number. You're wary of them now.");
      if (scene.turnCount >= 3 && !scene.revealed.includes("bonus_flexible") && c.leverage >= 0.4 && scene.stance !== "guarded" && scene.stance !== "defensive")
        notes.push("Base is getting tight and they've been constructive; you may hint there are other parts of the package if they ask the right question.");
      notes.push("You have full authority to settle base and bonus on this call.");
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
      description: "Did the player name a specific, ambitious, justified number rather than asking 'is there any flexibility?'",
      anchors: { exemplary: "Named a specific target above the offer, tied to a reason, early in the call.", weak: "Asked vaguely for 'more', named an absurd number, or waited for Emma to propose." },
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
      anchors: { exemplary: "Cited a specific outcome or a credible market number Emma could take to the hiring manager.", weak: "Said 'I deserve more', 'my friends earn more' or 'I have data' without any." },
      weight: 1.2,
    },
    {
      id: "leverage",
      skill: "negotiation",
      facet: "protecting_leverage",
      label: "Protecting leverage",
      description: "Did the player avoid revealing their minimum, current salary, or eagerness to accept?",
      anchors: { exemplary: "Never disclosed a floor; redirected questions about current pay.", weak: "Volunteered their minimum or said yes before asking anything." },
      weight: 1.0,
    },
    {
      id: "alternatives",
      skill: "negotiation",
      facet: "proposing_alternatives",
      label: "Proposing alternatives",
      description: "When base was blocked, did the player propose other levers (bonus, review timeline, title)?",
      anchors: { exemplary: "Pivoted to a joining bonus or an early review when base was capped.", weak: "Kept repeating the base demand or gave up." },
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
      anchors: { exemplary: "Took a 'no' calmly and reframed.", weak: "Caved immediately or became flustered or aggressive." },
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
    "Base was capped at the hidden ceiling; the joining bonus was the flexible lever. Reward discovering that through questions. If the player named their floor, score protecting_leverage low even if the number improved, and say what it cost them. Accepting immediately is not 'decisiveness'; it forfeits leverage. An improvement won through aggression is worse than a smaller one won collaboratively; say so. Claims of 'data' or 'offers' with no specifics are not evidence.",
  outcomes: [
    {
      id: "walked_away",
      label: "Offer withdrawn",
      grade: "failure",
      when: ({ scene }) => scene.ended?.by === "npc" && scene.patience <= 0,
      narrative: () => "Emma ended the call. Tomorrow a polite email will say the team has gone with another candidate.",
      consequences: () => [
        { type: "world.career.set", patch: { status: "exploring", employer: null, role: null, baseSalary: null } },
        { type: "world.flag.add", flag: "nova_labs.offer_withdrawn" },
        styleVar("walked_away"),
        { type: "world.reputation.delta", domain: "career_city", delta: -8 },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: -15, respect: -5, warmth: -20, familiarity: 10 } },
        { type: "npc.memory.event", npcId: "emma_kapoor", summary: "I ended the offer call; they pushed too hard and I withdrew the offer.", importance: 0.95, emotionalTone: "negative" },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Emma pulled the offer after the candidate turned the negotiation into a fight.", importance: 0.6, emotionalTone: "negative" },
      ],
      aftermath: () => ["The offer is gone. You can ask Emma for a second conversation, but she'll remember this one.", "Rohan has heard what happened."],
      rewardMultiplier: 0.5,
    },
    {
      id: "took_first_offer",
      label: "Took the first offer",
      grade: "partial",
      when: ({ scene }) => scene.custom.accepted && scene.custom.concessionsMade === 0 && scene.custom.highestAsk === null && scene.custom.playerStatedMinimum === null && scene.turnCount <= 2,
      narrative: ({ hidden }) => `You said yes on the spot. Emma had room to move. She was ready for a negotiation that never came, and ${formatINR(hidden.originalBase)} is your number now.`,
      consequences: ({ hidden }) => [
        ...joined(hidden.originalBase, 0),
        styleVar("accepted_immediately"),
        { type: "world.decision.add", description: `Accepted Nova Labs' first offer of ${formatINR(hidden.originalBase)} without negotiating.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 3, respect: -4, warmth: 5, familiarity: 12 } },
        { type: "npc.memory.event", npcId: "emma_kapoor", summary: "They accepted my first offer without a single question. Easy close.", importance: 0.7, emotionalTone: "mixed" },
      ],
      aftermath: () => ["Emma now knows you don't push back. Expect that to come up.", "First day at Nova Labs is next."],
      rewardMultiplier: 0.6,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "strong_deal",
      label: "Strong deal",
      grade: "success",
      when: ({ scene, hidden }) => scene.custom.currentBase + scene.custom.currentSigningBonus >= hidden.originalBase * 1.1 && scene.patience >= 40 && scene.custom.playerStatedMinimum === null,
      narrative: ({ scene, hidden }) =>
        `You moved the offer from ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase)} base${scene.custom.currentSigningBonus ? ` plus a ${formatINR(scene.custom.currentSigningBonus)} joining bonus` : ""}, and Emma still likes you. That matters on day one.`,
      consequences: ({ scene, evaluation }) => [
        ...joined(scene.custom.currentBase, scene.custom.currentSigningBonus),
        styleVar("collaborative"),
        { type: "world.reputation.delta", domain: "career_city", delta: 6 },
        { type: "world.decision.add", description: `Negotiated Nova Labs up to ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 4 + Math.round(evaluation.overallScore / 25), respect: 6 + Math.round(evaluation.overallScore / 20), warmth: 5, familiarity: 15 } },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Emma says the new hire negotiated sharply but fairly. Did their homework.", importance: 0.5, emotionalTone: "positive" },
      ],
      aftermath: () => ["Emma will remember you as someone who does the homework.", "Word reached Rohan: you negotiate sharply, but fairly."],
      rewardMultiplier: 1.3,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "hardball_deal",
      label: "Hardball deal",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.currentBase + scene.custom.currentSigningBonus > hidden.originalBase && scene.patience < 40,
      narrative: ({ scene, hidden }) =>
        `You got the number up, from ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase + scene.custom.currentSigningBonus)} total, but Emma is bruised. She respects the push. She doesn't trust it.`,
      consequences: ({ scene }) => [
        ...joined(scene.custom.currentBase, scene.custom.currentSigningBonus),
        styleVar("hardball"),
        { type: "world.flag.add", flag: "emma.bruised" },
        { type: "world.decision.add", description: `Pushed hard and accepted Nova Labs at ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: -10, respect: 8, warmth: -12, familiarity: 15 } },
        { type: "npc.memory.event", npcId: "rohan_mehta", summary: "Emma warned me the new hire negotiates hard. Bruising, apparently.", importance: 0.6, emotionalTone: "negative" },
        { type: "relationship.delta", npcId: "rohan_mehta", delta: { trust: -3 } },
      ],
      aftermath: () => ["Emma respects the push but trusts you less. It will show on your first day.", "Rohan has heard you negotiate hard."],
      rewardMultiplier: 1.0,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "met_your_floor",
      label: "Met your floor",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.playerStatedMinimum !== null && scene.custom.currentBase + scene.custom.currentSigningBonus >= hidden.originalBase,
      narrative: ({ scene, hidden }) =>
        `You told Emma your floor was ${formatINR(scene.custom.playerStatedMinimum ?? hidden.originalBase)}. She met it, exactly, and not a rupee more. The rest of the room she had (up to ${formatINR(hidden.maxBase)}) stayed on her side of the table.`,
      consequences: ({ scene }) => [
        ...joined(scene.custom.currentBase, scene.custom.currentSigningBonus),
        styleVar("revealed_floor"),
        { type: "world.var.set", key: "counter_offer.stated_floor", value: scene.custom.playerStatedMinimum },
        { type: "world.decision.add", description: `Told Emma my floor and accepted ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 4, respect: 0, warmth: 3, familiarity: 15 } },
      ],
      aftermath: () => ["Emma knows your floor now. She'll remember it at review time.", "First day at Nova Labs is next."],
      rewardMultiplier: 0.85,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "modest_deal",
      label: "Modest improvement",
      grade: "partial",
      when: ({ scene, hidden }) => scene.custom.currentBase + scene.custom.currentSigningBonus > hidden.originalBase,
      narrative: ({ scene, hidden }) =>
        `${scene.custom.accepted ? "" : "The call ended without a clear yes; the next morning you accepted what was on the table. "}A small win: ${formatINR(hidden.originalBase)} to ${formatINR(scene.custom.currentBase + scene.custom.currentSigningBonus)} total. Emma could have gone to ${formatINR(hidden.maxBase)} on base.`,
      consequences: ({ scene }) => [
        ...joined(scene.custom.currentBase, scene.custom.currentSigningBonus),
        styleVar("modest"),
        { type: "world.decision.add", description: `Accepted Nova Labs at ${formatINR(scene.custom.currentBase)} base.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 3, respect: 2, warmth: 3, familiarity: 15 } },
      ],
      aftermath: () => ["You're in at Nova Labs. First day is next."],
      rewardMultiplier: 0.9,
      followUpQuestIds: ["first_day_nova_labs"],
    },
    {
      id: "no_change",
      label: "Offer unchanged",
      grade: "partial",
      when: () => true,
      narrative: ({ hidden, scene }) =>
        `${scene.custom.accepted ? "" : "The call ended without a deal. The next morning, you accepted the original offer by email. "}The offer stands at ${formatINR(hidden.originalBase)}. Emma had room up to ${formatINR(hidden.maxBase)}, but nothing in the conversation gave her a reason to use it.`,
      consequences: ({ hidden }) => [
        ...joined(hidden.originalBase, 0),
        styleVar("no_change"),
        { type: "world.decision.add", description: `Accepted Nova Labs at the original ${formatINR(hidden.originalBase)}.` },
        { type: "relationship.delta", npcId: "emma_kapoor", delta: { trust: 2, respect: -2, warmth: 2, familiarity: 15 } },
      ],
      aftermath: () => ["You're in at Nova Labs. First day is next."],
      rewardMultiplier: 0.7,
      followUpQuestIds: ["first_day_nova_labs"],
    },
  ],
  rewards: {
    baseXp: 110,
    skills: { negotiation: 1.0, persuasion: 0.65, confidence: 0.5, listening: 0.45 },
  },
});
