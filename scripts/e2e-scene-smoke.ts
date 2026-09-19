/**
 * Focused browser check of the conversation screen against a running dev
 * server (real provider or fake), using the locally installed Chrome. No
 * microphone is available to Playwright, so this verifies the text path, the
 * caption/transcript/status behaviour, the voice-mode UI states, the mic
 * failure path and (when the headless TTS engine is slow enough) the
 * interrupted-opening path. Prints observations; exits non-zero on page errors.
 *
 *   npx tsx scripts/e2e-scene-smoke.ts http://localhost:3000 ./e2e-shots
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? path.join(process.cwd(), "e2e-shots");
fs.mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, // Fake capture device: never listen to the real microphone of the machine running the check.
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/hydrat|caret-color|favicon/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(out, `${name}.png`), caret: "initial" });
    console.log(`shot ${name}`);
  };
  const note = (s: string) => console.log(`  ${s}`);

  await page.goto(base + "/");
  await page.fill('input[name="email"]', `scene_${Date.now()}@test.local`);
  await page.fill('input[name="password"]', "password123");
  await page.click('button:has-text("Create character")');
  await page.waitForURL("**/onboarding", { timeout: 30000 });
  await page.fill('input[name="displayName"]', "Asha");
  await page.click('button:has-text("Enter Career City")');
  await page.waitForURL("**/quests/recruiter_screening**", { timeout: 30000 });

  // ---- Voice mode UI: opening spoken (headless TTS), mic failure path, interruption by typing.
  await page.click('button:has-text("Enter the scene")');
  await page.waitForURL("**/play/**", { timeout: 60000 });
  await page.click('button:has-text("Pick up")');
  await page.waitForTimeout(400);
  await shot("scene-voice-opening");
  const stateLabel = async () => (await page.locator("footer p.text-xs").first().textContent().catch(() => "")) ?? "";
  note(`after Pick up: "${await stateLabel()}"`);
  const orbState = await page.locator(".orb").getAttribute("data-state");
  note(`orb state: ${orbState}`);

  // Type while the opening is (possibly) still being spoken: exercises the interruption report.
  await page.click('button:has-text("Type instead")').catch(() => {});
  const typing = (await page.locator("footer input").count()) > 0;
  note(`text input available in voice mode: ${typing}`);
  await page.fill("footer input", "Hi Emma, thanks for making time. I've been working on platform infrastructure for four years.");
  const t0 = Date.now();
  await page.click('footer button:has-text("Say")');
  // Caption should appear progressively (thinking dots, then text).
  let firstCaptionAt = 0;
  let firstCaption = "";
  for (let i = 0; i < 300; i++) {
    const cap = (await page.locator("main section p.font-display.text-center").textContent()) ?? "";
    if (cap.trim() && !/^[·\s]+$/.test(cap.trim())) {
      firstCaptionAt = Date.now() - t0;
      firstCaption = cap.trim();
      break;
    }
    await page.waitForTimeout(100);
  }
  note(`first caption after ${firstCaptionAt} ms: "${firstCaption.slice(0, 80)}"`);
  await page.waitForTimeout(600);
  await shot("scene-voice-mid-reply");
  // Wait until Emma has finished saying her reply (idle again), then inspect the canonical transcript.
  const tSpeak = Date.now();
  await page.waitForFunction(() => /Tap to reply|Tap and talk/.test(document.querySelector("footer p.text-xs")?.textContent ?? ""), null, { timeout: 120000 });
  note(`reply finished speaking ${Date.now() - tSpeak} ms after the mid-reply shot`);
  await shot("scene-voice-after-turn");
  await page.click('header button:has-text("Transcript"), header button:has-text("Log")');
  await page.waitForTimeout(200);
  const transcript = (await page.locator("aside ol").textContent()) ?? "";
  note(`transcript has ${await page.locator("aside li").count()} lines; interrupted opening: ${/you cut in/.test(transcript)}`);
  note(`transcript: ${transcript.replace(/\s+/g, " ").slice(0, 400)}`);
  await shot("scene-voice-transcript");
  await page.click('aside button:has-text("Close")');

  // Mic tap in headless Chrome: no device → the error path, and text remains usable.
  await page.click('footer button[aria-pressed]');
  await page.waitForTimeout(1500);
  const alert = (await page.locator('footer [role="alert"]').textContent().catch(() => "")) ?? "";
  note(`mic tap in headless: state "${await stateLabel()}" alert "${alert.trim().slice(0, 90)}"`);
  await shot("scene-voice-mic-error");
  await page.fill("footer input", "I'd be happy around eight lakh, based on the market for this profile.");
  await page.click('footer button:has-text("Say")');
  await page.waitForFunction(() => !document.querySelector("footer input[disabled]"), null, { timeout: 90000 });
  note("second line sent after the mic error: ok");

  // Leave the scene cleanly.
  await page.click('header button:has-text("Leave")');
  await page.click('.card button:has-text("Leave")');
  await page.waitForURL("**/world", { timeout: 30000 });
  await shot("scene-left");

  console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join("\n")}` : "\nno page errors");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
