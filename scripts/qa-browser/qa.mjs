// Real-browser business regression at iPhone 13 width (390px). See run.sh.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const B = process.env.QA_BASE;
const OUT = process.env.QA_OUT;
const ids = JSON.parse(readFileSync(`${OUT}/ids.json`, "utf8"));
const WHO = { tony: ["a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01", "Tony"], anna: ["a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02", "Anna"] };
const CHROMIUM = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;

const results = [];
const check = (name, ok, extra = "") => results.push({ ok: Boolean(ok), line: `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}` });
const browser = await chromium.launch({ executablePath: CHROMIUM });

async function session(who, { lastLearner, holdMe } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], extraHTTPHeaders: { "x-instructor-id": WHO[who][0], "x-instructor-name": WHO[who][1] } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.dialogAnswer = "accept";
  page.on("dialog", (d) => (page.dialogAnswer === "dismiss" ? d.dismiss() : d.accept()));
  if (lastLearner) await page.addInitScript((id) => localStorage.setItem("actgds-driver:last-learner", id), lastLearner);
  let release;
  if (holdMe) {
    const gate = new Promise((r) => (release = r));
    await page.route("**/api/me", async (route) => { await gate; await route.continue(); });
  }
  await page.goto(B);
  return { ctx, page, errors, release };
}
const ready = (page) => page.waitForFunction(() => document.querySelector(".view-tab.active") !== null);
const activeTab = (page) => page.textContent(".view-tab.active");
const options = (page) => page.$$eval('select[aria-label="Select learner"] option', (os) => os.filter((o) => o.value).map((o) => o.textContent));
const selectedValue = (page) => page.$eval('select[aria-label="Select learner"]', (s) => s.value);
const hasSummary = async (page) => (await page.$(".summary")) !== null;
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tab = (page, label) => page.click(`.view-tab:has-text("${label}")`);
const pick = (page, label) => page.selectOption('select[aria-label="Select learner"]', { label });
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
async function signBoth(page) {
  for (const canvas of await page.$$(".sig canvas")) {
    await canvas.scrollIntoViewIfNeeded();
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + 120 + Math.random() * 30, b.y + 90, { steps: 8 });
    await page.mouse.up();
  }
}
const learnersApi = async (q = "") => (await (await fetch(`${B}/api/learners${q}`)).json()).learners;
const postLesson = (id, body) =>
  fetch(`${B}/api/learners/${id}/lessons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// ═══ 1. Identity default: My learners, never stale device state ═══════════
{
  const s = await session("tony");
  await ready(s.page);
  check("viewport is iPhone 13 (390px)", (await s.page.evaluate(() => window.innerWidth)) === 390);
  check("Tony fresh login → default My learners", (await activeTab(s.page)).startsWith("My learners"));
  const opts = await options(s.page);
  check("Tony My learners = only Tony's active learners", opts.length === 6 && opts.every((o) => o.startsWith("QA Tony")), opts.join(","));
  check("nothing pre-selected on a fresh login", (await selectedValue(s.page)) === "" && !(await hasSummary(s.page)));
  check("no horizontal scroll (picker)", await noHScroll(s.page));
  await shot(s.page, "01-tony-my-learners");
  await s.page.reload(); await ready(s.page);
  check("Tony refresh/relogin → still My learners", (await activeTab(s.page)).startsWith("My learners"));
  check("Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}
{
  const s = await session("anna");
  await ready(s.page);
  const opts = await options(s.page);
  check("Anna fresh login → default My learners, only Anna's", (await activeTab(s.page)).startsWith("My learners") && opts.join() === "QA Anna Charlie,QA Anna Delta", opts.join(","));
  await s.ctx.close();
}
{
  const s = await session("tony", { lastLearner: ids.charlie });
  await ready(s.page);
  check("stale LAST_LEARNER of a colleague (Anna's) → Tony still My learners", (await activeTab(s.page)).startsWith("My learners"));
  check("stale colleague LAST_LEARNER is not opened", !(await hasSummary(s.page)) && (await selectedValue(s.page)) === "");
  await s.ctx.close();
}
{
  const s = await session("anna", { lastLearner: ids.alpha });
  await ready(s.page);
  check("stale LAST_LEARNER of a colleague (Tony's) → Anna still My learners", (await activeTab(s.page)).startsWith("My learners") && !(await hasSummary(s.page)));
  await s.ctx.close();
}
{
  const s = await session("tony", { lastLearner: ids.alpha });
  await s.page.waitForSelector(".summary");
  check("own LAST_LEARNER is restored, in My learners", (await activeTab(s.page)).startsWith("My learners") && (await s.page.textContent(".summary-main small")) === "QA Tony Alpha");
  await s.ctx.close();
}
{
  const s = await session("tony", { holdMe: true });
  await settle(600);
  check("before identity resolves: neutral loading state, no view tabs (no 'All' flash)", (await s.page.$("[data-testid=picker-loading]")) !== null && (await s.page.$(".view-tab")) === null);
  s.release();
  await ready(s.page);
  check("after identity resolves: My learners", (await activeTab(s.page)).startsWith("My learners"));
  await s.ctx.close();
}

// ═══ 2. View switching never leaves a stale selected learner ══════════════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Alpha");
  await s.page.waitForSelector(".summary");
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelector(".view-tab.active")?.textContent.startsWith("Archived"));
  check("My → Archived: selected active learner cleared", !(await hasSummary(s.page)) && (await selectedValue(s.page)) === "");
  check("My → Archived: dropdown has no active learner", (await options(s.page)).every((o) => !o.includes("Tony Alpha")) && (await options(s.page)).length === 0, (await options(s.page)).join(","));
  await shot(s.page, "02-archived-empty-after-switch");
  await tab(s.page, "All");
  await pick(s.page, "QA Anna Charlie · Anna");
  await s.page.waitForSelector(".summary");
  await tab(s.page, "Archived");
  check("All → Archived: colleague's active learner cleared", !(await hasSummary(s.page)) && (await options(s.page)).length === 0);
  await tab(s.page, "All");
  await pick(s.page, "QA Anna Charlie · Anna");
  await s.page.waitForSelector(".summary");
  await tab(s.page, "My learners");
  check("All → My: colleague's learner cleared, dropdown only Tony's", !(await hasSummary(s.page)) && (await options(s.page)).every((o) => o.startsWith("QA Tony")));
  await pick(s.page, "QA Tony Alpha");
  await s.page.waitForSelector(".summary");
  await tab(s.page, "All");
  check("My → All: own learner is kept", (await hasSummary(s.page)) && (await s.page.textContent(".summary-main small")) === "QA Tony Alpha");
  await s.ctx.close();
}

// ═══ 3. Search × scope, archive / restore / persistence ═══════════════════
{
  const s = await session("tony");
  await ready(s.page);
  await s.page.fill(".learner-search", "alp");
  check("search 'alp' in My learners → Tony Alpha only", (await s.page.$$eval("[data-testid=learner-result] span", (e) => e.map((x) => x.textContent))).join() === "QA Tony Alpha");
  await s.page.fill(".learner-search", "charlie");
  check("search: colleague's learner absent from My learners", (await s.page.textContent(".learner-results")).includes("No matching learners"));
  await tab(s.page, "All");
  await s.page.fill(".learner-search", "charlie");
  check("search + All finds colleague's learner with instructor name", (await s.page.textContent("[data-testid=learner-result]")).includes("Anna"));
  await tab(s.page, "My learners");
  await s.page.fill(".learner-search", "");

  await pick(s.page, "QA Tony Bravo");
  await s.page.waitForSelector(".archive-link");
  check("active non-completed learner: Start Lesson present, plain Archive link, no suggestion", (await s.page.$("text=Start Lesson")) !== null && (await s.page.$("[data-testid=archive-suggestion]")) === null);
  s.page.dialogAnswer = "dismiss";
  await s.page.click(".archive-link"); await settle();
  check("cancelling the archive confirm keeps the learner active", (await options(s.page)).includes("QA Tony Bravo"));
  s.page.dialogAnswer = "accept";
  await s.page.click(".archive-link");
  await s.page.waitForSelector('.status:has-text("archived")');
  check("archive: removed from My learners; selection cleared", !(await options(s.page)).includes("QA Tony Bravo") && !(await hasSummary(s.page)));
  await s.page.reload(); await ready(s.page);
  check("archive persists after refresh", !(await options(s.page)).includes("QA Tony Bravo"));
  await s.page.fill(".learner-search", "bravo");
  check("archived learner absent from normal active search", (await s.page.textContent(".learner-results")).includes("No matching learners"));
  await s.page.fill(".learner-search", "");
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select learner"] option').length > 1);
  check("Archived view contains only archived learners", (await options(s.page)).join() === "QA Tony Bravo · Tony", (await options(s.page)).join(","));
  await s.page.fill(".learner-search", "alpha");
  check("active learner never matches in Archived search", (await s.page.textContent(".learner-results")).includes("No matching learners"));
  await s.page.fill(".learner-search", "");
  await pick(s.page, "QA Tony Bravo · Tony");
  await s.page.waitForSelector("[data-testid=archived-banner]");
  check("archived learner: Restore offered, no Start Lesson", (await s.page.$("text=Start Lesson")) === null && (await s.page.$("text=Restore learner")) !== null);
  check("no horizontal scroll (archived learner)", await noHScroll(s.page));
  await shot(s.page, "03-archived-learner");
  await s.page.click("text=Restore learner");
  await s.page.waitForSelector('.status:has-text("restored")');
  check("restore: back in My learners with Start Lesson", (await activeTab(s.page)).startsWith("My learners") && (await s.page.$("text=Start Lesson")) !== null);
  await s.page.reload(); await ready(s.page);
  check("restore persists after refresh", (await options(s.page)).includes("QA Tony Bravo"));
  check("Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 4. Competency 18-22 gate in the UI and on the server ═════════════════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Gate Locked");
  await s.page.waitForSelector("text=Start Lesson");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  const assessedRow = s.page.locator(".comp-section:has(.comp-label:text-is('Assessed')) .chip-row").first();
  const lockedStates = await Promise.all(["18", "19", "20", "21", "22"].map(async (id) => (await assessedRow.locator(`button:text-is("${id}")`).isDisabled()) && (await assessedRow.locator(`button:text-is("${id}")`).getAttribute("data-locked")) === "true"));
  check("1-17 achieved, Review 1-17 NOT: Assessed 18-22 all locked in the UI", lockedStates.every(Boolean), lockedStates.join());
  check("…while Assessed 17 (already achieved) / 1-17 chips are not gate-locked", (await assessedRow.locator('button:text-is("5")').getAttribute("data-locked")) === null);
  const taughtRow = s.page.locator(".comp-section:has(.comp-label:text-is('Taught')) .chip-row").first();
  const taught18Disabled = await taughtRow.locator('button:text-is("18")').isDisabled();
  await taughtRow.locator('button:text-is("18")').click();
  check("18 can be Taught before Review 1-17 (Taught is not gated)", !taught18Disabled && (await taughtRow.locator('button:text-is("18")').getAttribute("aria-pressed")) === "true");
  check("lock hint explains the rule", (await s.page.textContent(".comp-lock-hint")).includes("Review 1-17"));
  await shot(s.page, "04-gate-locked");
  const api = await postLesson(ids.gateLocked, { lessonDate: "2026-09-21", startTime: "09:00", finishTime: "10:00", startOdometer: "5000", finishOdometer: "5010", assessedIds: ["18"], achievedResults: { "18": "achieved" }, adiSignature: SIG, learnerSignature: SIG });
  check("server rejects assessing 18 before Review 1-17 (400)", api.status === 400 && /Competency 18-22 can only be assessed/.test(api.body.error), `${api.status} ${api.body.error}`);
  await s.ctx.close();
}
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Gate Open");
  await s.page.waitForSelector("text=Start Lesson");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  const assessedRow = s.page.locator(".comp-section:has(.comp-label:text-is('Assessed')) .chip-row").first();
  const open = await Promise.all(["18", "19", "20", "21", "22"].map(async (id) => !(await assessedRow.locator(`button:text-is("${id}")`).isDisabled())));
  check("1-17 + Review 1-17 achieved: Assessed 18-22 unlocked", open.every(Boolean), open.join());
  await s.ctx.close();
}

// ═══ 5. Final Drive completion, archive suggestion, no Start Lesson ═══════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Completed");
  await s.page.waitForSelector("[data-testid=cbta-completed-card]");
  check("completed learner: CBT&A Completed card + archive suggestion", (await s.page.$("[data-testid=archive-suggestion]")) !== null);
  check("completed learner: header says CBT&A Completed, not a next lesson number", (await s.page.textContent("[data-testid=lesson-no]")) === "CBT&A Completed");
  check("completed learner: Start Lesson not available", (await s.page.$("text=Start Lesson")) === null && (await s.page.$(".btn.go")) === null);
  check("completed learner: NOT auto-archived", (await learnersApi()).some((l) => l.id === ids.completed && l.archivedAt === null));
  check("no horizontal scroll (completed)", await noHScroll(s.page));
  await shot(s.page, "05-completed");
  const api = await postLesson(ids.completed, { lessonDate: "2026-09-21", startTime: "09:00", finishTime: "10:00", startOdometer: "9000", finishOdometer: "9010", taughtIds: ["1"], adiSignature: SIG, learnerSignature: SIG });
  check("server rejects an ordinary lesson for a completed learner (400)", api.status === 400 && /already completed/.test(api.body.error), `${api.status} ${api.body.error}`);
  s.page.dialogAnswer = "dismiss";
  await s.page.click("[data-testid=archive-suggestion] button"); await settle();
  check("instructor can decline the suggestion: learner stays active", (await learnersApi()).some((l) => l.id === ids.completed && l.archivedAt === null) && (await s.page.$("[data-testid=archive-suggestion]")) !== null);
  await s.ctx.close();
}
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony FD Ready");
  await s.page.waitForSelector("text=Start Lesson");
  check("before Final Drive: normal lesson panel, no completed card", (await s.page.$("[data-testid=cbta-completed-card]")) === null);
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.fill('input[placeholder="Enter now"]', String(1000 + 12 * 4 + 30));
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.click('.result-list li:has-text("23 Final Drive") >> text="Achieved"');
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await signBoth(s.page);
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("saving the Final Drive lesson succeeds", (await s.page.textContent(".status")).includes("saved"), await s.page.textContent(".status"));
  check("right after saving (no reload): completed card + archive suggestion, Start Lesson gone", (await s.page.$("[data-testid=archive-suggestion]")) !== null && (await s.page.$("text=Start Lesson")) === null);
  check("…and NOT auto-archived", (await learnersApi()).some((l) => l.id === ids.fdReady && l.archivedAt === null));
  await s.page.reload(); await ready(s.page);
  await tab(s.page, "My learners");
  await pick(s.page, "QA Tony FD Ready");
  await s.page.waitForSelector("[data-testid=cbta-completed-card]");
  check("after reload the completed state is preserved", (await s.page.$("text=Start Lesson")) === null);
  await s.page.click("[data-testid=archive-suggestion] button");
  await s.page.waitForSelector('.status:has-text("archived")');
  check("completed learner can be archived by the instructor", !(await options(s.page)).includes("QA Tony FD Ready"), (await options(s.page)).join(","));
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select learner"] option').length > 1);
  await pick(s.page, "QA Tony FD Ready · Tony");
  await s.page.waitForSelector("[data-testid=archived-banner]");
  await s.page.click("text=Restore learner");
  await s.page.waitForSelector('.status:has-text("restored")');
  check("restored completed learner shows the completed card again (still no Start Lesson)", (await s.page.$("[data-testid=cbta-completed-card]")) !== null && (await s.page.$("text=Start Lesson")) === null);
  await s.ctx.close();
}

// ═══ 6. Regression: lesson workflow, History Edit, signatures, PDF ═══════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Alpha");
  await s.page.waitForSelector("text=Start Lesson");
  check("regression: next lesson number and odometer carried forward", (await s.page.textContent("[data-testid=lesson-no]")) === "Lesson #2" && (await s.page.inputValue('input[placeholder="e.g. 45210"]')) === "1012");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.fill('input[placeholder="Enter now"]', "1030");
  await s.page.click('.comp-section:has(.comp-label:text-is("Taught")) .chip-row >> text="3"');
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await signBoth(s.page);
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("regression: Start/End Lesson + CBT&A + signatures save", (await s.page.textContent(".status")).includes("Lesson #2 saved"), await s.page.textContent(".status"));
  check("regression: cumulative km derived (12 + 18 = 30)", (await s.page.textContent("[data-testid=total-km]")) === "30 km");
  check("regression: cumulative time derived (1h + 45m)", (await s.page.textContent("[data-testid=total-hours]")).startsWith("1h 45m"));
  await s.page.click("[data-testid=history-row] .h-edit >> nth=0");
  await s.page.waitForSelector("text=Editing Lesson #2");
  await s.page.fill('.h-editing input[type="time"] >> nth=1', "10:15");
  await signBoth(s.page);
  await s.page.click(".h-editing .btn.save");
  await s.page.waitForSelector(".status.ok:has-text('Lesson updated'), .h-editing .status.error");
  if (await s.page.$(".h-editing .status.error")) console.log("HISTORY EDIT ERROR:", await s.page.textContent(".h-editing .status.error"));
  check("regression: History Edit saves and recalculates (1h 45m + 1h → 2h 15m total)", (await s.page.textContent("[data-testid=total-hours]")).startsWith("2h 15m"), await s.page.textContent("[data-testid=total-hours]"));
  check("regression: instructor attribution shown on the edited lesson", (await s.page.textContent("[data-testid=history-row] >> nth=0")).includes("Last edited by Tony"));
  await s.page.click("text=/Export.*PDF/i");
  await s.page.waitForSelector(".export-adi-prompt input");
  await s.page.fill(".export-adi-prompt input", "QA-ADI-1");
  const [download] = await Promise.all([s.page.waitForEvent("download", { timeout: 60000 }), s.page.click(".export-adi-prompt .btn.primary")]);
  const pdfPath = `${OUT}/qa-export.pdf`;
  await download.saveAs(pdfPath);
  check("regression: PDF export downloads a real PDF", readFileSync(pdfPath).subarray(0, 5).toString() === "%PDF-", download.suggestedFilename());
  check("no horizontal scroll (lesson + history)", await noHScroll(s.page));
  await shot(s.page, "06-regression-lesson");
  check("Tony: no page errors (regression)", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/results.txt`, results.map((r) => r.line).join("\n"));
console.log(results.map((r) => r.line).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? `  (${failed} FAIL)` : ""}`);
process.exit(failed ? 1 : 0);
