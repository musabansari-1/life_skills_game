/**
 * POST /api/v1/attempts/:id/delivery — the player cut the NPC's last line off
 * and did NOT follow it with a line of their own (silence, or they left).
 *
 * Body: DeliveryReport { turnIndex, heardText }. The server keeps only the
 * heard prefix as canon and re-derives the scene from it. When the player does
 * follow with a line, clients send the report inside TurnRequest.interrupted
 * instead (one round trip, ordered). Idempotent: a repeat or stale report is a no-op.
 */
import { DeliveryReportSchema, type DeliveryResponse } from "@/contracts/api";
import { toClientAttempt } from "@/server/queries";
import { errorResponse, ok, parseBody, requirePlayer } from "../../../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/delivery">) {
  try {
    const deps = await requirePlayer();
    const body = await parseBody(req, DeliveryReportSchema);
    const { id } = await ctx.params;
    const attempt = await deps.game.reportDelivery(deps.player.playerId, id, body);
    const res: DeliveryResponse = { attempt: toClientAttempt(attempt) };
    return ok(res);
  } catch (err) {
    return errorResponse(err);
  }
}
