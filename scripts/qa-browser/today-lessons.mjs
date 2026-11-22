import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const executablePath = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const base = process.env.QA_BASE;
const owner = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
const headers = { "x-instructor-id": owner, "x-instructor-name": "Tony" };
const created = await fetch(`${base}/api/learners`, { method: "POST", headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ fullName: "QA Today Learner", instructorId: owner }) });
assert.ok(created.ok);
const { learner } = await created.json();
const browser = await chromium.launch({ executablePath });
try {
  const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 375, height: 740 }, extraHTTPHeaders: headers });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Today’s lessons", exact: true }).click();
  await page.getByText(/connection is not set up/).waitFor();
  const events = [{
    id: "qa-1", title: "Driving lesson", name: "QA Today Learner", address: "Canberra, ACT",
    phone: "0400000000", email: "learner@example.test", startsAt: "2026-11-22T09:00:00+11:00", endsAt: "2026-11-22T10:00:00+11:00",
  }, {
    id: "qa-2", title: "Driving lesson", name: "QA Other Booking", address: "Belconnen, ACT",
    phone: null, email: null, startsAt: "2026-11-22T10:20:00+11:00", endsAt: "2026-11-22T11:20:00+11:00",
  }];
  let refreshes = 0;
  await page.route("**/api/today-lessons", (route) => {
    refreshes += 1;
    if (refreshes === 2) return route.fulfill({ status: 503, json: { state: "unavailable" } });
    const lessons = refreshes === 1 ? events : [{ ...events[0], address: "Mitchell, ACT" }, events[1]];
    return route.fulfill({ json: {
      state: "connected", date: "2026-11-22", lessons, incomplete: false, refreshedAt: new Date().toISOString(),
    } });
  });
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await refresh.click();
  const cards = page.getByTestId("today-lesson");
  await cards.last().getByText("20 min between bookings", { exact: true }).waitFor();
  assert.equal(await cards.count(), 2);
  assert.equal(await cards.first().getByRole("link", { name: /Call/ }).getAttribute("href"), "tel:0400000000");
  assert.match(await cards.last().getByRole("link", { name: "Route from previous lesson" }).getAttribute("href"), /origin=Canberra/);
  assert.equal(await cards.first().getByRole("link", { name: /Directions/ }).count(), 1);
  assert.equal(await cards.first().getByRole("link", { name: /Email/ }).getAttribute("href"), "mailto:learner@example.test");
  assert.equal(await page.getByRole("link", { name: "Public toilet map" }).getAttribute("href"), "https://toiletmap.gov.au/");

  await refresh.click();
  const outage = page.getByText("Google Calendar is unavailable. Try Refresh.", { exact: true });
  await outage.waitFor();
  assert.equal(await cards.count(), 0);
  await refresh.click();
  await cards.first().getByText("Mitchell, ACT", { exact: true }).waitFor();
  await outage.waitFor({ state: "hidden" });
  assert.equal(await cards.count(), 2);

  await cards.first().getByLabel("Learner progress").selectOption(learner.id);
  await cards.first().getByText(/0\/22 achieved/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 820, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await cards.first().getByRole("button", { name: "Open learner record" }).click();
  await page.locator(".summary-name").getByText("QA Today Learner", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Today’s lessons QA PASS at 375/820px (disconnected state, schedule, contacts, outage and retry, progress and open learner)");
  await context.close();
} finally {
  await browser.close();
}
