/**
 * World-state engine (deterministic).
 *
 * `applyConsequences` is the single write path for WorldState. It returns the
 * new state plus a list of applied entries (used to emit events). Relationship
 * and NPC-memory consequences are *not* handled here; the orchestrator routes
 * them to the relationship/memory engines. This module only touches world state.
 */
import type { Consequence } from "../types/consequences";
import type { PrerequisiteContext, QuestPrerequisite } from "../types/quest";
import { WorldStateSchema, type WorldState } from "../types/world";
import { clamp, type EngineEnv } from "../util";

export interface AppliedConsequence {
  consequence: Consequence;
  /** Human-readable description for logs and the result screen. */
  description: string;
  /** False when the consequence was a no-op (e.g. flag already present). */
  changed: boolean;
}

export interface ApplyContext {
  questId: string;
  env: EngineEnv;
}

export function applyConsequences(
  world: WorldState,
  consequences: Consequence[],
  ctx: ApplyContext,
): { world: WorldState; applied: AppliedConsequence[] } {
  let state = structuredClone(world);
  const applied: AppliedConsequence[] = [];
  for (const c of consequences) {
    const r = applyOne(state, c, ctx);
    state = r.world;
    if (r.entry) applied.push(r.entry);
  }
  state.version += 1;
  return { world: WorldStateSchema.parse(state), applied };
}

function pushUnique(arr: string[], v: string): boolean {
  if (arr.includes(v)) return false;
  arr.push(v);
  return true;
}

function applyOne(
  world: WorldState,
  c: Consequence,
  ctx: ApplyContext,
): { world: WorldState; entry: AppliedConsequence | null } {
  const w = world;
  switch (c.type) {
    case "world.career.set": {
      const before = { ...w.career };
      w.career = { ...w.career, ...(c.patch as Partial<WorldState["career"]>) };
      const changed = JSON.stringify(before) !== JSON.stringify(w.career);
      return { world: w, entry: { consequence: c, description: `Career updated: ${describePatch(c.patch)}`, changed } };
    }
    case "world.var.set": {
      const changed = w.vars[c.key] !== c.value;
      w.vars[c.key] = c.value;
      return { world: w, entry: { consequence: c, description: `${c.key} = ${String(c.value)}`, changed } };
    }
    case "world.flag.add":
      return { world: w, entry: { consequence: c, description: `Flag: ${c.flag}`, changed: pushUnique(w.flags, c.flag) } };
    case "world.flag.remove": {
      const n = w.flags.length;
      w.flags = w.flags.filter((f) => f !== c.flag);
      return { world: w, entry: { consequence: c, description: `Flag removed: ${c.flag}`, changed: w.flags.length !== n } };
    }
    case "world.reputation.delta": {
      const before = w.reputation[c.domain] ?? 0;
      w.reputation[c.domain] = clamp(before + c.delta, -100, 100);
      return {
        world: w,
        entry: {
          consequence: c,
          description: `Reputation in ${c.domain} ${c.delta >= 0 ? "+" : ""}${c.delta}`,
          changed: w.reputation[c.domain] !== before,
        },
      };
    }
    case "world.unlock.world":
      return { world: w, entry: { consequence: c, description: `Unlocked world ${c.worldId}`, changed: pushUnique(w.unlockedWorlds, c.worldId) } };
    case "world.unlock.location":
      return {
        world: w,
        entry: { consequence: c, description: `Unlocked location ${c.locationId}`, changed: pushUnique(w.unlockedLocations, c.locationId) },
      };
    case "world.unlock.quest":
      return { world: w, entry: { consequence: c, description: `Unlocked quest ${c.questId}`, changed: pushUnique(w.unlockedQuests, c.questId) } };
    case "world.commitment.add": {
      const dup = w.commitments.find((x) => x.status === "open" && x.toNpcId === c.toNpcId && x.description === c.description);
      if (dup) return { world: w, entry: { consequence: c, description: `Commitment already tracked`, changed: false } };
      w.commitments.push({
        id: ctx.env.id(),
        description: c.description,
        toNpcId: c.toNpcId,
        madeInQuestId: ctx.questId,
        madeAt: ctx.env.now(),
        dueBy: c.dueBy,
        status: "open",
      });
      return { world: w, entry: { consequence: c, description: `You committed: ${c.description}`, changed: true } };
    }
    case "world.commitment.resolve": {
      const cm = w.commitments.find((x) => x.id === c.commitmentId);
      const changed = !!cm && cm.status !== c.status;
      if (cm) cm.status = c.status;
      return { world: w, entry: { consequence: c, description: `Commitment ${c.status}`, changed } };
    }
    case "world.decision.add":
      w.decisions.push({ id: ctx.env.id(), questId: ctx.questId, description: c.description, at: ctx.env.now() });
      return { world: w, entry: { consequence: c, description: `Decision: ${c.description}`, changed: true } };
    case "world.opportunity.add":
      w.opportunities.push({
        id: ctx.env.id(),
        description: c.description,
        sourceNpcId: c.sourceNpcId,
        questId: c.questId,
        createdAt: ctx.env.now(),
      });
      return { world: w, entry: { consequence: c, description: `Opportunity: ${c.description}`, changed: true } };
    case "world.person.met":
      return { world: w, entry: { consequence: c, description: `Met ${c.npcId}`, changed: pushUnique(w.peopleMet, c.npcId) } };
    case "relationship.delta":
    case "npc.memory.event":
      // Routed elsewhere by the orchestrator. Not a world-state change.
      return { world: w, entry: null };
  }
}

