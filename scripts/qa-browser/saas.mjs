// Real-browser QA of the SaaS edition (APP_MODE = "saas") at phone width, plus the product preview screenshots. See
// run-saas.sh: the app runs the production SaaS middleware (lib/saas/middleware.ts) with only the Cloudflare Access JWT
// replaced by the x-qa-email request header, on a brand-new local D1 built from migrations-saas/. Synthetic data only.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const WORK = process.env.QA_WORK;
// sql() runs wrangler against QA_WORK's local D1: without it wrangler would use the developer's own .wrangler database.
if (!WORK) throw new Error("saas.mjs: QA_WORK is not set. Run it through scripts/qa-browser/run-saas.sh (it points QA_WORK at the throw-away copy).");
const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const B = process.env.QA_BASE;
const OUT = process.env.QA_OUT;
const PREVIEW = process.env.QA_PREVIEW_OUT || `${OUT}/preview`;
const CHROMIUM = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;

const SAM = "qa-sam@example.test", JO = "qa-jo@example.test", LATE = "qa-late@example.test", OFF = "qa-off@example.test";
const SAM_NAME = "QA Alex Taylor"; // qa-jo deliberately signs up with the same display name (allowed in the SaaS edition)
const LATE_NAME = "QA 刘坤";
const LEARNER = "QA Sam Citizen";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TRIAL_ACTIVE = /^Free trial: (29|30) days left$/;
const TRIAL_ENDED = "Free trial ended — read-only. Your records and PDFs stay available.";

