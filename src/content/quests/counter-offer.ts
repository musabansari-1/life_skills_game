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
import { extractRupeeAmounts, formatAmountLike, normalizeMoneyText, type RupeeAmount } from "@/engine/parsing/numbers";
import { correctedPortion } from "@/engine/parsing/player";
import { difficultyProfile } from "@/engine/scene/difficulty";
import type { SceneContext, SpeechCheck } from "@/engine/types/quest";

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
function concessionBudget(signals: Set<PlayerSignal>, c: CounterOfferScene, hidden: CounterOfferHidden, scene: SceneState, difficulty?: number): number {
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
  // Difficulty as behaviour: a hard Emma unlocks less per good turn, an easy one more.
  budget *= difficultyProfile(difficulty).concessionScale;
  return Math.max(0, Math.min(1, budget));
}

/**
 * What Emma's words commit her to. ONE reader shared by the speech gate (before
 * she speaks) and speech inference (after), so the two can never disagree:
 * anything the recorder would treat as a move is exactly what the gate checks.
 */
interface OfferSpeechRead {
  reveal: string[];
  /** A base figure her words commit to, with the matched text for in-place rewriting. */
  base: RupeeAmount | null;
  /** A joining-bonus figure her words commit to. */
  bonus: RupeeAmount | null;
  /** Every salary-scale figure she named, committed or not. */
  salaryFigures: RupeeAmount[];
}

/** An offer verb immediately before a figure ("I can do", "let's say", "I'll put you at"). */
const COMMIT_BEFORE_RE =
  /(i can (?:do|take (?:it|base|you) (?:up )?to|go (?:up )?to|get you to|offer|stretch to|move to|bring (?:it|base) (?:up )?to|make (?:it|that))|we can (?:do|go (?:up )?to|land at|offer|move to|make (?:it|that))|(?:take|bring|move) (?:the )?base (?:up )?to|land at|meet you at|i'll go to|i could (?:do|go to|stretch to)|offer(?:ing)? you|how about|let'?s (?:say|do|call it)|you'?ve got|i'?ll (?:put|get) (?:it|that|you) (?:at|to)|(?:call|make) it|updated? (?:it |the offer )?to|revised? (?:it |the offer )?to|lock(?:ing)? in)\s*$/;
