/**
 * POST /api/v1/attempts/:id/conclude — resolve the scene (evaluation, outcome,
 * rewards, memory, consequences). Takes ~10-120 s depending on the model.
 *
 * Content negotiation:
 *   Accept: text/event-stream → SSE with real progress so the UI never looks frozen:
 *       event: progress  data: {"stage": "reviewing" | "remembering" | "evaluated" | "applying" | "done"}
 *       event: result    data: {"attemptId", "status"}
 *       event: error     data: ApiError
 *   otherwise           → one JSON {attemptId, status}
 * Idempotent once completed; a concurrent conclude gets 409.
 */
import { errorResponse, ok, requirePlayer, toApiError } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request, ctx: RouteContext<"/api/v1/attempts/[id]/conclude">) {
  let deps;
  try {
    deps = await requirePlayer();
  } catch (err) {
    return errorResponse(err);
  }
  const { id } = await ctx.params;
  const wantsStream = (req.headers.get("accept") ?? "").includes("text/event-stream");

  if (!wantsStream) {
    try {
      const attempt = await deps.game.concludeQuest(deps.player.playerId, id);
      return ok({ attemptId: attempt.id, status: attempt.status });
    } catch (err) {
      return errorResponse(err);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away; the conclusion still completes server-side
        }
      };
      // Heartbeat keeps proxies and mobile networks from dropping a quiet connection.
      const beat = setInterval(() => send("progress", { stage: "working" }), 15000);
      try {
        const attempt = await deps.game.concludeQuest(deps.player.playerId, id, (stage) => send("progress", { stage }));
        send("result", { attemptId: attempt.id, status: attempt.status });
      } catch (err) {
        send("error", toApiError(err));
      } finally {
        clearInterval(beat);
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
