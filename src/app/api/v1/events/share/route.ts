import { DbAnalytics } from "@/server/analytics";
import { errorResponse, ok, requirePlayer } from "../../_lib";

/** Instrumentation only: the player shared (or copied) a result card. */
export async function POST(req: Request) {
  try {
    const { db, player } = await requirePlayer();
    const body = (await req.json().catch(() => ({}))) as { questId?: string };
    await new DbAnalytics(db).track(player.playerId, "result_shared", { questId: body.questId ?? null });
    return ok({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
