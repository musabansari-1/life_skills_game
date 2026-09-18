/** Shared helpers for route handlers: auth + error mapping. */
import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/server/auth";
import { getGame } from "@/server/context";
import { GameError } from "@/server/orchestrator";

export async function requirePlayer() {
  const { game, db } = await getGame();
  const player = await getCurrentPlayer(db);
  if (!player) throw new GameError("Not signed in", "forbidden");
  return { game, db, player };
}

export function errorResponse(err: unknown) {
  if (err instanceof GameError) {
    const status = err.code === "not_found" ? 404 : err.code === "forbidden" ? 401 : err.code === "ai" ? 502 : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[api] unhandled", err);
  return NextResponse.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}
