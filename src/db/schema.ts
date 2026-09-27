/**
 * Database schema (Drizzle, SQLite/libsql).
 *
 * Structured game state (world state, NPC memory, competency profile, scene
 * state) is stored as validated JSON documents. Each is small, read and written
 * whole, and versioned by the engine. Relational tables hold identity, attempts,
 * dialogue turns and the append-only event log.
 *
 * Migration path to Postgres: swap `sqliteTable` for `pgTable`, `text({mode:'json'})`
 * for `jsonb`, and `integer({mode:'timestamp'})` for `timestamp`. Nothing in
 * the engine or services depends on SQLite specifics.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { WorldState } from "@/engine/types/world";
import type { NPCMemory, Relationship } from "@/engine/types/npc";
import type { CompetencyProfile } from "@/engine/types/skills";
import type { NPCMoves, SceneState } from "@/engine/types/scene";
import type { Evaluation } from "@/engine/types/evaluation";
import type { QuestResult } from "@/engine/types/quest";
import type { TurnIdentity } from "@/engine/scene/ensemble";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    onboardingCompletedAt: text("onboarding_completed_at"),
    competencies: text("competencies", { mode: "json" }).$type<CompetencyProfile>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("players_user_idx").on(t.userId)],
);

export const worldStates = sqliteTable("world_states", {
  playerId: text("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  state: text("state", { mode: "json" }).$type<WorldState>().notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const npcStates = sqliteTable(
  "npc_states",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    npcId: text("npc_id").notNull(),
    relationship: text("relationship", { mode: "json" }).$type<Relationship>().notNull(),
    memory: text("memory", { mode: "json" }).$type<NPCMemory>().notNull(),
    timesMet: integer("times_met").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("npc_states_player_npc_idx").on(t.playerId, t.npcId)],
);

export const questAttempts = sqliteTable(
  "quest_attempts",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    questId: text("quest_id").notNull(),
    npcId: text("npc_id").notNull(),
    status: text("status").$type<"active" | "evaluating" | "completed" | "abandoned">().notNull(),
    hidden: text("hidden", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    scene: text("scene", { mode: "json" }).$type<SceneState>().notNull(),
    evaluation: text("evaluation", { mode: "json" }).$type<Evaluation | null>(),
    result: text("result", { mode: "json" }).$type<QuestResult | null>(),
    /** Snapshot of relevant state *before* the attempt, for before/after displays. */
    snapshotBefore: text("snapshot_before", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    modality: text("modality").$type<"voice" | "text">().notNull().default("text"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("quest_attempts_player_idx").on(t.playerId, t.questId)],
);

export const dialogueTurns = sqliteTable(
  "dialogue_turns",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => questAttempts.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    speaker: text("speaker").$type<"player" | "npc" | "system">().notNull(),
    identity: text("identity", { mode: "json" }).$type<TurnIdentity | null>(),
    text: text("text").notNull(),
    modality: text("modality").$type<"voice" | "text" | "generated">().notNull(),
    moves: text("moves", { mode: "json" }).$type<NPCMoves | null>(),
    createdAt: text("created_at").notNull(),
    /** Canonical transcript: true when the player cut this NPC line off; `text` then holds only what was heard. */
    interrupted: integer("interrupted", { mode: "boolean" }),
    /** Full generated line for interrupted turns (diagnostics only). */
    generatedText: text("generated_text"),
    /** Scene state the NPC turn was reduced from, so an interrupted line can be re-reduced on what was actually heard. */
    sceneBefore: text("scene_before", { mode: "json" }).$type<SceneState | null>(),
  },
  (t) => [uniqueIndex("dialogue_turns_attempt_idx").on(t.attemptId, t.idx)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("events_player_idx").on(t.playerId, t.createdAt)],
);

export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    problems: text("problems", { mode: "json" }).$type<string[] | null>(),
    attemptId: text("attempt_id"),
    playerId: text("player_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_calls_attempt_idx").on(t.attemptId)],
);
