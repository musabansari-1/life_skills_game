/** Local development inspection; intentionally not an admin API or public reasoning endpoint. */
import { getDb } from "../src/db/client";
import { loadPlayerState } from "../src/server/player";

async function main() {
  const playerId = process.argv[2];
  if (!playerId) throw new Error("Usage: tsx scripts/director-inspect.ts <player-id> (set DATABASE_URL for your development database)");
  const { world } = await loadPlayerState(await getDb(), playerId);
  console.log(JSON.stringify({ clock: world.director.clock, recommendation: world.director.recommended?.id, audits: world.director.audits, chains: world.director.threads.map((t) => ({ id: t.id, stage: t.stage, status: t.status, sourceAttemptId: t.sourceAttemptId, sourceDecisionId: t.sourceDecisionId, resolvedByAttemptId: t.resolvedByAttemptId })) }, null, 2));
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
