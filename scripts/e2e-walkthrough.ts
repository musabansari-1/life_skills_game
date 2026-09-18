/**
 * Drives the real UI end to end with Playwright against a running dev server
 * (uses the locally installed Chrome; no browser download). Saves screenshots.
 *
 *   AI_PROVIDER=fake pnpm dev -p 3001     (in another terminal)
 *   npx tsx scripts/e2e-walkthrough.ts http://localhost:3001 ./e2e-shots
 *
 * Flow: sign up → name → chapter 1 briefing (prologue) → screening → results →
 * interview (carry-over) → results → counter offer → results → world (campaign)
 * → dossier. Then a phone-width pass over world, briefing, scene and results.
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? path.join(process.cwd(), "e2e-shots");
fs.mkdirSync(out, { recursive: true });

async function playScene(page: Page, lines: string[], shot: (n: string) => Promise<void>, tag: string) {
  await page.click('button:has-text("Text only")');
  await page.waitForURL("**/play/**", { timeout: 60000 });
  await page.click('button:has-text("Begin")');
  for (const [i, line] of lines.entries()) {
    if (await page.locator('footer button:has-text("See how it went")').count()) break;
    await page.fill("footer input", line);
    await page.click('footer button:has-text("Say")');
    await page.waitForFunction(
      () => !document.querySelector("footer input[disabled]") || Array.from(document.querySelectorAll("footer button")).some((b) => b.textContent?.includes("See how it went")),
      null,
      { timeout: 90000 },
    );
    await page.waitForTimeout(300);
    if (i === 1) await shot(`${tag}-scene`);
  }
  const endBtn = page.locator('footer button:has-text("See how it went")');
  if (await endBtn.count()) {
    await shot(`${tag}-ended`);
    await endBtn.click();
  } else {
    await page.click('header button:has-text("Wrap up")');
  }
  await page.waitForTimeout(250);
  await shot(`${tag}-concluding`);
  await page.waitForURL("**/results/**", { timeout: 180000 });
  await page.waitForTimeout(3800);
  await shot(`${tag}-results`);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/hydrat|caret-color/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, caret: "initial" });
    console.log(`shot ${name}`);
  };

  await page.goto(base + "/");
  await shot("01-landing");
  await page.fill('input[name="email"]', `e2e_${Date.now()}@test.local`);
  await page.fill('input[name="password"]', "password123");
  await page.click('button:has-text("Create character")');
  await page.waitForURL("**/onboarding", { timeout: 30000 });
  await shot("02-onboarding");
  await page.fill('input[name="displayName"]', "Asha");
  await page.click('button:has-text("Enter Career City")');
  await page.waitForURL("**/quests/recruiter_screening**", { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot("03-chapter1-briefing");

  await playScene(
    page,
    ["I led a migration at my current company that cut infra spend by 30% last year.", "Honestly I'd be happy with eight lakh.", "What is the team working on right now?"],
    shot,
    "04-screening",
  );
  await page.click('a:has-text("Continue")');
  await page.waitForURL("**/quests/hiring_manager_interview");
  await page.waitForTimeout(500);
  await shot("05-interview-briefing");
  await playScene(
    page,
    [
      "Last year I shipped a migration late because I underestimated testing; I missed it and now I plan buffers and flag risk early.",
      "I'll be shipping real work in my first week, no ramp-up needed.",
      "What's the hardest thing the team is dealing with right now?",
    ],
    shot,
    "06-interview",
  );
  await page.click('a:has-text("Continue")');
  await page.waitForURL("**/quests/counter_offer");
  await page.waitForTimeout(500);
  await shot("07-offer-briefing");
  await playScene(
    page,
    [
      "Thanks for the call. Before numbers, what does the band look like, and is there anything beyond base?",
      "In my current role I led a migration that cut infra spend by 30%, and the market range is ten lakh. I'd like ten lakh.",
      "Beyond base, is there flexibility on a joining bonus?",
      "That works for me. I accept.",
    ],
    shot,
    "08-offer",
  );
  await page.goto(base + "/world");
  await page.waitForTimeout(800);
  await shot("09-world");
  await page.goto(base + "/characters/emma_kapoor");
  await page.waitForTimeout(500);
  await shot("10-dossier");
  await page.goto(base + "/quests/first_day_nova_labs");
  await page.waitForTimeout(500);
  await shot("11-firstday-briefing");
  const resultsUrl = await (async () => {
    await page.goto(base + "/characters/emma_kapoor");
    const href = await page.locator('a[href^="/results/"]').last().getAttribute("href");
    return href ? base + href : null;
  })();

  // Phone pass
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  const widths: string[] = [];
  const mshot = async (name: string, full = true) => {
    widths.push(`${name}:${await mp.evaluate(() => document.documentElement.scrollWidth)}`);
    await mp.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  };
  await mp.goto(base + "/world");
  await mp.waitForTimeout(800);
  await mshot("m1-world");
  await mp.goto(base + "/quests/first_day_nova_labs");
  await mp.waitForTimeout(500);
  await mshot("m2-briefing");
  if (resultsUrl) {
    await mp.goto(resultsUrl);
    await mp.waitForTimeout(3800);
    await mshot("m3-results");
  }
  await mp.goto(base + "/quests/first_day_nova_labs");
  await mp.click('button:has-text("Enter the scene")');
  await mp.waitForURL("**/play/**", { timeout: 60000 });
  await mp.waitForTimeout(400);
  await mshot("m4-scene-begin", false);
  await mp.click('button:has-text("Pick up")');
  await mp.waitForTimeout(400);
  await mshot("m5-scene", false);
  console.log("phone scrollWidths (should all be 390):", widths.join(" "));

  console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no browser errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
