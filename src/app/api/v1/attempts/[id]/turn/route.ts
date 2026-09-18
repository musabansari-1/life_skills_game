/**
 * POST /api/v1/attempts/:id/turn — submit a player utterance, get the NPC reply.
 *
 * Content negotiation (so every client platform works):
 *   Accept: text/event-stream  → Server-Sent Events (web; native with a streaming fetch)
 *       event: speech  data: {"text": "...so far...", "done": false}
 *       event: result  data: ClientAttempt
 *       event: error   data: ApiError
 *   anything else              → one JSON TurnResponse { attempt, npcText } (plain RN fetch)
 *
 * Body: TurnRequest { text, modality, expectedTurnCount? }. When
 * expectedTurnCount doesn't match the server, the reply is 409 and the client
 * should GET /attempts/:id to resync (safe retries on flaky networks).
 */
import { TurnRequestSchema, type TurnResponse } from "@/contracts/api";
import { toClientAttempt } from "@/server/queries";
import { errorResponse, ok, parseBody, requirePlayer, toApiError } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/turn">) {
  let deps;
  let body;
  try {
    deps = await requirePlayer();
    body = await parseBody(req, TurnRequestSchema);
  } catch (err) {
    return errorResponse(err);
  }
  const { id } = await ctx.params;
  const opts = { expectedTurnCount: body.expectedTurnCount };
  const wantsStream = (req.headers.get("accept") ?? "").includes("text/event-stream");

  if (!wantsStream) {
    try {
      const { attempt, npcText } = await deps.game.submitPlayerTurn(deps.player.playerId, id, body.text, body.modality, undefined, opts);
      const res: TurnResponse = { attempt: toClientAttempt(attempt), npcText };
      return ok(res);
    } catch (err) {
      return errorResponse(err);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const { attempt } = await deps.game.submitPlayerTurn(deps.player.playerId, id, body.text, body.modality, (speechSoFar, done) => send("speech", { text: speechSoFar, done }), opts);
        send("result", toClientAttempt(attempt));
      } catch (err) {
        send("error", toApiError(err));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
