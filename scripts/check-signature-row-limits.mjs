#!/usr/bin/env node
// MANUAL CHECK — not part of CI or qa-browser, never run automatically.
//
// Proves that a real D1 database accepts one lesson row holding TWO
// signatures near the server limit (MAX_SIGNATURE_LENGTH = 700 000 chars in
// lib/repo.ts): it creates a synthetic learner "QA Signature Row Limit <time>",
// POSTs one lesson with two synthetic ~690 000-char PNG data URLs, then reads
// the lesson back and compares both signatures byte for byte.
// The node:sqlite shim used by `npm test` cannot prove D1's row/string limits;
// this script exists for that.
//
// It WRITES a learner and a lesson that cannot be deleted through the app
// (and, where Integration is enabled, the lesson emits a lesson.upserted
// event). Run it only against a local copy or Staging, deliberately. NEVER
// against Production.
//
//   BASE_URL=http://localhost:3100 INSTRUCTOR_ID=<instructor uuid> \
//     node scripts/check-signature-row-limits.mjs
//
// Env:
//   BASE_URL        required, e.g. http://localhost:3100 or the Staging URL
//   INSTRUCTOR_ID   required; sent as x-instructor-id (local/header-trusting
//                   setups) and used as the learner's instructor
//   EXTRA_HEADERS   optional JSON object of extra request headers (e.g.
//                   Cloudflare Access service-token headers for Staging)
//   CONFIRM_REMOTE_WRITE  required for any non-loopback target; exact value:
//                   I_ACKNOWLEDGE_PERMANENT_SYNTHETIC_LEARNER_AND_LESSON_DATA
//   LEARNER_ID      optional: reuse an existing learner instead of creating one
//   SIG_LENGTH      optional, default 690000 (must stay ≤ 700000)

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const INSTRUCTOR_ID = process.env.INSTRUCTOR_ID || "";
const SIG_LENGTH = Number(process.env.SIG_LENGTH || 690_000);
if (!BASE || !INSTRUCTOR_ID) {
  console.error("BASE_URL and INSTRUCTOR_ID are required (see the header of this file).");
  process.exit(2);
}
let targetUrl;
try {
  targetUrl = new URL(BASE);
} catch {
  console.error(`Refusing invalid BASE_URL: ${BASE}`);
  process.exit(2);
}
if (!["http:", "https:"].includes(targetUrl.protocol)) {
  console.error(`Refusing unsupported BASE_URL protocol: ${targetUrl.protocol}`);
  process.exit(2);
}
if (targetUrl.username || targetUrl.password || targetUrl.search || targetUrl.hash) {
  console.error("Refusing BASE_URL credentials, query strings or fragments; use EXTRA_HEADERS for access credentials.");
  process.exit(2);
}

const host = targetUrl.hostname.toLowerCase().replace(/\.$/, "");
const isLoopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(host);
const isKnownProductionHost =
  host === "actgds.com" ||
  host.endsWith(".actgds.com") ||
  /(^|[-.])production($|[-.])/i.test(host);
if (isKnownProductionHost) {
  console.error(`Refusing to run against a known Production host: ${host}`);
  process.exit(2);
}
if (!isLoopback && targetUrl.protocol !== "https:") {
  console.error("Refusing remote HTTP; non-loopback targets must use HTTPS.");
  process.exit(2);
}
const REMOTE_WRITE_ACK = "I_ACKNOWLEDGE_PERMANENT_SYNTHETIC_LEARNER_AND_LESSON_DATA";
if (!isLoopback && process.env.CONFIRM_REMOTE_WRITE !== REMOTE_WRITE_ACK) {
  console.error(
    "Refusing remote write: this check permanently creates a synthetic learner and lesson and may emit an Integration V1 event. " +
    "For a deliberately selected non-Production Staging target, set CONFIRM_REMOTE_WRITE=" + REMOTE_WRITE_ACK,
  );
  process.exit(2);
}

const headers = { "content-type": "application/json", "x-instructor-id": INSTRUCTOR_ID, ...JSON.parse(process.env.EXTRA_HEADERS || "{}") };
const call = async (path, method = "GET", body) => {
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error" });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
};
// Synthetic, PNG-prefixed data URLs of exactly SIG_LENGTH chars (the server checks prefix and length only).
const synthetic = (fill) => { const prefix = "data:image/png;base64,iVBORw0KGgo"; return prefix + fill.repeat(SIG_LENGTH - prefix.length); };

const adiSignature = synthetic("A");
const learnerSignature = synthetic("B");
console.log(`BASE_URL ${BASE}; two signatures of ${SIG_LENGTH} chars each (${(2 * SIG_LENGTH / 1e6).toFixed(2)} MB in one row)`);

const learnerId = process.env.LEARNER_ID || (await call("/api/learners", "POST", { fullName: `QA Signature Row Limit ${new Date().toISOString()}`, instructorId: INSTRUCTOR_ID })).learner.id;
const detail = await call(`/api/learners/${learnerId}`);
const last = detail.lessons?.at?.(-1);
const startOdometer = String(last?.finishOdometer ?? 1000);
const { lesson } = await call(`/api/learners/${learnerId}/lessons`, "POST", {
  lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00",
  startOdometer, finishOdometer: String(Number(startOdometer) + 10),
  taughtIds: ["1"], comments: "QA signature row-limit check (synthetic)",
  adiSignature, learnerSignature,
});
const back = (await call(`/api/learners/${learnerId}/lessons/${lesson.id}`)).lesson;
const ok = back.adiSignature === adiSignature && back.learnerSignature === learnerSignature;
console.log(`learner ${learnerId}, lesson #${lesson.lessonNo} (${lesson.id})`);
console.log(`read back: ADI ${back.adiSignature?.length ?? 0} chars, learner ${back.learnerSignature?.length ?? 0} chars → ${ok ? "PASS (identical)" : "FAIL (differs)"}`);
process.exit(ok ? 0 : 1);
