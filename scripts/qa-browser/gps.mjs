// Real-browser QA of the isolated P4 GPS recorder page (/gps) at 375 and 820 px, light and dark. SYNTHETIC DATA ONLY:
// the page's default source replays a scripted drive through the recorder; navigator.geolocation.watchPosition is
// replaced by a spy in every context so this script can PROVE the synthetic flow never calls it, and the one Real GPS
// check gets a denied error back (no real position ever exists here). Nothing is uploaded; IndexedDB only. A PASS here
// is not evidence of iPhone background-GPS behaviour (see docs/superpowers/specs/2026-10-13-gps-tracking-design.md).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const B = process.env.QA_BASE;
const OUT = process.env.QA_OUT;
const CHROMIUM = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const SPEEDUP = 100; // simulated seconds per wall second
const results = [];
const check = (name, ok, extra = "") => results.push({ ok: Boolean(ok), line: `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}` });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROMIUM });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const undersized = (page) =>
  page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select, textarea, summary")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5);
  }).map((el) => `${el.tagName}"${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 16)}"`));
const layoutOk = async (page, tag) => check(`${tag}: no horizontal scroll, every control ≥ 44 px`, (await noHScroll(page)) && (await undersized(page)).length === 0, (await undersized(page)).join(" | "));
const num = async (page, sel) => Number((await page.textContent(sel)).replace(/[^\d.]/g, ""));
const elapsedS = async (page) => { const [m, s] = (await page.textContent("[data-testid=gps-elapsed]")).split(":").map(Number); return m * 60 + s; };
const waitElapsed = (page, s) => page.waitForFunction((target) => { const t = document.querySelector("[data-testid=gps-elapsed]")?.textContent ?? "0:00"; const [m, sec] = t.split(":").map(Number); return m * 60 + sec >= target; }, s, { timeout: 60_000 });
const state = (page) => page.getAttribute("[data-testid=gps-state]", "data-state");
const watchCalls = (page) => page.evaluate(() => window.__watchCalls ?? -1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Every context: the spy replaces watchPosition BEFORE any page script runs. It never produces a position.
const SPY = () => {
  window.__watchCalls = 0;
  const geo = navigator.geolocation;
  if (!geo) return;
  window.__clearCalls = 0;
  geo.watchPosition = (_ok, err) => { window.__watchCalls++; setTimeout(() => err?.({ code: 1, message: "User denied Geolocation (QA spy)" }), 30); return 99; };
  geo.clearWatch = () => { window.__clearCalls++; };
  geo.getCurrentPosition = (_ok, err) => { window.__watchCalls++; setTimeout(() => err?.({ code: 1, message: "User denied Geolocation (QA spy)" }), 30); };
};

async function open(width, theme) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height: width >= 700 ? 1180 : 812 }, isMobile: width < 700, hasTouch: true, colorScheme: "light" });
  await ctx.addInitScript(SPY);
  if (theme === "dark") await ctx.addInitScript(() => { try { localStorage.setItem("actgds-driver:theme", "dark"); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push(`unexpected dialog: ${d.message()}`); d.dismiss(); });
  await page.goto(`${B}/gps?speedup=${SPEEDUP}`);
  await page.waitForSelector("[data-testid=gps-start]");
  return { ctx, page, errors };
}

