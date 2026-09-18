/**
 * NPC memory engine (deterministic).
 *
 * The memory-extraction AI task proposes candidate items; this module merges
 * them into the persistent NPCMemory with de-duplication, caps and decay, and
 * selects the most salient items for a prompt.
 */
import type {
  MemoryEvent,
  MemoryExtraction,
  MemoryFact,
  NPCBelief,
  NPCCommitment,
  NPCMemory,
} from "../types/npc";
import { clamp, normalizeKey, round, textSimilarity, type EngineEnv } from "../util";

export const MEMORY_CAPS = { facts: 40, beliefs: 20, events: 30, commitments: 20 } as const;
const SIMILARITY_DEDUPE = 0.6;

export interface MergeContext {
  questId: string;
  attemptId: string | null;
  env: EngineEnv;
}

export function mergeMemory(memory: NPCMemory, extracted: MemoryExtraction, ctx: MergeContext): NPCMemory {
  const now = ctx.env.now();
  const next: NPCMemory = structuredClone(memory);

  // ---- Facts: dedupe by key, then by similarity; newer statement wins, confidence blended.
  for (const f of extracted.facts) {
    const key = normalizeKey(f.key);
    if (!key || !f.statement.trim()) continue;
    const existing =
      next.facts.find((x) => x.key === key) ??
      next.facts.find((x) => textSimilarity(x.statement, f.statement) >= SIMILARITY_DEDUPE);
    if (existing) {
      existing.statement = f.statement;
      existing.confidence = round(clamp(existing.confidence * 0.4 + f.confidence * 0.6 + 0.1, 0, 1), 2);
      existing.lastConfirmedAt = now;
      existing.sourceQuestId = ctx.questId;
    } else {
      const fact: MemoryFact = {
        id: ctx.env.id(),
        key,
        statement: f.statement,
        confidence: round(clamp(f.confidence, 0, 1), 2),
        sourceQuestId: ctx.questId,
        firstSeenAt: now,
        lastConfirmedAt: now,
      };
      next.facts.push(fact);
    }
  }

  // ---- Beliefs: dedupe by key; blend valence/strength toward the new observation.
  for (const b of extracted.beliefs) {
    const key = normalizeKey(b.key);
    if (!key) continue;
    const existing = next.beliefs.find((x) => x.key === key);
    if (existing) {
      existing.valence = round(clamp(existing.valence * 0.5 + b.valence * 0.5, -1, 1), 2);
      existing.strength = round(clamp(existing.strength * 0.6 + b.strength * 0.6, 0, 1), 2);
      existing.statement = b.statement;
      existing.evidence = b.evidence;
      existing.updatedAt = now;
      existing.sourceQuestId = ctx.questId;
    } else {
      const belief: NPCBelief = {
        id: ctx.env.id(),
        key,
        statement: b.statement,
        valence: round(clamp(b.valence, -1, 1), 2),
        strength: round(clamp(b.strength, 0, 1), 2),
        evidence: b.evidence,
        sourceQuestId: ctx.questId,
        updatedAt: now,
      };
      next.beliefs.push(belief);
    }
  }

  // ---- Events: similarity dedupe within the same quest; otherwise append.
  for (const e of extracted.events) {
    if (!e.summary.trim()) continue;
    const dup = next.events.find(
      (x) => x.questId === ctx.questId && textSimilarity(x.summary, e.summary) >= SIMILARITY_DEDUPE,
    );
    if (dup) {
      dup.importance = Math.max(dup.importance, e.importance);
      continue;
    }
    const ev: MemoryEvent = {
      id: ctx.env.id(),
      questId: ctx.questId,
      attemptId: ctx.attemptId,
      summary: e.summary,
      importance: round(clamp(e.importance, 0, 1), 2),
      emotionalTone: e.emotionalTone,
      at: now,
    };
    next.events.push(ev);
  }

  // ---- Commitments: dedupe by similarity among open ones.
  for (const c of extracted.commitments) {
    if (!c.description.trim()) continue;
    const dup = next.commitments.find(
      (x) => x.status === "open" && x.by === c.by && textSimilarity(x.description, c.description) >= SIMILARITY_DEDUPE,
    );
    if (dup) continue;
    const commitment: NPCCommitment = {
      id: ctx.env.id(),
      by: c.by,
      description: c.description,
      dueBy: c.dueBy,
      status: "open",
      questId: ctx.questId,
      at: now,
    };
    next.commitments.push(commitment);
  }

  next.lastInteractionSummary = extracted.interactionSummary || next.lastInteractionSummary;
  next.lastInteractionAt = now;

  return enforceCaps(next);
}

