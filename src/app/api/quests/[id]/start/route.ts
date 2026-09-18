import { NextResponse } from "next/server";
import { errorResponse, requirePlayer } from "../../../_lib";

export async function POST(req: Request, ctx: RouteContext<"/api/quests/[id]/start">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    const body = (await req.json().catch(() => ({}))) as { modality?: "voice" | "text" };
    const attempt = await game.startQuest(player.playerId, id, body.modality === "voice" ? "voice" : "text");
    return NextResponse.json({ attemptId: attempt.id });
  } catch (err) {
    return errorResponse(err);
  }
}
