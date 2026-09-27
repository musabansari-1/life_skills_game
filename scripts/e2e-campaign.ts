/** Run against a production server on 3012 with the same isolated database, fake provider and session secret. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/db/client";
import { env } from "../src/lib/env";
import { simulateCampaignPath, CRISIS_PLAN } from "../src/server/campaign-simulation";
import { onboardPlayer, registerAccount } from "../src/server/account";
import { SESSION_COOKIE } from "../src/server/auth";
import { GameService } from "../src/server/orchestrator";
import { FakeProvider } from "../src/ai/providers/fake";
import { MemoryAILogSink } from "../src/ai/logger";
import { MemoryAnalytics } from "../src/server/analytics";

async function main() {
  if (env.DATABASE_URL !== "file:./data/campaign-qa.db" || env.AI_PROVIDER !== "fake") throw new Error("Use only the isolated campaign-qa database and fake provider.");
  const db = await getDb(), base = "http://127.0.0.1:3012";
  const fixture = await simulateCampaignPath(db, "strong");
  await onboardPlayer(db, fixture.playerId, { displayName: "Asha" });
  const out = path.join(process.cwd(), "e2e-shots", "campaign"); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: fixture.account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/world`);
    await page.getByRole("heading", { name: fixture.state.world.campaign.ending!.professional, exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, "ending-desktop.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "ending-mobile.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("region", { name: "Career City campaign" }).screenshot({ path: path.join(out, "ending-card-mobile.png"), animations: "disabled" });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Ending overflows on mobile");
    await page.goto(`${base}/results/${fixture.reviewAttemptId}`);
    await page.getByRole("link", { name: "See the story you shaped" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("main section.opacity-0"));
    await page.getByText(/Asked first, then moved|lead trial/i).first().waitFor();
    await page.screenshot({ path: path.join(out, "boss-debrief-mobile.png"), fullPage: true, animations: "disabled" });
    await page.goto(`${base}/characters/maya_sen`);
    await page.getByText("The Project Crisis", { exact: true }).first().waitFor();
    await page.goto(`${base}/quests/project_crisis`);
    await page.getByRole("heading", { name: "The Project Crisis", exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, "boss-briefing-mobile.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Text only", exact: true }).click();
    await page.waitForURL("**/play/**"); await page.getByRole("button", { name: "Begin", exact: true }).click();
    for (const [index, line] of CRISIS_PLAN.slice(0, 3).entries()) {
      await page.getByPlaceholder(/Say something to/).fill(line);
      await page.getByRole("button", { name: "Say", exact: true }).click();
      await page.getByPlaceholder(/Say something to/).waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[placeholder^="Say something to"]')?.disabled);
      const expected = ["Rohan Mehta", "Nora Shah", "Maya Sen"][index];
      await page.getByText(expected, { exact: true }).first().waitFor();
    }
    await page.screenshot({ path: path.join(out, "multi-npc-mobile.png"), fullPage: true, animations: "disabled" });
    await page.reload(); await page.getByRole("button", { name: "Begin", exact: true }).click();
    await page.getByText("Maya Sen", { exact: true }).first().waitFor();
    const active = (await (await page.request.get(`${base}/api/v1/attempts/active`)).json()).active;
    if (active.attempt.turns.at(-1).identity.npcId !== "maya_sen") throw new Error("Speaker identity lost after reload");
    const reaction = page.waitForResponse((response) => response.url().endsWith("/react") && response.request().method() === "POST");
    await page.getByPlaceholder(/Say something to/).fill("Rohan, I promise the full migration today and everyone can do overtime.");
    await page.getByRole("button", { name: "Say", exact: true }).click();
    const reactionResponse = await reaction;
    if (!reactionResponse.ok()) throw new Error(`Reaction failed: ${reactionResponse.status()}`);
    const reacted = (await (await page.request.get(`${base}/api/v1/attempts/active`)).json()).active;
    const reactionTurn = reacted.attempt.turns.at(-1);
    if (!reactionTurn.identity?.autonomous || reactionTurn.identity.npcId !== "maya_sen" || reactionTurn.identity.addressedTo !== "rohan_mehta") throw new Error("Expected Maya to challenge Rohan after the unsafe promise");
    if (reacted.attempt.reactionAvailable) throw new Error("Reaction did not yield the floor to the player");
    await page.getByText("Maya Sen", { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(out, "npc-reaction-mobile.png"), fullPage: true, animations: "disabled" });
    await page.request.post(`${base}/api/v1/attempts/${active.attempt.id}/abandon`, { data: {} });

    const account = await registerAccount(db, { email: `recovery_${Date.now()}@test.local`, password: "fixture-password-only" });
    await onboardPlayer(db, account.player.playerId, { displayName: "Sam" });
    const game = new GameService({ db, provider: new FakeProvider(), aiLog: new MemoryAILogSink(), analytics: new MemoryAnalytics() });
    let failed = await game.startQuest(account.player.playerId, "recruiter_screening");
    for (const line of ["This is an insult, take it or leave it.", "Unacceptable. Non-negotiable. Final offer.", "You're wasting my time. Final offer.", "Take it or leave it."]) {
      if (failed.scene.ended) break;
      failed = (await game.submitPlayerTurn(account.player.playerId, failed.id, line, "text")).attempt;
    }
    const result = await game.concludeQuest(account.player.playerId, failed.id);
    if (result.result?.grade !== "failure") throw new Error("Recovery fixture did not fail");
    await context.clearCookies();
    await context.addCookies([{ name: SESSION_COOKIE, value: account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/world`);
    await page.getByRole("link", { name: "Open the recovery conversation" }).waitFor();
    await page.screenshot({ path: path.join(out, "recovery-mobile.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Open the recovery conversation" }).click();
    await page.getByRole("heading", { name: "One More Call", exact: true }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Recovery briefing overflows on mobile");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`PASS: ending desktop/mobile, ending debrief link, Maya history, boss briefing, three live speakers, reload identity, autonomous NPC reaction, failure-to-recovery UI. Screenshots: ${out}`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