const NEGATED_RE = /\b(can'?t|cannot|won'?t|not|no way|isn'?t|never|unable|couldn'?t|wouldn'?t|don'?t|doesn'?t)\b/;
/** Framing that talks ABOUT a figure without offering it ("ten is above where I can go", "a big jump"). */
const NOT_AN_OFFER_RE = /\b(above|beyond|past|more than|higher than|over what|too (high|much|far)|(a )?(big|healthy|huge|real|large) (jump|step|stretch)|step up|out of (reach|range)|off the table|feels high|is high|a lot)\b/;
/** The figure belongs to the player ("you asked for ten", "your number", "what you told me"). */
const ATTRIBUTED_RE = /\b(you|you'?re|you'?ve|your)\b.{0,30}\b(asked|ask|asking|said|say|mentioned|want|wanted|told|hoping|looking for|had in mind|named|number|figure|expect|expected)\b|\basked for\b|\byour (ask|number|figure|floor|minimum)\b/;
const FIGURE_WORKS_RE = /\b(works|is fine|is doable|we can do that|i can make that (happen|work)|is where (?:i|we) can land|(?:i|we) can land (?:there|on that)|done|agreed|you'?ve got it|it is|it'?s a deal|you have it|sounds good|let'?s go with|deal)\b/;

/** Salary figures a sentence states as fact, not negated, questioned or attributed to the player. */
function confirmedFigures(sentence: string): RupeeAmount[] {
  const withCommas = sentence.toLowerCase().replace(/₹/g, " rs ");
  return extractRupeeAmounts(sentence, { salaryContext: true })
    .filter((a) => a.raw && (a.unit === "lakh" || a.amount >= 500000))
    .filter((a) => {
      const { clause, question } = clauseAt(withCommas, toCommaIndex(withCommas, a.index));
      return !question && !ATTRIBUTED_RE.test(clause) && !NEGATED_RE.test(clause) && !NOT_AN_OFFER_RE.test(clause);
    });
}

/** Map an index in comma-free normalised text back to the same character in text that still has its commas. */
function toCommaIndex(withCommas: string, normIndex: number): number {
  let seen = 0;
  for (let i = 0; i < withCommas.length; i++) {
    if (withCommas[i] === ",") continue;
    if (seen === normIndex) return i;
    seen++;
  }
  return withCommas.length;
}

/** The clause around a character index, and whether its sentence is a question. */
function clauseAt(text: string, index: number): { clause: string; question: boolean } {
  const SEP = /[,;:—–!?.]|\s-\s|\b(?:but|though|however|although)\b/g;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SEP)) {
    const i = m.index ?? 0;
    if (i + m[0].length <= index) start = i + m[0].length;
    else if (i > index) {
      // A decimal point inside a figure ("9.2") is not a boundary.
      if (m[0] === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
      end = i;
      break;
    }
  }
  const terminal = text.slice(index).match(/[.!?]/);
  return { clause: text.slice(start, end), question: terminal?.[0] === "?" };
}

function readOfferSpeech(speech: string, { hidden, scene }: SceneContext<CounterOfferHidden, CounterOfferScene>): OfferSpeechRead {
  const s = speech.toLowerCase();
  const reveal: string[] = [];
  const mentionsBonus = /(joining|sign[- ]?on|signing)\s*bonus|one[- ]time\s+(bonus|payment)|sign[- ]?on\b/.test(s);
  const mentionsCap = /(capped|cap on|ceiling|fixed band|band is fixed|top of the band|can't (go|stretch|move) (any )?(higher|further|past)|no way around it|as high as (i|we) can)/.test(s);
  const flexible = /(flexib|room|wiggle|some movement|could look at|can (do|offer|put together|sweeten|add)|there is some|might be able|i'?ll add|add a)/.test(s);
  if (mentionsCap) reveal.push("base_capped");
  if (mentionsBonus && flexible) reveal.push("bonus_flexible");
  if (/(urgent|urgency|short-?staffed|need someone (fast|quickly|soon)|stretched|under-?staffed|running lean)/.test(s)) reveal.push("urgency_high");
  if (/(another candidate|other candidate|second candidate|someone else in the (process|pipeline|final))/.test(s)) reveal.push("competing_candidate");
  if (/(rohan|hiring manager|the team) (was|were|is|are) (really )?(impressed|keen|excited)/.test(s)) reveal.push("manager_keen");

  const amounts = extractRupeeAmounts(speech, { salaryContext: true });
  const salaryFigures = amounts.filter((a) => a.unit === "lakh" || a.amount >= 500000);
  let bonus: RupeeAmount | null = null;
  if (mentionsBonus) {
    const candidates = amounts.filter((a) => a.amount >= 10000 && a.amount <= 200000 && a.unit !== "lakh");
    if (candidates.length) bonus = candidates.reduce((m, a) => (a.amount > m.amount ? a : m));
  }

  const norm = normalizeMoneyText(speech);
  // Clause boundaries need the commas that normalizeMoneyText drops ("9,50,000" → "950000").
  const withCommas = speech.toLowerCase().replace(/₹/g, " rs ");
  let base: RupeeAmount | null = null;
  const { currentBase } = scene.custom;
  const near = (a: number, b: number | null | undefined) => typeof b === "number" && Math.abs(a - b) < 2500;
  const playerNamed = (a: number) => near(a, scene.custom.highestAsk) || near(a, scene.custom.playerStatedMinimum) || near(a, hidden.statedExpectation);
  // Every salary figure above what's on the table is classified in its own clause.
  // Emma's OWN numbers are offers by default: anything else would let her say a
  // figure the game never records. A number the PLAYER named needs explicit agreement.
  const committed: RupeeAmount[] = [];
  for (const a of salaryFigures) {
    if (a.amount <= currentBase || a.amount > hidden.maxBase * 1.5) continue;
    const { clause, question } = clauseAt(withCommas, toCommaIndex(withCommas, a.index));
    if (question || ATTRIBUTED_RE.test(clause) || NEGATED_RE.test(clause) || NOT_AN_OFFER_RE.test(clause)) continue;
    if (playerNamed(a.amount) && !(COMMIT_BEFORE_RE.test(norm.slice(Math.max(0, a.index - 40), a.index)) || FIGURE_WORKS_RE.test(clause))) continue;
    committed.push(a);
  }
  if (committed.length) base = committed.reduce((m, a) => (a.amount > m.amount ? a : m));
  // "I can take you to the top of the band": an offer at the ceiling without a number.
  if (!base && hidden.maxBase > currentBase && /\b(?:(take|bring|get|move) (you|it|base|the base) (up )?to|(i|we) can (offer|do)|offer(ing)? you) (is )?(the )?(very )?(top|ceiling|max(imum)?) of (the|my|our) (band|range)\b/.test(norm)) {
    base = { amount: hidden.maxBase, unit: "raw", index: 0, raw: "" };
    if (!reveal.includes("base_capped")) reveal.push("base_capped");
  }
  return { reveal, base, bonus, salaryFigures };
}

/** Replace one figure in the original (un-normalised) sentence with a same-style rendering of `amount`. */
function rewriteFigure(sentence: string, figure: RupeeAmount, amount: number): string {
  if (!figure.raw) return sentence;
  // Build a matcher tolerant of case, commas inside digit runs and a leading rupee sign.
  const pattern = figure.raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/(\d)(?=\d)/g, "$1,?")
    .replace(/\s+/g, "\\s+");
  const re = new RegExp(pattern, "i");
  if (!re.test(sentence)) return sentence;
  const out = sentence.replace(re, formatAmountLike(amount, figure.raw));
  // Keep sentence-initial capitalisation ("Nine point five…" → "Nine point two…").
  return /^[A-Z]/.test(sentence) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
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
  boss: {
    id: "counter_offer",
    stakes: "Your salary for years to come, and the first impression of the person who will vouch for you inside Nova Labs. Push too hard and the offer can disappear.",
    combinedSkills: ["negotiation", "persuasion", "listening", "confidence"],
    approaches: [
      "Anchor with a number and a reason: evidence she can take to the hiring manager.",
      "Ask what she can move before you argue about base. The flexible lever may not be the obvious one.",
    ],
    resistance: { opening: "Test whether they know what they want.", probing: "Hold the band; look for the lever that isn't base.", decision: "Close within your authority." },
  },
  pacing: { category: "boss", intensity: 4, emotionalPressure: 4, importance: 5, urgency: "normal" },
  transition: ({ world }) => world.failedQuests.some((q) => q.questId === "counter_offer") ? null : ({ when: "Two days after the interview", message: "The offer letter arrived at 9pm. Emma wants to 'talk it through'." }),
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
    preTurn: (ctx, playerRead, text) => {
      const { hidden, scene } = ctx;
      const c: CounterOfferScene = { ...scene.custom };
      let read = playerRead;
      const dir: string[] = [];
      const fmt = formatINR;
      // In a salary negotiation a bare "nine point five" means lakh: re-read with that
      // context, from the corrected part of the line only ("twelve... I mean nine point five").
      if (read.ask === null && read.minimum === null) {
        const salaryAmounts = extractRupeeAmounts(correctedPortion(text), { salaryContext: true }).filter((a) => a.unit === "lakh" || a.amount >= 300000);
        if (salaryAmounts.length) read = { ...read, ask: Math.max(...salaryAmounts.map((a) => a.amount)), signals: [...new Set([...read.signals, "clear_ask" as const])] };
      }
      // "Nine point two then, I accept": a yes that names a different, higher figure is a
      // counter-offer, not acceptance of what's on the table. The rules decide, not the model.
      const dropSignals: PlayerSignal[] = [];
      if (read.signals.includes("accepted_terms") && read.ask !== null && read.ask > c.currentBase) {
        read = { ...read, signals: read.signals.filter((s) => s !== "accepted_terms") };
        dropSignals.push("accepted_terms");
      }
      if (read.minimum !== null) c.playerStatedMinimum = read.minimum;
      if (read.ask !== null) c.highestAsk = Math.max(c.highestAsk ?? 0, read.ask);
      const sig = new Set(read.signals);
      if (sig.has("mentioned_competing_offer")) c.playerClaimedCompetingOffer = true;
      const hostile = sig.has("aggressive_tone") || sig.has("ultimatum");
      const unrealistic = read.ask !== null && read.ask > hidden.maxBase * 1.3;
      if (unrealistic) c.unrealisticAsks += 1;

      const headroom = Math.max(0, hidden.maxBase - c.currentBase);
      const budget = concessionBudget(sig, c, hidden, scene, ctx.difficulty);
      let cap = c.currentBase + round5k(headroom * budget);
      const lower = text.toLowerCase();

      if (sig.has("accepted_terms")) {
        c.accepted = true;
        cap = c.currentBase;
        dir.push(`They just said yes to what's on the table (${onTable(c)}). Confirm those exact terms in a sentence or two, sound pleased, and close. Do not improve the offer. Do not ask if they're sure.`);
        if (read.ask !== null && read.ask < c.currentBase)
          dir.push(`They said ${fmt(read.ask)}, but what's on the table is ${fmt(c.currentBase)} and that is what they're getting. Confirm ${fmt(c.currentBase)}, not their number.`);
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
      if (dropSignals.includes("accepted_terms"))
        dir.push(`They said yes, but to ${fmt(read.ask!)}, not to what's on the table. That's a counter, not a deal: answer the number (within the limit above). If you agree to it, say the figure; if not, say what you can do. Don't treat it as settled.`);
      return { custom: c, direction: dir, dropSignals, moves: read.minimum !== null ? { proposal: { playerMinimum: read.minimum } } : undefined };
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
    inferMovesFromSpeech: (speech, ctx) => {
      const read = readOfferSpeech(speech, ctx);
      const proposal: Record<string, number> = {};
      if (read.base) proposal.base = read.base.amount;
      if (read.bonus) proposal.signingBonus = read.bonus.amount;
      return { reveal: read.reveal, proposal };
    },
    /**
     * Before a sentence is spoken, using the SAME reader that records offers:
     * a base figure Emma commits to above this turn's cap is lowered to the cap;
     * a bonus above her maximum is lowered to the maximum; her hidden ceiling is
     * never said out loud above the cap, even in a refusal. Figures the player
     * named may be repeated freely ("you asked for ten"). Every violation in a
     * sentence is corrected, not just the first.
     */
    speechGate: (sentence, ctx): SpeechCheck => {
      const near = (a: number, b: number | null | undefined) => typeof b === "number" && Math.abs(a - b) < 2500;
      const { hidden, scene } = ctx;
      const c = scene.custom;
      const cap = Math.max(c.currentBase, Math.min(c.turnCap ?? c.currentBase, hidden.maxBase));
      const reasons: string[] = [];
      let text = sentence;
      for (let pass = 0; pass < 4; pass++) {
        const read = readOfferSpeech(text, ctx);
        let next = text;
        if (read.base && read.base.amount > cap) {
          reasons.push(`committed base ${read.base.amount} above turn cap ${cap}`);
          next = rewriteFigure(text, read.base, cap);
        } else if (read.bonus && read.bonus.amount > hidden.signingBonusMax) {
          reasons.push(`bonus ${read.bonus.amount} above max ${hidden.signingBonusMax}`);
          next = rewriteFigure(text, read.bonus, hidden.signingBonusMax);
        } else {
          const leak = read.salaryFigures.find((a) => a.raw && near(a.amount, hidden.maxBase) && hidden.maxBase > cap && !near(a.amount, c.highestAsk) && !near(a.amount, c.playerStatedMinimum));
          if (leak) {
            reasons.push(`hidden ceiling ${hidden.maxBase} spoken above turn cap ${cap}`);
            next = rewriteFigure(text, leak, cap);
          }
        }
        if (next === text) break;
        text = next;
      }
      // Once the player has accepted, the deal is what's on the table: a confirmation that
      // names any other base figure ("nine point two it is" with 9.7 agreed) is corrected.
      if (c.accepted) {
        for (let pass = 0; pass < 4; pass++) {
          const wrong = confirmedFigures(text).find((a) => !near(a.amount, c.currentBase));
          if (!wrong) break;
          reasons.push(`confirmed base ${wrong.amount} but the deal is ${c.currentBase}`);
          const next = rewriteFigure(text, wrong, c.currentBase);
          if (next === text) break;
          text = next;
        }
      }
      // The same for the joining bonus: accepting seals it. One that wasn't agreed can't be
      // added while confirming; a different amount is corrected to the agreed one.
      let bonusUnsafe = false;
      if (c.accepted) {
        const bonus = readOfferSpeech(text, ctx).bonus;
        if (bonus && !near(bonus.amount, c.currentSigningBonus)) {
          reasons.push(`confirmed bonus ${bonus.amount} but the deal has ${c.currentSigningBonus}`);
          if (c.currentSigningBonus > 0) text = rewriteFigure(text, bonus, c.currentSigningBonus);
          else bonusUnsafe = true;
        }
      }
      if (!reasons.length) return { ok: true };
      // If a figure couldn't be rewritten in place, drop the sentence rather than speak it.
      const still = readOfferSpeech(text, ctx);
      const unsafe = bonusUnsafe || (still.base && still.base.amount > cap) || (still.bonus && still.bonus.amount > hidden.signingBonusMax);
      return { ok: false, reason: reasons.join("; "), rewrite: unsafe ? null : text };
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
