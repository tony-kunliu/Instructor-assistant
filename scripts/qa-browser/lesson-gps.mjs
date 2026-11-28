// Private-edition lesson capture with synthetic device positions and a real lesson API.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const executablePath = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const base = process.env.QA_BASE;
const headers = {
  "x-instructor-id": "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01",
  "x-instructor-name": "Tony",
};

// v2 draft envelope: the stored value is { v: 1, rev, tabId, updatedAt, tombstone, draft }.
// These helpers read and replace the draft inside it; a bare JSON value is a legacy draft (revision 0).
const readStored = (page, key) => page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = JSON.parse(raw);
  if (parsed && parsed.v === 1) return parsed.tombstone ? { tombstone: true, rev: parsed.rev } : parsed.draft;
  return parsed;
}, key);
const replaceStored = (page, key, patch) => page.evaluate(({ key, patch }) => {
  const raw = localStorage.getItem(key);
  const parsed = raw ? JSON.parse(raw) : null;
  if (parsed && parsed.v === 1 && typeof parsed.rev === "number") {
    localStorage.setItem(key, JSON.stringify({ ...parsed, rev: parsed.rev + 1, updatedAt: Date.now(), draft: { ...parsed.draft, ...patch } }));
  } else {
    localStorage.setItem(key, JSON.stringify({ ...(parsed ?? {}), ...patch }));
  }
}, { key, patch });
const storedIsTombstone = (key) => {
  const raw = localStorage.getItem(key);
  if (raw === null) return true;
  try { const parsed = JSON.parse(raw); return parsed.v === 1 && parsed.tombstone === true; } catch { return false; }
};
const seed = await fetch(`${base}/api/learners`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ fullName: "QA GPS Lesson", instructorId: headers["x-instructor-id"] }),
});
assert.ok(seed.ok, await seed.clone().text());
const { learner } = await seed.json();

