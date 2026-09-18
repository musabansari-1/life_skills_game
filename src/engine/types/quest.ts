/**
 * Quest definition model.
 *
 * Quests are *content*: typed TypeScript objects registered in `src/content/quests`.
 * They are not hardcoded pages. The engine runs any quest through the same
 * loop: prerequisites → briefing → scene (NPC turns + reducer) → evaluation →
 * outcome branch → rewards + consequences → follow-ups.
 *
 * Predicates and reducers are plain TS functions rather than a JSON DSL. This
 * keeps them typed and unit-testable; content authors are expected to be
 * engineers (or coding models). See docs/ADDING-A-QUEST.md.
 */
import { z } from "zod";
import type { Consequence } from "./consequences";
import type { Evaluation, RubricCriterion } from "./evaluation";
import type { NPCInstanceState, NPCMemory, Relationship } from "./npc";
import type { NPCMoves, SceneState } from "./scene";
import type { SkillId } from "./skills";
import type { WorldState } from "./world";
import type { CompetencyProfile } from "./skills";
import type { PlayerRead } from "../parsing/player";

// ---------- Prerequisites ----------

export type QuestPrerequisite =
  | { type: "quest_completed"; questId: string; outcomeIds?: string[] }
  | { type: "quest_not_completed"; questId: string }
  | { type: "world_flag"; flag: string; present?: boolean }
  | { type: "world_unlocked_quest"; questId: string }
  | { type: "career_status"; status: WorldState["career"]["status"] }
  | { type: "skill_level"; skill: SkillId; min: number }
  | { type: "relationship"; npcId: string; dimension: keyof Relationship; min: number }
  | { type: "custom"; label: string; check: (ctx: PrerequisiteContext) => boolean };

export interface PrerequisiteContext {
  world: WorldState;
  competencies: CompetencyProfile;
  npcs: Record<string, NPCInstanceState | undefined>;
}

// ---------- Objectives ----------

export interface QuestObjective {
  id: string;
  label: string;
  /** "primary" is shown in briefing; "hidden" is revealed in results; "optional" is a bonus. */
  kind: "primary" | "hidden" | "optional";
  /** Evaluator instructions for judging whether it was achieved. */
  description: string;
  /**
   * Optional deterministic check against final scene state. If provided it
   * overrides the evaluator's judgement (scene state is ground truth).
   */
  check?: (scene: SceneState, hidden: Record<string, unknown>) => boolean;
}

// ---------- Scene ----------

export interface SceneContext<H, S> {
  hidden: H;
  scene: SceneState & { custom: S };
  world: WorldState;
  npc: NPCInstanceState;
  playerName: string;
}

export interface QuestScene<H, S> {
  /** Instantiate hidden NPC state for this attempt. May vary by world state / relationship. */
  createHidden: (ctx: { world: WorldState; npc: NPCInstanceState }) => H;
  /** Initial quest-specific scene state, derived from hidden state. */
  createCustom: (hidden: H) => S;
  /** Initial patience (0-100). Lower = tougher. */
  initialPatience?: (ctx: { hidden: H; npc: NPCInstanceState }) => number;
  /** The scene's opening: either a scripted line or a prompt hint for a generated opener. */
  opening: { scripted?: (ctx: SceneContext<H, S>) => string; generatedHint?: string };
  /** Situation as the NPC understands it (goes into the NPC prompt). */
  npcSituation: (ctx: SceneContext<H, S>) => string;
  /** Explains hidden state to the NPC model in prose, with how to treat each item. */
  hiddenBriefing: (ctx: SceneContext<H, S>) => string;
  /** Keys that the NPC may reveal, with a description of when. Used for validation of `reveal`. */
  revealableKeys: Record<string, string>;
  /** Names of proposal keys and how they should be interpreted. */
  proposalKeys?: Record<string, string>;
  /**
   * Quest-specific reducer for proposals. Runs *after* the generic reducer has
   * applied signals/patience. Must be pure. Returns new custom state and any
   * scene flags to add.
   */
  reduceProposal?: (ctx: SceneContext<H, S>, moves: NPCMoves) => { custom: S; flags?: string[] };
  /**
   * Deterministic safety net: infer reveals/proposals from what the NPC
   * actually *said* (e.g. "I can do fifty thousand as a joining bonus"). Merged
   * with the model's reported moves so a weak model that narrates a concession
   * without reporting it still changes the scene. Must be pure and conservative.
   */
  inferMovesFromSpeech?: (speech: string, ctx: SceneContext<H, S>) => Partial<NPCMoves>;
  /**
   * Runs BEFORE the NPC replies, with a deterministic read of the player's line.
   * Lets the quest decide what the NPC may do this turn (e.g. how far an offer
   * can move) and tell the NPC in `direction`, so what the NPC *says* and what
   * the rules *allow* agree. Must be pure. `moves` are merged into the NPC's own.
   */
  preTurn?: (ctx: SceneContext<H, S>, read: PlayerRead, playerText: string) => { custom?: S; moves?: Partial<NPCMoves>; direction?: string[] };
  /** Turns the numbers into behavioural direction for the NPC model, each turn. */
  director: (ctx: SceneContext<H, S>) => string[];
  /** Visible-to-player scene summary, e.g. "Offer on the table: ₹8.5L". */
  visibleStatus?: (ctx: SceneContext<H, S>) => { label: string; value: string }[];
  minTurns: number;
  maxTurns: number;
}

// ---------- Outcomes ----------