const results = [];
const check = (name, ok, extra = "") => results.push({ ok: Boolean(ok), line: `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}` });
const shots = [];
// Screenshots must never be committed: the preview folder ignores itself, wherever QA_PREVIEW_OUT points. Refuse a
// folder that is already someone else's (its own different .gitignore, or files git tracks), rather than overwrite it.
{
  let existing = null;
  try { existing = readFileSync(`${PREVIEW}/.gitignore`, "utf8"); } catch { /* none yet */ }
  if (existing !== null && existing !== "*\n") throw new Error(`saas.mjs: ${PREVIEW}/.gitignore exists with other content; choose an empty QA_PREVIEW_OUT folder.`);
  let tracked = "";
  try { tracked = execFileSync("git", ["-C", PREVIEW, "ls-files", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not inside a git work tree */ }
  if (tracked) throw new Error(`saas.mjs: ${PREVIEW} contains files tracked by git (${tracked.split("\n").slice(0, 3).join(", ")}); choose a folder of its own for QA_PREVIEW_OUT.`);
  writeFileSync(`${PREVIEW}/.gitignore`, "*\n");
}
const browser = await chromium.launch({ executablePath: CHROMIUM });
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// ── Direct database access (test setup only): the same local D1 the app uses, through wrangler. ──
function sql(command) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", command], { cwd: WORK, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out)[0].results;
}
const instructorRows = (email) => sql(`SELECT id, full_name, status, created_at FROM instructors WHERE lower(email) = '${email}'`);

// ── API as a given account (x-qa-email = the identity the stub middleware hands to the real saas middleware). ──
async function api(email, path, { method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (email) h["x-qa-email"] = email;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, location: r.headers.get("location") };
}

// ── Browser sessions. Journey: iPhone 13, light, deviceScaleFactor 2. Every console error / page error is collected. ──
const journeyErrors = [];
async function session(email, { colorScheme = "light", viewport, lastLearner } = {}) {
  const base = viewport ? { viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPhone 13"].userAgent } : { ...devices["iPhone 13"], deviceScaleFactor: 2 };
  const ctx = await browser.newContext({ ...base, colorScheme, acceptDownloads: true, extraHTTPHeaders: { "x-qa-email": email } });
  const page = await ctx.newPage();
  const label = `${email}${viewport ? ` ${viewport.width}px` : ""}${colorScheme === "dark" ? " dark" : ""}`;
  page.on("pageerror", (e) => journeyErrors.push(`${label} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") journeyErrors.push(`${label} console: ${m.text()} @ ${page.url()}`); });
  page.on("dialog", (d) => d.accept());
  if (lastLearner) await page.addInitScript((id) => localStorage.setItem("actgds-driver:last-learner", id), lastLearner);
  return { ctx, page };
}
const ready = (page) => page.waitForSelector("[data-testid=trial-banner]", { timeout: 20000 });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= 375);
async function settled(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector("[role=status].empty, .status.ok, .status.info:not([data-testid])"), null, { timeout: 8000 }).catch(() => {});
  await settle(500);
}
async function previewShot(page, file, caption) {
  await settled(page);
  await page.screenshot({ path: `${PREVIEW}/${file}` });
  shots.push({ file, caption });
}
const scrollTo = (page, selector) => page.$eval(selector, (el) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); });

async function signBoth(page) {
  for (const canvas of await page.$$(".sig canvas")) {
    await canvas.scrollIntoViewIfNeeded();
    // The page can still move after End Lesson (finish odometer autofocus): draw once the canvas box has been still.
    let b = await canvas.boundingBox();
    for (let i = 0, still = 0; i < 60 && still < 2; i++) { await settle(60); const n = await canvas.boundingBox(); still = n && b && n.x === b.x && n.y === b.y ? still + 1 : 0; b = n; }
    await canvas.scrollIntoViewIfNeeded();
    b = await canvas.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + 70, b.y + 70, { steps: 5 });
    await page.mouse.move(b.x + 150, b.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction((el) => el.closest(".sig")?.querySelector(".sig-ok") !== null, canvas, { timeout: 5000 }).catch(() => {});
  }
}
async function exportPdf(page, path) {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click("text=Export CBT&A PDF")]);
  await download.saveAs(path);
  return readFileSync(path).subarray(0, 5).toString() === "%PDF-";
}

const ids = {};
// Each numbered section runs on its own: an exception is that section's FAIL line, and later sections still run.
async function section(name, body) {
  try { await body(); } catch (error) { check(`${name}: section ran to completion`, false, error.message?.split("\n").slice(0, 12).join(" ").slice(0, 1500) ?? String(error)); }
}
const needs = (...values) => { if (values.some((v) => !v)) throw new Error("skipped: an earlier section did not create the records this one needs"); };
// ═══ 0. The harness really runs the SaaS edition on a brand-new migrations-saas database ═══
await section("0. The harness really runs the SaaS edition on a brand-new migrations-saas database", async () => {
  const me = await api("qa-probe@example.test", "/api/me");
  check("setup: GET /api/me reports mode \"saas\" (APP_MODE from the copy's wrangler [vars] via the Cloudflare context)", me.status === 200 && me.json?.mode === "saas" && me.json.instructor === null, `${me.status} ${me.text}`);
  const count = sql("SELECT count(*) AS n FROM instructors")[0].n;
  check("setup: brand-new migrations-saas database has exactly 0 instructors before the first sign-up", count === 0, String(count));
  const nameIndex = sql("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'instructors_name_idx'").length;
  const emailIndex = sql("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'instructors_email_idx'").length;
  check("setup: database has the SaaS schema (no unique-name index, unique e-mail index)", nameIndex === 0 && emailIndex === 1);
});

// ═══ 1. No identity → 403, exactly like production without a Cloudflare Access identity ═══
await section("1. No identity → 403, exactly like production without a Cloudflare Access identity", async () => {
  const home = await api(null, "/");
  const me = await api(null, "/api/me");
  check("no x-qa-email: GET / → 403 \"Cloudflare Access identity required.\"", home.status === 403 && home.text === "Cloudflare Access identity required.", `${home.status} ${home.text.slice(0, 80)}`);
  check("no x-qa-email: GET /api/me → 403", me.status === 403 && me.text === "Cloudflare Access identity required.", `${me.status} ${me.text.slice(0, 80)}`);
});

// ═══ 9 (first half). Before sign-up: /terms, /privacy, /welcome reachable without an instructor row, no h-scroll at 375 ═══
await section("9 (first half). Before sign-up: /terms, /privacy, /welcome reachable without an instructor row, no h-scroll at 375", async () => {
  const { ctx, page } = await session(OFF);
  for (const [path, file, caption] of [["/terms", "09-terms.png", "Terms of Use (draft, awaiting review), readable before signing up."], ["/privacy", "10-privacy.png", "Privacy Policy (draft, awaiting review), readable before signing up."]]) {
    const r = await page.goto(B + path);
    await page.waitForSelector("[data-testid=draft-notice]");
    check(`${path} renders with "DRAFT — not yet reviewed" for an e-mail with no instructor row`, r.status() === 200 && new URL(page.url()).pathname === path && (await page.textContent("[data-testid=draft-notice]")) === "DRAFT — not yet reviewed", `${r.status()} ${page.url()}`);
    await previewShot(page, file, caption);
  }
  await ctx.close();
  const narrow = await session(OFF, { viewport: { width: 375, height: 812 } });
  for (const path of ["/welcome", "/terms", "/privacy"]) {
    await narrow.page.goto(B + path);
    await narrow.page.waitForSelector(path === "/welcome" ? "[data-testid=welcome-form]" : "[data-testid=draft-notice]");
    check(`no horizontal scroll at 375px: ${path}`, await noHScroll(narrow.page), `scrollWidth ${await narrow.page.evaluate(() => document.documentElement.scrollWidth)}`);
  }
  await narrow.ctx.close();
});

// ═══ 2 + 4. qa-sam: sign-up through /welcome, then the whole journey ═══
const sam = await session(SAM);
await section("2 + 4. qa-sam: sign-up through /welcome, then the whole journey", async () => {
  const { page } = sam;
  const welcomePosts = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/welcome") welcomePosts.push(r); });
  await page.goto(B + "/");
  await page.waitForSelector("[data-testid=welcome-form]");
  check("new e-mail: GET / ends on /welcome", new URL(page.url()).pathname === "/welcome", page.url());
  await previewShot(page, "01-welcome.png", "First visit: a new instructor sets up their profile (name, ADI number, terms).");

  // Continue cannot submit an incomplete form: each missing field shows its own inline message and nothing is sent.
  const submit = "[data-testid=welcome-submit]";
  const errorsShown = () => page.$$eval("[data-testid=welcome-form] .field-error", (e) => e.map((x) => x.textContent));
  await page.click(submit); await settle(300);
  const e0 = await errorsShown();
  await page.fill("[data-testid=welcome-name]", SAM_NAME);
  await page.click(submit); await settle(300);
  const e1 = await errorsShown();
  await page.fill("[data-testid=welcome-adi]", "QA-ADI-101");
  await page.click(submit); await settle(300);
  const e2 = await errorsShown();
  check("welcome: Continue does not submit until name, ADI number and the accept box are all filled (inline message per missing field, no POST)",
    welcomePosts.length === 0 && e0.length === 3 && e1.length === 2 && !e1.some((t) => /Full name/.test(t)) && e2.length === 1 && /Terms/.test(e2[0]), JSON.stringify({ posts: welcomePosts.length, e0, e1, e2 }));
  // The tick must really be drawn: element screenshots of the box unticked and ticked must differ. Both are taken after
  // a first tick has cleared the "please confirm" error (its red invalid border would otherwise be the only difference).
  const box = page.locator("[data-testid=welcome-accept]");
  const shotOf = async () => { await page.evaluate(() => document.activeElement?.blur()); await settle(200); return box.screenshot(); };
  await page.check("[data-testid=welcome-accept]");
  await page.uncheck("[data-testid=welcome-accept]");
  const unticked = await shotOf();
  await page.check("[data-testid=welcome-accept]");
  const ticked = await shotOf();
  check("welcome: the accept checkbox visibly changes when ticked (element screenshots differ)", (await box.isChecked()) && !unticked.equals(ticked), `${unticked.length} vs ${ticked.length} bytes`);
  const rowHeight = await page.$eval(".check-row", (e) => e.getBoundingClientRect().height);
  check("welcome: the accept row is a ≥44px tap target", rowHeight >= 44, String(rowHeight));
  check("welcome: Continue is enabled once the form is complete", !(await page.isDisabled(submit)) && (await errorsShown()).length === 0);
  await previewShot(page, "02-welcome-filled.png", "The profile form filled in and ready to continue.");

  await page.dblclick(submit);
  await page.waitForURL(B + "/", { timeout: 20000 });
  await ready(page);
  const rows = instructorRows(SAM);
  check("welcome: double-click on Continue creates exactly one instructor (one POST /api/welcome)", rows.length === 1 && sql("SELECT count(*) AS n FROM instructors")[0].n === 1 && welcomePosts.length === 1, `rows ${rows.length}, posts ${welcomePosts.length}`);
  ids.sam = rows[0]?.id;
  check("welcome: submitting lands on /", new URL(page.url()).pathname === "/");
  const banner = (await page.textContent("[data-testid=trial-banner] span"))?.trim();
  check("home: header shows the trial banner \"Free trial: 30 days left\" (29/30)", TRIAL_ACTIVE.test(banner ?? ""), banner);
  const tabs = await page.$$eval(".view-tab", (b) => b.map((x) => x.textContent.trim()));
  check("home: no instructor picker (no \"All\" view)", !tabs.some((t) => t.startsWith("All")), JSON.stringify(tabs));
  check("home: no /gps link", (await page.$("a[href^='/gps']")) === null);
  check("home: no \"Paste from assistant\" (ACTGDS's own assistant format)", (await page.$("[data-testid=paste-draft-open]")) === null && (await page.$("[data-testid=paste-draft]")) === null);
  // An outside instructor sees the product name, not the school's internals.
  const brand = await page.evaluate(() => ({ name: document.querySelector(".brand strong")?.textContent, title: document.title, text: document.body.innerText, foot: document.querySelector("footer.foot")?.textContent ?? "" }));
  check("home: header and page title say \"Instructor Assistant\"; no \"ACTGDS\" anywhere on the page; footer has no school line but keeps the G-NAF attribution",
    brand.name === "Instructor Assistant" && brand.title.includes("Instructor Assistant") && !brand.title.includes("ACTGDS") && !brand.text.includes("ACTGDS") && !brand.foot.includes("Golden Driving School") && brand.foot.includes("G-NAF"),
    JSON.stringify({ name: brand.name, title: brand.title, foot: brand.foot.slice(0, 60), actgds: brand.text.includes("ACTGDS") }));
  check("home: Signed in as the new account, with an Account link", (await page.textContent(".signed-in-as span")) === `Signed in as ${SAM_NAME}` && (await page.$("[data-testid=account-link]")) !== null);
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > width + 0.5).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${e.getAttribute("class") ?? ""} right=${Math.round(e.getBoundingClientRect().right)}`);
    return { ok: document.documentElement.scrollWidth <= width, detail: `scrollWidth ${document.documentElement.scrollWidth} > ${width}: ${wide.join(", ")}` };
  });
  check("home: no horizontal scroll at iPhone 13 width (390px)", overflow.ok, overflow.ok ? "" : overflow.detail);
  const appManifest = await api(SAM, "/manifest.webmanifest");
  check("installed-app manifest (as served) is named \"Instructor Assistant\", no school wording", appManifest.status === 200 && appManifest.json?.name === "Instructor Assistant" && !appManifest.text.includes("ACTGDS") && !appManifest.text.includes("Golden Driving School"), `${appManifest.status} ${appManifest.text.slice(0, 160)}`);
  const gps = await api(SAM, "/gps");
  check("GET /gps → 404 for a signed-up account", gps.status === 404, String(gps.status));
  // With no learners the app opens (and scrolls to) the New learner form; the preview shows the top: banner + empty list.
  await page.evaluate(() => window.scrollTo(0, 0));
  await previewShot(page, "03-home-empty.png", "Home right after sign-up: empty learner list and the 30-day free trial banner.");

  // Dark mode of the same screen, while it is still empty.
  const dark = await session(SAM, { colorScheme: "dark" });
  await dark.page.goto(B + "/"); await ready(dark.page);
  await settled(dark.page);
  await dark.page.evaluate(() => window.scrollTo(0, 0));
  await previewShot(dark.page, "dark-03-home-empty.png", "The same home screen in dark mode.");
  await dark.ctx.close();

  // Add a learner. With no learners yet the app opens the New learner form by itself (driver-app initial load).
  check("home (no learners yet): the New learner form is already open", (await page.$("[data-testid=learner-form]")) !== null);
  if ((await page.$("[data-testid=learner-form]")) === null) await page.click("[data-testid=new-learner]");
  await page.waitForSelector("[data-testid=save-learner]");
  check("new learner form: no instructor picker", (await page.$("text=Select instructor…")) === null && (await page.$("label:has-text('Instructor') select")) === null);
  const subline = await page.textContent(".form-sub");
  check("new learner form: the note does not ask for an instructor", !/instructor/i.test(subline ?? ""), subline);
  await page.fill('label:has-text("Student name") input', LEARNER);
  // The action bar is un-pinned while a field has focus (globals.css): leave the field first so the tap lands on Save.
  await page.evaluate(() => document.activeElement?.blur());
  await settle(300);
  await page.click("[data-testid=save-learner]");
  await page.waitForSelector(".summary", { timeout: 20000 });
  const learners = (await api(SAM, "/api/learners")).json.learners;
  ids.samLearner = learners.find((l) => l.fullName === LEARNER)?.id;
  check("journey: learner added through the UI belongs to qa-sam", learners.length === 1 && learners[0].instructorId === ids.sam, JSON.stringify(learners.map((l) => [l.fullName, l.instructorId])));
  check("learner page: no Transfer on the page", (await page.$("[data-testid=transfer-open]")) === null);
  check("learner page: no Integration ID line, no \"ACTGDS\"", (await page.$(".integration-id")) === null && !(await page.evaluate(() => document.body.innerText.includes("ACTGDS"))));
  await page.click("[data-testid=edit-learner]");
  await page.waitForSelector("[data-testid=save-learner]");
  // Open the folded "More" (where the private edition offers Transfer) without a tap the pinned action bar could cover.
  if (await page.$("[data-testid=learner-more]")) { await page.$eval("[data-testid=learner-more]", (e) => { e.open = true; }); await settle(200); }
  check("learner page: no Transfer under Edit learner > More", (await page.$("[data-testid=transfer-open]")) === null && (await page.$("text=Transfer learner")) === null);
  await page.click("[data-testid=cancel-edit-learner]");
  await page.waitForSelector("[data-testid=learner-form]", { state: "detached" });
  await scrollTo(page, ".summary");
  await previewShot(page, "04-learner.png", "A new learner's page: Start Lesson, progress at zero, PDF export.");

  // Record a lesson.
  await page.fill('input[placeholder="e.g. 45210"]', "45210");
  await page.click("text=Start Lesson");
  await page.click("text=End Lesson");
  await page.fill('input[placeholder="Enter now"]', "45238");
  // Each chip is centred first: the sticky competency header and the pinned Save bar can cover a chip at the edges.
  for (const n of ["1", "2", "3", "4"]) {
    const chip = page.locator(`.comp-section:has(.comp-label:text-is("Taught")) .chip-row >> text="${n}"`).first();
    await chip.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await chip.click();
  }
  await page.evaluate(() => document.activeElement?.blur());
  await page.click(".edit-times summary");
  await page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await page.fill('.edit-times input[type="time"] >> nth=1', "10:00");
  await signBoth(page);
  await page.evaluate(() => document.activeElement?.blur());
  await scrollTo(page, '.comp-section:has(.comp-label:text-is("Taught"))');
  await previewShot(page, "05-lesson-form.png", "Recording Lesson #1: competencies 1-4 taught, times and odometer filled in.");
  await page.click(".btn.save");
  await page.waitForSelector(".status.ok, .status.error", { timeout: 20000 });
  const status = await page.textContent(".status");
  check("journey: Start/End Lesson + Taught + both signatures save Lesson #1", status.includes("Lesson #1 saved"), status);
  await page.waitForSelector("[data-testid=history-row]");
  const histRows = await page.$$eval("[data-testid=history-row]", (e) => e.map((x) => x.textContent));
  check("journey: the lesson is in History (#1, 28 km odometer)", histRows.length === 1 && histRows[0].includes("#1") && histRows[0].includes("45210"), histRows.join("|").slice(0, 200));
  const lessons = (await api(SAM, `/api/learners/${ids.samLearner}`)).json?.lessons ?? [];
  ids.samLesson = lessons[0]?.id;
  await scrollTo(page, "[data-testid=history-learner]");
  await previewShot(page, "06-history.png", "History after saving: Lesson #1 with its competencies, times, odometer and signatures.");
  check("journey: learner PDF export downloads a real PDF", await exportPdf(page, `${OUT}/sam-learner.pdf`));
  check("no horizontal scroll (lesson saved + history, 390px)", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), String(await page.evaluate(() => document.documentElement.scrollWidth)));

  const darkHist = await session(SAM, { colorScheme: "dark", lastLearner: ids.samLearner });
  await darkHist.page.goto(B + "/"); await darkHist.page.waitForSelector("[data-testid=history-row]");
  await scrollTo(darkHist.page, "[data-testid=history-learner]");
  await previewShot(darkHist.page, "dark-06-history.png", "History in dark mode.");
  await darkHist.ctx.close();

  // /account
  await page.goto(B + "/account");
  await page.waitForSelector("[data-testid=account-name]");
  const accountTrial = (await page.textContent("[data-testid=account-trial]"))?.trim();
  check("/account: name, ADI number and trial days shown", (await page.textContent("[data-testid=account-name]")) === SAM_NAME && (await page.textContent("[data-testid=account-adi]")) === "QA-ADI-101" && TRIAL_ACTIVE.test(accountTrial ?? ""), accountTrial);
  check("/account: Export my data link and Sign out link present", (await page.getAttribute("[data-testid=export-link]", "href")) === "/api/account/export" && (await page.$("[data-testid=signout-link]")) !== null);
  await previewShot(page, "07-account.png", "Account page: profile, trial days left, Export my data, Sign out.");
});

