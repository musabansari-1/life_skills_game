/**
 * Player state repository. Loads and saves the validated JSON documents that
 * make up a player's persistent game state. All writes go through here.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { npcStates, players, worldStates } from "@/db/schema";
import { NPCS } from "@/content/npcs";
import { createEmptyProfile } from "@/engine/competency";
import { createNPCInstanceState, NPCInstanceStateSchema, type NPCInstanceState } from "@/engine/types/npc";
import { PlayerSkillSchema, SKILL_IDS, type CompetencyProfile } from "@/engine/types/skills";
import { WorldStateSchema, type WorldState } from "@/engine/types/world";
import { defaultEnv } from "@/engine/util";

export interface PlayerState {
  playerId: string;
  displayName: string;
  onboardingCompleted: boolean;
  world: WorldState;
  competencies: CompetencyProfile;
  npcs: Record<string, NPCInstanceState>;
}

export async function loadPlayerState(db: Db, playerId: string): Promise<PlayerState> {
  const player = await db.query.players.findFirst({ where: eq(players.id, playerId) });
  if (!player) throw new Error(`Player not found: ${playerId}`);
  const ws = await db.query.worldStates.findFirst({ where: eq(worldStates.playerId, playerId) });
  const rows = await db.query.npcStates.findMany({ where: eq(npcStates.playerId, playerId) });
  const npcs: Record<string, NPCInstanceState> = {};
  for (const r of rows) {
    npcs[r.npcId] = NPCInstanceStateSchema.parse({ npcId: r.npcId, relationship: r.relationship, memory: r.memory, timesMet: r.timesMet });
  }
  return {
    playerId,
    displayName: player.displayName,
    onboardingCompleted: !!player.onboardingCompletedAt,
    world: WorldStateSchema.parse(ws?.state ?? {}),
    competencies: normalizeProfile(player.competencies),
    npcs,
  };
}

/** Fill in any skills added after the profile was created. */
function normalizeProfile(raw: CompetencyProfile): CompetencyProfile {
  const empty = createEmptyProfile();
  const out = { ...empty };
  for (const id of SKILL_IDS) {
    const parsed = PlayerSkillSchema.safeParse((raw as Record<string, unknown>)?.[id]);
    if (parsed.success) out[id] = { ...empty[id], ...parsed.data, facets: { ...empty[id].facets, ...parsed.data.facets } };
  }
  return out;
}

export function getOrCreateNpcState(state: PlayerState, npcId: string): NPCInstanceState {
  if (!state.npcs[npcId]) {
    const def = NPCS[npcId];
    if (!def) throw new Error(`Unknown NPC ${npcId}`);
    state.npcs[npcId] = createNPCInstanceState(def);
  }
  return state.npcs[npcId];
}

export async function saveWorldState(db: Db, playerId: string, world: WorldState) {
  const now = defaultEnv.now();
  await db
    .insert(worldStates)
    .values({ playerId, state: world, version: world.version, updatedAt: now })
    .onConflictDoUpdate({ target: worldStates.playerId, set: { state: world, version: world.version, updatedAt: now } });
}

export async function saveCompetencies(db: Db, playerId: string, competencies: CompetencyProfile) {
  await db.update(players).set({ competencies, updatedAt: defaultEnv.now() }).where(eq(players.id, playerId));
}

export async function saveNpcState(db: Db, playerId: string, npc: NPCInstanceState) {
  const now = defaultEnv.now();
  const existing = await db.query.npcStates.findFirst({ where: and(eq(npcStates.playerId, playerId), eq(npcStates.npcId, npc.npcId)) });
  if (existing) {
    await db
      .update(npcStates)
      .set({ relationship: npc.relationship, memory: npc.memory, timesMet: npc.timesMet, updatedAt: now })
      .where(eq(npcStates.id, existing.id));
  } else {
    await db.insert(npcStates).values({ id: defaultEnv.id(), playerId, npcId: npc.npcId, relationship: npc.relationship, memory: npc.memory, timesMet: npc.timesMet, updatedAt: now });
  }
}

export async function completeOnboarding(db: Db, playerId: string, displayName: string) {
  await db.update(players).set({ displayName: displayName.trim() || "Player", onboardingCompletedAt: defaultEnv.now(), updatedAt: defaultEnv.now() }).where(eq(players.id, playerId));
}
