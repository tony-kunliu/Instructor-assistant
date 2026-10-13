// Real-browser check of the GPS Lab harness (P4-A spike) at phone widths. Chromium's geolocation is
// emulated (context.setGeolocation) and page visibility is simulated — REAL iPhone background/lock
// behaviour cannot be established here (see docs/GPS_PWA_FEASIBILITY.md).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const B = process.env.QA_BASE;
const OUT = process.env.QA_OUT;
const CHROMIUM = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const results = [];
const check = (name, ok, extra = "") => results.push({ ok: Boolean(ok), line: `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}` });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROMIUM });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const undersized = (page) =>
  page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select, textarea, summary")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5);
  }).map((el) => `${el.tagName}"${(el.textContent || "").trim().slice(0, 16)}"`));
const setVisibility = (page, state) =>
  page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

async function drive(ctx, page, n) {
  for (let i = 0; i < n; i++) {
    await ctx.setGeolocation({ latitude: -35.28 + i * 0.0004, longitude: 149.13 + i * 0.0004, accuracy: 9 });
    await settle(450);
  }
}

try {
  for (const width of [375, 390]) {
    const W = `${width}px`;
    const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height: 812 }, geolocation: { latitude: -35.28, longitude: 149.13, accuracy: 9 }, permissions: ["geolocation"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${B}/gps-lab`);
    await page.waitForSelector("[data-testid=lab-start]");
    check(`[${W}] idle: Not recording, Start offered, no overflow, hit targets ≥44`, (await page.textContent("[data-testid=lab-state]")) === "Not recording" && (await noHScroll(page)) && (await undersized(page)).length === 0, (await undersized(page)).join(" | "));
    check(`[${W}] lab has its own manifest (installable separately)`, (await page.getAttribute('link[rel="manifest"]', "href")) === "/gps-lab/manifest.webmanifest");
    const manifest = await (await fetch(`${B}/gps-lab/manifest.webmanifest`)).json();
    check(`[${W}] manifest: standalone, scoped to /gps-lab`, manifest.display === "standalone" && manifest.start_url === "/gps-lab" && manifest.scope === "/gps-lab");

    await page.click("[data-testid=lab-start]");
    await page.waitForSelector("[data-testid=lab-stop]");
    await drive(ctx, page, 6);
    const fixes = Number(await page.textContent("[data-testid=lab-fixes]"));
    check(`[${W}] watchPosition delivers fixes while recording`, fixes >= 4, `fixes=${fixes}`);
    check(`[${W}] live status: last-fix age shown, accuracy shown`, /s ago/.test(await page.textContent("[data-testid=lab-fix-age]")) && /9 m/.test(await page.textContent("[data-testid=lab-metrics]")));
    const wl = await page.textContent("[data-testid=lab-wakelock]");
    check(`[${W}] wake lock state reported (held/error/unsupported — never blank)`, ["held", "error", "unsupported", "released", "idle"].includes(wl), wl);
    await setVisibility(page, "hidden");
    await settle(300);
    check(`[${W}] hidden page is detected and logged`, (await page.textContent("[data-testid=lab-vis]")) === "hidden" && /visibility hidden/.test(await page.textContent("[data-testid=lab-log]")));
    await setVisibility(page, "visible");
    await settle(300);
    check(`[${W}] visible again is logged`, /visibility visible/.test(await page.textContent("[data-testid=lab-log]")));
    check(`[${W}] recording: no overflow, hit targets ≥44`, (await noHScroll(page)) && (await undersized(page)).length === 0, (await undersized(page)).join(" | "));
    await page.screenshot({ path: `${OUT}/gps-${width}-recording.png`, fullPage: true });

    // Kill simulation: reload mid-recording without Stop. Fixes were flushed to IndexedDB on the 2s cadence.
    await settle(2600);
    await page.reload();
    await page.waitForSelector("[data-testid=lab-interrupted]");
    check(`[${W}] after reload mid-recording the interrupted session is offered for recovery`, true);
    check(`[${W}] interrupted: no overflow, hit targets ≥44`, (await noHScroll(page)) && (await undersized(page)).length === 0, (await undersized(page)).join(" | "));
    await page.click("[data-testid=lab-recover]");
    await page.waitForSelector("[data-testid=lab-report]");
    const recoveredText = await page.textContent("[data-testid=lab-report]");
    check(`[${W}] recovery rebuilds a report from device-local data (recovered = yes, fixes kept)`, /Recovered\?yes/.test(recoveredText) && Number(/Fixes(\d+)/.exec(recoveredText)?.[1]) >= 4, recoveredText.slice(0, 160));
    check(`[${W}] short test → INCONCLUSIVE (not a false verdict)`, /INCONCLUSIVE/.test(await page.textContent("[data-testid=lab-verdict]")));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=lab-download]")]);
    const path = `${OUT}/gps-report-${width}.json`;
    await dl.saveAs(path);
    const json = JSON.parse(readFileSync(path, "utf8"));
    check(`[${W}] downloaded report: schema ok, stats only (no coordinates)`, json.schema === "gps-lab-report-v1" && !/"lat"|"lon"/.test(readFileSync(path, "utf8")) && json.samples >= 4);
    check(`[${W}] report: no overflow, hit targets ≥44`, (await noHScroll(page)) && (await undersized(page)).length === 0, (await undersized(page)).join(" | "));
    await page.screenshot({ path: `${OUT}/gps-${width}-report.png`, fullPage: true });

    // Normal Start → Stop path.
    await page.click("[data-testid=lab-start]");
    await page.waitForSelector("[data-testid=lab-stop]");
    await drive(ctx, page, 4);
    await page.click("[data-testid=lab-stop]");
    await page.waitForSelector("[data-testid=lab-report]");
    check(`[${W}] Stop produces a report and returns to idle`, (await page.textContent("[data-testid=lab-state]")) === "Not recording" && /Fixes/.test(await page.textContent("[data-testid=lab-report]")));
    check(`[${W}] no page errors`, errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  // Permission denied: the harness must say so, not crash.
  // Headless Chromium leaves an ungranted prompt pending instead of denying, so force the denial the way iOS reports it.
  const denied = await browser.newContext({ ...devices["iPhone 13"] });
  await denied.addInitScript(() => {
    navigator.geolocation.watchPosition = (_ok, err) => { setTimeout(() => err?.({ code: 1, message: "User denied Geolocation" }), 50); return 1; };
  });
  const dp = await denied.newPage();
  await dp.goto(`${B}/gps-lab`);
  await dp.waitForSelector("[data-testid=lab-start]");
  await dp.click("[data-testid=lab-start]");
  await dp.waitForSelector("[data-testid=lab-geo-error]", { timeout: 8000 }).catch(() => {});
  check("permission not granted: GPS error surfaced, still recording-capable UI (no crash)", (await dp.$("[data-testid=lab-geo-error]")) !== null && (await dp.$("[data-testid=lab-stop]")) !== null, (await dp.textContent("body")).slice(0, 80));
  await denied.close();
} catch (error) {
  check(`script aborted: ${String(error.message).split("\n").slice(0, 3).join(" / ")}`, false);
}

await browser.close();
writeFileSync(`${OUT}/gps-results.txt`, results.map((r) => r.line).join("\n"));
console.log(results.map((r) => r.line).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? `  (${failed} FAIL)` : ""}`);
process.exit(failed ? 1 : 0);