// ═══ 5. qa-jo: same display name, but nothing of qa-sam's is reachable ═══
await section("5. qa-jo: same display name, but nothing of qa-sam's is reachable", async () => {
  needs(ids.sam, ids.samLearner, ids.samLesson);
  const welcome = await api(JO, "/api/welcome", { method: "POST", body: { fullName: SAM_NAME, adiNumber: "QA-ADI-202" } });
  ids.jo = welcome.json?.instructor?.id;
  check("qa-jo signs up with the same display name as qa-sam (allowed)", welcome.status === 201 && welcome.json.instructor.fullName === SAM_NAME && ids.jo && ids.jo !== ids.sam, `${welcome.status} ${welcome.text}`);
  const { ctx, page } = await session(JO, { lastLearner: ids.samLearner });
  await page.goto(B + "/"); await ready(page);
  await settled(page);
  check("qa-jo: learner list is empty (even with qa-sam's learner id as the device's last learner)", (await page.$$("[data-testid=learner-card]")).length === 0 && (await page.$(".summary")) === null);
  check("qa-jo: GET /api/learners is empty", (await api(JO, "/api/learners")).json?.learners?.length === 0);
  await ctx.close();
  const joLearner = await api(JO, "/api/learners", { method: "POST", body: { fullName: "QA Jo Pupil" } });
  ids.joLearner = joLearner.json?.learner?.id;
  check("qa-jo: can create its own learner", joLearner.status === 201 && joLearner.json.learner.instructorId === ids.jo, `${joLearner.status} ${joLearner.text.slice(0, 120)}`);

  const L = `/api/learners/${ids.samLearner}`;
  const lessonBody = { lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "2", taughtIds: ["1"], adiSignature: SIG, learnerSignature: SIG };
  const probes = [
    ["GET", L], ["PATCH", L, { fullName: "QA Hijack" }],
    ["GET", `${L}/lessons`], ["POST", `${L}/lessons`, lessonBody],
    ["GET", `${L}/lessons/${ids.samLesson}`], ["PATCH", `${L}/lessons/${ids.samLesson}`, { location: "QA Hijack" }],
    ["GET", `${L}/lessons/${ids.samLesson}/revisions`], ["POST", `${L}/lessons/${ids.samLesson}/sign`, { adiSignature: SIG, learnerSignature: SIG }],
    ["GET", `${L}/export`], ["GET", `${L}/archive-history`],
    ["GET", `${L}/import-draft`], ["PUT", `${L}/import-draft`, { csv: "date\n" }], ["DELETE", `${L}/import-draft`], ["POST", `${L}/import`, { csv: "date\n" }],
    ["POST", `${L}/transfer`, { toInstructorId: ids.jo }], ["POST", `${L}/transfer/checked`, {}],
  ];
  const leaks = [];
  for (const [method, path, body] of probes) {
    const r = await api(JO, path, { method, body });
    if (r.status !== 404) leaks.push(`${method} ${path.replace(ids.samLearner, "<sam>")} → ${r.status}`);
  }
  check(`qa-jo: GET/PATCH/POST/PUT/DELETE on qa-sam's learner, lessons, export, import-draft, sign → all 404 (${probes.length} probes)`, leaks.length === 0, leaks.join("; "));
  const own = await Promise.all([L, `${L}/export`, `${L}/lessons/${ids.samLesson}/revisions`, `${L}/import-draft`].map((path) => api(SAM, path)));
  check("control: the same GET paths answer qa-sam itself (200), so the 404s above are the guard", own.every((r) => r.status === 200), own.map((r) => r.status).join(","));
  // Listings that are not keyed by a learner id: qa-jo's must hold only qa-jo's own rows. An archived learner of qa-sam's
  // exists first, so the archived listing check has something it could leak. (Both accounts share a display name, so
  // the instructor listing is checked by id and ADI number.)
  const archivedSam = await api(SAM, "/api/learners", { method: "POST", body: { fullName: "QA Sam Archived" } });
  ids.samArchived = archivedSam.json?.learner?.id;
  const archiveIt = await api(SAM, `/api/learners/${ids.samArchived}`, { method: "PATCH", body: { archived: true } });
  const samArchivedList = await api(SAM, "/api/learners?status=archived");
  const joArchivedList = await api(JO, "/api/learners?status=archived");
  check("qa-jo: GET /api/learners?status=archived holds none of qa-sam's learners (qa-sam has an archived one)",
    archiveIt.status === 200 && samArchivedList.json?.learners?.some((l) => l.id === ids.samArchived) && joArchivedList.status === 200 && joArchivedList.json.learners.every((l) => l.instructorId === ids.jo) && !joArchivedList.text.includes(ids.samArchived) && !joArchivedList.text.includes("QA Sam"),
    `${archiveIt.status} ${joArchivedList.status} ${joArchivedList.text.slice(0, 160)}`);
  const joInstructors = await api(JO, "/api/instructors");
  check("qa-jo: GET /api/instructors → 200 with exactly qa-jo's own instructor (no qa-sam id or ADI number)",
    joInstructors.status === 200 && joInstructors.json?.instructors?.length === 1 && joInstructors.json.instructors[0].id === ids.jo && joInstructors.json.instructors[0].adiNumber === "QA-ADI-202" && !joInstructors.text.includes(ids.sam) && !joInstructors.text.includes("QA-ADI-101"),
    `${joInstructors.status} ${joInstructors.text.slice(0, 200)}`);
  const patchInstructor = await api(JO, `/api/instructors/${ids.sam}`, { method: "PATCH", body: { adiNumber: "QA-HIJACK" } });
  check("qa-jo: PATCH /api/instructors/<qa-sam id> → 404", patchInstructor.status === 404, String(patchInstructor.status));
  const ownTransfer = await api(JO, `/api/learners/${ids.joLearner}/transfer`, { method: "POST", body: { toInstructorId: ids.sam } });
  check("qa-jo: /api/learners/<id>/transfer → 404 (qa-sam's and its own)", ownTransfer.status === 404 && !leaks.some((l) => l.includes("transfer")), String(ownTransfer.status));
  const samAfter = (await api(SAM, L)).json?.learner;
  check("qa-jo's rejected writes changed nothing of qa-sam's", samAfter?.fullName === LEARNER && samAfter.instructorId === ids.sam && instructorRows(SAM)[0].full_name === SAM_NAME);

  // /api/unsigned-lessons and /api/me/signature only ever touch the signed-in account.
  const unsigned = await api(SAM, `${L}/lessons`, { method: "POST", body: { lessonDate: "2026-10-21", startTime: "09:00", finishTime: "10:00", startOdometer: "45238", finishOdometer: "45250", taughtIds: ["5"], signLater: true } });
  ids.samUnsigned = unsigned.json?.lesson?.id;
  const joUnsigned = await api(JO, "/api/unsigned-lessons");
  const samUnsigned = await api(SAM, "/api/unsigned-lessons");
  check("/api/unsigned-lessons: qa-jo sees none of qa-sam's unsigned lessons; qa-sam sees its own", unsigned.status === 201 && joUnsigned.status === 200 && joUnsigned.json.lessons.length === 0 && samUnsigned.json.lessons.some((l) => l.lessonId === ids.samUnsigned), `${unsigned.status} jo ${joUnsigned.text.slice(0, 80)}`);
  const samSigBefore = (await api(SAM, "/api/me/signature")).json?.signature ?? null;
  const joPut = await api(JO, "/api/me/signature", { method: "PUT", body: { signature: SIG } });
  const joSig = (await api(JO, "/api/me/signature")).json?.signature;
  const samSigAfter = (await api(SAM, "/api/me/signature")).json?.signature ?? null;
  check("/api/me/signature: qa-jo's PUT sets only qa-jo's saved signature", joPut.status === 200 && joSig === SIG && samSigAfter === samSigBefore, `${joPut.status} sam ${String(samSigBefore).slice(0, 20)} → ${String(samSigAfter).slice(0, 20)}`);
  await api(JO, "/api/me/signature", { method: "PUT", body: { signature: "" } });
});