const browser = await chromium.launch({ executablePath });
try {
  const { defaultBrowserType: _, ...mobile } = devices["iPhone SE"];
  const context = await browser.newContext({ ...mobile, viewport: { width: 375, height: 740 }, extraHTTPHeaders: headers });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((id) => {
    localStorage.setItem("actgds-driver:last-learner", id);
    const gps = { watches: 0, clears: 0, emit: null, deny: false, active: false };
    window.lessonGpsTest = gps;
    Object.defineProperty(navigator, "geolocation", { value: {
      watchPosition(ok, fail) {
        gps.active = true;
        gps.watches++;
        gps.emit = (positions, startedAt) => positions.forEach(([x, y], index) => ok({
          timestamp: startedAt + 3000 * (index + 1),
          coords: { latitude: -35.25723 + y / 111_195, longitude: 149.054376 + x / 90_700, accuracy: 5, speed: 8, heading: null },
        }));
        if (gps.deny) queueMicrotask(() => fail({ code: 1, message: "QA permission denied" }));
        return gps.watches;
      },
      clearWatch() {
        gps.active = false;
        gps.clears++;
      },
    } });
  }, learner.id);
  const start = page.getByRole("button", { name: "Start Lesson #1", exact: true });
  const end = page.getByRole("button", { name: "End Lesson", exact: true });
  const consent = page.getByTestId("lesson-gps-consent");
  const review = page.getByTestId("lesson-gps-review");
  const comments = page.getByTestId("notes-block").locator("textarea");
  const startedAt = Date.parse("2026-10-20T01:00:00Z");
  await page.clock.setFixedTime(new Date(startedAt));
  await page.goto(base);

  await start.waitFor();
  assert.equal(await consent.isChecked(), false);
  await start.click();
  assert.equal(await page.evaluate(() => window.lessonGpsTest.watches), 0);
  assert.equal(await page.getByTestId("lesson-gps-running").count(), 0);
  await page.getByRole("button", { name: "Discard this lesson", exact: true }).click();

  await consent.check();
  await start.click();
  await page.waitForFunction(() => window.lessonGpsTest.active);
  assert.equal(await page.evaluate(() => window.lessonGpsTest.watches), 1);
  await comments.fill("Coach note from during the lesson.");
  await page.evaluate((at) => window.lessonGpsTest.emit([[-55, 0], [-25, 0], [-12, 13], [11, 14], [30, 0], [56, 0]], at), startedAt);
  await page.clock.setFixedTime(new Date(startedAt + 60_000));
  await end.click();
  await page.getByRole("heading", { name: "CBT&A checklist", exact: true }).waitFor();
  await review.getByText(/1 possible roundabout pass/).waitFor();
  assert.deepEqual(await page.evaluate(() => [window.lessonGpsTest.active, window.lessonGpsTest.clears]), [false, 1]);
  assert.match(await comments.inputValue(), /^Coach note from during the lesson\.\nGPS estimates \(partial,/);
  assert.doesNotMatch(await comments.inputValue(), /Coulter Drive/);
  assert.match(await review.textContent(), /Coulter Drive/);
  assert.equal(await page.getByTestId("competency-block").locator("[aria-pressed=true]").count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  const text = (await comments.inputValue()) + "\nCoach verified the route.";
  await comments.fill(text);
  await page.getByLabel("Start odometer (km)").fill("1000");
  await page.getByLabel("Finish odometer (km)").fill("1003");
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/learners/${learner.id}/lessons`) && response.request().method() === "POST"),
    page.getByTestId("save-sign-later").click(),
  ]);
  assert.ok(saved.ok(), await saved.text());
  const body = saved.request().postDataJSON();
  assert.equal(body.comments, text);
  assert.equal(Object.hasOwn(body, "lessonGps"), false);
  assert.deepEqual([body.taughtIds, body.assessedIds, body.achievedResults], [[], [], {}]);
  assert.doesNotMatch(JSON.stringify(body), /149\.054376|-35\.25723/);
  const record = await saved.json();
  assert.equal(record.lesson.comments, text);
  assert.equal(record.lesson.finishOdometer - record.lesson.startOdometer, 3);
  await page.waitForFunction(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("ia-lesson-gps", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["meta", "samples", "events"]);
      const counts = Array.from(tx.objectStoreNames, (name) => tx.objectStore(name).count());
      tx.oncomplete = () => { db.close(); resolve(counts.every((entry) => entry.result === 0)); };
    };
  }));

  // A denied location request leaves a normal checklist ready to use.
  await page.evaluate(() => { window.lessonGpsTest.deny = true; });
  await consent.check();
  await page.getByRole("button", { name: "Start Lesson #2", exact: true }).click();
  await page.getByText(/permission was refused/).waitFor();
  await page.clock.setFixedTime(new Date(startedAt + 110_000));
  await end.click();
  await page.getByText(/No usable GPS route/).waitFor();
  assert.equal(await comments.inputValue(), "");
  const discard = page.getByRole("button", { name: "Discard this lesson", exact: true });
  await discard.click();

  // Ending in a second tab must stop the first tab's watch before reading its final batch.
  await page.evaluate(() => { window.lessonGpsTest.deny = false; });
  await consent.check();
  const startSecond = page.getByRole("button", { name: "Start Lesson #2", exact: true });
  await startSecond.click();
  await page.waitForFunction(() => window.lessonGpsTest.active);
  await page.evaluate((at) => window.lessonGpsTest.emit([[-56, 0], [-25, 0], [-12, 13], [11, 14], [30, 0], [55, 0]], at), startedAt + 110_000);
  const other = await context.newPage();
  other.on("dialog", (dialog) => dialog.accept());
  await other.clock.setFixedTime(new Date(startedAt + 170_000));
  await other.goto(base);
  await other.getByRole("button", { name: "End Lesson", exact: true }).click();
  await page.waitForFunction(() => !window.lessonGpsTest.active);
  await other.getByTestId("lesson-gps-review").getByText(/1 possible roundabout pass/).waitFor();
  const localDraftKey = `actgds-driver:draft:${learner.id}`;
  const finishedDraft = await other.evaluate((key) => localStorage.getItem(key), localDraftKey);
  assert.ok((await readStored(other, localDraftKey)).finishTime);
  await comments.fill("An older tab cannot reopen the finished checklist.");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), localDraftKey), finishedDraft);
  await other.getByRole("button", { name: "Discard this lesson", exact: true }).click();
  await other.waitForFunction(storedIsTombstone, localDraftKey);
  await comments.fill("Stale tab text must stay local.");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), localDraftKey), null);
  await other.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    lessonDate: "2026-10-20", startTime: "10:00", finishTime: "",
    comments: "Replacement draft survives stale tab controls.",
  })), localDraftKey);
  await discard.click();
  await page.getByText(/This lesson draft changed in another tab/).waitFor();
  await page.getByText("Edit date / times").click();
  await page.locator("#lesson-field-times").fill("");
  assert.match(await page.evaluate((key) => localStorage.getItem(key), localDraftKey), /Replacement draft survives/);
  await other.evaluate((key) => localStorage.removeItem(key), localDraftKey);
  await other.close();
  await page.reload();

  // Confirmed replacement of a live draft must close its GPS watch in the same tab.
  await consent.check();
  await startSecond.click();
  await page.waitForFunction(() => window.lessonGpsTest.active);
  await page.getByTestId("paste-draft-open").click();
  await page.getByTestId("paste-draft-text").fill(
    "ACTGDS-DRAFT LESSON\nLearner: QA GPS Lesson\nDate: 2026-10-20\nStart: 09:00\nFinish: 10:00\nComments: Replacement draft.",
  );
  await page.getByTestId("paste-draft-use").click();
  await page.waitForFunction(() => !window.lessonGpsTest.active);
  await page.getByRole("heading", { name: "CBT&A checklist", exact: true }).waitFor();
  assert.equal(await review.count(), 0);
  assert.equal(await comments.inputValue(), "Replacement draft.");

  // Clearing Start time returns to Ready and must close the watch before an opted-out restart.
  await discard.click();
  await consent.check();
  await startSecond.click();
  await page.waitForFunction(() => window.lessonGpsTest.active);
  await page.getByText("Edit date / times").click();
  await page.locator("#lesson-field-times").fill("");
  await page.waitForFunction(() => !window.lessonGpsTest.active);
  assert.equal(await consent.isChecked(), false);
  const watches = await page.evaluate(() => window.lessonGpsTest.watches);
  await startSecond.click();
  assert.equal(await page.evaluate(() => window.lessonGpsTest.watches), watches);
  assert.equal(await page.getByTestId("lesson-gps-running").count(), 0);
  // A stale ordinary lesson cannot overwrite or discard a GPS replacement.
  const replacementTab = await context.newPage();
  await replacementTab.goto(base);
  const ordinaryDraft = await replacementTab.evaluate((key) => localStorage.getItem(key), localDraftKey);
  await replacementTab.evaluate((key) => {
    const current = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...current, lessonGps: { id: "replacement-gps-id", instructorId: "qa" } }));
  }, localDraftKey);
  await comments.fill("Stale ordinary tab attempt.");
  await discard.click();
  await page.getByText(/This lesson draft changed in another tab/).waitFor();
  assert.match(await page.evaluate((key) => localStorage.getItem(key), localDraftKey), /replacement-gps-id/);
  await replacementTab.evaluate(({ key, draft }) => localStorage.setItem(key, draft), { key: localDraftKey, draft: ordinaryDraft });
  // An older save must preserve a replacement made while its request is in flight.
  await page.clock.setFixedTime(new Date(startedAt + 230_000));
  await end.click();
  await page.getByLabel("Start odometer (km)").fill("1003");
  await page.getByLabel("Finish odometer (km)").fill("1005");
  await page.route(`**/api/learners/${learner.id}/lessons`, async (route) => {
    await replaceStored(replacementTab, localDraftKey, { startTime: "13:00", finishTime: "14:00",
      comments: "Newer lesson from another tab." });
    await route.continue();
  });
  await page.getByTestId("save-sign-later").click();
  await page.getByText(/Lesson #2 saved/).waitFor();
  assert.equal(await comments.inputValue(), "Newer lesson from another tab.");
  assert.match(await page.evaluate((key) => localStorage.getItem(key), localDraftKey), /Newer lesson from another tab/);
  await page.unroute(`**/api/learners/${learner.id}/lessons`);
  await discard.click();
  await consent.check();
  await page.getByRole("button", { name: "Start Lesson #3", exact: true }).click();
  await page.clock.setFixedTime(new Date(startedAt + 300_000));
  await end.click();
  await page.getByLabel("Start odometer (km)").fill("1005");
  await page.getByLabel("Finish odometer (km)").fill("1006");
  let posts = 0;
  await page.route(`**/api/learners/${learner.id}/lessons`, async (route) => {
    posts++;
    await replaceStored(replacementTab, localDraftKey, { comments: "Newer edits to the same GPS session." });
    await route.continue();
  });
  await page.getByTestId("save-sign-later").click();
  await page.getByText(/Lesson #3 saved/).waitFor();
  assert.match(await comments.inputValue(), /Newer edits to the same GPS session/);
  await page.getByTestId("save-sign-later").click();
  await page.getByText(/Lesson #3 already exists/).waitFor();
  assert.equal(posts, 1);
  assert.deepEqual(pageErrors, []);
  console.log("Lesson GPS QA: PASS (opt-in, capture, junction, checklist, persisted edit, local cleanup, denied permission, second tab, replacement, concurrent save and reset at 375px)");
  await context.close();
} finally {
  await browser.close();
}
