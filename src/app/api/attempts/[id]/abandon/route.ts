import { NextResponse } from "next/server";
import { errorResponse, requirePlayer } from "../../../_lib";

export async function POST(_req: Request, ctx: RouteContext<"/api/attempts/[id]/abandon">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    await game.abandonQuest(player.playerId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