// ═══ 6. Header forging as qa-jo: client-supplied identity / middleware headers have no effect ═══
await section("6. Header forging as qa-jo: client-supplied identity / middleware headers have no effect", async () => {
  needs(ids.sam, ids.jo, ids.samLearner);
  // x-middleware-subrequest in its current (Next >= 13.2, CVE-2025-29927) form: the middleware name repeated up to the
  // recursion depth (5), for both `middleware` and `src/middleware`. Either would skip middleware if Next honoured it.
  for (const subrequest of ["middleware:middleware:middleware:middleware:middleware", "src/middleware:src/middleware:src/middleware:src/middleware:src/middleware"]) {
    const forged = {
      "x-instructor-id": ids.sam, "x-instructor-name": "forged", "x-access-email": SAM,
      "x-middleware-request-x-instructor-id": ids.sam, "x-middleware-override-headers": "x-instructor-id", "x-middleware-subrequest": subrequest,
    };
    const tag = `(x-middleware-subrequest: ${subrequest.split(":")[0]} ×5)`;
    const me = await api(JO, "/api/me", { headers: forged });
    check(`forged headers ${tag}: GET /api/me is still qa-jo`, me.status === 200 && me.json?.instructor?.id === ids.jo && me.json.instructor.fullName === SAM_NAME, `${me.status} ${me.text.slice(0, 160)}`);
    const list = await api(JO, "/api/learners", { headers: forged });
    const names = (list.json?.learners ?? []).map((l) => l.fullName);
    check(`forged headers ${tag}: GET /api/learners is qa-jo's list, without qa-sam's learner`, list.status === 200 && !names.includes(LEARNER) && names.includes("QA Jo Pupil") && list.json.learners.every((l) => l.instructorId === ids.jo), `${list.status} ${JSON.stringify(names)}`);
    const page = await api(JO, "/", { headers: forged });
    check(`forged headers ${tag}: GET / still renders for qa-jo (no bypass, no error)`, page.status === 200, String(page.status));
  }
});

