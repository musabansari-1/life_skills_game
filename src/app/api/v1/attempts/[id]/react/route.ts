import { ReactionRequestSchema } from "@/contracts/api";
import { attemptEnvelope } from "@/server/queries";
import { errorResponse, ok, parseBody, requirePlayer } from "../../../_lib";

export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await requirePlayer();
    const body = await parseBody(req, ReactionRequestSchema);
    const { id } = await ctx.params;
    return ok(attemptEnvelope(await deps.game.continueEnsemble(deps.player.playerId, id, body.expectedTurnCount)));
  } catch (error) { return errorResponse(error); }
}
