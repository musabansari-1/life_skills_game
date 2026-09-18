/**
 * Plays The Counter Offer end to end over HTTP exactly like a native app would:
 * bearer-token auth, JSON reads, both turn modes (JSON and SSE), conclude,
 * debrief, dossier. No cookies, no web pages.
 *
 *   pnpm dev                       # in another terminal
 *   npx tsx scripts/api-smoke.ts [baseUrl]
 */
import { createGameClient, GameApiError } from "../src/client/gameClient";

const baseUrl = process.argv[2] ?? "http://localhost:3000";

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function main() {
  let token: string | null = null;
  const api = createGameClient({ baseUrl, getToken: () => token });

  console.log(`API smoke against ${baseUrl}`);
  const anon = await api.me().catch((e) => e);
  check(anon instanceof GameApiError && anon.status === 401, "unauthenticated /me → 401");

  const session = await api.signUp({ email: `native_${Date.now()}@t.local`, password: "password123" });
  token = session.token;
  check(session.token.length > 20 && !session.player.onboardingCompleted, "signup issues a bearer token");
  await api.completeOnboarding("Native Asha");
  check((await api.me()).onboardingCompleted, "onboarding via API");

  const world = await api.world();
  check(world.worlds.length === 6 && world.skills.length === 8, "GET /world validates against contract");
  const briefing = await api.quest("counter_offer");
  check(briefing.canStart && briefing.npc.name === "Emma Kapoor", "GET /quests/:id briefing");

  const started = await api.startQuest("counter_offer", "voice");
  check(started.attempt.turns.length === 1 && started.scene.npc.voice.lang, "start quest → opening line + voice profile");
  check(!JSON.stringify(started).includes("maxBase"), "no hidden state in start response");
  check((await api.activeAttempt())?.attempt.id === started.attempt.id, "GET /attempts/active resumes the scene");

  const t1 = await api.sendTurn(started.attempt.id, { text: "Before numbers — what does the band look like, and is there anything beyond base?", modality: "voice", expectedTurnCount: 1 });
  check(t1.attempt.turns.length === 3 && t1.npcText.length > 0, "non-streaming JSON turn");

  const stale = await api.sendTurn(started.attempt.id, { text: "retry of an old request", modality: "text", expectedTurnCount: 1 }).catch((e) => e);
  check(stale instanceof GameApiError && stale.status === 409 && stale.code === "conflict", "stale retry → 409 conflict, nothing appended");
  check((await api.attempt(started.attempt.id)).attempt.turns.length === 3, "resync via GET /attempts/:id");

  const speech: string[] = [];
  const t2 = await api.streamTurn(
    started.attempt.id,
    { text: "I led a migration that cut infra spend thirty percent; the market benchmark is ten lakh. I'd like ten.", modality: "voice", expectedTurnCount: 3 },
    { onSpeech: (s) => speech.push(s) },
  );
  check(t2.turns.length === 5 && speech.length > 0, `SSE streaming turn (${speech.length} speech events)`);
  await api.sendTurn(started.attempt.id, { text: "That works — I accept.", modality: "text", expectedTurnCount: 5 });

  await api.conclude(started.attempt.id);
  const result = await api.result(started.attempt.id);
  check(result.rewards.xp.length > 0 && result.evaluation.summary.length > 0, `debrief: ${result.outcomeLabel}, ${result.rewards.xp.map((x) => `${x.skill}+${x.xp}`).join(" ")}`);

  const after = await api.world();
  check(after.career.status === "employed" && after.stateVersion > world.stateVersion, `world state persisted (${after.career.label})`);
  const emma = await api.character("emma_kapoor");
  check(emma.met && emma.history.length === 1, `Emma remembers: "${emma.lastInteractionSummary}"`);

  await api.signOut();
  const revoked = await api.me().catch((e) => e);
  check(revoked instanceof GameApiError && revoked.status === 401, "signout revokes the bearer token");
  console.log("API smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
