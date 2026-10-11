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

try {
// ═══ 1. Identity default: My learners, never stale device state ═══════════
{
  const s = await session("tony");
  await ready(s.page);
  check("viewport is iPhone 13 (390px)", (await s.page.evaluate(() => window.innerWidth)) === 390);
  check("Tony fresh login → default My learners", (await activeTab(s.page)).startsWith("My learners"));
  const opts = await options(s.page);
  check("Tony My learners = only Tony's active learners", opts.length === 7 && opts.every((o) => o.startsWith("QA Tony")), opts.join(","));
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
  await s.page.click(".archive-link");
  await s.page.waitForSelector("[data-testid=archive-panel]");
  check("archive panel has a visible border (easy to tell apart from the box it sits in)", (await s.page.$eval("[data-testid=archive-panel]", (e) => { const c = getComputedStyle(e); return parseFloat(c.borderTopWidth) >= 2 && c.borderTopStyle === "solid"; })));
  await s.page.click("[data-testid=archive-cancel]"); await settle();
  check("cancelling the archive panel keeps the learner active", (await options(s.page)).includes("QA Tony Bravo") && (await s.page.$("[data-testid=archive-panel]")) === null);
  await s.page.click(".archive-link");
  await s.page.click("[data-testid=archive-confirm]");
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
  const lockedStates = await Promise.all(["18", "20", "21"].map(async (id) => (await assessedRow.locator(`button:text-is("${id}")`).isDisabled()) && (await assessedRow.locator(`button:text-is("${id}")`).getAttribute("data-locked")) === "true"));
  check("1-17 achieved, Review 1-17 NOT: Assessed 18, 20, 21 all locked in the UI", lockedStates.every(Boolean), lockedStates.join());
  for (const id of ["19", "22"]) check(`…but Assessed ${id} is NOT locked (any time, NI2020-703)`, !(await assessedRow.locator(`button:text-is("${id}")`).isDisabled()) && (await assessedRow.locator(`button:text-is("${id}")`).getAttribute("data-locked")) !== "true");
  check("…while Assessed 17 (already achieved) / 1-17 chips are not gate-locked", (await assessedRow.locator('button:text-is("5")').getAttribute("data-locked")) === null);
  const taughtRow = s.page.locator(".comp-section:has(.comp-label:text-is('Taught')) .chip-row").first();
  const taught18Disabled = await taughtRow.locator('button:text-is("18")').isDisabled();
  await taughtRow.locator('button:text-is("18")').click();
  check("18 can be Taught before Review 1-17 (Taught is not gated)", !taught18Disabled && (await taughtRow.locator('button:text-is("18")').getAttribute("aria-pressed")) === "true");
  check("lock hint explains the rule", (await s.page.textContent(".comp-lock-hint")).includes("Review 1-17"));
  await shot(s.page, "04-gate-locked");
  const api = await postLesson(ids.gateLocked, { lessonDate: "2026-09-21", startTime: "09:00", finishTime: "10:00", startOdometer: "5000", finishOdometer: "5010", assessedIds: ["18"], achievedResults: { "18": "achieved" }, adiSignature: SIG, learnerSignature: SIG });
  check("server rejects assessing 18 before Review 1-17 (400)", api.status === 400 && /Competency 18, 20 and 21 can only be assessed/.test(api.body.error), `${api.status} ${api.body.error}`);
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
  await s.page.click("[data-testid=archive-suggestion] button");
  await s.page.click("[data-testid=archive-cancel]"); await settle();
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
  await s.page.click("[data-testid=archive-confirm]");
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

// ═══ 5a. History Edit judges every gate by lesson chronology ═══════════════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Completed");
  await s.page.waitForSelector("[data-testid=history-row]");
  // History rows are newest first: nth=-1 is Lesson #1 (assessed 1-17), nth=1 is Lesson #4 (Review 1-22).
  await s.page.click("[data-testid=history-row] .h-edit >> nth=-1");
  await s.page.waitForSelector("text=/Editing Lesson #1/");
  const assessedRow = s.page.locator(".h-editing .comp-section:has(.comp-label:text-is('Assessed'))");
  const lockedIn = async (label) => (await assessedRow.locator(`button:has-text("${label}")`).first().isDisabled());
  check("History Edit of Lesson #1: Review 1-17, Review 1-22 and Final Drive are locked (nothing achieved before it)", (await lockedIn("Review 1-17")) && (await lockedIn("Review 1-22")) && (await lockedIn("23 Final Drive")));
  const core = await Promise.all(["18", "20", "21"].map(async (id) => assessedRow.locator(`.chip-row >> nth=0 >> button:text-is("${id}")`).isDisabled()));
  check("History Edit of Lesson #1: 18, 20, 21 are locked for Assessed", core.every(Boolean), core.join());
  await shot(s.page, "05a-history-edit-chronology");
  await s.page.click(".h-editing >> text=Cancel");
  await s.page.click("[data-testid=history-row] .h-edit >> nth=1");
  await s.page.waitForSelector("text=/Editing Lesson #4/");
  const row4 = s.page.locator(".h-editing .comp-section:has(.comp-label:text-is('Assessed'))");
  check("History Edit of the Review 1-22 lesson: Review 1-22 stays selectable, Final Drive (needs Review 1-22 EARLIER) is locked", !(await row4.locator('button:has-text("Review 1-22")').first().isDisabled()) && (await row4.locator('button:has-text("23 Final Drive")').first().isDisabled()));
  await s.ctx.close();
  // Server side: the same edit through the API is rejected with the specific rule.
  const detail = await (await fetch(`${B}/api/learners/${ids.completed}`)).json();
  const lesson1 = detail.lessons.find((l) => l.lessonNo === 1);
  const patch = await fetch(`${B}/api/learners/${ids.completed}/lessons/${lesson1.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ lessonDate: lesson1.lessonDate, startTime: lesson1.startTime, finishTime: lesson1.finishTime, startOdometer: String(lesson1.startOdometer), finishOdometer: String(lesson1.finishOdometer),
      assessedIds: [...Array.from({ length: 17 }, (_, i) => String(i + 1)), "review-1-22"], achievedResults: Object.fromEntries([...Array.from({ length: 17 }, (_, i) => String(i + 1)), "review-1-22"].map((id) => [id, "achieved"])),
      adiSignature: SIG.replace("AAAAC0lEQVR42", "AAAAC0lEQVR43"), learnerSignature: SIG.replace("AAAAC0lEQVR42", "AAAAC0lEQVR44") }),
  });
  const patchBody = await patch.json();
  check("server rejects backdating Review 1-22 onto Lesson #1 through History Edit (400)", patch.status === 400 && /Review 1-22 is locked/.test(patchBody.error), `${patch.status} ${patchBody.error}`);
}

// ═══ 5a2. Finish odometer only opens after End Lesson; Sign out link ═════
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Save Errors");
  await s.page.waitForSelector("text=Start Lesson");
  const finish = s.page.locator("#lesson-field-finish-odometer");
  check("READY: Start odometer editable, Finish odometer not editable", (await s.page.locator("#lesson-field-start-odometer").isEnabled()) && (await finish.isDisabled()));
  await s.page.click("text=Start Lesson");
  check("RUNNING: Finish odometer still not editable", await finish.isDisabled());
  await s.page.click("text=End Lesson");
  // The autofocus fires from a short timer after End Lesson, so wait for it rather than sampling instantly.
  const focused = await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-finish-odometer", null, { timeout: 3000 }).then(() => true, () => false);
  check("ENDED: Finish odometer editable and focused (existing End Lesson autofocus)", (await finish.isEnabled()) && focused);
  check("no horizontal scroll (odometer states)", await noHScroll(s.page));
  const href = await s.page.getAttribute("[data-testid=signout-link]", "href");
  check("Sign out is the app-origin Access logout returning to the app root", href === `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(B + "/")}`, href);
  await s.ctx.close();
}

// ═══ 5b. Save-failure UX: summary next to Save, jump-to-field, persistence ═
const inViewport = (page, selector) =>
  page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return Boolean(r) && r.top >= 0 && r.bottom <= window.innerHeight; }, selector);
// Waits for smooth scrolling to finish, then records whether the element is fully on screen.
async function expectVisible(page, selector, name) {
  try {
    await page.waitForFunction((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return Boolean(r) && r.top >= -1 && r.bottom <= window.innerHeight + 1; }, selector, { timeout: 8000 }); // 1px tolerance: layouts with fractional line heights put an element at top -0.4
    check(name, true);
  } catch {
    const rect = await page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? `top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, viewport ${window.innerHeight}, scrollY ${Math.round(window.scrollY)}` : "element missing"; }, selector);
    check(name, false, `not fully on screen after 8s (${rect})`);
  }
}
async function expectIssueCount(page, prefix, n, name) {
  try {
    await page.waitForFunction(([p, count]) => document.querySelectorAll(`[data-testid=${p}-save-errors] li`).length === count, [prefix, n], { timeout: 8000 });
    check(name, true);
  } catch {
    const now = await page.$$eval(`[data-testid=${prefix}-save-errors] li span`, (e) => e.map((x) => x.textContent)).catch(() => []);
    check(name, false, `expected ${n} item(s), got ${now.length}: ${now.join(" | ")}`);
  }
}
const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? "");
const draw = async (page, index) => {
  const canvas = (await page.$$(".sig canvas"))[index];
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 30); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + 90, { steps: 8 }); await page.mouse.up();
};
{
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Save Errors");
  await s.page.waitForSelector("text=Start Lesson");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.click('.comp-section:has(.comp-label:text-is("Assessed")) .chip-row >> text="5"'); // assessed, result not chosen
  await s.page.click(".btn.save");
  await s.page.waitForSelector("[data-testid=lesson-save-errors]");
  const items = await s.page.$$eval("[data-testid=lesson-save-errors] li span", (e) => e.map((x) => x.textContent));
  // Start Lesson → End Lesson in the same minute gives finish == start, which the server also rejects: a real "times" problem.
  check("failed save lists every problem, in page order (finish odometer, competency result, times, both signatures)", items.length === 5 && items[0] === "Finish odometer is required." && /^Start and finish time/.test(items[2]), items.join(" | "));
  const box = async (sel) => (await s.page.locator(sel).boundingBox());
  const summaryBox = await box("[data-testid=lesson-save-errors]"), saveBox = await box(".btn.save");
  check("summary sits directly above the Save button", saveBox.y - (summaryBox.y + summaryBox.height) >= 0 && saveBox.y - (summaryBox.y + summaryBox.height) < 40, `${Math.round(saveBox.y - (summaryBox.y + summaryBox.height))}px gap`);
  await settle(300);
  check("summary and Save button are on screen right after the tap (no scrolling to find why)", (await inViewport(s.page, "[data-testid=lesson-save-errors]")) && (await inViewport(s.page, ".btn.save")));
  check("no separate top-of-page error to hunt for", (await s.page.$(".status.error")) === null);
  check("no horizontal scroll with the summary showing", await noHScroll(s.page));
  await shot(s.page, "07-save-errors");
  await s.page.click("[data-testid=lesson-go-finish-odometer]");
  await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-finish-odometer");
  await s.page.waitForFunction(() => { const r = document.getElementById("lesson-field-finish-odometer").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
  check("'Go to Finish odometer' scrolls to and focuses the input", (await activeId(s.page)) === "lesson-field-finish-odometer");
  check("the summary is still there (not a disappearing toast)", (await s.page.$("[data-testid=lesson-save-errors]")) !== null);
  await s.page.keyboard.type("1030");
  await expectIssueCount(s.page, "lesson", 4, "fixing the finish odometer removes just that item");
  await s.page.click("[data-testid=lesson-go-competency]");
  await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-competency");
  await expectVisible(s.page, "#lesson-field-competency .comp-section", "'Go to CBT&A competencies' brings the competency section on screen");
  await s.page.click('.result-list li:has-text("5") >> text="Achieved"');
  await expectIssueCount(s.page, "lesson", 3, "choosing Achieved removes the competency item");
  await s.page.click("[data-testid=lesson-go-times]");
  await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-times");
  check("'Go to Start / finish time' opens the collapsed time section and focuses it", (await s.page.evaluate(() => document.querySelector("details.edit-times").open)) && (await activeId(s.page)) === "lesson-field-times");
  await s.page.fill("#lesson-field-times", "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await expectIssueCount(s.page, "lesson", 2, "fixing the times removes that item");
  await s.page.click("[data-testid=lesson-go-adi-signature]");
  await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-adi-signature");
  await expectVisible(s.page, "#lesson-field-adi-signature canvas", "'Go to ADI signature' brings the signature pad on screen");
  await draw(s.page, 0);
  await expectIssueCount(s.page, "lesson", 1, "signing as ADI removes that item");
  await draw(s.page, 1);
  await s.page.waitForFunction(() => document.querySelector("[data-testid=lesson-save-errors]") === null);
  check("once everything is fixed the summary disappears", true);
  await s.page.click(".btn.save");
  await s.page.waitForSelector('.status:has-text("saved")');
  check("…and the lesson saves", (await s.page.textContent(".status")).includes("Lesson #2 saved"));

  // Server-side rejection → single item mapped to the right section, persists until that section changes.
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.fill('input[placeholder="Enter now"]', "1100");
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await draw(s.page, 0); await draw(s.page, 1);
  await s.page.route("**/api/learners/*/lessons", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Competency 18, 20 and 21 can only be assessed after Competency 1-17 and Review 1-17 are all achieved (19 and 22 may be assessed at any time)." }) }) : route.continue(),
  );
  await s.page.click(".btn.save");
  await s.page.waitForSelector("[data-testid=lesson-save-errors]");
  check("server rejection is shown next to Save with a jump link to the competency section", (await s.page.textContent("[data-testid=lesson-save-errors]")).includes("Competency 18, 20 and 21") && (await s.page.$("[data-testid=lesson-go-competency]")) !== null);
  await s.page.fill('input[placeholder="Belconnen, Gungahlin…"]', "Belconnen");
  check("an unrelated edit does not hide the server error", (await s.page.$("[data-testid=lesson-save-errors]")) !== null);
  await s.page.click("[data-testid=lesson-go-competency]");
  await s.page.waitForFunction(() => document.activeElement?.id === "lesson-field-competency");
  await s.page.click('.comp-section:has(.comp-label:text-is("Taught")) .chip-row >> text="6"');
  await s.page.waitForFunction(() => document.querySelector("[data-testid=lesson-save-errors]") === null);
  check("changing the competency selection clears the server error", true);
  await s.page.unroute("**/api/learners/*/lessons");
  await s.page.route("**/api/learners/*/lessons", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "CBT&A is already completed for this learner — no further CBT&A lessons can be recorded." }) }) : route.continue(),
  );
  await s.page.click(".btn.save");
  await s.page.waitForSelector("[data-testid=lesson-save-errors]");
  check("a message with no field is still shown next to Save (no jump link)", (await s.page.$("[data-testid=lesson-save-errors] button")) === null && (await s.page.textContent("[data-testid=lesson-save-errors]")).includes("already completed"));
  await s.page.unroute("**/api/learners/*/lessons");
  check("Tony: no page errors (save-error UX)", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}
{
  // History Edit form: same summary next to "Save changes".
  const s = await session("tony");
  await ready(s.page);
  await pick(s.page, "QA Tony Save Errors");
  await s.page.waitForSelector("[data-testid=history-row]");
  await s.page.click("[data-testid=history-row] .h-edit >> nth=-1");
  await s.page.waitForSelector("text=/Editing Lesson/");
  await s.page.fill('.h-editing input[type="time"] >> nth=1', "10:20");
  await s.page.click(".h-editing .btn.save");
  await s.page.waitForSelector("[data-testid=edit-save-errors]");
  const items = await s.page.$$eval("[data-testid=edit-save-errors] li span", (e) => e.map((x) => x.textContent));
  check("History Edit: changed content without re-signing lists both signatures", items.join("|") === "ADI signature is required.|Learner signature is required.", items.join(" | "));
  const summaryBox = await s.page.locator("[data-testid=edit-save-errors]").boundingBox(), saveBox = await s.page.locator(".h-editing .btn.save").boundingBox();
  check("History Edit: summary directly above Save changes", saveBox.y - (summaryBox.y + summaryBox.height) >= 0 && saveBox.y - (summaryBox.y + summaryBox.height) < 40);
  await s.page.click("[data-testid=edit-go-learner-signature]");
  await s.page.waitForFunction(() => document.activeElement?.id === "edit-field-learner-signature");
  await expectVisible(s.page, "#edit-field-learner-signature canvas", "History Edit: 'Go to Learner signature' brings the pad on screen");
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
  await s.page.waitForSelector("[data-testid=export-status-line]", { timeout: 15000 }).catch(() => {});
  check("pdf status line: an English export says compact font", /^PDF ready: \d+ KB \(compact font\)$/.test((await s.page.textContent("[data-testid=export-status-line]").catch(() => "")) ?? ""), await s.page.textContent("[data-testid=export-status-line]").catch(() => "none"));
  check("pdf size: the export embeds only the glyphs it uses (was 10+ MB with the whole font)", readFileSync(pdfPath).length < 1_000_000, `${readFileSync(pdfPath).length} bytes`);
  check("no horizontal scroll (lesson + history)", await noHScroll(s.page));
  await shot(s.page, "06-regression-lesson");
  check("Tony: no page errors (regression)", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 7. Paper records import: preview, errors, commit, Paper record badge, paper edit ═
{
  const { tmpdir } = await import("node:os");
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(`${tmpdir()}/qa-paper-`);
  const HEAD = "date,start_time,finish_time,start_odometer,finish_odometer,taught,assessed_achieved,assessed_not_achieved,location,comments,signature,instructor,prior_instructor,prior_lessons,prior_hours,prior_km";
  const goodRows = [
    "2026-01-01,09:00,10:00,100,120,1;2,3,4,QA Street,first,on_paper,Tony,,,,",
    "2026-01-02,,,,,5,,,,,unsigned,Tony,,,,",
    "2026-01-03,10:00,10:30,130,145,,1,,,,on_paper,Tony,,,,",
  ];
  const badFile = `${dir}/bad.csv`, goodFile = `${dir}/good.csv`;
  writeFileSync(badFile, [HEAD, goodRows[0], "2026-13-45,09:00,10:00,120,130,,,,,,on_paper,Tony,,,,", goodRows[2]].join("\n") + "\n");
  writeFileSync(goodFile, [HEAD, ...goodRows].join("\n") + "\n");

  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await s.page.click('button:has-text("+ New")');
  await s.page.fill('label:has-text("Student name") input', "QA Paper Learner");
  await s.page.click('button:has-text("Save learner")');
  await s.page.waitForSelector("[data-testid=paper-import-open]");
  check("paper: Import paper records button shown for a learner with no lessons", await s.page.isVisible("[data-testid=paper-import-open]"));
  await s.page.click("[data-testid=paper-import-open]");
  await s.page.setInputFiles('input[type="file"]', badFile);
  await s.page.waitForSelector("[data-testid=paper-import-errors]");
  check("paper: error row listed as 'Row 3: …'", (await s.page.textContent("[data-testid=paper-import-errors]")).includes("Row 3: Date must be a valid date"), await s.page.textContent("[data-testid=paper-import-errors]"));
  check("paper: no Confirm button while there are errors", (await s.page.$("[data-testid=paper-import-confirm]")) === null);
  const learnerId = await s.page.$eval('select[aria-label="Select learner"]', (el) => el.value);
  check("paper: nothing written by a failed preview", (await (await fetch(`${B}/api/learners/${learnerId}`)).json()).lessons.length === 0);
  check("paper: no horizontal scroll at 375px (errors)", await noHScroll(s.page));
  await s.page.setInputFiles('input[type="file"]', goodFile);
  await s.page.waitForSelector("[data-testid=paper-import-preview]");
  const pv = await s.page.textContent("[data-testid=paper-import-preview]");
  check("paper: preview shows 3 lessons, 1h 30m, 35 km", (await s.page.textContent("[data-testid=paper-import-lessons]")) === "3" && (await s.page.textContent("[data-testid=paper-import-hours]")).startsWith("1h 30m") && (await s.page.textContent("[data-testid=paper-import-km]")) === "35 km", pv);
  check("paper: no once-per-learner warning without prior rows", (await s.page.$("[data-testid=paper-import-once-warning]")) === null);
  check("paper: preview lists Missing data #2 and Unsigned #2", pv.includes("Missing data: #2") && pv.includes("Unsigned: #2"), pv);
  check("paper: still nothing written before confirm", (await (await fetch(`${B}/api/learners/${learnerId}`)).json()).lessons.length === 0);
  check("paper: no horizontal scroll at 375px (preview)", await noHScroll(s.page));
  await shot(s.page, "07-paper-preview");
  await s.page.click("[data-testid=paper-import-confirm]");
  await s.page.waitForSelector("[data-testid=paper-badge]");
  const badges = await s.page.$$eval("[data-testid=history-row]", (rows) => rows.map((r) => r.textContent));
  check("paper: History shows 3 'Paper record' lessons", badges.length === 3 && badges.every((t) => t.includes("Paper record")), String(badges.length));
  check("paper: History shows — for the lesson with no times/odometer", badges.some((t) => t.includes("#2") && t.includes("—–—") && t.includes("Odo — → —")));
  check("paper: Import button gone once lessons exist", (await s.page.$("[data-testid=paper-import-open]")) === null && (await s.page.$("[data-testid=paper-import-panel]")) === null);
  check("paper: totals derived (1h 30m, 35 km) and next lesson is #4", (await s.page.textContent("[data-testid=total-km]")) === "35 km" && (await s.page.textContent("[data-testid=lesson-no]")) === "Lesson #4");
  check("paper: no horizontal scroll at 375px (history)", await noHScroll(s.page));
  await shot(s.page, "07-paper-history");

  // Edit paper lesson #1: blank times, Not signed.
  const rowsLoc = s.page.locator("[data-testid=history-row]");
  const rowOf = (n) => rowsLoc.filter({ hasText: `#${n}` }).first();
  await rowOf(1).locator(".h-edit").click();
  await s.page.waitForSelector("text=Editing Lesson #1");
  check("paper edit: helper text and Signed on paper select, no signature pads", (await s.page.textContent(".h-editing")).includes("Leave both blank if not on the paper record") && (await s.page.$(".h-editing .sig canvas")) === null && (await s.page.inputValue("[data-testid=paper-signature-status]")) === "on_paper");
  check("paper edit: no horizontal scroll at 375px", await noHScroll(s.page));
  await shot(s.page, "07-paper-edit");
  await s.page.fill('.h-editing input[type="time"] >> nth=0', "");
  await s.page.fill('.h-editing input[type="time"] >> nth=1', "");
  await s.page.selectOption("[data-testid=paper-signature-status]", "unsigned");
  await s.page.click(".h-editing .btn.save");
  await s.page.waitForSelector(".status.ok:has-text('Lesson updated'), .h-editing .status.error, .h-editing [data-testid=edit-save-errors]");
  const after = await (await fetch(`${B}/api/learners/${learnerId}`)).json();
  const l1 = after.lessons.find((l) => l.lessonNo === 1);
  check("paper edit: saved with blank times and Not signed", l1 && l1.startTime === null && l1.finishTime === null && l1.signatureStatus === "unsigned" && l1.recordSource === "paper_import", JSON.stringify(l1 && [l1.startTime, l1.signatureStatus]));
  check("paper edit: totals recalculated (0h 30m, 35 km; odometers kept)", (await s.page.textContent("[data-testid=total-km]")) === "35 km" && (await s.page.textContent("[data-testid=total-hours]")).startsWith("0h 30m"), await s.page.textContent("[data-testid=total-hours]"));

  // New App lesson continues numbering and odometer.
  check("paper: next App lesson is #4 with start odometer prefilled 145", (await s.page.textContent("[data-testid=lesson-no]")) === "Lesson #4" && (await s.page.inputValue('input[placeholder="e.g. 45210"]')) === "145");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.fill('input[placeholder="Enter now"]', "160");
  await s.page.click('.comp-section:has(.comp-label:text-is("Taught")) .chip-row >> text="6"');
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await signBoth(s.page);
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("paper: new App lesson saves as Lesson #4", (await s.page.textContent(".status")).includes("Lesson #4 saved"), await s.page.textContent(".status"));
  check("paper: App lesson has no Paper record badge", (await rowOf(4).textContent()).includes("Paper record") === false);

  const dlPromise = s.page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  await s.page.click("text=/Export.*PDF/i");
  const prompt = await s.page.waitForSelector(".export-adi-prompt input", { timeout: 8000 }).catch(() => null);
  if (prompt) {
    await s.page.fill(".export-adi-prompt input", "QA-ADI-1");
    await s.page.click(".export-adi-prompt .btn.primary");
  }
  const dl = await dlPromise;
  const paperPdf = `${OUT}/qa-paper-export.pdf`;
  await dl.saveAs(paperPdf);
  check("paper: PDF export with paper + App lessons succeeds", readFileSync(paperPdf).subarray(0, 5).toString() === "%PDF-", dl.suggestedFilename());
  check("paper: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 8. Prior-instructor records (spec §12): preview, History card without Edit, gates ═
{
  const { tmpdir } = await import("node:os");
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(`${tmpdir()}/qa-prior-`);
  const HEAD = "date,start_time,finish_time,start_odometer,finish_odometer,taught,assessed_achieved,assessed_not_achieved,location,comments,signature,instructor,prior_instructor,prior_lessons,prior_hours,prior_km";
  const all = [...Array.from({ length: 22 }, (_, i) => String(i + 1)), "review-1-17", "review-1-22"].join(";");
  const file = `${dir}/prior.csv`;
  writeFileSync(file, [
    HEAD,
    `2025-12-01,,,,,,${all},,,,,,QA ADI 358,11,20,150`,
    "2026-01-01,09:00,10:00,100,120,,,,QA Street,,on_paper,Tony,,,,",
    "2026-01-02,10:00,10:30,120,135,,,,,,on_paper,Tony,,,,",
  ].join("\n") + "\n");

  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await s.page.click('button:has-text("+ New")');
  await s.page.fill('label:has-text("Student name") input', "QA Prior Transfer Learner");
  await s.page.click('button:has-text("Save learner")');
  await s.page.waitForSelector("[data-testid=paper-import-open]");
  await s.page.click("[data-testid=paper-import-open]");
  await s.page.setInputFiles('input[type="file"]', file);
  await s.page.waitForSelector("[data-testid=paper-import-preview]");
  const priorPv = await s.page.textContent("[data-testid=paper-import-prior]").catch(() => "");
  check("prior: preview lists the prior instructor and its totals", priorPv === "Prior instructor: QA ADI 358 · 11 lessons · 20.0 h · 150 km", priorPv);
  const priorNote = await s.page.textContent("[data-testid=paper-import-prior-note]").catch(() => "");
  check("prior: preview Hours/Km note says what came from previous instructors", priorNote === "Hours / Km incl. 20.0 h / 150 km from previous instructors", priorNote);
  check("prior: preview shows 2 lessons, hours/km incl. prior (21h 30m, 185 km)", (await s.page.textContent("[data-testid=paper-import-lessons]")) === "2" && (await s.page.textContent("[data-testid=paper-import-hours]")).startsWith("21h 30m") && (await s.page.textContent("[data-testid=paper-import-km]")) === "185 km", await s.page.textContent("[data-testid=paper-import-preview]"));
  check("prior: preview warns that paper import is once per learner", (await s.page.textContent("[data-testid=paper-import-once-warning]").catch(() => "")) === "Paper import can only be done once per learner; check everything before importing.");
  check("prior: no horizontal scroll at 375px (preview)", await noHScroll(s.page));
  await shot(s.page, "08-prior-preview");
  await s.page.click("[data-testid=paper-import-confirm]");
  await s.page.waitForSelector("[data-testid=prior-record]");
  const cards = await s.page.$$eval("[data-testid=prior-record]", (els) => els.map((e) => ({ text: e.textContent, edit: !!e.querySelector("button, .h-edit") })));
  check("prior: History shows the prior card with its line", cards.length === 1 && cards[0].text === "Prior instructor: QA ADI 358 · 11 lessons · 20.0 h · 150 km · achieved 1-22, Review 1-17, Review 1-22", JSON.stringify(cards));
  check("prior: the prior card has no Edit button", cards.length === 1 && !cards[0].edit);
  const histRows = await s.page.$$eval("[data-testid=history-row]", (rows) => rows.map((r) => r.querySelector(".h-no")?.textContent));
  check("prior: History lesson rows are #2, #1 only (no negative numbers)", JSON.stringify(histRows) === JSON.stringify(["#2", "#1"]), JSON.stringify(histRows));
  const below = await s.page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-testid=history-row]")];
    const card = document.querySelector("[data-testid=prior-record]");
    return !!card && rows.length > 0 && card.getBoundingClientRect().top >= rows[rows.length - 1].getBoundingClientRect().bottom;
  });
  check("prior: the prior card sits at the bottom of History, below lesson #1 (newest first)", below);
  check("prior: Edit buttons only on the 2 lessons", (await s.page.$$(".history .h-edit")).length === 2);
  check("prior: next lesson is #3 and totals include prior (185 km)", (await s.page.textContent("[data-testid=lesson-no]")) === "Lesson #3" && (await s.page.textContent("[data-testid=total-km]")) === "185 km", await s.page.textContent("[data-testid=total-km]"));
  check("prior: Import button gone", (await s.page.$("[data-testid=paper-import-open]")) === null);
  check("prior: no horizontal scroll at 375px (history)", await noHScroll(s.page));
  await shot(s.page, "08-prior-history");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  const fd = s.page.locator(".chip-row.special button", { hasText: "23 Final Drive" }).first();
  check("prior: 23 Final Drive is not locked (prior achieved 1-22 + both reviews)", !(await fd.isDisabled()) && (await fd.getAttribute("data-locked")) === null);
  const learnerId = await s.page.$eval('select[aria-label="Select learner"]', (el) => el.value);
  const data = await (await fetch(`${B}/api/learners/${learnerId}`)).json();
  const priorRow = data.lessons.find((l) => l.recordSource === "prior_instructor");
  const patch = await fetch(`${B}/api/learners/${learnerId}/lessons/${priorRow.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonDate: "2025-12-02", signatureStatus: "on_paper", taughtIds: [], assessedIds: [], achievedResults: {} }) });
  const patchBody = await patch.json().catch(() => ({}));
  check("prior: server rejects editing the prior record (400)", patch.status === 400 && patchBody.error === "Prior-instructor records cannot be edited.", `${patch.status} ${patchBody.error}`);
  check("prior: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 9. Lesson edit ownership + revision history (design 2026-10-08, E1-E8) ═
{
  const created = await fetch(`${B}/api/learners`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "QA Tony Revision", instructorId: WHO.tony[0] }) });
  const revLearner = (await created.json()).learner;
  const lessonRes = await postLesson(revLearner.id, { lessonDate: "2026-09-21", startTime: "09:00", finishTime: "10:00", startOdometer: "2000", finishOdometer: "2020", taughtIds: ["1"], location: "QA Old Place", adiSignature: SIG, learnerSignature: SIG });
  check("ownership: seed lesson created for QA Tony Revision", lessonRes.status === 201 || lessonRes.status === 200, String(lessonRes.status));
  const lessonId = lessonRes.body.lesson.id;

  // Anna: Tony's lesson is read-only in the UI and rejected by the server.
  const a = await session("anna");
  await ready(a.page);
  await tab(a.page, "All");
  await pick(a.page, "QA Tony Revision · Tony");
  await a.page.waitForSelector("[data-testid=history-row]");
  check("ownership: Anna sees Tony's lesson in History but NO Edit button", (await a.page.$$(".history .h-edit")).length === 0 && (await a.page.$("[data-testid=history-readonly]")) !== null);
  check("ownership: read-only label names the recorder", (await a.page.textContent("[data-testid=history-readonly]")).includes("Recorded by Tony"));
  const rejected = await fetch(`${B}/api/learners/${revLearner.id}/lessons/${lessonId}`, {
    method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": WHO.anna[0], "x-instructor-name": "Anna" },
    body: JSON.stringify({ lessonDate: "2026-09-21", startTime: "09:00", finishTime: "10:00", startOdometer: "2000", finishOdometer: "2020", taughtIds: ["1"], location: "QA Anna Hack", adiSignature: SIG, learnerSignature: SIG }),
  });
  const rejectedBody = await rejected.json().catch(() => ({}));
  check("ownership: server rejects Anna's edit of Tony's lesson (400, Code of Practice 9.2)", rejected.status === 400 && rejectedBody.error === "This lesson was recorded by Tony; only they can change it (Code of Practice 9.2).", `${rejected.status} ${rejectedBody.error}`);
  check("ownership: rejected edit changed nothing and wrote no revision", (await (await fetch(`${B}/api/learners/${revLearner.id}`)).json()).lessons[0].location === "QA Old Place" && (await (await fetch(`${B}/api/learners/${revLearner.id}/lessons/${lessonId}/revisions`)).json()).revisions.length === 0);
  check("ownership: Anna's History at phone width has no horizontal scroll", await noHScroll(a.page));
  await shot(a.page, "09-anna-readonly-history");
  check("ownership: Anna: no page errors", a.errors.length === 0, a.errors.join("|"));
  await a.ctx.close();

  // Tony: edits his own lesson at 375px, sees "Edited 1 time" and the struck-through old value, then the PDF is "(amended)".
  const t = await session("tony");
  await t.page.setViewportSize({ width: 375, height: 812 });
  await ready(t.page);
  await pick(t.page, "QA Tony Revision");
  await t.page.waitForSelector("[data-testid=history-row]");
  check("revisions: a never-edited lesson shows no 'Edited N times'", (await t.page.$("[data-testid=revisions-toggle]")) === null);
  await t.page.click("[data-testid=history-row] .h-edit");
  await t.page.waitForSelector("text=Editing Lesson #1");
  const locationInput = t.page.locator('.h-editing .field:has(span:text-is("Location")) input');
  await locationInput.fill("QA New Place");
  check("revisions: edit form has the optional reason field (max 200)", (await t.page.getAttribute("[data-testid=edit-reason]", "maxlength")) === "200");
  await t.page.fill("[data-testid=edit-reason]", "QA wrong place recorded");
  await signBoth(t.page);
  check("revisions: edit form has no horizontal scroll at 375px", await noHScroll(t.page));
  await shot(t.page, "09-tony-edit-reason-375");
  await t.page.click(".h-editing .btn.save");
  await t.page.waitForSelector(".status.ok:has-text('Lesson updated'), .h-editing .status.error");
  check("revisions: Tony's own edit saves", (await t.page.$(".h-editing .status.error")) === null);
  check("revisions: History shows \"Edited 1 time\"", (await t.page.textContent("[data-testid=revisions-toggle]")).trim() === "Edited 1 time", await t.page.textContent("[data-testid=revisions-toggle]").catch(() => "none"));
  let revisionRequests = 0;
  t.page.on("request", (r) => { if (r.url().includes("/revisions")) revisionRequests++; });
  await t.page.click("[data-testid=revisions-toggle]");
  await t.page.waitForSelector("[data-testid=revision-item]");
  check("revisions: opening lists the previous version with the old value struck through", (await t.page.textContent("[data-testid=revision-struck]")) === "QA Old Place" && (await t.page.$eval("[data-testid=revision-struck]", (el) => getComputedStyle(el).textDecorationLine)) === "line-through");
  check("revisions: shows the new value and the reason", (await t.page.textContent("[data-testid=revision-item]")).includes("QA New Place") && (await t.page.textContent("[data-testid=revision-item]")).includes("Reason: QA wrong place recorded"));
  check("revisions: details loaded lazily with exactly one request for this lesson", revisionRequests === 1, String(revisionRequests));
  check("revisions: list has no horizontal scroll at 375px", await noHScroll(t.page));
  await shot(t.page, "09-tony-revisions-375");
  await t.page.click("text=/Export.*PDF/i");
  if (await t.page.$(".export-adi-prompt input")) await t.page.fill(".export-adi-prompt input", "QA-ADI-1");
  const [dl] = await Promise.all([t.page.waitForEvent("download", { timeout: 60000 }), t.page.click(".export-adi-prompt .btn.primary").catch(() => {})]);
  const revPdf = `${OUT}/qa-amended.pdf`;
  await dl.saveAs(revPdf);
  const { execFileSync } = await import("node:child_process");
  const pdfText = execFileSync("pdftotext", ["-layout", revPdf, "-"], { encoding: "utf8" });
  check("revisions: PDF marks the amended lesson \"(amended)\" next to the lesson number", /#1\s*\(amended\)/.test(pdfText), pdfText.match(/#1[^\n]{0,20}/)?.[0] ?? "no #1");
  // Reason-only re-save: the revisions panel must not stay open/stale, and the new version says no value changed.
  await t.page.click("[data-testid=history-row] .h-edit");
  await t.page.waitForSelector("text=Editing Lesson #1");
  await t.page.fill("[data-testid=edit-reason]", "QA reason only");
  await t.page.click(".h-editing .btn.save");
  await t.page.waitForSelector(".status.ok:has-text('Lesson updated'), .h-editing .status.error");
  check("revisions: panel closed after an edit (never stale)", (await t.page.$("[data-testid=revisions-list]")) === null);
  check("revisions: History shows \"Edited 2 times\"", (await t.page.textContent("[data-testid=revisions-toggle]")).trim() === "Edited 2 times");
  await t.page.click("[data-testid=revisions-toggle]");
  await t.page.waitForSelector("[data-testid=revision-item] >> nth=1");
  const second = await t.page.textContent("[data-testid=revision-item] >> nth=1");
  check("revisions: reason-only re-save says no recorded value changed (not 'signatures only')", second.includes("QA reason only") && second.includes("No recorded value changed.") && !second.includes("Signatures only"), second);
  check("revisions: Tony: no page errors", t.errors.length === 0, t.errors.join("|"));
  await t.ctx.close();
}

// ── PDF missing characters: warn before any box-filled PDF, full-font download failure is visible (375px) ──
{
  const make = async (name, comments) => {
    const created = await fetch(`${B}/api/learners`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: name, instructorId: WHO.tony[0] }) });
    const learner = (await created.json()).learner;
    const res = await postLesson(learner.id, { lessonDate: "2026-09-22", startTime: "09:00", finishTime: "10:00", startOdometer: "2000", finishOdometer: "2020", taughtIds: ["1"], location: "QA Glyph", comments, adiSignature: SIG, learnerSignature: SIG });
    return { learner, status: res.status };
  };
  const emoji = await make("QA Glyph Emoji", "car 🚗 ok");
  const rare = await make("QA Glyph Rare", "x 龘 y");
  check("pdf glyph: seed learners and lessons created", emoji.status < 300 && rare.status < 300, `${emoji.status} ${rare.status}`);
  const t = await session("tony");
  await t.page.setViewportSize({ width: 375, height: 812 });
  await ready(t.page);
  let downloads = 0;
  t.page.on("download", () => { downloads++; });
  const exportFor = async (name) => {
    await pick(t.page, name);
    await t.page.waitForSelector("[data-testid=history-row]");
    await t.page.click("text=/Export.*PDF/i");
    if (await t.page.$(".export-adi-prompt input")) await t.page.fill(".export-adi-prompt input", "QA-ADI-1");
  };
  // 1. Rare CJK character: full font downloads, no warning, PDF downloads directly.
  await exportFor("QA Glyph Rare");
  const d1 = t.page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  if (await t.page.$(".export-adi-prompt .btn.primary")) await t.page.click(".export-adi-prompt .btn.primary");
  check("pdf glyph: a rare Chinese character downloads the PDF with no warning", (await d1) !== null && (await t.page.$("[data-testid=export-missing-warning]")) === null);
  await t.page.waitForSelector("[data-testid=export-status-line]");
  const rareLine = await t.page.textContent("[data-testid=export-status-line]");
  check("pdf status line: names the character, code point and field that forced the full font", /full font used for: 龘 U\+9F98 in lesson #1 comments/.test(rareLine) && /\d+\.\d MB/.test(rareLine), rareLine);
  // 2. Emoji no font has: warning names it, nothing downloads until confirmed; fits 375px.
  const before = downloads;
  await exportFor("QA Glyph Emoji");
  await t.page.waitForSelector("[data-testid=export-missing-warning]", { timeout: 60000 });
  check("pdf glyph: the warning names the missing emoji", (await t.page.textContent("[data-testid=export-missing-warning]")).includes("🚗"));
  await new Promise((r) => setTimeout(r, 1500));
  check("pdf glyph: nothing downloads before the user confirms", downloads === before, `${downloads - before}`);
  const box = await t.page.locator("[data-testid=export-missing-warning]").boundingBox();
  check("pdf glyph: warning fits the 375px width (no clipping, no horizontal scroll)", box !== null && box.x >= 0 && box.x + box.width <= 375 && (await noHScroll(t.page)), JSON.stringify(box));
  await shot(t.page, "11-pdf-missing-glyph-375");
  const dl = t.page.waitForEvent("download", { timeout: 60000 });
  await t.page.click("text=Download anyway");
  await dl;
  check("pdf glyph: 'Download anyway' downloads after confirmation", downloads === before + 1);
  // Learner switch: a warning open for learner A must not survive into learner B (the button is keyed by learner id).
  const beforeSwitch = downloads;
  await exportFor("QA Glyph Emoji");
  await t.page.waitForSelector("[data-testid=export-missing-warning]", { timeout: 60000 });
  await pick(t.page, "QA Glyph Rare");
  await t.page.waitForSelector("[data-testid=history-row]");
  check("pdf glyph: switching learner removes the open warning dialog", (await t.page.$("[data-testid=export-missing-warning]")) === null && (await t.page.$("text=Download anyway")) === null);
  check("pdf glyph: switching learner shows the export button again", (await t.page.$("text=Export CBT&A PDF")) !== null);
  await new Promise((r) => setTimeout(r, 1000));
  check("pdf glyph: switching learner downloads nothing", downloads === beforeSwitch, `${downloads - beforeSwitch}`);
  // 3. Full-font download fails (404): the rare character is not silently boxed; the warning explains why.
  await t.page.route("**/fonts/NotoSansSC-Regular.otf", (route) => route.fulfill({ status: 404, body: "not found" }));
  const beforeFail = downloads;
  await exportFor("QA Glyph Rare");
  await t.page.waitForSelector("[data-testid=export-missing-warning]", { timeout: 60000 });
  const failText = await t.page.textContent("[data-testid=export-missing-warning]");
  check("pdf glyph: a failed full-font download shows a clear warning naming the character", failText.includes("龘") && failText.includes("could not be downloaded"), failText);
  await new Promise((r) => setTimeout(r, 1000));
  check("pdf glyph: a failed full-font download does not download the boxed PDF", downloads === beforeFail);
  await shot(t.page, "11-pdf-font-failed-375");
  await t.page.click(".export-adi-prompt .btn.primary");
  check("pdf glyph: Cancel returns to the export button without downloading", (await t.page.$("text=Export CBT&A PDF")) !== null && downloads === beforeFail);
  await t.page.unroute("**/fonts/NotoSansSC-Regular.otf");
  check("pdf glyph: Tony: no page errors", t.errors.length === 0, t.errors.join("|"));
  await t.ctx.close();
}

// ── Learner edit (learner management Phase 1): rename, picker + History, owner-only, 375px ──
{
  const t = await session("tony");
  await ready(t.page);
  await t.page.setViewportSize({ width: 375, height: 812 });
  await pick(t.page, "QA Tony Bravo");
  await t.page.waitForSelector(".summary");
  check("learner edit: owner sees the Edit learner button", (await t.page.$("[data-testid=edit-learner]")) !== null);
  await t.page.click("[data-testid=edit-learner]");
  await t.page.waitForSelector("[data-testid=save-learner]");
  check("learner edit: form is pre-filled with the current name", (await t.page.inputValue("label:has-text('Student name') input")) === "QA Tony Bravo");
  check("learner edit: no instructor selector (transfer is not editable)", (await t.page.$("text=Instructor *")) === null);
  check("learner edit: no horizontal scroll at 375px", await noHScroll(t.page));
  await shot(t.page, "10-learner-edit-375");
  await t.page.click("[data-testid=cancel-edit-learner]");
  check("learner edit: Cancel closes the form and keeps the name", (await t.page.$("[data-testid=save-learner]")) === null && (await t.page.textContent(".summary-main small")) === "QA Tony Bravo");
  // Switching learner while the edit form is open discards the form (it must never save onto the newly selected learner).
  await t.page.click("[data-testid=edit-learner]");
  await t.page.waitForSelector("[data-testid=save-learner]");
  await pick(t.page, "QA Glyph Rare");
  await t.page.waitForSelector("[data-testid=history-row]");
  check("learner edit: switching learner closes the open edit form", (await t.page.$("[data-testid=save-learner]")) === null);
  await pick(t.page, "QA Tony Bravo");
  await t.page.waitForSelector(".summary");
  // Clearing the selection (another view) while the form is open must not leave an Edit form behind.
  await t.page.click("[data-testid=edit-learner]");
  await t.page.waitForSelector("[data-testid=save-learner]");
  await tab(t.page, "Archived");
  await t.page.waitForFunction(() => document.querySelector(".view-tab.active")?.textContent.startsWith("Archived"));
  // The form is discarded by an effect one render after the tab changes, so wait for it instead of reading the DOM immediately.
  const formGone = await t.page.waitForSelector("[data-testid=save-learner]", { state: "detached", timeout: 3000 }).then(() => true, () => false);
  check("learner edit: clearing the selection closes the open edit form", formGone);
  await t.page.click("text=+ New");
  check("learner edit: '+ New' after that opens an empty New learner form, not Edit", (await t.page.textContent("h2:has-text('learner')")).includes("New learner"));
  await t.page.click("text=Cancel");
  await tab(t.page, "My");
  await pick(t.page, "QA Tony Bravo");
  await t.page.waitForSelector(".summary");
  await t.page.click("[data-testid=edit-learner]");
  await t.page.fill("label:has-text('Student name') input", "QA Tony Bravo Renamed");
  await t.page.fill("label:has-text('Phone') input", "0400 000 123");
  await t.page.click("[data-testid=save-learner]");
  await t.page.waitForSelector(".status.ok");
  check("learner edit: Save shows a success status", (await t.page.textContent(".status.ok")).includes("QA Tony Bravo Renamed updated"), await t.page.textContent(".status"));
  check("learner edit: form closed, summary shows the new name", (await t.page.$("[data-testid=save-learner]")) === null && (await t.page.textContent(".summary-main small")) === "QA Tony Bravo Renamed");
  check("learner edit: the picker lists the new name (and not the old one)", (await options(t.page)).includes("QA Tony Bravo Renamed") && !(await options(t.page)).includes("QA Tony Bravo"), (await options(t.page)).join(","));
  check("learner edit: History header shows the new name", (await t.page.textContent("[data-testid=history-learner]")) === "QA Tony Bravo Renamed");
  check("learner edit: no horizontal scroll after save", await noHScroll(t.page));
  await t.page.reload();
  await ready(t.page);
  check("learner edit: the new name persists after a reload", (await options(t.page)).includes("QA Tony Bravo Renamed"));
  const saved = (await (await fetch(`${B}/api/learners/${ids.bravo}`)).json()).learner;
  check("learner edit: server stored the new name and phone, instructor unchanged", saved.fullName === "QA Tony Bravo Renamed" && saved.phone === "0400 000 123" && saved.instructorId === WHO.tony[0]);
  // No-op save says so.
  await pick(t.page, "QA Tony Bravo Renamed");
  await t.page.waitForSelector(".summary");
  await t.page.click("[data-testid=edit-learner]");
  await t.page.click("[data-testid=save-learner]");
  await t.page.waitForSelector(".status.ok");
  check("learner edit: a save with nothing changed says so", (await t.page.textContent(".status.ok")).includes("No changes"), await t.page.textContent(".status"));
  check("learner edit: Tony: no page errors", t.errors.length === 0, t.errors.join("|"));
  await t.ctx.close();

  const a = await session("anna");
  await ready(a.page);
  await a.page.setViewportSize({ width: 375, height: 812 });
  await tab(a.page, "All");
  await pick(a.page, "QA Tony Bravo Renamed · Tony");
  await a.page.waitForSelector(".summary");
  check("learner edit: a second instructor (Anna) sees no Edit button on Tony's learner", (await a.page.$("[data-testid=edit-learner]")) === null);
  const denied = await fetch(`${B}/api/learners/${ids.bravo}`, { method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": WHO.anna[0] }, body: JSON.stringify({ fullName: "QA Anna Hijack" }) });
  const deniedBody = await denied.json();
  check("learner edit: the server rejects Anna editing Tony's learner (400, clear message)", denied.status === 400 && /only they can edit/.test(deniedBody.error), `${denied.status} ${deniedBody.error}`);
  check("learner edit: nothing was written by the rejected edit", (await (await fetch(`${B}/api/learners/${ids.bravo}`)).json()).learner.fullName === "QA Tony Bravo Renamed");
  check("learner edit: no horizontal scroll (Anna, 375px)", await noHScroll(a.page));
  check("learner edit: Anna: no page errors", a.errors.length === 0, a.errors.join("|"));
  await a.ctx.close();
}

// ═══ 10. Assessment-rules reminders (T1): display only, never block ═══════
{
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date()); // YYYY-MM-DD in Canberra
  const post = async (path, body) => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d; };
  const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const doneBy = (ids) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });
  const mkLessons = async (learnerId, steps) => {
    let odo = 1000;
    for (const step of steps) { const start = odo; odo += 12; await post(`/api/learners/${learnerId}/lessons`, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step }); }
  };
  const wait = (await post("/api/learners", { fullName: "QA Tony Rules Wait", instructorId: WHO.tony[0] })).learner;
  await mkLessons(wait.id, [{ ...doneBy(rng(1, 17)), lessonDate: today, startTime: "00:00", finishTime: "00:30" }]);
  const fd = (await post("/api/learners", { fullName: "QA Tony Rules FD", instructorId: WHO.tony[0] })).learner;
  await mkLessons(fd.id, [doneBy(rng(1, 17)), doneBy(["review-1-17"]), doneBy(rng(18, 22)), doneBy(["review-1-22"])]);

  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await pick(s.page, "QA Tony Rules Wait");
  await s.page.waitForSelector("[data-testid=panel-reminders]");
  const panelRem = await s.page.$eval("[data-testid=panel-reminders] .reminder", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  check("reminders: Start Lesson panel shows the Review 1-17 36 h line (amber, lesson finished today)", panelRem.tone === "amber" && /^Review 1-17 allowed from .+ \(36 h after Lesson #1\)\.$/.test(panelRem.text), `${panelRem.tone} ${panelRem.text}`);
  check("reminders: panel has at most 3 lines and no booking link yet", (await s.page.$$("[data-testid=start-reminders] .reminder")).length <= 3 && (await s.page.$("[data-testid=adi-booking]")) === null);
  check("reminders: learner summary shows the neutral 'add licence expiry' note (R5), not a pass", (await s.page.textContent("[data-testid=licence-reminder]")).includes("Add licence expiry to check the learner licence is current."));
  check("reminders: no horizontal scroll at 375px (panel)", await noHScroll(s.page) && (await s.page.evaluate(() => window.innerWidth)) === 375);
  await shot(s.page, "10-rules-panel-375");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  check("reminders: no reminder in the lesson form before Review 1-17 is ticked", (await s.page.$("[data-testid=form-reminders]")) === null);
  await s.page.click(".chip-row.special >> text=/Review 1-17/");
  await s.page.waitForSelector("[data-testid=form-reminders]");
  const formRem = await s.page.$eval("[data-testid=form-reminders] .reminder", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  check("reminders: lesson form shows the amber 36 h warning once Review 1-17 is ticked, and says it can still be saved", formRem.tone === "amber" && /^This Review 1-17 starts within 36 h of Lesson #1 \(allowed from .+\)\. You can still save\.$/.test(formRem.text), formRem.text);
  check("reminders: no horizontal scroll at 375px (form)", await noHScroll(s.page));
  await shot(s.page, "10-rules-form-375");
  await s.page.fill('input[placeholder="Enter now"]', "1030");
  await s.page.click('.result-list li:has-text("Review 1-17") >> text="Achieved"');
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "09:45");
  await signBoth(s.page);
  check("reminders: the warning is still showing and Save is enabled", (await s.page.$("[data-testid=form-reminders] .reminder.amber")) !== null && !(await s.page.isDisabled(".btn.save")));
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("reminders: the lesson saves despite the amber warning (reminders never block)", (await s.page.textContent(".status")).includes("Lesson #2 saved"), await s.page.textContent(".status"));
  check("reminders: nothing on the Completed card / History (History has no reminder lines)", (await s.page.$("[data-testid=history-row] .reminder")) === null);

  await pick(s.page, "QA Tony Rules FD");
  await s.page.waitForSelector("[data-testid=adi-booking]");
  const link = await s.page.$eval("[data-testid=adi-booking-link]", (a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), text: a.textContent }));
  check("booking link: official ADI Audit online form URL", link.href === "https://forms.act.gov.au/smartforms/servlet/SmartForm.html?formCode=1503", link.href);
  check("booking link: opens in a new tab with rel noopener noreferrer", link.target === "_blank" && link.rel === "noopener noreferrer", `${link.target} ${link.rel}`);
  check("booking link: text and one-line note", link.text === "Book the Competency 23 drive with ADI Audit (ACT online form)" && (await s.page.textContent("[data-testid=adi-booking] small")) === "Book at least 1 clear business day before, in writing (CoP 9.2 n).");
  check("reminders: 23 Final Drive ready → Competency 23 day/hours line on the panel (after the R2 line)", (await s.page.$$eval("[data-testid=panel-reminders] .reminder", (els) => els.map((e) => e.dataset.rule))).join(",").startsWith("r2,r3"), await s.page.textContent("[data-testid=panel-reminders]"));
  {
    // The panel line's tone must follow the Canberra clock: plain only inside today's window.
    const nowC = await s.page.evaluate(() => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return { wd: p.weekday, min: Number(p.hour) * 60 + Number(p.minute) }; });
    const r3 = await s.page.$eval("[data-testid=panel-reminders] .reminder[data-rule^=r3]", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
    if (/^Competency 23 hours today/.test(r3.text)) {
      const end = nowC.wd === "Fri" ? 21 * 60 : 19 * 60;
      const inside = nowC.min >= 7 * 60 && nowC.min < end;
      check("reminders: Competency 23 panel line is plain inside today's window and amber ('currently outside the window') outside it", inside ? r3.tone === "plain" && !/outside/.test(r3.text) : r3.tone === "amber" && /it is currently outside the window\.$/.test(r3.text), `${nowC.wd} ${nowC.min} ${r3.tone} ${r3.text}`);
    } else {
      check("reminders: Competency 23 panel line on a Sunday/holiday/not-loaded day is amber or grey, never plain", r3.tone !== "plain", `${r3.tone} ${r3.text}`);
    }
  }
  check("reminders: no horizontal scroll at 375px (panel with booking link)", await noHScroll(s.page));
  await shot(s.page, "10-rules-fd-panel-375");
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForSelector("[data-testid=form-reminders]");
  await s.page.click(".edit-times summary");
  const formText = async () => (await s.page.$$eval("[data-testid=form-reminders] .reminder[data-rule^=r3]", (els) => els.map((e) => e.textContent.trim()).join(" ")));
  await s.page.fill("#lesson-field-date", "2026-10-06"); // a Tuesday, not a holiday
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "06:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "07:00");
  check("reminders: Competency 23 outside 07:00-19:00 → amber with this lesson's times", (await formText()) === "Competency 23 must run 07:00–19:00 Mon–Thu/Sat (Fri to 21:00). This lesson: 06:00–07:00.", await formText());
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "10:00");
  check("reminders: Competency 23 inside the hours → plain line", (await s.page.$("[data-testid=form-reminders] .reminder.plain[data-rule^=r3]")) !== null, await formText());
  await s.page.fill("#lesson-field-date", "2026-10-11"); // a Sunday
  check("reminders: Competency 23 on a Sunday → amber 'not allowed on Sundays'", (await formText()) === "Competency 23 is not allowed on Sundays.", await formText());
  await s.page.fill("#lesson-field-date", "2026-10-05"); // Labour Day
  check("reminders: Competency 23 on an ACT public holiday → amber with its name", (await formText()) === "Competency 23 is not allowed on ACT public holidays (Labour Day).", await formText());
  await s.page.fill("#lesson-field-date", "2028-03-01");
  check("reminders: a year outside the holiday table → grey 'not loaded; check manually', never a pass", (await formText()).includes("ACT public holidays for 2028 are not loaded; check manually.") && (await s.page.$$("[data-testid=form-reminders] .reminder.grey[data-rule^=r3]")).length === 2 && (await s.page.$("[data-testid=form-reminders] .reminder.plain[data-rule^=r3]")) === null && (await s.page.$("[data-testid=form-reminders] .reminder.amber[data-rule^=r3]")) === null, await formText());
  await s.page.fill("#lesson-field-date", "2026-10-11");
  await s.page.fill('input[placeholder="Enter now"]', "1060");
  await s.page.click('.result-list li:has-text("23 Final Drive") >> text="Achieved"');
  await signBoth(s.page);
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("reminders: a Sunday Competency 23 lesson still saves (reminders never block)", (await s.page.textContent(".status")).includes("saved"), await s.page.textContent(".status"));
  check("reminders: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 11. Competency 23 eligibility fields + R2 reminder (T2, migration 0009) ═══
{
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const addYears = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() + n); return t.toISOString().slice(0, 10); };
  const post = async (path, body) => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d; };
  const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const doneBy = (ids) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });
  const c23 = (await post("/api/learners", { fullName: "QA Tony C23 Fields", instructorId: WHO.tony[0] })).learner;
  let odo = 3000;
  for (const step of [doneBy(rng(1, 17)), doneBy(["review-1-17"]), doneBy(rng(18, 22)), doneBy(["review-1-22"])]) {
    const start = odo; odo += 12;
    await post(`/api/learners/${c23.id}/lessons`, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step });
  }
  const api = async () => (await learnersApi()).find((l) => l.id === c23.id);
  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await pick(s.page, "QA Tony C23 Fields");
  const r2 = async () => s.page.$eval("[data-testid=panel-reminders] .reminder[data-rule=r2]", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  await s.page.waitForSelector("[data-testid=panel-reminders] .reminder[data-rule=r2]");
  const missing = await r2();
  check("C23 fields: nothing entered → neutral grey 'add X' on the panel, never a pass", missing.tone === "grey" && missing.text === "Add licence issue date, date of birth, HPT pass date and logged hours to check Competency 23 eligibility.", missing.text);

  const openEdit = async () => { await s.page.click("[data-testid=edit-learner]"); await s.page.waitForSelector("[data-testid=c23-group]"); };
  const expand = async () => { if (!(await s.page.$eval("[data-testid=c23-group]", (e) => e.open))) await s.page.click("[data-testid=c23-group] summary"); };
  const save = async () => { await s.page.click("[data-testid=save-learner]"); await s.page.waitForSelector(".status.ok, .status.error"); return s.page.textContent(".status"); };
  await openEdit();
  check("C23 fields: the Edit learner group is collapsed by default", (await s.page.$eval("[data-testid=c23-group]", (e) => e.open)) === false && !(await s.page.isVisible("[data-testid=c23-hours]")));
  await expand();
  check("C23 fields: the group shows the five fields once opened", (await Promise.all(["c23-issued", "c23-first-issued", "c23-hpt", "c23-hours", "c23-hours-on"].map((id) => s.page.isVisible(`[data-testid=${id}]`)))).every(Boolean));
  const E = addDays(today, -400);
  await s.page.fill('label:has-text("DOB") input', addDays(addYears(today, -18), -100));
  await s.page.fill('label:has-text("Licence expiry") input', addYears(E, 5));
  await s.page.fill("[data-testid=c23-hpt]", addDays(today, -200));
  await s.page.fill("[data-testid=c23-hours]", "100");
  check("C23 fields: typing hours fills the 'as of' date with today (editable)", (await s.page.inputValue("[data-testid=c23-hours-on]")) === today, await s.page.inputValue("[data-testid=c23-hours-on]"));
  check("C23 fields: no horizontal scroll at 375px (Edit form, group open)", await noHScroll(s.page));
  await shot(s.page, "11-c23-edit-375");
  const saved1 = await save();
  check("C23 fields: saved from the Edit form", /updated/.test(saved1), saved1);
  const a1 = await api();
  check("C23 fields: stored and returned by the API", a1.hptPassedOn === addDays(today, -200) && a1.loggedHours === 100 && a1.loggedHoursOn === today && a1.learnerLicenceIssuedOn === null, JSON.stringify(a1));
  const est = await r2();
  check("C23 fields: estimate from the licence expiry → plain pass, labelled 'estimated from the licence expiry'", est.tone === "plain" && /^Competency 23 eligibility met per entered data \(new licence, under 25 at issue; licence issue date estimated from the licence expiry \(.+\)\)\.$/.test(est.text), est.text);
  check("C23 fields: no horizontal scroll at 375px (panel with R2, R3 and booking link)", await noHScroll(s.page));
  await shot(s.page, "11-c23-panel-375");

  await openEdit();
  check("C23 fields: reopening the Edit form shows the group collapsed again", (await s.page.$eval("[data-testid=c23-group]", (e) => e.open)) === false);
  await expand();
  check("C23 fields: the stored values are prefilled", (await s.page.inputValue("[data-testid=c23-hours]")) === "100" && (await s.page.inputValue("[data-testid=c23-hpt]")) === addDays(today, -200));
  await s.page.fill("[data-testid=c23-hours]", "82");
  check("C23 fields: changing the hours refreshes the as-of date to today", (await s.page.inputValue("[data-testid=c23-hours-on]")) === today);
  await save();
  const notYet = await r2();
  check("C23 fields: 82 of 100 hours → amber 'not yet' with the as-of date and the estimate label", notYet.tone === "amber" && /^Competency 23 not yet: 82 of 100 logged hours \(as of .+\)\. \(licence issue date estimated from the licence expiry/.test(notYet.text), notYet.text);

  // Borderline: the 12-month date (estimate + 12 months) is 13 days before today, so moving the estimate 14 days later flips the result.
  const held12 = addDays(today, -13);
  await openEdit(); await expand();
  await s.page.fill('label:has-text("Licence expiry") input', addYears(addYears(held12, -1), 5));
  await s.page.fill("[data-testid=c23-hours]", "100");
  await save();
  const border = await r2();
  check("C23 fields: borderline estimate → 'Borderline, check the licence card', amber, never a pass", border.tone === "amber" && /^Borderline, check the licence card/.test(border.text) && /estimated from the licence expiry/.test(border.text), border.text);
  await shot(s.page, "11-c23-borderline-375");

  // A typed issue date overrides the estimate and the label disappears.
  await openEdit(); await expand();
  await s.page.fill("[data-testid=c23-issued]", E);
  await save();
  const typed = await r2();
  check("C23 fields: a typed issue date overrides the estimate (exact, no 'estimated')", typed.tone === "plain" && typed.text === "Competency 23 eligibility met per entered data (new licence, under 25 at issue).", typed.text);

  // I1: an expired learner licence is never a pass, even with a typed issue date.
  await openEdit(); await expand();
  check("C23 fields: the date inputs cannot be set after today (max=today)", (await s.page.getAttribute("[data-testid=c23-hpt]", "max")) === today && (await s.page.getAttribute("[data-testid=c23-issued]", "max")) === today);
  await s.page.fill('label:has-text("Licence expiry") input', addDays(today, -30));
  await save();
  const expired = await r2();
  check("C23 fields: expired learner licence → grey 'update the licence details', never a pass", expired.tone === "grey" && /^Learner licence expired .+: update the licence details to check Competency 23 eligibility\.$/.test(expired.text), expired.text);
  await openEdit(); await expand();
  await s.page.fill('label:has-text("Licence expiry") input', addYears(today, 2));
  await save();
  check("C23 fields: licence details updated → back to a pass", (await r2()).tone === "plain");

  // Server validation (D19) shows in the status line and changes nothing.
  await openEdit(); await expand();
  await s.page.fill("[data-testid=c23-hpt]", addDays(today, 1));
  const rejected = await save();
  check("C23 fields: a future HPT date is rejected with a clear message and nothing is saved", /HPT pass date cannot be in the future/.test(rejected) && (await api()).hptPassedOn === addDays(today, -200), rejected);
  await s.page.click("[data-testid=cancel-edit-learner]");

  // Lesson form: R2 line when 23 is ticked as Assessed (before save), alongside R3.
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForSelector("[data-testid=form-reminders] .reminder[data-rule=r2]");
  const formR2 = await s.page.$eval("[data-testid=form-reminders] .reminder[data-rule=r2]", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  check("C23 fields: lesson form shows the R2 line when 23 is ticked as Assessed", formR2.tone === "plain" && /^Competency 23 eligibility met per entered data/.test(formR2.text), formR2.text);
  check("C23 fields: no horizontal scroll at 375px (lesson form with R2)", await noHScroll(s.page));
  await s.page.click(".edit-times summary");
  await s.page.fill("#lesson-field-date", addDays(today, -300));
  const early = await s.page.$eval("[data-testid=form-reminders] .reminder[data-rule=r2]", (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  check("C23 fields: the lesson form checks the draft lesson date (D13), still saveable", early.tone === "amber" && !(await s.page.isDisabled(".btn.save")), early.text);

  // New learner form: collapsed by default, hours fill the as-of date, values are stored.
  await s.page.click("text=+ New");
  await s.page.waitForSelector("[data-testid=c23-group]");
  check("C23 fields: the New learner group is collapsed by default", (await s.page.$eval("[data-testid=c23-group]", (e) => e.open)) === false && !(await s.page.isVisible("[data-testid=c23-hours]")));
  await s.page.fill('label:has-text("Student name") input', "QA Tony C23 New");
  await expand();
  await s.page.fill("[data-testid=c23-hours]", "5");
  await s.page.fill("[data-testid=c23-hpt]", addDays(today, -30));
  check("C23 fields: New learner form: no horizontal scroll at 375px (group open)", await noHScroll(s.page));
  await shot(s.page, "11-c23-new-375");
  await s.page.click("[data-testid=save-learner]");
  await s.page.waitForSelector(".status.ok, .status.error");
  const created = (await learnersApi()).find((l) => l.fullName === "QA Tony C23 New");
  check("C23 fields: New learner saves the five fields", created && created.loggedHours === 5 && created.loggedHoursOn === today && created.hptPassedOn === addDays(today, -30) && created.learnerLicenceIssuedOn === null, JSON.stringify(created));
  check("C23 fields: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 12. Learner checks (Phase 3a): missing PDF details, duplicate licence — reminders only ═══
{
  const post = async (path, body, who = "tony") => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json", "x-instructor-id": WHO[who][0] }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d.learner; };
  const full = { address: "1 QA Street", phone: "0400 000 001", dob: "2008-01-01", licenceExpiry: "2030-01-01", eligibility: "QA eligible", transmission: "auto", schoolWork: "QA School" };
  await post("/api/learners", { fullName: "QA Tony Missing", instructorId: WHO.tony[0], phone: "0400 000 002" });
  await post("/api/learners", { fullName: "QA Tony Dup One", instructorId: WHO.tony[0], licenceNumber: "QA77001", ...full });
  await post("/api/learners", { fullName: "QA Anna Dup Three", instructorId: WHO.anna[0], licenceNumber: " qa 77 001 " }, "anna");
  const two = await post("/api/learners", { fullName: "QA Anna Dup Two", instructorId: WHO.anna[0], licenceNumber: "qa77001" }, "anna");
  await fetch(`${B}/api/learners/${two.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": WHO.anna[0] }, body: JSON.stringify({ archived: true }) });
  const line = (page, rule, scope = "[data-testid=learner-checks]") => page.$eval(`${scope} .reminder[data-rule=${rule}]`, (e) => ({ tone: e.dataset.tone, text: e.textContent })).catch(() => null);

  const s = await session("tony");
  // The archived list normally loads in the background; fail it first so the "not checked" grey note path is exercised.
  await s.page.route("**/api/learners?status=archived", (route) => route.abort());
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  check("learner checks: viewport is 375px", (await s.page.evaluate(() => window.innerWidth)) === 375);
  await pick(s.page, "QA Tony Missing");
  await s.page.waitForSelector("[data-testid=learner-checks]");
  const miss = await line(s.page, "pdf-missing");
  check("learner checks: missing details → one amber line with the form labels and the Edit learner hint", miss?.tone === "amber" && miss.text === "Missing for the PDF: Address, DOB, Licence number, Licence expiry, Eligibility, School / Work, Manual / Auto. Add them with Edit learner.", JSON.stringify(miss));
  check("learner checks: no extra button for the hint (still exactly one Edit learner button)", (await s.page.$$("[data-testid=learner-checks] button, [data-testid=learner-checks] a")).length === 0 && (await s.page.$$("[data-testid=edit-learner]")).length === 1);
  check("learner checks: no duplicate line for a learner with no licence number", (await line(s.page, "dup-licence")) === null);
  check("learner checks: no horizontal scroll at 375px (missing details)", await noHScroll(s.page));
  await shot(s.page, "12-missing-details-375");

  await pick(s.page, "QA Tony Dup One");
  await s.page.waitForSelector("[data-testid=learner-checks] .reminder[data-rule=dup-licence]");
  check("learner checks: complete details → no missing line", (await line(s.page, "pdf-missing")) === null);
  const dup1 = await line(s.page, "dup-licence");
  check("learner checks: duplicate licence (case/space variant, another instructor's learner) → amber line naming them", dup1?.tone === "amber" && dup1.text === "Same licence number as QA Anna Dup Three (Anna's learner). Check this is not the same learner entered twice.", JSON.stringify(dup1));
  check("learner checks: no horizontal scroll at 375px (duplicate)", await noHScroll(s.page));
  await shot(s.page, "12-duplicate-panel-375");

  // New learner form: warning while typing, Save stays enabled and works.
  await s.page.click("text=+ New");
  await s.page.waitForSelector("[data-testid=save-learner]");
  await s.page.fill('label:has-text("Student name") input', "QA Tony Dup New");
  check("learner checks: New form: no licence line before a number is typed", (await s.page.$("[data-testid=licence-duplicate]")) === null);
  await s.page.fill('label:has-text("Licence number") input', "QA 00 999");
  const grey = await line(s.page, "dup-licence-archived", "[data-testid=licence-duplicate]");
  check("learner checks: New form: unique number while archived learners are not loaded → grey 'not checked', never a pass", grey?.tone === "grey" && /^Archived learners are not checked/.test(grey.text), JSON.stringify(grey));
  await s.page.fill('label:has-text("Licence number") input', "qa77 001");
  const formDup = await line(s.page, "dup-licence", "[data-testid=licence-duplicate]");
  check("learner checks: New form: typing a matching number → amber warning naming both learners, 'You can still save.'", formDup?.tone === "amber" && formDup.text === "Same licence number as QA Anna Dup Three (Anna's learner) and QA Tony Dup One. Check this is not the same learner entered twice. You can still save.", JSON.stringify(formDup));
  check("learner checks: New form: Save is not disabled by the duplicate warning", !(await s.page.isDisabled("[data-testid=save-learner]")));
  check("learner checks: no horizontal scroll at 375px (New form with warning)", await noHScroll(s.page));
  await shot(s.page, "12-duplicate-form-375");
  await s.page.click("[data-testid=save-learner]");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("learner checks: New form: the learner saves despite the warning", (await s.page.textContent(".status")).includes("QA Tony Dup New added"), await s.page.textContent(".status"));
  check("learner checks: the saved licence number is stored", (await learnersApi()).some((l) => l.fullName === "QA Tony Dup New" && l.licenceNumber), "");

  // Normal case: the archived list loads in the background, so the panel already includes archived duplicates without opening Archived.
  await s.page.unroute("**/api/learners?status=archived");
  await s.page.reload();
  await ready(s.page);
  await pick(s.page, "QA Tony Dup One");
  const archivedSeen = await s.page.waitForFunction(() => /QA Anna Dup Two \(archived/.test(document.querySelector("[data-testid=learner-checks]")?.textContent ?? ""), null, { timeout: 5000 }).then(() => true, () => false);
  check("learner checks: archived duplicates are included without opening Archived (background load)", archivedSeen, await s.page.textContent("[data-testid=learner-checks]"));
  await s.page.click("text=+ New");
  await s.page.fill('label:has-text("Licence number") input', "QA 00 998");
  check("learner checks: New form: unique number with archived loaded → no licence line (no grey note)", (await s.page.$("[data-testid=licence-duplicate]")) === null);
  await s.page.click("text=Cancel");

  // Opening Archived still works.
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => /\(\d+\)/.test(document.querySelector(".view-tab.active")?.textContent ?? ""));
  await tab(s.page, "My");
  await pick(s.page, "QA Tony Dup One");
  await s.page.waitForSelector("[data-testid=learner-checks] .reminder[data-rule=dup-licence]");
  const dupAll = await line(s.page, "dup-licence");
  check("learner checks: multiple matches incl. an archived one, self not counted", dupAll?.text === "Same licence number as QA Anna Dup Three (Anna's learner), QA Anna Dup Two (archived, Anna's learner) and QA Tony Dup New. Check this is not the same learner entered twice.", JSON.stringify(dupAll));

  // Edit form: the learner itself is never a match; a changed unique number clears the warning.
  await s.page.click("[data-testid=edit-learner]");
  await s.page.waitForSelector("[data-testid=licence-duplicate]");
  const editDup = await line(s.page, "dup-licence", "[data-testid=licence-duplicate]");
  check("learner checks: Edit form: warning shown, never naming the learner being edited", editDup?.tone === "amber" && !editDup.text.includes("QA Tony Dup One") && !(await s.page.isDisabled("[data-testid=save-learner]")), JSON.stringify(editDup));
  await s.page.fill('label:has-text("Licence number") input', "QA 55 555");
  check("learner checks: Edit form: a unique number (archived loaded) → no licence line", (await s.page.$("[data-testid=licence-duplicate]")) === null);
  check("learner checks: no horizontal scroll at 375px (Edit form)", await noHScroll(s.page));
  await s.page.click("[data-testid=cancel-edit-learner]");
  check("learner checks: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();

  // Someone who cannot edit gets the missing line without the Edit learner hint.
  const a = await session("anna");
  await ready(a.page);
  await a.page.setViewportSize({ width: 375, height: 812 });
  await tab(a.page, "All");
  await pick(a.page, "QA Tony Missing · Tony");
  await a.page.waitForSelector("[data-testid=learner-checks]");
  const annaMiss = await line(a.page, "pdf-missing");
  check("learner checks: non-owner sees the missing line without the Edit learner hint", annaMiss?.tone === "amber" && annaMiss.text.startsWith("Missing for the PDF: Address") && !annaMiss.text.includes("Edit learner"), JSON.stringify(annaMiss));
  check("learner checks: Anna: no horizontal scroll, no page errors", (await noHScroll(a.page)) && a.errors.length === 0, a.errors.join("|"));
  await a.ctx.close();
}

// ═══ 13. Archive reason + restore history (Phase 3b, migration 0010) at 375px ═══
{
  const post = async (fullName) => { const r = await fetch(B + "/api/learners", { method: "POST", headers: { "content-type": "application/json", "x-instructor-id": WHO.tony[0] }, body: JSON.stringify({ fullName, instructorId: WHO.tony[0] }) }); const d = await r.json(); if (!r.ok) throw new Error(JSON.stringify(d)); return d.learner; };
  const withReason = await post("QA Tony Archive Reason");
  const noReason = await post("QA Tony Archive Plain");
  const learnerById = async (id) => (await learnersApi("?status=archived")).find((l) => l.id === id) ?? (await learnersApi()).find((l) => l.id === id);
  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });

  // Cancel changes nothing, even after choosing a reason and typing a note.
  await pick(s.page, "QA Tony Archive Reason");
  await s.page.click(".archive-link");
  await s.page.waitForSelector("[data-testid=archive-panel]");
  check("archive reason: panel defaults to 'Choose a reason (optional)'", (await s.page.$eval("[data-testid=archive-reason-select]", (e) => e.selectedOptions[0].textContent)) === "Choose a reason (optional)");
  check("archive reason: panel has the five presets", (await s.page.$$eval("[data-testid=archive-reason-select] option", (os) => os.filter((o) => o.value).map((o) => o.textContent))).join("|") === "Completed / licensed|Stopped learning|Moved away|Went to another instructor|Other");
  check("archive reason: no horizontal scroll at 375px (archive panel)", await noHScroll(s.page));
  await shot(s.page, "13-archive-panel-375");
  await s.page.selectOption("[data-testid=archive-reason-select]", "moved_away");
  await s.page.fill("[data-testid=archive-note]", "QA moved to Sydney");
  await s.page.click("[data-testid=archive-cancel]"); await settle();
  const afterCancel = await learnerById(withReason.id);
  check("archive reason: Cancel changes nothing (still active, panel closed, still listed)", afterCancel.archivedAt === null && (await s.page.$("[data-testid=archive-panel]")) === null && (await options(s.page)).includes("QA Tony Archive Reason"), JSON.stringify(afterCancel));
  const historyNow = async (id) => (await (await fetch(`${B}/api/learners/${id}/archive-history`)).json()).events;
  check("archive reason: Cancel writes no history event", (await historyNow(withReason.id)).length === 0);

  // Archive with a reason and note: shown in the banner and in History.
  await s.page.click(".archive-link");
  await s.page.selectOption("[data-testid=archive-reason-select]", "moved_away");
  await s.page.fill("[data-testid=archive-note]", "  QA moved to Sydney  ");
  await s.page.click("[data-testid=archive-confirm]");
  await s.page.waitForSelector('.status:has-text("archived")');
  check("archive reason: archived with a reason leaves My learners", !(await options(s.page)).includes("QA Tony Archive Reason"));
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select learner"] option').length > 1);
  await pick(s.page, "QA Tony Archive Reason · Tony");
  await s.page.waitForSelector("[data-testid=archived-banner]");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date()); // Canberra date, as the app shows it
  const bannerText = (await s.page.textContent("[data-testid=archived-banner] p")).replace(/\s+/g, " ").trim();
  check("archive reason: banner shows 'Archived <date> — Moved away: note' (note trimmed)", bannerText === `Archived ${today} — Moved away: QA moved to Sydney`, bannerText);
  await s.page.click("[data-testid=archive-history] summary");
  await s.page.waitForSelector("[data-testid=archive-history-item]");
  const hist1 = await s.page.$$eval("[data-testid=archive-history-item]", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("archive reason: History lists the archive with reason, note and who", hist1.length === 1 && hist1[0] === `${today} ${hist1[0].slice(11, 16)} Archived — Moved away: QA moved to Sydney · Tony` && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} /.test(hist1[0]), hist1.join(" | "));
  check("archive reason: no horizontal scroll at 375px (banner + History)", await noHScroll(s.page));
  await shot(s.page, "13-archived-reason-history-375");

  // Restore adds a history line; archiving again without a reason shows no (old) reason.
  await s.page.click("text=Restore learner");
  await s.page.waitForSelector('.status:has-text("restored")');
  const restoredHist = await historyNow(withReason.id);
  check("archive reason: restore adds a 'restored' history event", restoredHist.length === 2 && restoredHist[0].action === "restored" && restoredHist[0].reason === null, JSON.stringify(restoredHist));
  await s.page.click(".archive-link");
  await s.page.click("[data-testid=archive-confirm]");
  await s.page.waitForSelector('.status:has-text("archived")');
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select learner"] option').length > 1);
  await pick(s.page, "QA Tony Archive Reason · Tony");
  await s.page.waitForSelector("[data-testid=archived-banner]");
  check("archive reason: re-archived without a reason → banner shows no reason (never the old one)", (await s.page.$("[data-testid=archive-reason]")) === null);
  await s.page.click("[data-testid=archive-history] summary");
  await s.page.waitForSelector("[data-testid=archive-history-item]");
  const hist2 = await s.page.$$eval("[data-testid=archive-history-item]", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("archive reason: History shows archived, restored, archived (newest first)", hist2.length === 3 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} Archived · Tony$/.test(hist2[0]) && hist2[0].startsWith(today) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} Restored · Tony$/.test(hist2[1]) && hist2[2].includes("Moved away"), hist2.join(" | "));

  // Archive without choosing a reason still works (plain confirm).
  await tab(s.page, "My learners");
  await pick(s.page, "QA Tony Archive Plain");
  await s.page.click(".archive-link");
  await s.page.click("[data-testid=archive-confirm]");
  await s.page.waitForSelector('.status:has-text("archived")');
  const plain = await learnerById(noReason.id);
  check("archive reason: archiving without a reason works (no reason stored)", Boolean(plain.archivedAt) && plain.archiveReason === null && plain.archiveNote === null, JSON.stringify(plain));
  check("archive reason: API {archived:true} with an unknown reason is a 400", (await fetch(`${B}/api/learners/${noReason.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, reason: "nope" }) })).status === 400);
  check("archive reason: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 14. Derived milestone validity after History Edit + Completed banner (progress-invalidation fix) ═══
{
  const post = async (path, body, method = "POST") => { const r = await fetch(B + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d; };
  const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const doneBy = (ids) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });
  const mkLessons = async (learnerId, steps) => {
    let odo = 1000;
    for (const step of steps) { const start = odo; odo += 12; await post(`/api/learners/${learnerId}/lessons`, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step }); }
  };
  // Bug 1: Lesson 1 achieves 1-17, Lesson 2 Review 1-17, Lesson 3 achieves 17 again; the UI edit removes 17 from Lesson 1.
  const r17 = (await post("/api/learners", { fullName: "QA Tony Invalid R17", instructorId: WHO.tony[0] })).learner;
  await mkLessons(r17.id, [doneBy(rng(1, 17)), doneBy(["review-1-17"]), doneBy(["17"])]);
  // Bug 2: a full valid chain, then Lesson 3 edited (API) so 22 is Not achieved.
  const revoked = (await post("/api/learners", { fullName: "QA Tony Completion Revoked", instructorId: WHO.tony[0] })).learner;
  await mkLessons(revoked.id, [doneBy(rng(1, 17)), doneBy(["review-1-17"]), doneBy(rng(18, 22)), doneBy(["review-1-22"]), doneBy(["final-drive-23"])]);
  const revokedDetail = await (await fetch(`${B}/api/learners/${revoked.id}`)).json();
  check("completed chain: API completion summary present while completed", revokedDetail.progress.completed === true && revokedDetail.completion?.completingLessonNo === 5);
  const l3 = revokedDetail.lessons.find((l) => l.lessonNo === 3);
  await post(`/api/learners/${revoked.id}/lessons/${l3.id}`, { lessonDate: l3.lessonDate, startTime: l3.startTime, finishTime: l3.finishTime, startOdometer: String(l3.startOdometer), finishOdometer: String(l3.finishOdometer),
    assessedIds: rng(18, 22), achievedResults: { ...Object.fromEntries(rng(18, 21).map((id) => [id, "achieved"])), "22": "not_achieved" },
    adiSignature: SIG.replace("AAAAC0lEQVR42", "AAAAC0lEQVR45"), learnerSignature: SIG.replace("AAAAC0lEQVR42", "AAAAC0lEQVR46") }, "PATCH");
  const afterRevoke = await (await fetch(`${B}/api/learners/${revoked.id}`)).json();
  check("revoked completion: API progress.completed false and completion null (raw Final Drive event kept)", afterRevoke.progress.completed === false && afterRevoke.completion === null && afterRevoke.progress.competencies["final-drive-23"].achieved === true, JSON.stringify(afterRevoke.completion));

  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await pick(s.page, "QA Tony Completion Revoked");
  await s.page.waitForSelector("text=Start Lesson");
  check("revoked completion: no 'CBT&A Completed' banner, no completed card, Start Lesson available", (await s.page.$("[data-testid=cbta-completed-banner]")) === null && (await s.page.$("[data-testid=cbta-completed-card]")) === null);
  await pick(s.page, "QA Tony Invalid R17");
  await s.page.waitForSelector("[data-testid=history-row]");
  await s.page.click("[data-testid=history-row] .h-edit >> nth=-1");
  await s.page.waitForSelector("text=/Editing Lesson #1/");
  await s.page.locator(".h-editing .comp-section:has(.comp-label:text-is('Assessed')) .chip-row >> nth=0 >> button:text-is(\"17\")").click();
  await signBoth(s.page);
  await s.page.click(".h-editing .btn.save");
  await s.page.waitForSelector(".status:has-text('Lesson updated'), .h-editing .status.error");
  const statusText = (await s.page.textContent(".status")) ?? "";
  check("History Edit removing 17 from Lesson #1 (17 only re-achieved in Lesson #3): saved with a short amber warning naming Review 1-17", statusText === "Lesson updated. No longer valid: Review 1-17 (prerequisites must be achieved in earlier lessons)." && (await s.page.$(".status.warn")) !== null, statusText);
  const r17After = await (await fetch(`${B}/api/learners/${r17.id}`)).json();
  check("…and the derived progress persists: Review 1-17 ready (not achieved), original Review 1-17 event kept", r17After.progress.review1_17.status === "ready" && r17After.progress.competencies["review-1-17"].achieved === true, r17After.progress.review1_17.status);
  check("progress-invalidation: no horizontal scroll at 375px", await noHScroll(s.page));
  await shot(s.page, "14-milestone-invalidated-375");
  check("progress-invalidation: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 15. Learner intake P1: "Competency 23 from" line + PDF Eligibility auto-fill (no migration) ═══
{
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  // First day of a month `back` months before today's month (never after today; no month-end clamping involved).
  const firstOf = (back, years = 0) => { const [y, m] = today.split("-").map(Number); const t = y * 12 + (m - 1) - back + years * 12; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`; };
  const nice = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  const post = async (path, body) => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d; };
  const dob = addDays(firstOf(0, -18), -40); // 18 at issue: under 25, already 17.
  const issue1 = firstOf(1);
  const due1 = firstOf(1, 1);
  const learner = (await post("/api/learners", { fullName: "QA Tony C23 From", instructorId: WHO.tony[0], dob, learnerLicenceIssuedOn: issue1, loggedHours: 40, loggedHoursOn: today })).learner;
  const stored = async () => (await (await fetch(`${B}/api/learners/${learner.id}`)).json()).learner;
  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await pick(s.page, "QA Tony C23 From");
  await s.page.waitForSelector("[data-testid=c23-from] .reminder");
  const line = async (sel) => s.page.$eval(sel, (e) => ({ tone: e.dataset.tone, text: e.textContent }));
  const panel1 = await line("[data-testid=c23-from] .reminder");
  check("C23 from: panel line 'Competency 23 from <date> (licence 12 months; plus 100 h and HPT)', amber", panel1.tone === "amber" && panel1.text === `Competency 23 from ${nice(due1)} (licence 12 months; plus 100 h and HPT).`, panel1.text);
  check("C23 from: no horizontal scroll at 375px (panel)", await noHScroll(s.page));
  await shot(s.page, "15-c23-from-panel-375");
  check("C23 from: stored Eligibility is still empty before any form save (export computes it)", (await stored()).eligibility === null);

  const openEdit = async () => { await s.page.click("[data-testid=edit-learner]"); await s.page.waitForSelector("[data-testid=c23-group]"); };
  const expand = async () => { if (!(await s.page.$eval("[data-testid=c23-group]", (e) => e.open))) await s.page.click("[data-testid=c23-group] summary"); };
  const save = async () => { await s.page.click("[data-testid=save-learner]"); await s.page.waitForSelector(".status.ok, .status.error"); return s.page.textContent(".status"); };
  const elig = () => s.page.inputValue("[data-testid=learner-eligibility]");
  await openEdit();
  check("C23 from: Edit opens Eligibility as stored (empty) with the 'auto' hint (filled on save)", (await elig()) === "" && (await s.page.isVisible("[data-testid=eligibility-auto]")), await elig());
  const untouched = await save();
  check("C23 from: opening Edit and saving untouched records no change ('No changes', Eligibility still empty)", /No changes/.test(untouched) && (await stored()).eligibility === null, untouched);
  check("C23 from: the panel still shows the live computed line after an untouched save", (await line("[data-testid=c23-from] .reminder")).text === panel1.text);
  await openEdit();
  await expand();
  const form1 = await line("[data-testid=c23-from-form] .reminder");
  check("C23 from: the Competency 23 group shows the same line, live", form1.text === panel1.text, form1.text);
  const issue2 = firstOf(2);
  const due2 = firstOf(2, 1);
  await s.page.fill("[data-testid=c23-issued]", issue2);
  check("C23 from: changing the issue date updates the generated Eligibility and the line live", (await elig()) === `C23 from ${due2}` && (await line("[data-testid=c23-from-form] .reminder")).text.startsWith(`Competency 23 from ${nice(due2)} (`), await elig());
  check("C23 from: no horizontal scroll at 375px (Edit form, group open)", await noHScroll(s.page));
  await shot(s.page, "15-c23-from-edit-375");
  const saved1 = await save();
  check("C23 from: the generated value is saved with the learner (normal save)", /updated/.test(saved1) && (await stored()).eligibility === `C23 from ${due2}`, saved1);

  // Tony's own text is never overwritten, even when the dates change.
  await openEdit(); await expand();
  await s.page.fill("[data-testid=learner-eligibility]", "QA own eligibility");
  check("C23 from: own text hides the auto hint", !(await s.page.isVisible("[data-testid=eligibility-auto]")));
  await s.page.fill("[data-testid=c23-issued]", issue1);
  check("C23 from: own text stays when the dates change", (await elig()) === "QA own eligibility", await elig());
  await save();
  check("C23 from: own text is saved unchanged", (await stored()).eligibility === "QA own eligibility");
  await openEdit(); await expand();
  check("C23 from: reopening keeps the own text (not regenerated)", (await elig()) === "QA own eligibility");
  // Clearing the field restarts auto-fill.
  await s.page.fill("[data-testid=learner-eligibility]", "");
  await save();
  check("C23 from: a cleared Eligibility is saved as the generated value again", (await stored()).eligibility === `C23 from ${due1}`, (await stored()).eligibility);

  // Tablet width: panel and form, no horizontal scroll.
  await s.page.setViewportSize({ width: 820, height: 1180 });
  check("C23 from: no horizontal scroll at 820px tablet (panel)", (await noHScroll(s.page)) && (await s.page.isVisible("[data-testid=c23-from] .reminder")));
  await openEdit(); await expand();
  check("C23 from: no horizontal scroll at 820px tablet (Edit form, group open)", await noHScroll(s.page));
  await shot(s.page, "15-c23-from-edit-820");
  await s.page.click("[data-testid=cancel-edit-learner]");
  await s.page.setViewportSize({ width: 375, height: 812 });

  // New learner: estimate from the expiry (≈ on screen, ~ in the Eligibility value); grey and empty without a DOB.
  await s.page.click("text=+ New");
  await s.page.waitForSelector("[data-testid=c23-group]");
  await s.page.fill('label:has-text("Student name") input', "QA Tony C23 Estimate");
  await expand();
  await s.page.fill('label:has-text("Licence expiry") input', firstOf(1, 5));
  const noDob = await line("[data-testid=c23-from-form] .reminder");
  check("C23 from: New form without a DOB → grey reason, no date, Eligibility stays empty, no auto hint", noDob.tone === "grey" && noDob.text === "Add date of birth to work out the Competency 23 date." && (await elig()) === "" && !(await s.page.isVisible("[data-testid=eligibility-auto]")), noDob.text);
  await s.page.fill('label:has-text("DOB") input', dob);
  const est = await line("[data-testid=c23-from-form] .reminder");
  check("C23 from: estimated issue date → '≈ <date>, between …' labelled as estimated", est.text.startsWith(`Competency 23 from ≈ ${nice(due1)}, between `) && est.text.includes("issue date estimated from the licence expiry"), est.text);
  check("C23 from: estimated Eligibility value uses ASCII '~'", (await elig()) === `C23 from ~${due1}`, await elig());
  check("C23 from: no horizontal scroll at 375px (New form)", await noHScroll(s.page));
  await shot(s.page, "15-c23-from-new-375");
  await s.page.click("[data-testid=save-learner]");
  await s.page.waitForSelector(".status.ok, .status.error");
  const created = (await learnersApi()).find((l) => l.fullName === "QA Tony C23 Estimate");
  check("C23 from: New learner saves the estimated Eligibility value", created?.eligibility === `C23 from ~${due1}`, JSON.stringify(created?.eligibility));
  check("C23 from: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

// ═══ 16. Learner transfer (3c T1, migration 0011): two taps, History line, receiver's CoP 9.1 h / 9.2 e check ═══
{
  const api = async (path, body, headers = {}, method = "POST") => { const r = await fetch(B + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const mkLearner = async (fullName, who) => (await api("/api/learners", { fullName, instructorId: WHO[who][0] }, { "x-instructor-id": WHO[who][0] })).body.learner;
  const moving = await mkLearner("QA Tony Transfer Move", "tony");
  await api(`/api/learners/${moving.id}/lessons`, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: "1000", finishOdometer: "1012", taughtIds: ["1"], adiSignature: SIG, learnerSignature: SIG }, { "x-instructor-id": WHO.tony[0] });
  const archived = await mkLearner("QA Tony Transfer Archived", "tony");
  await api(`/api/learners/${archived.id}`, { archived: true }, { "x-instructor-id": WHO.tony[0] }, "PATCH");
  const longDate = (() => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month} ${p.year}`; })();

  // Tony (home instructor) at 375px: Transfer learner… → Anna preselected → "Transfer to Anna" = two taps.
  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  await pick(s.page, "QA Tony Transfer Move");
  await s.page.waitForSelector("[data-testid=transfer-open]");
  check("transfer: no 'check the records' reminder before any transfer", (await s.page.$("[data-testid=transfer-check]")) === null);
  await s.page.click("[data-testid=transfer-open]");
  await s.page.waitForSelector("[data-testid=transfer-panel]");
  const choices = await s.page.$$eval("[data-testid=transfer-choice]", (els) => els.map((e) => ({ checked: e.checked, label: e.closest("label").textContent.trim() })));
  check("transfer: the panel lists only the other active instructor (Anna), preselected", choices.length === 1 && choices[0].label === "Anna" && choices[0].checked, JSON.stringify(choices));
  check("transfer: confirm button reads 'Transfer to Anna'", (await s.page.textContent("[data-testid=transfer-confirm]")).trim() === "Transfer to Anna");
  check("transfer: no horizontal scroll at 375px (transfer panel)", await noHScroll(s.page));
  await shot(s.page, "16-transfer-panel-375");
  await s.page.click("[data-testid=transfer-cancel]");
  check("transfer: Cancel closes the panel and writes nothing", (await s.page.$("[data-testid=transfer-panel]")) === null && (await learnersApi()).find((l) => l.id === moving.id).instructorId === WHO.tony[0]);
  await s.page.click("[data-testid=transfer-open]");
  await s.page.click("[data-testid=transfer-confirm]");
  await s.page.waitForSelector('.status:has-text("Transferred to Anna")');
  const moved = (await learnersApi()).find((l) => l.id === moving.id);
  check("transfer: two taps moved the learner to Anna (one event, by Tony)", moved.instructorId === WHO.anna[0] && moved.transfers.length === 1 && moved.transfers[0].byInstructorId === WHO.tony[0], JSON.stringify(moved.transfers));
  check("transfer: Tony's view switches to All and the learner stays open", (await activeTab(s.page)).startsWith("All") && (await s.page.textContent(".summary-main small")) === "QA Tony Transfer Move");
  const divider = (await s.page.textContent("[data-testid=history-transfer]")).trim();
  check("transfer: History shows 'Transferred from Tony to Anna, <Canberra date>' above Tony's lesson", divider === `Transferred from Tony to Anna, ${longDate}` && (await s.page.$$eval(".history ol > li", (els) => els.map((e) => e.dataset.testid))).join() === "history-transfer,history-row", divider);
  check("transfer: Tony can still edit his own lesson (Edit shown, not 'Recorded by')", (await s.page.$("[data-testid=history-row] .h-edit")) !== null && (await s.page.$("[data-testid=history-readonly]")) === null);
  check("transfer: Tony no longer sees Edit learner or Transfer, nor the receiver's reminder", (await s.page.$("[data-testid=edit-learner]")) === null && (await s.page.$("[data-testid=transfer-open]")) === null && (await s.page.$("[data-testid=transfer-check]")) === null);
  await tab(s.page, "My learners");
  check("transfer: the learner left Tony's My learners", !(await options(s.page)).includes("QA Tony Transfer Move"));
  check("transfer: no horizontal scroll at 375px (after transfer)", await noHScroll(s.page));
  await shot(s.page, "16-transfer-done-tony-375");
  // Archived learner: no Transfer in the UI; the API says restore first.
  await tab(s.page, "Archived");
  await s.page.waitForFunction(() => document.querySelectorAll('select[aria-label="Select learner"] option').length > 1);
  await pick(s.page, "QA Tony Transfer Archived · Tony");
  await s.page.waitForSelector("[data-testid=archived-banner]");
  check("transfer: an archived learner shows no Transfer", (await s.page.$("[data-testid=transfer-open]")) === null);
  const archivedTry = await api(`/api/learners/${archived.id}/transfer`, { toInstructorId: WHO.anna[0] }, { "x-instructor-id": WHO.tony[0] });
  check("transfer: API refuses an archived learner (400, 'Restore the learner first')", archivedTry.status === 400 && /Restore the learner first/.test(archivedTry.body.error), JSON.stringify(archivedTry));
  check("transfer: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();

  // Anna (receiver) at tablet width: My learners has the learner, amber reminder, "Recorded by Tony", one tap Checked.
  const a = await session("anna");
  await ready(a.page);
  await a.page.setViewportSize({ width: 768, height: 1024 });
  check("transfer: Anna's My learners now lists the learner", (await options(a.page)).includes("QA Tony Transfer Move"));
  await pick(a.page, "QA Tony Transfer Move");
  await a.page.waitForSelector("[data-testid=transfer-check]");
  const reminder = (await a.page.textContent("[data-testid=transfer-check] span")).trim();
  check("transfer: receiver sees the CoP 9.1 h / 9.2 e reminder (amber)", reminder === "Check the records from Tony. If any is not filled out correctly, or is false, misleading or incomplete, tell ADI Audit as soon as possible (CoP 9.1 h, 9.2 e)." && (await a.page.$("[data-testid=transfer-check] .reminder.amber")) !== null, reminder);
  check("transfer: Anna sees 'Recorded by Tony' (no Edit) on Tony's lesson", ((await a.page.textContent("[data-testid=history-readonly]")) ?? "").trim() === "Recorded by Tony" && (await a.page.$("[data-testid=history-row] .h-edit")) === null);
  check("transfer: Anna can now edit the learner and transfer back", (await a.page.$("[data-testid=edit-learner]")) !== null && (await a.page.$("[data-testid=transfer-open]")) !== null);
  check("transfer: Start Lesson is not blocked by the reminder", (await a.page.$("text=Start Lesson")) !== null);
  check("transfer: no horizontal scroll at tablet width 768px (reminder + History)", await noHScroll(a.page));
  await shot(a.page, "16-transfer-receiver-768");
  await a.page.click("[data-testid=transfer-checked]");
  await a.page.waitForFunction(() => document.querySelector("[data-testid=transfer-check]") === null);
  const afterCheck = (await learnersApi()).find((l) => l.id === moving.id).transfers[0];
  check("transfer: one tap 'Checked' is stored (who + when) and hides the reminder", afterCheck.recordsCheckedBy === WHO.anna[0] && Boolean(afterCheck.recordsCheckedAt), JSON.stringify(afterCheck));
  await a.page.reload(); await ready(a.page);
  await pick(a.page, "QA Tony Transfer Move");
  await a.page.waitForSelector("[data-testid=history-transfer]");
  check("transfer: after reload the reminder stays hidden", (await a.page.$("[data-testid=transfer-check]")) === null);
  await a.page.setViewportSize({ width: 1024, height: 768 });
  await a.page.click("[data-testid=transfer-open]");
  await a.page.waitForSelector("[data-testid=transfer-panel]");
  check("transfer: no horizontal scroll at tablet landscape 1024px (transfer panel)", await noHScroll(a.page));
  await shot(a.page, "16-transfer-panel-1024");
  await a.page.click("[data-testid=transfer-cancel]");
  const tonyTry = await api(`/api/learners/${moving.id}/transfer`, { toInstructorId: WHO.tony[0] }, { "x-instructor-id": WHO.tony[0] });
  check("transfer: API refuses Tony, who is no longer the owner (400, 'only they can transfer')", tonyTry.status === 400 && tonyTry.body.error === "This learner belongs to Anna; only they can transfer them.", JSON.stringify(tonyTry));
  const sameTry = await api(`/api/learners/${moving.id}/transfer`, { toInstructorId: WHO.anna[0] }, { "x-instructor-id": WHO.anna[0] });
  check("transfer: API refuses a same-instructor transfer (400, 'already belongs')", sameTry.status === 400 && sameTry.body.error === "This learner already belongs to Anna.", JSON.stringify(sameTry));
  const tonyCheck = await api(`/api/learners/${moving.id}/transfer/checked`, {}, { "x-instructor-id": WHO.tony[0] });
  check("transfer: a later 'Checked' call by Tony never changes who checked", (await learnersApi()).find((l) => l.id === moving.id).transfers[0].recordsCheckedBy === WHO.anna[0], JSON.stringify(tonyCheck));
  check("transfer: Anna: no page errors", a.errors.length === 0, a.errors.join("|"));
  await a.ctx.close();
}


// ═══ 18. Competency 23 route reminders (R10): home district from the address, suggestion line, route check group ═══
{
  const post = async (path, body, method = "POST") => { const r = await fetch(B + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`); return d; };
  const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const doneBy = (ids) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });
  const fdReady = async (fullName, address) => {
    const learner = (await post("/api/learners", { fullName, instructorId: WHO.tony[0], address })).learner;
    let odo = 1000;
    for (const step of [doneBy(rng(1, 17)), doneBy(["review-1-17"]), doneBy(rng(18, 22)), doneBy(["review-1-22"])]) {
      const start = odo; odo += 12;
      await post(`/api/learners/${learner.id}/lessons`, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step });
    }
    return learner;
  };
  // Synthetic learners with invented street numbers in several districts (never real data).
  const florey = await fdReady("QA Tony Route Florey", "12 Gungahlin Dr, Florey ACT 2615"); // street named after another centre: the suburb must win
  await fdReady("QA Tony Route Weston", "7 Namatjira Dr, Weston ACT 2611");
  await fdReady("QA Tony Route Queanbeyan", "8 Lowe St, Queanbeyan NSW 2620");
  const noAddress = await fdReady("QA Tony Route No Address", "");
  await fdReady("QA Tony Route Kingston", "4 Eyre St, Kingston ACT 2604");

  const s = await session("tony");
  await ready(s.page);
  await s.page.setViewportSize({ width: 375, height: 812 });
  const r10 = async () => { await s.page.waitForSelector("[data-testid=panel-reminders] .reminder[data-rule=r10]"); return s.page.$eval("[data-testid=panel-reminders] .reminder[data-rule=r10]", (e) => ({ tone: e.dataset.tone, text: e.textContent })); };
  await pick(s.page, "QA Tony Route Florey");
  let line = await r10();
  check("route: 23-ready panel adds the 4th line with the unfamiliar centres (home Belconnen from 'Florey', not 'Gungahlin Dr')", line.tone === "plain" && line.text === "Unfamiliar town centres (home: Belconnen, from 'Florey' in the address): Civic, Gungahlin, Woden, Tuggeranong, Fyshwick, Manuka/Kingston.", line.text);
  check("route: the line comes after R2 and R3 (r2, r3, r10) and the booking link is still shown", (await s.page.$$eval("[data-testid=panel-reminders] .reminder", (els) => els.map((e) => e.dataset.rule))).join(",") === "r2,r3,r10" && (await s.page.$("[data-testid=adi-booking]")) !== null);
  check("route: no horizontal scroll at 375px (panel)", await noHScroll(s.page));
  await shot(s.page, "18-route-panel-375");
  await pick(s.page, "QA Tony Route Weston");
  line = await r10();
  check("route: Weston Creek has no accepted centre → plain, all 7 unfamiliar, no neighbour counts as home", line.tone === "plain" && line.text === "Home district Weston Creek (from 'Weston' in the address) has no accepted town centre: all 7 are unfamiliar by this rule.", line.text);
  await pick(s.page, "QA Tony Route Queanbeyan");
  line = await r10();
  check("route: NSW address → outside the ACT, all 7 unfamiliar", line.tone === "plain" && line.text === "Address outside the ACT (Queanbeyan): all 7 town centres are unfamiliar by the home-district rule.", line.text);
  await pick(s.page, "QA Tony Route No Address");
  line = await r10();
  check("route: empty address → grey 'add the learner's suburb', never a guess", line.tone === "grey" && line.text === "Cannot check the home town centre: add the learner's suburb to the address.", line.text);
  await pick(s.page, "QA Tony Route Kingston");
  line = await r10();
  check("route: Kingston (South Canberra) → Manuka/Kingston is home, the other 6 are suggested", line.text === "Unfamiliar town centres (home: Manuka/Kingston, from 'Kingston' in the address): Civic, Gungahlin, Belconnen, Woden, Tuggeranong, Fyshwick.", line.text);

  // Lesson form: the group appears only with 23 Assessed; Civic (first suggested) preselected; written into location + comments at once.
  await pick(s.page, "QA Tony Route Florey");
  await r10();
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  check("route: no route group before 23 Final Drive is ticked", (await s.page.$("[data-testid=route-group]")) === null);
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForSelector("[data-testid=route-group]");
  const location = () => s.page.inputValue('label:has-text("Location") input');
  const comments = () => s.page.inputValue('label:has-text("Comments") textarea');
  check("route: ticking 23 Assessed shows the collapsed group and writes NOTHING into Location / Comments", !(await s.page.$eval("[data-testid=route-group]", (e) => e.open)) && (await location()) === "" && (await comments()) === "", `${await location()} | ${await comments()}`);
  await s.page.click("[data-testid=route-group] summary");
  check("route: new-lesson form has no signature hint (only History Edit)", (await s.page.$("[data-testid=route-signature-hint]")) === null);
  check("route: Civic is only highlighted as preselected (data-preselected), home chip carries visually-hidden 'home district' text", (await s.page.$eval("[data-testid=route-centre][data-centre=civic]", (e) => e.dataset.preselected)) === "true" && (await s.page.$eval("[data-testid=route-centre][data-centre=belconnen]", (e) => e.textContent)) === "Belconnen (home district)" && (await s.page.$eval("[data-testid=route-centre][data-centre=belconnen] .sr-only", (e) => getComputedStyle(e).position)) === "absolute");
  const centres = await s.page.$$eval("[data-testid=route-centre]", (els) => els.map((e) => ({ id: e.dataset.centre, selected: e.getAttribute("aria-pressed") === "true", home: e.classList.contains("home") })));
  check("route: 7 town-centre chips, Civic selected, Belconnen marked as the home centre (still tappable)", centres.length === 7 && centres.filter((c) => c.selected).map((c) => c.id).join() === "civic" && centres.filter((c) => c.home).map((c) => c.id).join() === "belconnen", JSON.stringify(centres));
  const groupRem = async () => s.page.$$eval("[data-testid=route-group-reminders] .reminder", (els) => els.map((e) => ({ id: e.dataset.rule, tone: e.dataset.tone, text: e.textContent })));
  check("route: nothing recorded yet → grey 'Route not recorded yet… Nothing is written until you do.'", JSON.stringify(await groupRem()) === JSON.stringify([{ id: "r10-centre", tone: "grey", text: "Route not recorded yet: tap the town centre or a tick after the drive. Nothing is written until you do." }]), JSON.stringify(await groupRem()));
  check("route: no horizontal scroll at 375px (group open)", await noHScroll(s.page));
  await shot(s.page, "18-route-group-375");
  await s.page.click("[data-testid=route-centre][data-centre=belconnen]");
  check("route: the first explicit tap (home centre) writes Location + the line and shows the amber warning with the evidence", (await comments()) === "Comp 23 route (Belconnen): none ticked." && (await groupRem())[0].tone === "amber" && (await groupRem())[0].text === "Belconnen is the learner's home district (from 'Florey' in the address). Competency 23 needs an unfamiliar town centre. You can still save." && (await location()) === "Belconnen", JSON.stringify(await groupRem()));
  await s.page.click("[data-testid=route-centre][data-centre=woden]");
  check("route: switching to Woden removes the amber line and rewrites Location + the comment line", (await groupRem()).every((r) => r.id !== "r10-home") && (await location()) === "Woden" && (await comments()) === "Comp 23 route (Woden): none ticked.", `${await location()} | ${await comments()}`);
  // The instructor's own comment text is kept while the group regenerates its line.
  await s.page.fill('label:has-text("Comments") textarea', `Smooth drive.\n${await comments()}`);
  await s.page.click("[data-testid=route-all-met]");
  const ticked = await s.page.$$eval("[data-testid=route-item]", (els) => els.filter((e) => e.checked).length);
  check("route: 'All met' ticks all six in one tap → plain line; own text kept above the regenerated line", ticked === 6 && (await groupRem())[0].tone === "plain" && (await comments()) === "Smooth drive.\nComp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked.", await comments());
  await s.page.click("[data-testid=route-item][data-item=lights]");
  await s.page.click('.result-list li:has-text("23 Final Drive") >> text="Achieved"');
  check("route: one item unticked while 23 is Achieved → amber 'not complete', Save stays enabled", (await groupRem())[0].tone === "amber" && (await groupRem())[0].text === "Route check not complete: 2 lights. You can still save." && (await comments()).endsWith("ticked: 2 zones, stop, give way, 2 crossings, 5R/5L; not ticked: 2 lights.") && !(await s.page.isDisabled(".btn.save")), JSON.stringify(await groupRem()));
  await shot(s.page, "18-route-amber-375");
  await s.page.fill('input[placeholder="Enter now"]', "1060");
  // Start Lesson → End Lesson in the same minute gives finish == start (rejected), so give the drive real times.
  await s.page.click(".edit-times summary");
  await s.page.fill('.edit-times input[type="time"] >> nth=0', "09:00");
  await s.page.fill('.edit-times input[type="time"] >> nth=1', "10:00");
  await signBoth(s.page);
  await s.page.click(".btn.save");
  await s.page.waitForSelector(".status.ok, .status.error");
  check("route: the lesson saves with an incomplete checklist (reminders never block)", (await s.page.textContent(".status")).includes("Lesson #5 saved"), await s.page.textContent(".status"));
  const saved = (await (await fetch(`${B}/api/learners/${florey.id}`)).json()).lessons.find((l) => l.lessonNo === 5);
  check("route: stored as location + comment line only (no new field)", saved.location === "Woden" && saved.comments === "Smooth drive.\nComp 23 route (Woden): ticked: 2 zones, stop, give way, 2 crossings, 5R/5L; not ticked: 2 lights.", JSON.stringify([saved.location, saved.comments]));
  check("route: History shows the line in Comments and Woden in the odometer line", (await s.page.textContent("[data-testid=history-row]")).includes("Comp 23 route (Woden)") && (await s.page.textContent("[data-testid=history-row] .h-odo")).includes("Woden"));

  // History Edit parses the exact line back into ticks; a tick regenerates it; own text untouched.
  await s.page.click("[data-testid=history-row] .h-edit");
  await s.page.waitForSelector("[data-testid=edit-route-group]");
  await s.page.click("[data-testid=edit-route-group] summary");
  check("route: History Edit shows the signature hint inside the group", ((await s.page.textContent("[data-testid=edit-route-group] [data-testid=route-signature-hint]")) ?? "") === "Changing this clears both signatures: location and comments are signed content.");
  // Toggling another Assessed chip (not 23) must not touch the signed fields of this legacy-like lesson.
  const beforeToggle = await s.page.inputValue(".h-editing textarea");
  await s.page.click('.h-editing .comp-section:has(.comp-label:text-is("Assessed")) .chip-row >> text="19"');
  await s.page.click('.h-editing .comp-section:has(.comp-label:text-is("Assessed")) .chip-row >> text="19"');
  check("route: an unrelated Assessed change in History Edit leaves Location / Comments untouched", (await s.page.inputValue(".h-editing textarea")) === beforeToggle && (await s.page.inputValue('.h-editing label:has-text("Location") input')) === "Woden");
  const editTicks = await s.page.$$eval("[data-testid=edit-route-group] [data-testid=route-item]", (els) => els.map((e) => `${e.dataset.item}:${e.checked ? 1 : 0}`).join(","));
  check("route: History Edit parses the stored line back (5 ticked, lights not; Woden selected)", editTicks === "zones:1,stop:1,giveWay:1,lights:0,crossings:1,turns:1" && (await s.page.$eval("[data-testid=edit-route-group] [data-testid=route-centre][data-centre=woden]", (e) => e.getAttribute("aria-pressed"))) === "true", editTicks);
  await s.page.click("[data-testid=edit-route-group] [data-testid=route-item][data-item=lights]");
  const editComments = await s.page.inputValue(".h-editing textarea");
  check("route: ticking lights in History Edit regenerates the line; own text kept", editComments === "Smooth drive.\nComp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked.", editComments);
  await signBoth(s.page);
  await s.page.click(".h-editing .btn.save");
  await s.page.waitForSelector(".status.ok:has-text('Lesson updated'), .h-editing .status.error");
  const edited = (await (await fetch(`${B}/api/learners/${florey.id}`)).json()).lessons.find((l) => l.lessonNo === 5);
  check("route: the edit is saved (location unchanged, line now 'all ticked')", edited.location === "Woden" && edited.comments.endsWith("5R/5L all ticked.") && edited.revisionCount === 1, JSON.stringify([edited.location, edited.comments]));

  // PDF: the line prints through the existing Comments column (or Additional Notes), nothing new.
  await s.page.click("text=/Export.*PDF/i");
  if (await s.page.$(".export-adi-prompt input")) await s.page.fill(".export-adi-prompt input", "QA-ADI-1");
  const [dl] = await Promise.all([s.page.waitForEvent("download", { timeout: 60000 }), s.page.click(".export-adi-prompt .btn.primary").catch(() => {})]);
  const routePdf = `${OUT}/qa-route.pdf`;
  await dl.saveAs(routePdf);
  const { execFileSync: run } = await import("node:child_process");
  const routeText = run("pdftotext", ["-layout", routePdf, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  check("route: PDF prints the route line and Woden through today's Location/Comments cells", /Comp 23 route \(Woden\)/.test(routeText) && /Woden/.test(routeText) && /Smooth drive\./.test(routeText), routeText.match(/Comp 23 route[^.]{0,80}/)?.[0] ?? "no route line in PDF text");

  // Unticking 23 removes the app's line and the written name; a learner with no address gets Civic (first of all 7) by default.
  await pick(s.page, "QA Tony Route No Address");
  await r10();
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForSelector("[data-testid=route-group]");
  check("route: no address → group still works, Civic only highlighted (all 7 unfamiliar, no home chip), nothing written", (await location()) === "" && (await s.page.$$eval("[data-testid=route-group] [data-testid=route-centre].home", (els) => els.length)) === 0);
  await s.page.fill('label:has-text("Location") input', "Civic: London Cct");
  await s.page.click("[data-testid=route-group] summary");
  await s.page.click("[data-testid=route-centre][data-centre=civic]");
  check("route: a hand-typed 'Civic: ' prefix never stacks when Civic is tapped", (await location()) === "Civic: London Cct" && (await comments()) === "Comp 23 route (Civic): none ticked.", `${await location()} | ${await comments()}`);
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForFunction(() => document.querySelector("[data-testid=route-group]") === null);
  check("route: unticking 23 Assessed removes the group, the comment line and the 'Civic: ' prefix, keeping the instructor's text", (await location()) === "London Cct" && (await comments()) === "", `${await location()} | ${await comments()}`);
  await s.page.click("text=Discard this lesson");
  void noAddress;

  // Tablet width: group open, two-column ticks, no horizontal scroll.
  await s.page.setViewportSize({ width: 820, height: 1180 });
  await pick(s.page, "QA Tony Route Kingston");
  await r10();
  check("route: no horizontal scroll at 820px tablet (panel)", await noHScroll(s.page));
  await s.page.click("text=Start Lesson");
  await s.page.click("text=End Lesson");
  await s.page.click(".chip-row.special >> text=/23 Final Drive/");
  await s.page.waitForSelector("[data-testid=route-group]");
  await s.page.click("[data-testid=route-group] summary");
  check("route: Kingston learner → Civic highlighted, Manuka/Kingston marked home, nothing written; no horizontal scroll at 820px (group open)", (await location()) === "" && (await s.page.$$eval("[data-testid=route-centre].home", (els) => els.map((e) => e.dataset.centre).join())) === "manuka-kingston" && (await noHScroll(s.page)));
  await shot(s.page, "18-route-group-820");
  await s.page.click("text=Discard this lesson");
  check("route: Tony: no page errors", s.errors.length === 0, s.errors.join("|"));
  await s.ctx.close();
}

} catch (error) {
  check(`script aborted: ${String(error.message).split("\n")[0]}`, false, String(error.message).split("\n").slice(1,4).join(" ").trim());
}

await browser.close();
writeFileSync(`${OUT}/results.txt`, results.map((r) => r.line).join("\n"));
console.log(results.map((r) => r.line).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? `  (${failed} FAIL)` : ""}`);
process.exit(failed ? 1 : 0);
