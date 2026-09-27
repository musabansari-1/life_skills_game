/**
 * V1 Career City browser walkthrough (desktop + 390px mobile).
 * Run against a production server on 3012 with the isolated QA database, fake provider and the same SESSION_SECRET:
 *   DATABASE_URL=file:./data/campaign-qa.db AI_PROVIDER=fake SESSION_SECRET=… npx next start -p 3012
 *   DATABASE_URL=file:./data/campaign-qa.db AI_PROVIDER=fake SESSION_SECRET=… npx tsx scripts/e2e-v1.ts
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/db/client";
import { env } from "../src/lib/env";
import { simulateCampaignPath } from "../src/server/campaign-simulation";
import { onboardPlayer } from "../src/server/account";
import { SESSION_COOKIE } from "../src/server/auth";

const base = "http://127.0.0.1:3012";
const out = path.join(process.cwd(), "e2e-shots", "v1");

async function main() {
  if (env.DATABASE_URL !== "file:./data/campaign-qa.db" || env.AI_PROVIDER !== "fake") throw new Error("Use only the isolated campaign-qa database and fake provider.");
  fs.mkdirSync(out, { recursive: true });
  const db = await getDb();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  const checks: string[] = [];
  const pass = (m: string) => { checks.push(m); console.log(`  ✓ ${m}`); };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/hydrat|caret-color|favicon/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
    const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, animations: "disabled" });
    const mobile = async (name: string) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`${name} overflows horizontally on mobile`);
      await shot(`${name}-mobile`);
      await page.setViewportSize({ width: 1440, height: 1000 });
    };

    // A. A brand-new player: sign up → name → straight into the first call.
    console.log("A. New player");
    await page.goto(`${base}/`);
    await page.fill('input[name="email"]', `v1_${Date.now()}@test.local`);
    await page.fill('input[name="password"]', "password123");
    await page.click('button:has-text("Create character")');
    await page.waitForURL("**/onboarding");
    await page.getByText("your first call with their recruiter is booked").waitFor();
    await page.fill('input[name="displayName"]', "Asha");
    await page.click('button:has-text("Enter Career City")');
    await page.waitForURL("**/quests/recruiter_screening**");
    await page.getByText("Monday, 11:00").waitFor();
    await page.getByText("This is a world, not a course.").waitFor();
    await page.getByText(/Act I · Chapter 1 of 13/).waitFor();
    pass("onboarding lands on the first chapter with its transition and act");
    await shot("a1-first-briefing"); await mobile("a1-first-briefing");
    await playInUi(page, ["I led a migration that cut infra spend by 30% last year.", "I'd rather understand the role first. What range do you have budgeted?", "What is the team working on right now?"]);
    await page.getByText("It landed").first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector("main section.opacity-0"), null, { timeout: 15000 });
    await page.getByText("Three days later").waitFor();
    pass("first result names what's next with a narrative transition");
    await shot("a2-first-result"); await mobile("a2-first-result");
    await page.goto(`${base}/world`);
    await page.getByRole("heading", { name: "Act I: Get in" }).waitFor();
    await page.getByRole("region", { name: "Next in your story" }).getByText("The Hiring Manager").first().waitFor().catch(async () => { await page.getByRole("region", { name: "Next in your story" }).waitFor(); });
    await page.getByText("Your story so far").waitFor().catch(() => undefined);
    pass("home screen shows the act, the next chapter and the act track");
    await shot("a3-world-early"); await mobile("a3-world-early");

    // B. Mid-season: Acts 1–2 played by the "strong" persona, standing before the Meridian call.
    console.log("B. Mid-season");
    const mid = await simulateCampaignPath(db, "strong", { stopBefore: "customer_escalation" });
    await onboardPlayer(db, mid.playerId, { displayName: "Asha" });
    await context.clearCookies();
    await context.addCookies([{ name: SESSION_COOKIE, value: mid.account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/world`);
    await page.getByRole("heading", { name: "Act III: Consequences" }).waitFor();
    await page.getByRole("region", { name: "Next in your story" }).getByText("The Meridian Call").waitFor();
    await page.getByText("A conversation that matters").first().waitFor();
    await page.getByText("Your story so far").waitFor();
    await page.getByText(/Asked what Meridian actually needed/).first().waitFor();
    pass("mid-season home: Act III, Boss 2 marked, recap of real moments");
    await shot("b1-world-mid"); await mobile("b1-world-mid");
    await page.goto(`${base}/quests/customer_escalation`);
    await page.getByRole("heading", { name: "The Meridian Call" }).waitFor();
    await page.getByText("Ten days later").waitFor();
    await page.getByText(/renewal is six weeks out/).waitFor();
    await page.getByText(/That was you/).waitFor();
    pass("Boss 2 briefing: stakes, approaches and carry-over from Act 2");
    await shot("b2-meridian-briefing"); await mobile("b2-meridian-briefing");
    await playInUi(page, [
      "Vikram, what happened is we missed: the migration went wrong on our side, and I own that.",
      "Vikram, what does your team need at month-end?",
      "Here's the protection: a change freeze in close week and a verified export on the 28th, with a go/no-go call.",
    ], async () => {
      await page.getByText("Vikram Rao", { exact: true }).first().waitFor();
      await shot("b3-meridian-scene"); await mobile("b3-meridian-scene");
    });
    await page.waitForURL("**/results/**");
    await page.waitForFunction(() => !document.querySelector("main section.opacity-0"), null, { timeout: 15000 });
    await page.getByText("A plan Vikram can check").first().waitFor();
    await page.getByText("Vikram Rao").first().waitFor();
    pass("Boss 2 played in the UI with two live speakers; result shows both relationships");
    await shot("b4-meridian-result"); await mobile("b4-meridian-result");

    // C. A strong full season: the ending.
    console.log("C. Strong ending");
    const strong = await simulateCampaignPath(db, "strong");
    await onboardPlayer(db, strong.playerId, { displayName: "Asha" });
    await context.clearCookies();
    await context.addCookies([{ name: SESSION_COOKIE, value: strong.account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/results/${strong.reviewAttemptId}`);
    await page.getByRole("link", { name: "See the story you shaped" }).waitFor();
    await shot("c1-review-result"); await mobile("c1-review-result");
    await page.goto(`${base}/world`);
    const ending = strong.state.world.campaign.ending!;
    await page.getByRole("heading", { name: ending.professional, exact: true }).waitFor();
    for (const t of ["Season one complete", "Defining moments", "The people you leave with", "Strongest growth", "Coming next", ending.tease!.title]) await page.getByText(t, { exact: false }).first().waitFor();
    pass(`strong ending renders: ${ending.professional} / ${ending.identity}`);
    await shot("c2-ending"); await mobile("c2-ending");

    // D. A weak full season: a different, honest ending.
    console.log("D. Weak ending");
    const weak = await simulateCampaignPath(db, "weak");
    await onboardPlayer(db, weak.playerId, { displayName: "Sam" });
    await context.clearCookies();
    await context.addCookies([{ name: SESSION_COOKIE, value: weak.account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/world`);
    const weakEnding = weak.state.world.campaign.ending!;
    await page.getByRole("heading", { name: weakEnding.professional, exact: true }).waitFor();
    await page.getByText(weakEnding.identity).first().waitFor();
    pass(`weak ending renders differently: ${weakEnding.professional} / ${weakEnding.identity}`);
    await shot("d1-weak-ending"); await mobile("d1-weak-ending");
    await page.goto(`${base}/characters/maya_sen`);
    await page.getByText("Maya Sen").first().waitFor();
    await mobile("d2-maya-dossier-weak");

    if (errors.length) throw new Error(`Page errors:\n${errors.join("\n")}`);
    console.log(`PASS (${checks.length} checks). Screenshots: ${out}`);
  } finally { await browser.close(); }
}

async function playInUi(page: Page, lines: string[], midScene?: () => Promise<void>) {
  await page.click('button:has-text("Text only")');
  await page.waitForURL("**/play/**", { timeout: 60000 });
  await page.click('button:has-text("Begin")');
  for (const [i, line] of lines.entries()) {
    if (await page.locator('footer button:has-text("See how it went")').count()) break;
    await page.fill("footer input", line);
    await page.click('footer button:has-text("Say")');
    await page.waitForFunction(() => !document.querySelector("footer input[disabled]") || Array.from(document.querySelectorAll("footer button")).some((b) => b.textContent?.includes("See how it went")), null, { timeout: 90000 });
    await page.waitForTimeout(400);
    if (i === 1 && midScene) await midScene();
  }
  const end = page.locator('footer button:has-text("See how it went")');
  if (await end.count()) await end.click(); else await page.click('header button:has-text("Wrap up")');
  await page.waitForURL("**/results/**", { timeout: 180000 });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