/** Decay older events slightly and trim to caps, keeping the most salient. */
export function enforceCaps(memory: NPCMemory): NPCMemory {
  const m = structuredClone(memory);
  m.facts.sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
  m.facts = m.facts.slice(0, MEMORY_CAPS.facts);
  m.beliefs.sort((a, b) => b.strength - a.strength);
  m.beliefs = m.beliefs.slice(0, MEMORY_CAPS.beliefs);
  m.events.sort((a, b) => salience(b) - salience(a));
  m.events = m.events.slice(0, MEMORY_CAPS.events).sort((a, b) => a.at.localeCompare(b.at));
  m.commitments.sort((a, b) => (a.status === "open" ? -1 : 1) - (b.status === "open" ? -1 : 1));
  m.commitments = m.commitments.slice(0, MEMORY_CAPS.commitments);
  return m;
}

function salience(e: MemoryEvent): number {
  // Recency bonus computed from ordering, not wall clock, so tests are stable.
  return e.importance + (e.emotionalTone === "neutral" ? 0 : 0.1);
}

export function resolveCommitment(memory: NPCMemory, commitmentId: string, status: "fulfilled" | "broken"): NPCMemory {
  const m = structuredClone(memory);
  const c = m.commitments.find((x) => x.id === commitmentId);
  if (c) c.status = status;
  return m;
}

/** Choose what the NPC model should see this turn. Bounded and ranked. */
export function selectMemoryForPrompt(memory: NPCMemory, limits = { facts: 10, beliefs: 8, events: 6, commitments: 6 }) {
  return {
    facts: [...memory.facts].sort((a, b) => b.confidence - a.confidence).slice(0, limits.facts),
    beliefs: [...memory.beliefs].sort((a, b) => b.strength - a.strength).slice(0, limits.beliefs),
    events: [...memory.events].sort((a, b) => b.importance - a.importance || b.at.localeCompare(a.at)).slice(0, limits.events),
    commitments: memory.commitments.filter((c) => c.status === "open").slice(0, limits.commitments),
    lastInteractionSummary: memory.lastInteractionSummary,
  };
}

/** Render selected memory as a compact prose block for a prompt. */
export function renderMemoryBlock(memory: NPCMemory, playerName: string): string {
  const sel = selectMemoryForPrompt(memory);
  const lines: string[] = [];
  if (sel.lastInteractionSummary) lines.push(`Last time you spoke: ${sel.lastInteractionSummary}`);
  if (sel.events.length) {
    lines.push("Things you remember happening:");
    for (const e of sel.events) lines.push(`- ${e.summary}`);
  }
  if (sel.facts.length) {
    lines.push(`Things you know about ${playerName}:`);
    for (const f of sel.facts) lines.push(`- ${f.statement}${f.confidence < 0.6 ? " (not fully sure)" : ""}`);
  }
  if (sel.beliefs.length) {
    lines.push(`Your impressions of ${playerName}:`);
    for (const b of sel.beliefs) lines.push(`- ${b.statement}${b.strength < 0.4 ? " (tentative)" : ""}`);
  }
  if (sel.commitments.length) {
    lines.push("Open commitments:");
    for (const c of sel.commitments)
      lines.push(`- ${c.by === "player" ? playerName : "You"} promised: ${c.description}${c.dueBy ? ` (by ${c.dueBy})` : ""}`);
  }
  return lines.length ? lines.join("\n") : `You have no prior history with ${playerName}.`;
}