try {
  for (const [width, theme] of [[375, "light"], [375, "dark"], [820, "light"], [820, "dark"]]) {
    const T = `[${width}px ${theme}]`;
    const { ctx, page, errors } = await open(width, theme);
    const prof = JSON.parse(await page.getAttribute("[data-testid=gps-source]", "data-profile"));
    check(`${T} theme applied (${theme})`, (await page.evaluate(() => document.documentElement.dataset.theme ?? "none")) === (theme === "dark" ? "dark" : "none") && (theme === "dark" ? /^rgb\(9, 19, 28\)$/ : /^rgb\(246, 243, 235\)$/).test(await bg(page)), await bg(page));
    check(`${T} loads with Synthetic selected, state Ready, Start enabled, no consent block, no location API touched`,
      (await page.getAttribute("[data-testid=gps-source]", "data-source")) === "synthetic" && (await state(page)) === "idle" && (await page.isEnabled("[data-testid=gps-start]")) && (await page.$("[data-testid=gps-consent]")) === null && (await watchCalls(page)) === 0);
    check(`${T} own manifest, noindex, footer line`, (await page.getAttribute('link[rel="manifest"]', "href")) === "/gps/manifest.webmanifest" && /noindex/.test(await page.getAttribute('meta[name="robots"]', "content")) && /nothing leaves this device/.test(await page.textContent(".gps-foot")));
    await layoutOk(page, `${T} idle`);
    await shot(page, `gps-${width}-${theme}-idle`);

    // ── Synthetic Start → Pause → Resume → error injection → reload → recover ──
    await page.click("[data-testid=gps-start]");
    await page.waitForFunction(() => Number(document.querySelector("[data-testid=gps-fixes]")?.textContent) >= 20);
    await waitElapsed(page, 20);
    check(`${T} Start: recording, fixes arrive, distance and elapsed count up, wake lock reported`, (await state(page)) === "recording" && (await num(page, "[data-testid=gps-fixes]")) >= 20 && (await num(page, "[data-testid=gps-distance]")) >= 0.1 && (await elapsedS(page)) >= 20 && ["held", "error", "unsupported", "released", "idle"].includes(await page.textContent("[data-testid=gps-wakelock]")), await page.textContent("[data-testid=gps-state]"));
    check(`${T} recording: Pause and Stop offered, Start and source locked`, (await page.$("[data-testid=gps-pause]")) !== null && (await page.$("[data-testid=gps-stop]")) !== null && (await page.$("[data-testid=gps-start]")) === null && (await page.isDisabled("[data-testid=gps-source-device]")));
    await layoutOk(page, `${T} recording`);
    await shot(page, `gps-${width}-${theme}-recording`);
    await page.click("[data-testid=gps-pause]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-state]")?.dataset.state === "paused");
    const fixesAtPause = await num(page, "[data-testid=gps-fixes]");
    await settle(700);
    check(`${T} Pause: state paused, fixes stop, paused clock runs, Resume + Stop offered`, (await num(page, "[data-testid=gps-fixes]")) === fixesAtPause && (await page.textContent("[data-testid=gps-paused]")) !== "00:00" && (await page.$("[data-testid=gps-resume]")) !== null && (await page.$("[data-testid=gps-stop]")) !== null && /Paused/.test(await page.textContent("[data-testid=gps-state]")), `fixes ${fixesAtPause} → ${await num(page, "[data-testid=gps-fixes]")}`);
    await layoutOk(page, `${T} paused`);
    await shot(page, `gps-${width}-${theme}-paused`);
    await page.click("[data-testid=gps-resume]");
    await page.waitForFunction((n) => Number(document.querySelector("[data-testid=gps-fixes]")?.textContent) > n + 5, fixesAtPause);
    check(`${T} Resume: recording again, fixes continue, log shows pause / resume_recording`, (await state(page)) === "recording" && /resume_recording/.test(await page.textContent("[data-testid=gps-log]")) && /pause/.test(await page.textContent("[data-testid=gps-log]")));

    // Injected GPS errors (synthetic test tools): plain words, recording continues.
    await page.click("[data-testid=gps-tools] summary");
    await page.click("[data-testid=gps-inject-denied]");
    await page.waitForSelector("[data-testid=gps-geo-error]");
    const deniedText = await page.textContent("[data-testid=gps-geo-error]");
    const fixesAtError = await num(page, "[data-testid=gps-fixes]");
    await settle(400);
    check(`${T} injected "denied" surfaces in plain words (Settings › Location Services), stays readable after fixes resume, recording continues`, /permission was refused/.test(deniedText) && /Location Services/.test(deniedText) && /arriving again/.test(await page.textContent("[data-testid=gps-geo-error]")) && (await num(page, "[data-testid=gps-fixes]")) > fixesAtError && (await state(page)) === "recording", deniedText.slice(0, 80));
    await page.click("[data-testid=gps-inject-unavailable]");
    await page.waitForFunction(() => /unavailable/.test(document.querySelector("[data-testid=gps-geo-error]")?.textContent ?? ""));
    await page.click("[data-testid=gps-inject-timeout]");
    await page.waitForFunction(() => /No fix for 30 seconds/.test(document.querySelector("[data-testid=gps-geo-error]")?.textContent ?? ""));
    check(`${T} injected "unavailable" and "timeout" each surface in words; geo_error events logged`, (await page.textContent("[data-testid=gps-log]")).split("geo_error").length - 1 >= 3);
    await layoutOk(page, `${T} recording with error`);
    await shot(page, `gps-${width}-${theme}-geo-error`);
    // Injected storage failure: counted, nothing lost, recording continues.
    const storeErrBefore = await num(page, "[data-testid=gps-store-errors]");
    await page.click("[data-testid=gps-inject-store]");
    await page.waitForFunction((n) => Number(document.querySelector("[data-testid=gps-store-errors]")?.textContent) > n, storeErrBefore, { timeout: 10_000 });
    const fixesAtStoreErr = await num(page, "[data-testid=gps-fixes]");
    await settle(300);
    check(`${T} injected storage failure increments Storage errors, recording continues, store_error logged`, (await num(page, "[data-testid=gps-store-errors]")) === storeErrBefore + 1 && (await num(page, "[data-testid=gps-fixes]")) > fixesAtStoreErr && (await state(page)) === "recording");
    check(`${T} synthetic flow so far never called navigator.geolocation.watchPosition`, (await watchCalls(page)) === 0, `calls=${await watchCalls(page)}`);

    // Kill simulation: reload mid-recording without Stop; the flushed fixes are in IndexedDB.
    await settle(300);
    await page.reload();
    await page.waitForSelector("[data-testid=gps-interrupted]");
    check(`${T} reload mid-recording → interrupted recording offered; page back to Synthetic + Ready`, (await page.getAttribute("[data-testid=gps-source]", "data-source")) === "synthetic" && (await state(page)) === "idle");
    await layoutOk(page, `${T} interrupted`);
    await shot(page, `gps-${width}-${theme}-interrupted`);
    await page.click("[data-testid=gps-recover]");
    await page.waitForSelector("[data-testid=gps-results]");
    const recText = await page.textContent("[data-testid=gps-results]");
    check(`${T} Recover → Results card (recovered, distance > 0, paused time kept), interrupted card gone`, /recovered/.test(recText) && (await num(page, "[data-testid=gps-r-distance]")) > 0 && !/^0\.0 s/.test(await page.textContent("[data-testid=gps-r-paused]")) && (await page.$("[data-testid=gps-interrupted]")) === null, recText.slice(0, 120));
    await page.click("[data-testid=gps-delete]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-results]") === null);
    check(`${T} Delete this recording removes the results card`, true);

    // ── Full synthetic drive with a clean pause between the scripted stops → results match the script ──
    await page.click("[data-testid=gps-start]");
    await waitElapsed(page, 160);
    await page.click("[data-testid=gps-pause]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-state]")?.dataset.state === "paused");
    const pausedAt = await elapsedS(page);
    await settle(700);
    await page.click("[data-testid=gps-resume]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-state]")?.dataset.state === "recording");
    const resumedAt = await elapsedS(page);
    await waitElapsed(page, 1600);
    await page.click("[data-testid=gps-stop]");
    await page.waitForSelector("[data-testid=gps-results]");
    const stoppedAt = await elapsedS(page);
    check(`${T} Stop → state stopped, Start offered again, status line keeps elapsed + km`, (await state(page)) === "stopped" && (await page.$("[data-testid=gps-start]")) !== null && /Stopped/.test(await page.textContent("[data-testid=gps-state]")) && /km/.test(await page.textContent("[data-testid=gps-distance]")));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=gps-download]")]);
    const file = `${OUT}/gps-summary-${width}-${theme}.json`;
    await dl.saveAs(file);
    const raw = readFileSync(file, "utf8");
    const s = JSON.parse(raw);
    const pauseOverlapsStop = prof.stops.some((st) => st.toS > pausedAt - 2 && st.fromS < resumedAt + 2);
    check(`${T} the pause (${pausedAt}s → ${resumedAt}s) fell between the scripted stops (timing sanity)`, !pauseOverlapsStop && pausedAt >= 150 && resumedAt < 400, `paused ${pausedAt} resumed ${resumedAt} stopped ${stoppedAt}`);
    const expectedStops = prof.stops.filter((st) => st.toS <= stoppedAt && !(st.toS > pausedAt && st.fromS < resumedAt));
    const expectedStopMs = expectedStops.reduce((a, st) => a + (st.toS - st.fromS) * 1000, 0);
    // Expected distance from the GENERATOR only (speed × seconds the scripted car moved while the recorder watched):
    // recorded [0, stoppedAt) minus the pause [pausedAt, resumedAt), minus scripted stops and the signal-loss window.
    const inWindow = (sec, w) => w.some((o) => sec >= o.fromS && sec < o.toS);
    let expectedDistance = 0;
    for (let sec = 0; sec < stoppedAt; sec++) if (!(sec >= pausedAt && sec < resumedAt) && !inWindow(sec, prof.stops) && !inWindow(sec, prof.outages)) expectedDistance += prof.speedMps;
    check(`${T} results: distance ${s.distanceM} m within ±5 % of the script's speed × moving seconds (${Math.round(expectedDistance)} m)`, Math.abs(s.distanceM - expectedDistance) / expectedDistance <= 0.05);
    check(`${T} results: stops ${s.stops.count} = scripted ${expectedStops.length}, stop total ≈ ${expectedStopMs / 1000} s`, s.stops.count === expectedStops.length && Math.abs(s.stops.totalMs - expectedStopMs) <= 4000, `total ${s.stops.totalMs}`);
    check(`${T} results: paused time > 0 (${s.pausedMs} ms, 1 pause), one gap (the 40 s outage), one jump, coverage > 95 %`, s.pausedMs >= 50_000 && s.pauses === 1 && s.gaps.count === 1 && s.gaps.maxMs >= 39_000 && s.gaps.maxMs <= 43_000 && s.jumps === 1 && s.coveragePct > 95, JSON.stringify({ paused: s.pausedMs, gaps: s.gaps, jumps: s.jumps, cov: s.coveragePct }));
    check(`${T} results: max speed 43.2 km/h (jump never sets it), moving + stopped + gaps ≈ active`, s.maxSpeedKmh === 43.2 && Math.abs(s.movingMs + s.stoppedMs + s.gaps.totalMs - s.activeMs) <= 8000 /* start, stop, pause and jump boundary legs */, `${s.maxSpeedKmh} ${s.movingMs}+${s.stoppedMs}+${s.gaps.totalMs} vs ${s.activeMs}`);
    check(`${T} downloaded summary JSON: schema, specialPoints empty, NO coordinates`, s.schema === "ia-gps-track-summary-v1" && Array.isArray(s.specialPoints) && s.specialPoints.length === 0 && !/"lat"|"lon"|latitude|longitude/.test(raw));
    const card = await page.textContent("[data-testid=gps-results]");
    check(`${T} results card wording: GPS distance (diagnostic) — the odometer stays official; moving / stopped / stops / max / coverage / paused / gaps shown`, /GPS distance \(diagnostic\) — the odometer stays official/.test(card) && /Moving/.test(card) && /Stopped/.test(card) && /Stops/.test(card) && /Max speed/.test(card) && /Coverage/.test(card) && /Paused/.test(card) && /Gaps/.test(card));
    check(`${T} feasibility report folded below with a verdict`, (await page.$("[data-testid=gps-feasibility][open]")) === null && /INCONCLUSIVE|PWA VIABLE|FOREGROUND ONLY|NATIVE REQUIRED/.test(await page.textContent("[data-testid=gps-feasibility] summary")));
    await layoutOk(page, `${T} results`);
    await shot(page, `gps-${width}-${theme}-results`);
    await page.click("[data-testid=gps-feasibility] summary");
    await layoutOk(page, `${T} feasibility open`);
    await shot(page, `gps-${width}-${theme}-feasibility`);
    await page.click("[data-testid=gps-copy]");
    await page.waitForSelector("[data-testid=gps-note]");
    check(`${T} Copy summary JSON reports copied (or a plain fallback), never throws`, /copied|Copy failed/.test(await page.textContent("[data-testid=gps-note]")));

    // Earlier recordings + Clear this device (confirm step inside the page, no window.confirm).
    check(`${T} Earlier recordings lists the stopped session with Delete`, (await page.$$("[data-testid=gps-earlier-open]")).length >= 1 && (await page.$$("[data-testid=gps-earlier-delete]")).length >= 1);

    // ── Earlier recordings: one-line summaries. A read-only, in-memory projection of recordings already on this device
    //    (existing summarizeTrack; no new rule). Fixtures are SYNTHETIC and injected straight into IndexedDB.
    const cardVals = async () => ({ distance: (await page.textContent("[data-testid=gps-r-distance]")).trim(), recorded: (await page.textContent("[data-testid=gps-r-recorded]")).trim(), coverage: (await page.textContent("[data-testid=gps-r-coverage]")).trim() });
    const lineOf = (v) => `${v.distance} · Recorded ${v.recorded} · Coverage ${v.coverage}`;
    const idbRows = () => page.evaluate(() => new Promise((resolve) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const db = o.result; const out = {}; let n = 0; for (const name of ["meta", "samples", "events"]) { const r = db.transaction(name).objectStore(name).count(); r.onsuccess = () => { out[name] = r.result; if (++n === 3) resolve(out); }; r.onerror = () => resolve(null); } }; o.onerror = () => resolve(null); }));
    const rowsInfo = () => page.$$eval("[data-testid=gps-earlier] .gps-past", (rows) => rows.map((r) => ({ line: r.querySelector("[data-testid=gps-earlier-line]")?.textContent ?? null, open: !!r.querySelector("[data-testid=gps-earlier-open]"), del: !!r.querySelector("[data-testid=gps-earlier-delete]") })));
    const realCard = await cardVals();
    // Test setup only (outside the app): keep just the recording the Results card shows, so the list below is exactly the fixtures.
    const keepId = await page.getAttribute("[data-testid=gps-results]", "data-session");
    const realStart = await page.evaluate((keep) => new Promise((resolve) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const db = o.result; const tx = db.transaction("meta", "readwrite"); const st = tx.objectStore("meta"); const all = st.getAll(); all.onsuccess = () => { let start = null; for (const m of all.result) { if (m.id === keep) start = m.startedAt; else st.delete(m.id); } tx.oncomplete = () => resolve(start); }; }; }), keepId);
    const DAY = 86_400_000;
    const env = { source: "synthetic", userAgent: "qa", standalone: false, wakeLockSupported: true, geolocationSupported: true, startVisibility: "visible" };
    const fixtures = [
      { id: "qa-empty", startedAt: realStart - DAY, stoppedAt: realStart - DAY + 60_000, env, pauses: [] },           // valid, no fixes at all
      { id: "qa-corrupt", startedAt: realStart - 2 * DAY, stoppedAt: realStart - 2 * DAY + 60_000, env, pauses: 7 }, // malformed field: summarizeTrack throws
      ...[3, 4, 5, 6, 7].map((k) => ({ id: `qa-extra-${k}`, startedAt: realStart - k * DAY, stoppedAt: realStart - k * DAY + 60_000, env, pauses: [] })),
    ];
    await page.evaluate((metas) => new Promise((resolve, reject) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const tx = o.result.transaction("meta", "readwrite"); for (const m of metas) tx.objectStore("meta").put(m); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }; o.onerror = () => reject(o.error); }), fixtures);
    const idbBefore = await idbRows();
    const requests = [];
    page.on("request", (rq) => requests.push(rq.url()));
    await page.reload();
    await page.waitForSelector("[data-testid=gps-start]");
    await page.waitForSelector("[data-testid=gps-earlier-line]");
    await settle(600);
    let rows = await rowsInfo();
    check(`${T} earlier: 8 listed; lines on rows 1, 2, 4, 5 only (newest five; row 3 is the malformed record, rows 6-8 are beyond the limit); every row keeps Open + Delete`, rows.length === 8 && rows.map((r, i) => (r.line ? i : -1)).filter((i) => i >= 0).join() === "0,1,3,4" && rows.every((r) => r.open && r.del), JSON.stringify(rows.map((r) => r.line)));
    check(`${T} earlier: after stop + reload, row 1's line equals the Results card of the same recording (distance, Recorded, Coverage) — ${rows[0].line}`, rows[0].line === lineOf(realCard), `card=${lineOf(realCard)}`);
    check(`${T} earlier: wording is the card's total duration "Recorded", never Moving/Paused/parked`, rows.filter((r) => r.line).every((r) => /^\d+\.\d{2} km · Recorded [\d.]+ (min|s) · Coverage [\d.]+%$/.test(r.line) && !/Moving|Paused|Stopped/.test(r.line)));
    check(`${T} earlier: loading the lines wrote nothing (IndexedDB meta/samples/events counts unchanged)`, JSON.stringify(await idbRows()) === JSON.stringify(idbBefore), JSON.stringify({ before: idbBefore, after: await idbRows() }));
    check(`${T} earlier: no request left the origin and the geolocation spy saw 0 calls`, requests.every((u) => u.startsWith(B) || u.startsWith("data:") || u.startsWith("blob:")) && (await watchCalls(page)) === 0, `calls=${await watchCalls(page)} foreign=${requests.filter((u) => !(u.startsWith(B) || u.startsWith("data:") || u.startsWith("blob:"))).join(",")}`);
    await layoutOk(page, `${T} earlier summary lines`);
    await shot(page, `gps-${width}-${theme}-earlier-lines`);
    // The empty fixture's line is the same numbers its own Results card shows.
    await page.locator("[data-testid=gps-earlier] .gps-past").nth(1).locator("[data-testid=gps-earlier-open]").click();
    await page.waitForSelector("[data-testid=gps-results]");
    check(`${T} earlier: an empty recording's line equals its own Results card (no special case, no blocking)`, (await rowsInfo())[1].line === lineOf(await cardVals()));
    // The malformed record does not block the list: delete it; the remaining rows keep working and the newest five all get lines.
    await page.locator("[data-testid=gps-earlier] .gps-past").nth(2).locator("[data-testid=gps-earlier-delete]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=gps-earlier] .gps-past").length === 7);
    await settle(500);
    rows = await rowsInfo();
    check(`${T} earlier: after deleting the malformed record the list updates (7 rows) and the newest five all have lines, later rows none`, rows.length === 7 && rows.map((r, i) => (r.line ? i : -1)).filter((i) => i >= 0).join() === "0,1,2,3,4", JSON.stringify(rows.map((r) => r.line)));
    check(`${T} earlier: no page errors while summarising a malformed record`, errors.length === 0, errors.join(" | "));
    // Valid A is open, then a damaged B is opened WITHOUT a reload: A's Results card and its Delete must not stay up under B's note.
    {
      const damaged = (id, extra) => ({ id, startedAt: 1_000, env: { source: "synthetic", userAgent: "qa", standalone: false, wakeLockSupported: true, geolocationSupported: true, startVisibility: "visible" }, pauses: 7, ...extra });
      await page.evaluate((m) => new Promise((resolve, reject) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const tx = o.result.transaction("meta", "readwrite"); tx.objectStore("meta").put(m); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }; }), damaged("qa-damaged-ab", { stoppedAt: 61_000 }));
      const sessionA = await page.getAttribute("[data-testid=gps-results]", "data-session");
      await page.locator("[data-testid=gps-earlier-open]").first().click(); // refreshes the list (B appears) and keeps A valid
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=gps-earlier-open]").length >= 2);
      const errorsBefore = errors.length;
      const n = (await page.$$("[data-testid=gps-earlier-open]")).length;
      await page.locator("[data-testid=gps-earlier-open]").nth(n - 1).click(); // oldest = B
      await page.waitForSelector("[data-testid=gps-note]");
      await settle(300);
      check(`${T} A then damaged B (no reload): B's note shown, A's Results card and Delete are gone, no page error`, /can't be read/.test(await page.textContent("[data-testid=gps-note]")) && (await page.$("[data-testid=gps-results]")) === null && (await page.$("[data-testid=gps-delete]")) === null && errors.length === errorsBefore, `A=${sessionA} ${errors.slice(errorsBefore).join(" | ")}`);
      await page.locator("[data-testid=gps-earlier-delete]").nth(n - 1).click();
      await page.waitForFunction((k) => document.querySelectorAll("[data-testid=gps-earlier-open]").length === k - 1, n);
    }
    // A damaged recording on this device: Open says so in words instead of throwing; the page and the other recordings keep working.
    {
      const metaCount = () => page.evaluate(() => new Promise((resolve) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const r = o.result.transaction("meta").objectStore("meta").count(); r.onsuccess = () => resolve(r.result); }; }));
      const before = await metaCount();
      await page.evaluate(() => new Promise((resolve, reject) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const tx = o.result.transaction("meta", "readwrite"); tx.objectStore("meta").put({ id: "qa-damaged", startedAt: 1_000, stoppedAt: 61_000, env: { source: "synthetic", userAgent: "qa", standalone: false, wakeLockSupported: true, geolocationSupported: true, startVisibility: "visible" }, pauses: 7 }); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }; }));
      await page.reload();
      await page.waitForSelector("[data-testid=gps-start]");
      await page.waitForSelector("[data-testid=gps-earlier-open]");
      const errorsBefore = errors.length;
      const rowsN = (await page.$$("[data-testid=gps-earlier-open]")).length;
      await page.locator("[data-testid=gps-earlier-open]").nth(rowsN - 1).click(); // oldest = the damaged one
      await page.waitForSelector("[data-testid=gps-note]");
      await settle(300);
      check(`${T} damaged recording: Open says so in words, no page error, no Results card, page still usable (Start offered)`, /can't be read/.test(await page.textContent("[data-testid=gps-note]")) && (await page.$("[data-testid=gps-results]")) === null && errors.length === errorsBefore && (await page.$("[data-testid=gps-start]")) !== null, errors.slice(errorsBefore).join(" | "));
      await page.locator("[data-testid=gps-earlier-delete]").nth(rowsN - 1).click();
      await page.waitForFunction((n) => document.querySelectorAll("[data-testid=gps-earlier-open]").length === n - 1, rowsN);
      check(`${T} damaged recording: Delete removes only it (${before} recordings again)`, (await metaCount()) === before, String(await metaCount()));
    }
    // An interrupted recording whose stored data is damaged: Recover says so in words (no unhandled rejection), the page stays usable.
    {
      const bad = { id: "qa-damaged-recover", startedAt: 2_000, env: { source: "synthetic", userAgent: "qa", standalone: false, wakeLockSupported: true, geolocationSupported: true, startVisibility: "visible" }, pauses: 7 }; // no stoppedAt = interrupted
      await page.evaluate((m) => new Promise((resolve, reject) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const tx = o.result.transaction("meta", "readwrite"); tx.objectStore("meta").put(m); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }; }), bad);
      await page.reload();
      await page.waitForSelector("[data-testid=gps-recover]");
      const errorsBefore = errors.length;
      await page.click("[data-testid=gps-recover]");
      await page.waitForSelector("[data-testid=gps-note]");
      await settle(300);
      check(`${T} damaged interrupted recording: Recover says so in words, no Results card, no page error, page still usable`, /can't be read/.test(await page.textContent("[data-testid=gps-note]")) && (await page.$("[data-testid=gps-results]")) === null && errors.length === errorsBefore && (await page.$("[data-testid=gps-start]")) !== null && !(await page.isDisabled("[data-testid=gps-start]")), errors.slice(errorsBefore).join(" | "));
      await page.evaluate(() => new Promise((resolve) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const tx = o.result.transaction("meta", "readwrite"); tx.objectStore("meta").delete("qa-damaged-recover"); tx.oncomplete = () => resolve(true); }; })); // test cleanup, outside the app
    }
    await page.click("[data-testid=gps-clear-device]");
    await page.waitForSelector("[data-testid=gps-clear-confirm]");
    await layoutOk(page, `${T} clear confirm`);
    await shot(page, `gps-${width}-${theme}-clear-confirm`);
    await page.click("[data-testid=gps-clear-cancel]");
    check(`${T} Clear: Keep cancels`, (await page.$("[data-testid=gps-clear-confirm]")) === null && (await page.$("[data-testid=gps-earlier]")) !== null);
    await page.click("[data-testid=gps-clear-device]");
    await page.click("[data-testid=gps-clear-confirm]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-earlier]") === null);
    await page.reload();
    await page.waitForSelector("[data-testid=gps-start]");
    await settle(400);
    const idbCount = await page.evaluate(() => new Promise((resolve) => { const o = indexedDB.open("ia-gps", 1); o.onsuccess = () => { const db = o.result; const r = db.transaction("meta").objectStore("meta").count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(-1); }; o.onerror = () => resolve(-2); }));
    check(`${T} Clear this device empties everything (no results, no earlier, no interrupted, IndexedDB "ia-gps" meta count 0)`, (await page.$("[data-testid=gps-earlier]")) === null && (await page.$("[data-testid=gps-interrupted]")) === null && (await page.$("[data-testid=gps-results]")) === null && idbCount === 0, `idb=${idbCount}`);

    // ── Real GPS mode: consent gate, not persisted, watchPosition called exactly once after consent ──
    await page.click("[data-testid=gps-source-device]");
    await page.waitForSelector("[data-testid=gps-consent]");
    const consentText = await page.textContent("[data-testid=gps-consent]");
    check(`${T} Real GPS: consent block (only on this device / nothing uploaded / Stop or Clear ends it), box off, Start disabled`, /only on this device/.test(consentText) && /Nothing is uploaded/.test(consentText) && /Stop or Clear ends it/.test(consentText) && !(await page.isChecked("[data-testid=gps-consent-box]")) && (await page.isDisabled("[data-testid=gps-start]")));
    await layoutOk(page, `${T} consent`);
    await shot(page, `gps-${width}-${theme}-consent`);
    await page.click("[data-testid=gps-consent-box]");
    check(`${T} Real GPS: ticking consent enables Start; nothing written to localStorage`, (await page.isEnabled("[data-testid=gps-start]")) && (await page.evaluate(() => Object.keys(localStorage).filter((k) => /gps|consent/i.test(k)).length)) === 0);
    await page.reload();
    await page.waitForSelector("[data-testid=gps-start]");
    check(`${T} reload → back to Synthetic, consent block gone (consent never persisted)`, (await page.getAttribute("[data-testid=gps-source]", "data-source")) === "synthetic" && (await page.$("[data-testid=gps-consent]")) === null && (await watchCalls(page)) === 0);
    await page.click("[data-testid=gps-source-device]");
    await page.waitForSelector("[data-testid=gps-consent-box]");
    check(`${T} re-selecting Real GPS → consent off again, Start disabled`, !(await page.isChecked("[data-testid=gps-consent-box]")) && (await page.isDisabled("[data-testid=gps-start]")));
    await page.click("[data-testid=gps-consent-box]");
    await page.click("[data-testid=gps-start]");
    await page.waitForSelector("[data-testid=gps-geo-error]");
    await settle(300);
    check(`${T} Real GPS + consent + Start → watchPosition called exactly once (spy), denial shown in words, recording stays open`, (await watchCalls(page)) === 1 && /permission was refused/.test(await page.textContent("[data-testid=gps-geo-error]")) && (await state(page)) === "recording" && (await num(page, "[data-testid=gps-fixes]")) === 0, `calls=${await watchCalls(page)}`);
    check(`${T} Real GPS: no Test tools (synthetic only)`, (await page.$("[data-testid=gps-tools]")) === null);
    await layoutOk(page, `${T} device recording denied`);
    await shot(page, `gps-${width}-${theme}-device-denied`);
    await page.click("[data-testid=gps-stop]");
    await page.waitForSelector("[data-testid=gps-results]");
    check(`${T} Real GPS: Stop → results with 0 fixes, no second watchPosition call`, (await watchCalls(page)) === 1 && (await num(page, "[data-testid=gps-r-distance]")) === 0);
    // Client-side navigation away while a device-mode recording is open: the page's unmount stops it (watch cleared,
    // session closed), so coming back shows no interrupted recording and no extra watch.
    await page.click("[data-testid=gps-start]");
    await page.waitForSelector("[data-testid=gps-stop]");
    const clearsBefore = await page.evaluate(() => window.__clearCalls);
    await page.evaluate(() => window.next.router.push("/"));
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-state]") === null);
    await page.evaluate(() => window.next.router.push("/gps"));
    await page.waitForSelector("[data-testid=gps-start]");
    await settle(400);
    check(`${T} Real GPS: navigating away unmounts and stops the recorder (watch cleared, no interrupted session on return, watchPosition still 2 calls total)`, (await page.evaluate(() => window.__clearCalls)) === clearsBefore + 1 && (await page.$("[data-testid=gps-interrupted]")) === null && (await watchCalls(page)) === 2 && (await state(page)) === "idle", `clears ${clearsBefore}→${await page.evaluate(() => window.__clearCalls)} calls=${await watchCalls(page)}`);
    await page.click("[data-testid=gps-clear-device]");
    await page.click("[data-testid=gps-clear-confirm]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-clear]") === null);
    check(`${T} no page errors, no dialogs`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // End of the synthetic script: a neutral note, not a location error; the recording stays open until Stop.
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 375, height: 812 } });
    await ctx.addInitScript(SPY);
    const page = await ctx.newPage();
    await page.goto(`${B}/gps?speedup=600`);
    await page.waitForSelector("[data-testid=gps-start]");
    await page.click("[data-testid=gps-start]");
    await page.waitForSelector("[data-testid=gps-drive-finished]", { timeout: 20_000 });
    check("[375px] synthetic drive finished → neutral note ('synthetic drive has finished … Stop'), no GPS error text, still recording", /synthetic drive has finished/.test(await page.textContent("[data-testid=gps-drive-finished]")) && (await page.$("[data-testid=gps-geo-error]")) === null && (await state(page)) === "recording" && (await page.$eval("[data-testid=gps-drive-finished]", (el) => el.className.includes("info"))));
    await page.click("[data-testid=gps-stop]");
    await page.waitForSelector("[data-testid=gps-results]");
    check("[375px] finished drive → results for the whole script (≈ 26 min moving, 4 stops)", /^4 ·/.test(await page.textContent("[data-testid=gps-r-stops]")) && (await num(page, "[data-testid=gps-r-distance]")) > 19);
    await ctx.close();
  }

  // Interrupted while PAUSED: the open pause closes at the last heartbeat; results still produced.
  {
    const { ctx, page, errors } = await open(375, "light");
    await page.click("[data-testid=gps-start]");
    await waitElapsed(page, 60);
    await page.click("[data-testid=gps-pause]");
    await page.waitForFunction(() => document.querySelector("[data-testid=gps-state]")?.dataset.state === "paused");
    const fixes = await num(page, "[data-testid=gps-fixes]");
    await settle(600); // heartbeats keep flushing while paused
    await page.reload();
    await page.waitForSelector("[data-testid=gps-recover]");
    await page.click("[data-testid=gps-recover]");
    await page.waitForSelector("[data-testid=gps-results]");
    const file = `${OUT}/gps-summary-recovered-paused.json`;
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=gps-download]")]);
    await dl.saveAs(file);
    const s = JSON.parse(readFileSync(file, "utf8"));
    check(`[375px] interrupted while paused → recovered results: fixes kept (${s.fixes}/${fixes}), pause closed (${s.pausedMs} ms ≥ 30 s), recovered flag`, s.recovered === true && s.fixes === fixes && s.pausedMs >= 30_000 && s.pauses === 1, JSON.stringify({ fixes: s.fixes, paused: s.pausedMs }));
    check(`[375px] interrupted-while-paused: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  // Stop when reading the recording back fails: the page must not stay busy; the recording is still on the device and opens once reads work.
  {
    const { ctx, page, errors } = await open(375, "light");
    await page.click("[data-testid=gps-start]");
    await waitElapsed(page, 25);
    await page.evaluate(() => { const orig = IDBIndex.prototype.getAll; window.__qaRestoreGetAll = () => { IDBIndex.prototype.getAll = orig; }; IDBIndex.prototype.getAll = function () { throw new Error("qa injected read failure"); }; });
    await page.click("[data-testid=gps-stop]");
    await page.waitForSelector("[data-testid=gps-note]");
    await settle(500);
    check("[375px] Stop with a failing read-back: note in words, Start offered and enabled again (not stuck busy), no Results card, no page error", /can't be read/.test(await page.textContent("[data-testid=gps-note]")) && (await page.$("[data-testid=gps-start]")) !== null && !(await page.isDisabled("[data-testid=gps-start]")) && (await page.$("[data-testid=gps-results]")) === null && errors.length === 0, errors.join(" | "));
    await page.evaluate(() => window.__qaRestoreGetAll());
    await page.reload();
    await page.waitForSelector("[data-testid=gps-earlier-open]");
    await page.locator("[data-testid=gps-earlier-open]").first().click();
    await page.waitForSelector("[data-testid=gps-results]");
    check("[375px] Stop with a failing read-back: the recording was kept and opens normally once reads work", /km/.test(await page.textContent("[data-testid=gps-r-distance]")));
    await ctx.close();
  }
} catch (error) {
  check(`script aborted: ${String(error.stack || error.message).split("\n").slice(0, 4).join(" / ")}`, false);
}

await browser.close();
writeFileSync(`${OUT}/gps-results.txt`, results.map((r) => r.line).join("\n"));
console.log(results.map((r) => r.line).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? `  (${failed} FAIL)` : ""}`);
process.exit(failed ? 1 : 0);
