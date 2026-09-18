/**
 * Skill & competency model.
 *
 * Two layers:
 *  - Visible "game skills" (Negotiation LVL 8, etc.) driven by XP.
 *  - Underlying competency estimates per *facet* (e.g. negotiation.anchoring),
 *    updated from evaluator observations. Facets are the rich model that lets
 *    the system say "communicates clearly but gives away leverage too early".
 *
 * XP is *derived* from demonstrated facet behaviour, so it is never meaningless.
 */
import { z } from "zod";

export const SKILL_IDS = [
  "communication",
  "confidence",
  "listening",
  "negotiation",
  "persuasion",
  "conflict_resolution",
  "storytelling",
  "leadership",
] as const;

export const SkillIdSchema = z.enum(SKILL_IDS);
export type SkillId = z.infer<typeof SkillIdSchema>;

export interface FacetDefinition {
  id: string; // e.g. "anchoring"
  label: string; // "Anchoring"
  description: string; // what the evaluator should look for
}

export interface SkillDefinition {
  id: SkillId;
  label: string;
  tagline: string;
  facets: FacetDefinition[];
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  communication: {
    id: "communication",
    label: "Communication",
    tagline: "Say the thing clearly, once.",
    facets: [
      { id: "clarity", label: "Clarity", description: "Expresses ideas in plain, unambiguous language." },
      { id: "concision", label: "Concision", description: "Gets to the point without padding or rambling." },
      { id: "structure", label: "Structure", description: "Orders points logically; signposts what comes next." },
      { id: "relevance", label: "Relevance", description: "Stays on the actual problem instead of drifting." },
      { id: "tone", label: "Tone", description: "Matches register to the situation and counterpart." },
    ],
  },
  confidence: {
    id: "confidence",
    label: "Confidence",
    tagline: "Hold your ground without bluster.",
    facets: [
      { id: "assertiveness", label: "Assertiveness", description: "States positions and needs directly." },
      { id: "composure", label: "Composure", description: "Stays steady under pressure or pushback." },
      { id: "decisiveness", label: "Decisiveness", description: "Commits to a position rather than hedging endlessly." },
      { id: "ownership", label: "Ownership", description: "Owns mistakes and claims without deflecting." },
    ],
  },
  listening: {
    id: "listening",
    label: "Listening",
    tagline: "Hear what they actually said.",
    facets: [
      { id: "questioning", label: "Questioning", description: "Asks open questions that surface useful information." },
      { id: "acknowledgement", label: "Acknowledgement", description: "Reflects and acknowledges what the other person said." },
      { id: "reading_signals", label: "Reading signals", description: "Notices hesitation, hints, and changes in the other person." },
      { id: "building_on", label: "Building on", description: "Uses what was said to shape the next move." },
    ],
  },
  negotiation: {
    id: "negotiation",
    label: "Negotiation",
    tagline: "Trade what you value less for what you value more.",
    facets: [
      { id: "anchoring", label: "Anchoring", description: "Sets an ambitious, justified first number or frame." },
      { id: "discovery", label: "Discovery", description: "Uncovers the counterpart's constraints, priorities and flexibility." },
      { id: "handling_resistance", label: "Handling resistance", description: "Responds to a refusal without collapsing or escalating." },
      { id: "proposing_alternatives", label: "Proposing alternatives", description: "Offers creative options or trades when blocked." },
      { id: "protecting_leverage", label: "Protecting leverage", description: "Avoids revealing minimums or giving concessions for free." },
      { id: "understanding_priorities", label: "Understanding priorities", description: "Identifies what the counterpart cares about most." },
      { id: "recognizing_tradeoffs", label: "Recognizing trade-offs", description: "Sees which items are cheap for them and valuable for you." },
      { id: "maintaining_rapport", label: "Maintaining rapport", description: "Keeps the relationship intact while pushing." },
    ],
  },
  persuasion: {
    id: "persuasion",
    label: "Persuasion",
    tagline: "Make the case they can say yes to.",
    facets: [
      { id: "evidence", label: "Evidence", description: "Backs claims with specific, credible evidence." },
      { id: "framing", label: "Framing", description: "Frames requests in terms of the other person's interests." },
      { id: "addressing_objections", label: "Addressing objections", description: "Anticipates and answers concerns directly." },
      { id: "credibility", label: "Credibility", description: "Avoids exaggeration; claims survive scrutiny." },
    ],
  },
  conflict_resolution: {
    id: "conflict_resolution",
    label: "Conflict Resolution",
    tagline: "Disagree without damage.",
    facets: [
      { id: "de_escalation", label: "De-escalation", description: "Lowers the temperature when things get tense." },
      { id: "empathy", label: "Empathy", description: "Shows understanding of the other side's position." },
      { id: "respectful_disagreement", label: "Respectful disagreement", description: "Disagrees clearly without hostility." },
      { id: "recovery", label: "Recovery", description: "Repairs after a misstep instead of digging in." },
    ],
  },
  storytelling: {
    id: "storytelling",
    label: "Storytelling",
    tagline: "Make them see it.",
    facets: [
      { id: "narrative", label: "Narrative", description: "Uses concrete situations with a beginning, tension and resolution." },
      { id: "specificity", label: "Specificity", description: "Uses vivid, specific detail rather than abstractions." },
      { id: "relevance_to_point", label: "Relevance to point", description: "Stories land the intended point." },
    ],
  },
  leadership: {
    id: "leadership",
    label: "Leadership",
    tagline: "Move people toward a decision.",
    facets: [
      { id: "direction", label: "Direction", description: "Sets a clear direction or decision." },
      { id: "accountability", label: "Accountability", description: "Takes responsibility for outcomes." },
      { id: "delegation", label: "Delegation", description: "Involves others appropriately." },
      { id: "motivation", label: "Motivation", description: "Energises rather than commands." },
    ],
  },
};

export function getFacet(skillId: SkillId, facetId: string): FacetDefinition | undefined {
  return SKILLS[skillId]?.facets.find((f) => f.id === facetId);
}

export function isValidFacet(skillId: string, facetId: string): skillId is SkillId {
  return SkillIdSchema.safeParse(skillId).success && !!getFacet(skillId as SkillId, facetId);
}

/** An estimate of a single facet, 0-100, with confidence 0-1. */
export const FacetEstimateSchema = z.object({
  estimate: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  samples: z.number().int().min(0),
  lastObservedAt: z.string().nullable(),
});
export type FacetEstimate = z.infer<typeof FacetEstimateSchema>;

/** Per-skill player state. */
export const PlayerSkillSchema = z.object({
  skillId: SkillIdSchema,
  xp: z.number().int().min(0),
  level: z.number().int().min(1),
  facets: z.record(z.string(), FacetEstimateSchema),
  /** Facet ids the player has demonstrated at least once at a strong level ("Skill discovered: ANCHORING"). */
  discovered: z.array(z.string()),
});
export type PlayerSkill = z.infer<typeof PlayerSkillSchema>;

export type CompetencyProfile = Record<SkillId, PlayerSkill>;

/** An observation from the evaluator that feeds competency updates. */
export const FacetObservationSchema = z.object({
  skill: SkillIdSchema,
  facet: z.string(),
  /** 0..1 quality of demonstration. 0 = clear failure, 0.5 = neutral/absent, 1 = exemplary. */
  score: z.number().min(0).max(1),
  evidence: z.string().max(600),
  note: z.string().max(400).optional(),
});
export type FacetObservation = z.infer<typeof FacetObservationSchema>;
