/** Targeted browser review on an isolated local fixture database, never the player's database.
 * Server and script: AI_PROVIDER=fake DATABASE_URL=file:./data/director-qa.db, with the same SESSION_SECRET.
 * Start the app on 3011, then: npx tsx scripts/e2e-director.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/db/client";
import { env } from "../src/lib/env";
import { registerAccount, onboardPlayer } from "../src/server/account";
import { saveCompetencies, saveNpcState, saveWorldState } from "../src/server/player";
import { simulatedProfiles } from "../src/engine/director/simulations";
import { SESSION_COOKIE } from "../src/server/auth";

async function main() {
  if (env.DATABASE_URL !== "file:./data/director-qa.db" || env.AI_PROVIDER !== "fake") throw new Error("Use the isolated director-qa database and fake provider.");
  const base = "http://127.0.0.1:3011";
  const db = await getDb();
  const account = await registerAccount(db, { email: `director_${Date.now()}@test.local`, password: "fixture-password-only" });
  const id = account.player.playerId;
  await onboardPlayer(db, id, { displayName: "Asha" });
  const fixture = simulatedProfiles().D_ready_for_responsibility;
  await saveWorldState(db, id, fixture.world);
  await saveCompetencies(db, id, fixture.competencies);
  for (const npc of Object.values(fixture.npcs)) if (npc) await saveNpcState(db, id, npc);
  const out = path.join(process.cwd(), "e2e-shots", "director");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/world`);
    await page.getByRole("heading", { name: "Put My Name Behind It" }).waitFor();
    await page.getByRole("button", { name: "See what's waiting" }).click();
    await page.getByRole("link", { name: "See the situation" }).waitFor();
    await page.getByText("Why this appeared", { exact: true }).click();
    await page.screenshot({ path: path.join(out, "world-desktop.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "See the situation" }).click();
    await page.getByRole("heading", { name: "Put My Name Behind It" }).waitFor();
    if (!(await page.getByText("A conversation that matters", { exact: true }).count())) throw new Error("Missing boss stakes");
    await page.screenshot({ path: path.join(out, "boss-briefing.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Text only", exact: true }).click();
    await page.waitForURL("**/play/**");
    const live = await page.request.get(`${base}/api/v1/attempts/active`);
    const envelope = await live.json();
    if (envelope.active?.scene.quest.title !== "Put My Name Behind It") throw new Error("Live scene lost personalized title");
    const abandon = await page.request.post(`${base}/api/v1/attempts/${envelope.active.attempt.id}/abandon`, { data: {} });
    if (!abandon.ok()) throw new Error("Could not close fixture scene");
    await page.goto(`${base}/world`);
    await page.getByRole("checkbox", { name: "Listen under pressure" }).check();
    await page.getByRole("button", { name: "Save my focus" }).click();
    await page.getByRole("status").filter({ hasText: "Your next situation" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "world-mobile.png"), fullPage: true, animations: "disabled" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error("World page overflows on mobile");
    await page.goto(`${base}/characters/emma_kapoor`);
    await page.getByText("trusted ally", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, "character-mobile.png"), fullPage: true, animations: "disabled" });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("PASS: desktop/mobile narrative, materialization, boss briefing, live pinned title, goal save, character arc; no page errors or mobile overflow.");
    console.log(`Screenshots: ${out}`);
  } finally { await browser.close(); }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
