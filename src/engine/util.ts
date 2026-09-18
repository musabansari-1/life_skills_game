/** Small pure helpers shared across engine modules. No IO here. */

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Injectable clock/id so engine logic is deterministic in tests. */
export interface EngineEnv {
  now: () => string; // ISO timestamp
  id: () => string;
}

let counter = 0;
export const defaultEnv: EngineEnv = {
  now: () => new Date().toISOString(),
  id: () =>
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `id_${Date.now().toString(36)}_${(counter++).toString(36)}`,
};

let testEnvInstances = 0;
export function makeTestEnv(start = Date.UTC(2026, 0, 1)): EngineEnv {
  let t = start;
  let i = 0;
  const prefix = `t${(testEnvInstances++).toString(36)}`;
  return {
    now: () => {
      t += 1000;
      return new Date(t).toISOString();
    },
    id: () => `${prefix}_${(i++).toString(36).padStart(4, "0")}`,
  };
}

/** Normalise a memory key: lowercase, keep letters/digits/dots, collapse the rest to underscores. */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/** Normalise free text for de-duplication (lowercase, strip punctuation, collapse spaces). */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cheap similarity: Jaccard over word sets. Good enough for memory dedupe. */
export function textSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeText(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export function formatINR(amount: number): string {
  // Lakh formatting: 850000 -> ₹8.5L ; 40000 -> ₹40K
  if (Math.abs(amount) >= 100000) {
    const l = amount / 100000;
    return `₹${Number.isInteger(l) ? l : l.toFixed(l < 10 ? 2 : 1).replace(/\.?0+$/, "")}L`;
  }
  if (Math.abs(amount) >= 1000) return `₹${Math.round(amount / 1000)}K`;
  return `₹${amount}`;
}
