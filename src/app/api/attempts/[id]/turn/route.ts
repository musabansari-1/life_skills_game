/**
 * POST /api/attempts/:id/turn — submit a player utterance, stream the NPC reply.
 *
 * Server-Sent Events:
 *   event: speech   data: {"text": "...so far...", "done": false}
 *   event: result   data: { attempt summary for the client }
 *   event: error    data: {"error": "..."}
 */
import { errorResponse, requirePlayer } from "../../../_lib";
import { toClientAttempt } from "../../../../play/[attemptId]/client-types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/attempts/[id]/turn">) {
  let deps;
  try {
    deps = await requirePlayer();
  } catch (err) {
    return errorResponse(err);
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { text?: string; modality?: "voice" | "text" };
  const text = (body.text ?? "").toString();
  const modality = body.modality === "voice" ? "voice" : "text";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const { attempt } = await deps.game.submitPlayerTurn(deps.player.playerId, id, text, modality, (speechSoFar, done) => send("speech", { text: speechSoFar, done }));
        send("result", toClientAttempt(attempt));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
