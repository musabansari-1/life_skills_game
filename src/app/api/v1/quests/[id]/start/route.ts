import { StartQuestRequestSchema } from "@/contracts/api";
import { attemptEnvelope } from "@/server/queries";
import { errorResponse, ok, parseBody, requirePlayer } from "../../../_lib";

export const maxDuration = 60;

/** Start a scene. Returns { attempt, scene } including the NPC's opening line. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/quests/[id]/start">) {
  try {
    const { id } = await ctx.params;
    const { game, player } = await requirePlayer();
    const body = await parseBody(req, StartQuestRequestSchema);
    const attempt = await game.startQuest(player.playerId, id, body.modality, body.mode);
    return ok(attemptEnvelope(attempt), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
