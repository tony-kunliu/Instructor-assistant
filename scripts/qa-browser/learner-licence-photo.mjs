import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const executablePath = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const base = process.env.QA_BASE;
const headers = {
  "x-instructor-id": "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01",
  "x-instructor-name": "Tony",
};
const existing = await fetch(`${base}/api/learners`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ fullName: "QA Scan Baseline", instructorId: headers["x-instructor-id"] }),
});
assert.ok(existing.ok, await existing.text());
const browser = await chromium.launch({ executablePath });
try {
  const { defaultBrowserType: _, ...mobile } = devices["iPhone SE"];
  const context = await browser.newContext({ ...mobile, viewport: { width: 375, height: 740 }, extraHTTPHeaders: headers });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  const timed = [];
  context.on("request", (request) => requests.push({ method: request.method(), url: request.url(), body: request.postData() }));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByTestId("new-learner").click();

  // A synthetic card image goes through the same browser decoding, OCR worker and field parser as a camera photo.
  const image = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 1260, height: 780 });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f2f4ef";
    ctx.fillRect(0, 0, 1260, 780);
    ctx.fillStyle = "#1a2232";
    ctx.font = "bold 45px sans-serif";
    ctx.fillText("ACT LEARNER DRIVER LICENCE", 50, 90);
    ctx.font = "39px sans-serif";
    [
      "Name: Jamie Example",
      "Licence number: 01234567",
      "Card number: 982143219",
      "Date of birth: 19/09/2007",
      "Expiry date: 28/11/2030",
      "Address: 41 Fiction Street Belconnen ACT 2617",
    ].forEach((line, i) => ctx.fillText(line, 50, 190 + i * 77));
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const capture = page.getByTestId("licence-photo");
  assert.equal(await capture.getAttribute("capture"), "environment");
  await capture.setInputFiles({ name: "fabricated-test-licence.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  const start = Date.now();
  await page.getByTestId("licence-scan-status").getByText(/Check the fields against the card/).waitFor({ timeout: 35_000 });
  timed.push(`synthetic photo ${((Date.now() - start) / 1000).toFixed(1)}s`);
  const name = page.getByTestId("learner-name");
  assert.equal(await name.inputValue(), "Jamie Example");
  assert.equal(await page.getByLabel("Licence number").inputValue(), "01234567");
  assert.equal(await page.getByLabel("Licence expiry", { exact: true }).inputValue(), "2030-11-28");
  assert.equal(await page.getByLabel("DOB").inputValue(), "2007-09-19");
  assert.equal(await page.getByTestId("learner-address").inputValue(), "41 Fiction Street Belconnen ACT 2617");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(requests.some((request) => request.method !== "GET"), false);
  // Chromium reports the device-local blob URL as a request. Only inspect actual network destinations.
  const otherOrigins = requests.filter((request) => /^https?:/.test(request.url))
    .map((request) => new URL(request.url).origin).filter((origin) => origin !== new URL(base).origin);
  assert.deepEqual(otherOrigins, []);
  assert.ok(requests.some((request) => request.url.includes("/licence-ocr-v7/worker.min.js")));

  // The normal Save validates and creates the reviewed learner, then opens the new record.
  await name.fill("Jamie Edited");
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.url() === `${base}/api/learners` && response.request().method() === "POST"),
    page.getByTestId("save-learner").click(),
  ]);
  assert.ok(saved.ok(), await saved.text());
  const payload = saved.request().postDataJSON();
  assert.equal(payload.fullName, "Jamie Edited");
  assert.equal(payload.licenceNumber, "01234567");
  assert.doesNotMatch(JSON.stringify(payload), /fabricated-test-licence|982143219|data:image/);
  await page.getByText("Jamie Edited added. Ready for Lesson #1.").waitFor();

  // Same field parser for iPhone Scan Text or paste, with handwritten entries kept.
  await page.getByTestId("new-learner").click();
  await name.fill("Typed before scan");
  await page.getByText("Use iPhone Scan Text or paste text").click();
  await page.getByLabel("Licence text", { exact: true }).fill("Name: Unused Example\nLicence No: 55554444");
  await page.getByRole("button", { name: "Fill from text" }).click();
  assert.equal(await name.inputValue(), "Typed before scan");
  assert.equal(await page.getByLabel("Licence number").inputValue(), "55554444");
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  assert.deepEqual(errors, []);
  console.log(`Learner photo scan QA PASS at 375px (${timed.join(", ")}; edited save, no image upload, text fallback)`);
  await context.close();
} finally {
  await browser.close();
}