// ═══ 4 (end). qa-sam's own data export contains only qa-sam's records ═══
await section("4 (end). qa-sam's own data export contains only qa-sam's records", async () => {
  needs(ids.sam, ids.jo, ids.samLearner);
  const { page } = sam;
  // Fetched from the /account page itself: Playwright does not add extraHTTPHeaders (our stand-in for the Access
  // cookie) to a native <a download> navigation, so clicking the link would download the stub's 403. The link's href
  // is asserted above; this is the same GET, from the same page, with the same identity.
  const res = await page.evaluate(async () => { const r = await fetch("/api/account/export"); return { status: r.status, disposition: r.headers.get("content-disposition"), text: await r.text() }; });
  writeFileSync(`${OUT}/sam-export.json`, res.text);
  let data = null;
  try { data = JSON.parse(res.text); } catch { /* checked below */ }
  check("/api/account/export (from /account): an attachment with this account's learners (active + archived) and lessons only",
    res.status === 200 && /^attachment; filename="instructor-assistant-export-\d{4}-\d{2}-\d{2}\.json"$/.test(res.disposition ?? "") &&
    data?.instructor?.id === ids.sam && data.learners.length === 2 && data.learners.find((l) => l.learner.fullName === LEARNER)?.lessons.length === 2 && data.learners.some((l) => l.learner.id === ids.samArchived && l.learner.archivedAt) && !res.text.includes(ids.jo) && !res.text.includes("QA Jo Pupil"),
    `${res.status} ${res.disposition} ${data?.learners?.length} learner(s)`);
  check("/api/account/export: compact JSON (not pretty-printed)", res.status === 200 && !res.text.includes("\n"), `${res.text.length} chars`);
  await sam.ctx.close();
});

