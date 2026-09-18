/**
 * Public API contract, version 1.
 *
 * This module is the boundary between the game server and ANY client (the
 * Next.js web app today; React Native / iOS / Android later). It depends only
 * on zod and the pure engine types, so it can be copied into or shared with a
 * native codebase unchanged.
 *
 * Rules:
 *  - Never expose hidden NPC state, raw patience, or internal flags here.
 *  - Additive changes only within v1 (new optional fields). Breaking changes
 *    need /api/v2 and a new module.
 *  - Every route under /api/v1 returns one of these shapes, or ApiError.
 */
import { z } from "zod";
import { EvaluationSchema } from "@/engine/types/evaluation";
import { QuestRewardsSchema } from "@/engine/types/quest";
import { RelationshipSchema } from "@/engine/types/npc";
import { SkillIdSchema } from "@/engine/types/skills";

export const API_VERSION = "v1" as const;
export const API_BASE = `/api/${API_VERSION}` as const;

// ---------------------------------------------------------------- errors

export const ApiErrorCodeSchema = z.enum(["unauthorized", "forbidden", "not_found", "prerequisites", "state", "conflict", "ai", "validation", "internal"]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: ApiErrorCodeSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------- auth

export const CredentialsSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

export const PlayerIdentitySchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  onboardingCompleted: z.boolean(),
});
export type PlayerIdentity = z.infer<typeof PlayerIdentitySchema>;

/** Returned by POST /auth/signup and /auth/signin. Native clients store `token` securely and send `Authorization: Bearer <token>`. */
export const AuthSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  player: PlayerIdentitySchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const OnboardingRequestSchema = z.object({
  displayName: z.string().trim().min(2, "Give your character a name (2+ characters).").max(24, "Keep it under 24 characters."),
});

// ---------------------------------------------------------------- player / world

export const SkillViewSchema = z.object({
  id: SkillIdSchema,
  label: z.string(),
  tagline: z.string(),
  level: z.number().int(),
  xp: z.number().int(),
  progress: z.object({ into: z.number(), needed: z.number(), pct: z.number() }),
  discovered: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type SkillView = z.infer<typeof SkillViewSchema>;

export const QuestCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  tagline: z.string(),
  worldId: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  npcId: z.string(),
  npcName: z.string(),
  npcRole: z.string(),
  difficulty: z.number().int(),
  skills: z.array(SkillIdSchema),
  availability: z.enum(["available", "locked", "completed", "replayable"]),
  unmet: z.array(z.string()),
  lastOutcomeId: z.string().nullable(),
  isNext: z.boolean(),
});
export type QuestCard = z.infer<typeof QuestCardSchema>;

export const WorldCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  status: z.enum(["open", "locked"]),
  map: z.object({ x: z.number(), y: z.number(), size: z.enum(["sm", "md", "lg"]).optional() }),
  accent: z.string(),
  quests: z.array(QuestCardSchema),
  availableCount: z.number().int(),
});
export type WorldCard = z.infer<typeof WorldCardSchema>;

export const PersonSummarySchema = z.object({
  npcId: z.string(),
  name: z.string(),
  role: z.string(),
  appearance: z.object({ hue: z.number(), initials: z.string() }),
  standing: z.string(),
});

export const CareerSummarySchema = z.object({
  status: z.enum(["exploring", "interviewing", "offer_received", "employed"]),
  employer: z.string().nullable(),
  role: z.string().nullable(),
  baseSalary: z.number().nullable(),
  signingBonus: z.number().nullable(),
  /** Pre-formatted one-liner, e.g. "Platform Engineer at Nova Labs · ₹9.2L". */
  label: z.string(),
});

export const ActiveAttemptRefSchema = z.object({
  attemptId: z.string(),
  questId: z.string(),
  questTitle: z.string(),
  npcShortName: z.string(),
});

