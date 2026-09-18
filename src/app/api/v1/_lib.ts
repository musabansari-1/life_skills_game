/**
 * Shared helpers for /api/v1 route handlers: auth, body validation, and
 * mapping domain errors to the public ApiError contract.
 */
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { ApiError, ApiErrorCode } from "@/contracts/api";
import { AuthError, ValidationError } from "@/server/account";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";
import { getCurrentPlayer } from "@/server/session";

export class UnauthorizedError extends Error {}

/** Resolve the calling player from `Authorization: Bearer` or the session cookie. */
export async function requirePlayer() {
  const { game, db } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) throw new UnauthorizedError("Not signed in");
  return { game, db, player };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  prerequisites: 409,
  state: 409,
  conflict: 409,
  ai: 502,
  validation: 400,
  internal: 500,
};

export function toApiError(err: unknown): ApiError {
  if (err instanceof UnauthorizedError) return { error: err.message, code: "unauthorized" };
  if (err instanceof AuthError) return { error: err.message, code: "unauthorized" };
  if (err instanceof ValidationError) return { error: err.message, code: "validation" };
  if (err instanceof GameError) return { error: err.message, code: err.code };
  console.error("[api] unhandled", err);
  return { error: "Something went wrong.", code: "internal" };
}

export function errorResponse(err: unknown) {
  const body = toApiError(err);
  return NextResponse.json(body, { status: STATUS[body.code] });
}

export function ok<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}
