/**
 * Structured-output safety net.
 *
 * Models produce almost-JSON surprisingly often: fenced blocks, trailing
 * commas, prose before/after, smart quotes. This module extracts and repairs
 * the most common failures, validates against a zod schema, and reports
 * exactly what went wrong so callers can retry with a correction prompt.
 */
import type { z } from "zod";

export interface ParseOk<T> {
  ok: true;
  value: T;
  repaired: boolean;
}
export interface ParseFail {
  ok: false;
  error: string;
  raw: string;
}
export type ParseResult<T> = ParseOk<T> | ParseFail;

/** Find the first balanced {...} or [...] block in text. */
export function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = extractBalanced(fenced[1]);
    if (inner) return inner;
  }
  return extractBalanced(text);
}

function extractBalanced(text: string): string | null {
  const start = findFirst(text, ["{", "["]);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unterminated: return from start and let repair try to close it.
  return text.slice(start);
}

function findFirst(text: string, chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const i = text.indexOf(c);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/** Conservative repairs for common model mistakes. */
export function repairJson(s: string): string {
  let out = s.trim();
  // Smart quotes → straight quotes (only outside obvious words; good enough).
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Remove trailing commas before } or ]
  out = out.replace(/,\s*([}\]])/g, "$1");
  // Remove JS-style comments
  out = out.replace(/^\s*\/\/.*$/gm, "");
  // Close unterminated structures
  const opens: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of out) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") opens.push("}");
    else if (ch === "[") opens.push("]");
    else if (ch === "}" || ch === "]") opens.pop();
  }
  if (inString) out += '"';
  // A dangling comma before we close ("...,"yes",) would leave `,}`; strip it.
  out = out.replace(/,\s*$/, "");
  while (opens.length) out += opens.pop();
  out = out.replace(/,\s*([}\]])/g, "$1");
  return out;
}

export function parseJsonWithSchema<S extends z.ZodTypeAny>(text: string, schema: S): ParseResult<z.infer<S>> {
  const block = extractJsonBlock(text);
  if (!block) return { ok: false, error: "No JSON object found in output", raw: text };

  const attempts: { candidate: string; repaired: boolean }[] = [
    { candidate: block, repaired: false },
    { candidate: repairJson(block), repaired: true },
  ];
  let lastError = "";
  for (const a of attempts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(a.candidate);
    } catch (e) {
      lastError = `Invalid JSON: ${(e as Error).message}`;
      continue;
    }
    const r = schema.safeParse(parsed);
    if (r.success) return { ok: true, value: r.data, repaired: a.repaired };
    lastError = `Schema mismatch: ${formatZodError(r.error)}`;
  }
  return { ok: false, error: lastError, raw: text };
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