// ═══ 3 + 7. qa-late (QA 刘坤): Chinese name end to end, then an expired trial is read-only ═══
await section("3 + 7. qa-late (QA 刘坤): Chinese name end to end, then an expired trial is read-only", async () => {
  const { ctx, page } = await session(LATE);
  await page.goto(B + "/");
  await page.waitForSelector("[data-testid=welcome-form]");
  await page.fill("[data-testid=welcome-name]", LATE_NAME);
  await page.fill("[data-testid=welcome-adi]", "QA-ADI-303");
  await page.check("[data-testid=welcome-accept]");
  await page.click("[data-testid=welcome-submit]");
  await page.waitForURL(B + "/", { timeout: 20000 });
  await ready(page);
  const me = await api(LATE, "/api/me");
  check(`"${LATE_NAME}" signs up; the page loads and /api/me shows the name`, (await page.textContent(".signed-in-as span")) === `Signed in as ${LATE_NAME}` && me.json?.instructor?.fullName === LATE_NAME, me.text);
  const learner = await api(LATE, "/api/learners", { method: "POST", body: { fullName: "QA Late Learner" } });
  ids.lateLearner = learner.json?.learner?.id;
  const lesson = await api(LATE, `/api/learners/${ids.lateLearner}/lessons`, { method: "POST", body: { lessonDate: "2026-10-01", startTime: "09:00", finishTime: "10:00", startOdometer: "1000", finishOdometer: "1020", taughtIds: ["1", "2"], adiSignature: SIG, learnerSignature: SIG } });
  const unsignedLesson = await api(LATE, `/api/learners/${ids.lateLearner}/lessons`, { method: "POST", body: { lessonDate: "2026-10-02", startTime: "09:00", finishTime: "10:00", startOdometer: "1020", finishOdometer: "1030", taughtIds: ["3"], signLater: true } });
  check(`"${LATE_NAME}": later writes work (learner + lesson created during the trial)`, learner.status === 201 && lesson.status === 201 && unsignedLesson.status === 201, `${learner.status} ${lesson.status} ${unsignedLesson.status}`);

  // Backdated in the stored ISO format (created_at is written by strftime('%Y-%m-%dT%H:%M:%fZ', 'now')).
  sql(`UPDATE instructors SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-40 days') WHERE lower(email) = '${LATE}'`);
  const backdated = instructorRows(LATE)[0]?.created_at ?? "";
  const lateMe = await api(LATE, "/api/me");
  const endsAt = Date.parse(lateMe.json?.trialEndsAt ?? "");
  const expectedEnd = Date.now() - 10 * 24 * 3600 * 1000;
  // A real date ~10 days ago, not null/NaN (which the app would also read as "expired" and so hide wrong maths).
  check("expired trial: created_at stays ISO and /api/me trialEndsAt is a real date about 10 days ago",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(backdated) && Number.isFinite(endsAt) && Math.abs(endsAt - expectedEnd) < 3600 * 1000,
    `created_at ${backdated}, trialEndsAt ${lateMe.json?.trialEndsAt}`);
  await page.addInitScript((id) => localStorage.setItem("actgds-driver:last-learner", id), ids.lateLearner);
  await page.reload();
  await ready(page);
  await page.waitForSelector(".summary");
  const banner = (await page.textContent("[data-testid=trial-banner] span"))?.trim();
  check("expired trial: banner reads the read-only message", banner === TRIAL_ENDED && (await page.getAttribute("[data-testid=trial-banner]", "data-kind")) === "expired", banner);
  check("expired trial: + New learner, Start Lesson, Edit learner and History Edit are disabled (saving itself is refused by the API: the 402 check below)",
    (await page.isDisabled("[data-testid=new-learner]")) && (await page.isDisabled(".btn.go")) && (await page.isDisabled("[data-testid=edit-learner]")) && (await page.$$eval("[data-testid=history-row] .h-edit", (b) => b.every((x) => x.disabled))));
  check("expired trial: To sign and Sign now are disabled",
    (await page.isDisabled("[data-testid=to-sign-open]")) && (await page.$$eval("[data-testid=unsigned-badge]", (b) => b.length > 0 && b.every((x) => x.disabled))));
  check("expired trial: the raw code \"trial_expired\" is never shown", !(await page.evaluate(() => document.body.innerText.includes("trial_expired"))));
  const post = await api(LATE, "/api/learners", { method: "POST", body: { fullName: "QA Late Too Late" } });
  check("expired trial: POST /api/learners → 402 trial_expired", post.status === 402 && post.json?.error === "trial_expired", `${post.status} ${post.text}`);
  const get = await api(LATE, "/api/learners");
  check("expired trial: GET /api/learners still 200", get.status === 200 && get.json.learners.length === 1, String(get.status));
  check(`expired trial: PDF export of an existing learner still works ("${LATE_NAME}" on the PDF)`, await exportPdf(page, `${OUT}/late-learner.pdf`));
  await page.evaluate(() => window.scrollTo(0, 0));
  await previewShot(page, "08-expired.png", "After the free trial: read-only banner, adding and editing switched off, records and PDFs still available.");
  await ctx.close();
});

