/**
 * Drives the real UI end to end with Playwright against a running dev server
 * (uses the locally installed Chrome; no browser download). Saves screenshots.
 *   pnpm dev   (in another terminal, AI_PROVIDER=fake is fine)
 *   npx tsx scripts/e2e-walkthrough.ts [baseUrl] [outDir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? path.join(process.cwd(), "e2e-shots");
fs.mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    console.log(`shot ${name}`);
  };

  const email = `e2e_${Date.now()}@test.local`;
  await page.goto(base + "/");
  await shot("01-landing");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "password123");
  await page.click('button:has-text("Create character")');
  await page.waitForURL("**/onboarding", { timeout: 30000 });
  await shot("02-onboarding");
  await page.fill('input[name="displayName"]', "Asha");
  await page.click('button:has-text("Enter Career City")');
  await page.waitForURL("**/world", { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot("03-world");

  await page.click('a[href="/quests/counter_offer"]');
  await page.waitForURL("**/quests/counter_offer");
  await page.waitForTimeout(500);
  await shot("04-briefing");

  await page.click('button:has-text("Text only")');
  await page.waitForURL("**/play/**", { timeout: 60000 });
  await page.waitForTimeout(500);
  await shot("05-scene-begin");
  await page.click('button:has-text("Begin")');
  await page.waitForTimeout(400);
  await shot("06-scene");

  const lines = [
    "Hi Emma, thanks for the call. Before numbers, can I ask what the band looks like and whether there's anything beyond base?",
    "In my current role I led the migration that cut infra spend by thirty percent, and the market benchmark is around ten lakh. I'd like to be at ten.",
    "If base is capped, is there room on a joining bonus to close the gap?",
    "That works. I accept — thank you.",
  ];
  for (const [i, line] of lines.entries()) {
    await page.fill('footer input', line);
    await page.click('footer button:has-text("Say")');
    // Wait until the NPC has replied: input re-enabled, or the scene ended ("See how it went").
    await page.waitForFunction(
      () => !document.querySelector("footer input[disabled]") || Array.from(document.querySelectorAll("header button")).some((b) => b.textContent?.includes("See how it went")),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(300);
    if (i === 1) await shot("07-scene-mid");
    if (await page.locator('header button:has-text("See how it went")').count()) {
      await shot("07b-scene-ended");
      break;
    }
  }
  await page.click('header button:has-text("Transcript")');
  await page.waitForTimeout(300);
  await shot("08-scene-transcript");
  await page.click('button:has-text("Close")');

  await page.click('header button:has-text("See how it went"), header button:has-text("Wrap up")');
  await page.waitForURL("**/results/**", { timeout: 120000 });
  await page.waitForTimeout(3600);
  await shot("09-results");

  await page.click('a:has-text("Continue")');
  await page.waitForURL("**/quests/first_day_nova_labs");
  await page.waitForTimeout(400);
  await shot("10-followup-briefing");
  await page.goto(base + "/characters/emma_kapoor");
  await page.waitForTimeout(400);
  await shot("11-dossier");
  await page.goto(base + "/world");
  await page.waitForTimeout(600);
  await shot("12-world-after");

  // Mobile pass
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(base + "/world");
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: path.join(out, "m1-world.png"), fullPage: true });
  await mp.goto(base + "/quests/counter_offer");
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: path.join(out, "m2-briefing.png"), fullPage: true });
  await mp.click('button:has-text("Text only")');
  await mp.waitForURL("**/play/**", { timeout: 60000 });
  await mp.waitForTimeout(400);
  await mp.click('button:has-text("Begin")');
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(out, "m3-scene.png") });
  console.log("mobile shots done");

  console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no browser errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
