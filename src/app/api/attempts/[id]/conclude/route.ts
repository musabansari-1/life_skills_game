import { NextResponse } from "next/server";
import { errorResponse, requirePlayer } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, ctx: RouteContext<"/api/attempts/[id]/conclude">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    const attempt = await game.concludeQuest(player.playerId, id);
    return NextResponse.json({ attemptId: attempt.id, status: attempt.status });
  } catch (err) {
    return errorResponse(err);
  }
}