/** GET /world — everything the home/map screen needs in one call. */
export const WorldOverviewSchema = z.object({
  player: PlayerIdentitySchema,
  career: CareerSummarySchema,
  worlds: z.array(WorldCardSchema),
  skills: z.array(SkillViewSchema),
  insight: z.string().nullable(),
  people: z.array(PersonSummarySchema),
  openCommitments: z.array(z.object({ id: z.string(), description: z.string(), toNpcName: z.string() })),
  activeAttempt: ActiveAttemptRefSchema.nullable(),
  /** The connected story: where the player is. */
  campaign: z
    .object({
      title: z.string(),
      chapters: z.array(z.object({ questId: z.string(), label: z.string(), state: z.enum(["done", "current", "locked"]) })),
      completed: z.number().int(),
      total: z.number().int(),
      currentQuestId: z.string().nullable(),
      finished: z.boolean(),
    })
    .nullable()
    .default(null),
  /** Recent decisions, newest first: the player's story so far. */
  story: z.array(z.string()).default([]),
  /** Monotonic world-state version; clients can skip re-rendering when unchanged. */
  stateVersion: z.number().int(),
});
export type WorldOverview = z.infer<typeof WorldOverviewSchema>;

// ---------------------------------------------------------------- NPC dossier

export const DossierSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  role: z.string(),
  organisation: z.string(),
  worldId: z.string(),
  worldName: z.string().nullable(),
  worldAccent: z.string().nullable(),
  publicDossier: z.string(),
  appearance: z.object({ hue: z.number(), initials: z.string() }),
  met: z.boolean(),
  timesMet: z.number().int(),
  relationship: RelationshipSchema.nullable(),
  relationshipLabel: z.string(),
  lastInteractionSummary: z.string().nullable(),
  remembers: z.array(z.string()),
  impressions: z.array(z.object({ statement: z.string(), valence: z.number() })),
  openCommitments: z.array(z.object({ by: z.enum(["player", "npc"]), description: z.string() })),
  history: z.array(z.object({ attemptId: z.string(), questId: z.string(), questTitle: z.string(), outcomeLabel: z.string() })),
});
export type Dossier = z.infer<typeof DossierSchema>;

// ---------------------------------------------------------------- quest briefing

export const QuestBriefingSchema = z.object({
  id: z.string(),
  title: z.string(),
  tagline: z.string(),
  worldName: z.string().nullable(),
  worldAccent: z.string().nullable(),
  locationName: z.string().nullable(),
  difficulty: z.number().int(),
  skills: z.array(z.object({ id: SkillIdSchema, label: z.string() })),
  briefing: z.object({ situation: z.string(), objective: z.string(), intel: z.array(z.string()), hint: z.string().optional() }),
  canStart: z.boolean(),
  unmet: z.array(z.string()),
  lastOutcomeLabel: z.string().nullable(),
  npc: DossierSchema,
  /** How earlier choices shape this quest ("Emma remembers you said nine lakh would do."). */
  carryOver: z.array(z.string()).default([]),
  /** What starting it now means: first run, second chance after a failure, or a rehearsal of a resolved quest. */
  replayMode: z.enum(["first", "second_chance", "rehearsal"]).default("first"),
  /** Position in the campaign, if the quest is a chapter. */
  chapter: z.object({ index: z.number().int(), total: z.number().int(), title: z.string() }).nullable().default(null),
});
export type QuestBriefingView = z.infer<typeof QuestBriefingSchema>;

// ---------------------------------------------------------------- scene / attempt

export const VoiceProfileSchema = z.object({
  lang: z.string(),
  gender: z.enum(["female", "male", "neutral"]),
  rate: z.number(),
  pitch: z.number(),
  preferredVoiceHints: z.array(z.string()),
});

export const ClientTurnSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  speaker: z.enum(["player", "npc", "system"]),
  text: z.string(),
});
export type ClientTurn = z.infer<typeof ClientTurnSchema>;

/** What a client may know about a live scene. Hidden NPC state never appears here. */
export const ClientAttemptSchema = z.object({
  id: z.string(),
  questId: z.string(),
  npcId: z.string(),
  status: z.enum(["active", "evaluating", "completed", "abandoned"]),
  turns: z.array(ClientTurnSchema),
  visibleStatus: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Coarse, diegetic read of the NPC's mood. Never the raw number. */
  mood: z.enum(["warm", "neutral", "guarded", "defensive", "done"]),
  ended: z.object({ by: z.string(), reason: z.string() }).nullable(),
  turnCount: z.number().int(),
  maxTurns: z.number().int(),
});
export type ClientAttempt = z.infer<typeof ClientAttemptSchema>;