// ═══ 8. qa-off: an inactive account is sent to /disabled ═══
await section("8. qa-off: an inactive account is sent to /disabled", async () => {
  const welcome = await api(OFF, "/api/welcome", { method: "POST", body: { fullName: "QA Off Account", adiNumber: "QA-ADI-404" } });
  sql(`UPDATE instructors SET status = 'inactive' WHERE lower(email) = '${OFF}'`);
  const { ctx, page } = await session(OFF);
  await page.goto(B + "/");
  await page.waitForSelector("[data-testid=disabled-page]");
  check("inactive account: pages redirect to /disabled, which shows the disabled message", welcome.status === 201 && new URL(page.url()).pathname === "/disabled" && (await page.textContent("[data-testid=disabled-page]")).includes("This account is disabled. Contact support."), page.url());
  const list = await api(OFF, "/api/learners");
  check("inactive account: /disabled offers Sign out (the same Cloudflare Access logout link)", ((await page.getAttribute("[data-testid=signout-link]", "href")) ?? "").startsWith("/cdn-cgi/access/logout"));
  check("inactive account: GET /api/learners → 403 account_disabled", list.status === 403 && list.json?.error === "account_disabled", `${list.status} ${list.text}`);
  const terms = await api(OFF, "/terms");
  check("inactive account: /terms still reachable", terms.status === 200);
  await previewShot(page, "11-disabled.png", "A disabled account sees only this page; no data is shown.");
  await ctx.close();
});