function describePatch(p: Record<string, unknown>): string {
  return Object.entries(p)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}

export function recordQuestCompletion(
  world: WorldState,
  rec: { questId: string; attemptId: string; outcomeId: string; grade: "success" | "partial" | "failure"; at: string },
): WorldState {
  const w = structuredClone(world);
  const entry = { questId: rec.questId, attemptId: rec.attemptId, outcomeId: rec.outcomeId, at: rec.at };
  if (rec.grade === "failure") w.failedQuests.push(entry);
  else w.completedQuests.push(entry);
  return w;
}

// ---------- Prerequisites ----------

export interface PrerequisiteResult {
  ok: boolean;
  /** Human-readable reasons for unmet prerequisites (used for locked quest markers). */
  unmet: string[];
}

export function checkPrerequisites(prereqs: QuestPrerequisite[], ctx: PrerequisiteContext): PrerequisiteResult {
  const unmet: string[] = [];
  for (const p of prereqs) {
    switch (p.type) {
      case "quest_completed": {
        const rec = ctx.world.completedQuests.filter((q) => q.questId === p.questId);
        const ok = rec.length > 0 && (!p.outcomeIds || rec.some((r) => p.outcomeIds!.includes(r.outcomeId)));
        if (!ok) unmet.push(`Complete "${p.questId}" first`);
        break;
      }
      case "quest_not_completed":
        if (ctx.world.completedQuests.some((q) => q.questId === p.questId)) unmet.push(`Already resolved by "${p.questId}"`);
        break;
      case "world_flag": {
        const has = ctx.world.flags.includes(p.flag);
        if (has !== (p.present ?? true)) unmet.push(p.present === false ? `Blocked by ${p.flag}` : `Requires ${p.flag}`);
        break;
      }
      case "world_unlocked_quest":
        if (!ctx.world.unlockedQuests.includes(p.questId)) unmet.push("Not yet unlocked");
        break;
      case "career_status":
        if (ctx.world.career.status !== p.status) unmet.push(`Requires career status: ${p.status}`);
        break;
      case "skill_level":
        if ((ctx.competencies[p.skill]?.level ?? 1) < p.min) unmet.push(`Requires ${p.skill} level ${p.min}`);
        break;
      case "relationship": {
        const npc = ctx.npcs[p.npcId];
        if (!npc || npc.relationship[p.dimension] < p.min) unmet.push(`Needs more ${p.dimension} with ${p.npcId}`);
        break;
      }
      case "custom":
        if (!p.check(ctx)) unmet.push(p.label);
        break;
    }
  }
  return { ok: unmet.length === 0, unmet };
}