/** Static scene framing a client needs to render the conversation screen. */
export const SceneInfoSchema = z.object({
  quest: z.object({ id: z.string(), title: z.string(), objective: z.string(), locationName: z.string(), minTurns: z.number().int() }),
  npc: z.object({
    id: z.string(),
    name: z.string(),
    shortName: z.string(),
    role: z.string(),
    organisation: z.string(),
    appearance: z.object({ hue: z.number(), initials: z.string() }),
    voice: VoiceProfileSchema,
  }),
});
export type SceneInfo = z.infer<typeof SceneInfoSchema>;

/** GET /attempts/:id and POST /quests/:id/start. */
export const AttemptEnvelopeSchema = z.object({
  attempt: ClientAttemptSchema,
  scene: SceneInfoSchema,
});
export type AttemptEnvelope = z.infer<typeof AttemptEnvelopeSchema>;

/** GET /attempts/active */
export const ActiveAttemptResponseSchema = z.object({ active: z.lazy(() => AttemptEnvelopeSchema).nullable() });

/** Generic acknowledgement for commands with no payload (abandon, signout, share). */
export const AckSchema = z.object({ ok: z.literal(true) });

/** POST /attempts/:id/conclude */
export const ConcludeResponseSchema = z.object({ attemptId: z.string(), status: z.enum(["active", "evaluating", "completed", "abandoned"]) });

export const StartQuestRequestSchema = z.object({
  modality: z.enum(["voice", "text"]).default("text"),
});

export const TurnRequestSchema = z.object({
  text: z.string().trim().min(1, "Say something first.").max(2000),
  modality: z.enum(["voice", "text"]).default("text"),
  /**
   * Optimistic concurrency / retry safety. The number of turns the client has
   * already seen. If it doesn't match the server, the server returns 409 with
   * the current attempt instead of appending a duplicate turn.
   */
  expectedTurnCount: z.number().int().min(0).optional(),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/** Non-streaming turn response (Accept: application/json). */
export const TurnResponseSchema = z.object({
  attempt: ClientAttemptSchema,
  npcText: z.string(),
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

/**
 * Streaming turn response (Accept: text/event-stream). Server-Sent Events:
 *   event: speech  data: TurnSpeechEvent   (repeated; growing NPC speech)
 *   event: result  data: ClientAttempt      (once, at the end)
 *   event: error   data: ApiError           (instead of result)
 */
export const TurnSpeechEventSchema = z.object({ text: z.string(), done: z.boolean() });
export type TurnSpeechEvent = z.infer<typeof TurnSpeechEventSchema>;

// ---------------------------------------------------------------- results

/** GET /attempts/:id/result — the debrief. Only available once status is "completed". */
export const DebriefSchema = z.object({
  attemptId: z.string(),
  quest: z.object({ id: z.string(), title: z.string() }),
  npc: z.object({ id: z.string(), name: z.string(), shortName: z.string(), appearance: z.object({ hue: z.number(), initials: z.string() }) }),
  outcomeId: z.string(),
  outcomeLabel: z.string(),
  grade: z.enum(["success", "partial", "failure"]),
  narrative: z.string(),
  objectives: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["primary", "hidden", "optional"]), achieved: z.boolean() })),
  rewards: QuestRewardsSchema,
  evaluation: EvaluationSchema,
  /** Player-facing descriptions of what changed in the world. */
  worldChanges: z.array(z.string()),
  shareCard: z.object({
    title: z.string(),
    headline: z.string(),
    lines: z.array(z.object({ label: z.string(), before: z.string(), after: z.string() })),
    levelChanges: z.array(z.object({ skill: z.string(), before: z.number(), after: z.number() })),
  }),
  skillLabels: z.record(z.string(), z.string()),
  /** Player's own lines, keyed by turn index, so key moments can quote them. */
  playerTurnTexts: z.record(z.string(), z.string()),
  nextQuest: z.object({ id: z.string(), title: z.string(), tagline: z.string(), npcName: z.string(), isFollowUp: z.boolean() }).nullable(),
  /** Forward-looking consequences ("Emma will remember you pushed hard."). */
  aftermath: z.array(z.string()).default([]),
  mode: z.enum(["first", "second_chance", "rehearsal"]).default("first"),
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
  chapter: z.object({ index: z.number().int(), total: z.number().int(), title: z.string(), finished: z.boolean() }).nullable().default(null),
});
export type Debrief = z.infer<typeof DebriefSchema>;