// ═══ No horizontal scroll at 375 px on the main screens of each state ═══
await section("No horizontal scroll at 375 px on the main screens of each state", async () => {
  const sweep = async (email, paths, lastLearner) => {
    const { ctx, page } = await session(email, { viewport: { width: 375, height: 812 }, lastLearner });
    for (const [path, waitFor, label] of paths) {
      try {
        await page.goto(B + path);
        await page.waitForSelector(waitFor, { timeout: 20000 });
        await settled(page);
        check(`no horizontal scroll at 375px: ${label}`, await noHScroll(page), `scrollWidth ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      } catch (error) {
        check(`no horizontal scroll at 375px: ${label}`, false, error.message.split("\n")[0]);
      }
    }
    await ctx.close();
  };
  await sweep(SAM, [["/", "[data-testid=trial-banner]", "qa-sam home"], ...(ids.samLesson ? [["/", "[data-testid=history-row]", "qa-sam learner + History"]] : []), ["/account", "[data-testid=account-name]", "/account"]], ids.samLearner);
  await sweep(JO, [["/", "[data-testid=trial-banner]", "qa-jo home"]]);
  await sweep(LATE, [["/", "[data-testid=history-row]", "expired account home with learner"]], ids.lateLearner);
  await sweep(OFF, [["/disabled", "[data-testid=disabled-page]", "/disabled"]]);
});

// ═══ 10. No page errors / console errors anywhere in the journey ═══
check("no pageerror / console errors on any journey page", journeyErrors.length === 0, journeyErrors.join(" | ").slice(0, 1500));
await browser.close();

for (const r of results) console.log(r.line);
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\nSaaS pass: ${passed} passed, ${failed} failed (${results.length} checks); preview: ${shots.length} screenshots in ${PREVIEW}`);
writeFileSync(`${PREVIEW}/preview-manifest.json`, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  device: "iPhone 13 viewport (390x664 CSS px), deviceScaleFactor 2, light unless the file name starts with dark-",
  data: "synthetic QA accounts and learners only (local throw-away database built from migrations-saas/)",
  screenshots: shots,
  checks: { passed, failed, total: results.length, failures: results.filter((r) => !r.ok).map((r) => r.line) },
}, null, 2)}\n`);
process.exit(failed ? 1 : 0);