export interface OutcomeContext<H, S> extends SceneContext<H, S> {
  evaluation: Evaluation;
  objectivesAchieved: Set<string>;
}

export interface OutcomeBranch<H, S> {
  id: string;
  label: string;
  /** "success" | "partial" | "failure" drives result-screen framing and analytics. */
  grade: "success" | "partial" | "failure";
  when: (ctx: OutcomeContext<H, S>) => boolean;
  /** Result-screen narrative. */
  narrative: (ctx: OutcomeContext<H, S>) => string;
  consequences: (ctx: OutcomeContext<H, S>) => Consequence[];
  /** XP multiplier applied to computed rewards. */
  rewardMultiplier: number;
  followUpQuestIds?: string[];
  /** Forward-looking consequences shown to the player ("Emma will remember you pushed hard."). */
  aftermath?: (ctx: OutcomeContext<H, S>) => string[];
}

// ---------- Rewards ----------

export interface RewardProfile {
  /** Base XP pool for the quest at neutral performance. */
  baseXp: number;
  /** Relative share per skill. Values are weights, not XP. */
  skills: Partial<Record<SkillId, number>>;
}

// ---------- Quest ----------

export interface QuestBriefing {
  situation: string;
  objective: string;
  /** Short list of what the player knows going in. */
  intel: string[];
  /** One-line coaching hint. Optional so quests can be blind. */
  hint?: string;
}

export interface QuestDefinition<H = Record<string, unknown>, S = Record<string, unknown>> {
  id: string;
  title: string;
  tagline: string;
  worldId: string;
  locationId: string;
  npcId: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  skills: SkillId[];
  /** Ordering hint for map/list display. */
  order: number;
  briefing: QuestBriefing;
  prerequisites: QuestPrerequisite[];
  objectives: QuestObjective[];
  scene: QuestScene<H, S>;
  rubric: RubricCriterion[];
  /** Extra instructions for the evaluator specific to this scenario. */
  evaluatorNotes?: string;
  outcomes: OutcomeBranch<H, S>[]; // ordered; first match wins; last should be a catch-all
  rewards: RewardProfile;
  /** Which NPC memory this quest wants surfaced to the model (defaults to all). */
  memoryFocus?: (memory: NPCMemory) => NPCMemory;
  /**
   * Shown on the briefing under "What carries over": how earlier choices shape
   * this quest ("Emma remembers you said nine lakh would do."). Pure.
   */
  carryOver?: (ctx: PrerequisiteContext) => string[];
}

/** Type-erased quest for registries. Use `defineQuest` to author. */
export type AnyQuestDefinition = QuestDefinition<Record<string, unknown>, Record<string, unknown>>;

export function defineQuest<H extends Record<string, unknown>, S extends Record<string, unknown>>(
  def: QuestDefinition<H, S>,
): AnyQuestDefinition {
  return def as unknown as AnyQuestDefinition;
}

// ---------- Attempt (persisted) ----------

export const QuestAttemptStatusSchema = z.enum(["active", "evaluating", "completed", "abandoned"]);
export type QuestAttemptStatus = z.infer<typeof QuestAttemptStatusSchema>;

export const XpAwardSchema = z.object({
  skill: z.string(),
  xp: z.number().int(),
  levelBefore: z.number().int(),
  levelAfter: z.number().int(),
});

export const QuestRewardsSchema = z.object({
  xp: z.array(XpAwardSchema),
  discoveredFacets: z.array(z.object({ skill: z.string(), facet: z.string(), label: z.string() })),
  relationshipChanges: z.array(
    z.object({
      npcId: z.string(),
      before: z.record(z.string(), z.number()),
      after: z.record(z.string(), z.number()),
    }),
  ),
  unlockedQuestIds: z.array(z.string()),
  unlockedLocationIds: z.array(z.string()),
  followUpQuestIds: z.array(z.string()),
});
export type QuestRewards = z.infer<typeof QuestRewardsSchema>;

export const QuestResultSchema = z.object({
  outcomeId: z.string(),
  outcomeLabel: z.string(),
  grade: z.enum(["success", "partial", "failure"]),
  narrative: z.string(),
  objectivesAchieved: z.array(z.string()),
  rewards: QuestRewardsSchema,
  consequencesApplied: z.array(z.unknown()),
  /** Forward-looking consequence lines for the player. */
  aftermath: z.array(z.string()).default([]),
  /**
   * first: the canonical run. second_chance: replay after a failure; becomes canon.
   * rehearsal: replay of a resolved quest; skills improve but the world keeps what really happened.
   */
  mode: z.enum(["first", "second_chance", "rehearsal"]).default("first"),
  /** How this run compares with the previous one of the same quest (replays only). */
  comparison: z
    .object({
      previousOutcomeLabel: z.string(),
      previousGrade: z.enum(["success", "partial", "failure"]),
      previousScore: z.number(),
      score: z.number(),
      lines: z.array(z.object({ label: z.string(), previous: z.string(), now: z.string() })),
      improved: z.boolean(),
    })
    .nullable()
    .default(null),
  /** Snapshot for the share card. */
  shareCard: z.object({
    title: z.string(),
    headline: z.string(),
    lines: z.array(z.object({ label: z.string(), before: z.string(), after: z.string() })),
    levelChanges: z.array(z.object({ skill: z.string(), before: z.number(), after: z.number() })),
  }),
});
export type QuestResult = z.infer<typeof QuestResultSchema>;
