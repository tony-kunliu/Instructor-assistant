import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, listLessons, MAX_SIGNATURE_LENGTH, updateLesson } from "../lib/repo.ts";
import { issueFromServerMessage } from "../lib/lesson-form-errors.ts";

const PREFIX = "data:image/png;base64,";
const SIG_A = `${PREFIX}iVBORw0KGgoAAAA1`;
const SIG_B = `${PREFIX}iVBORw0KGgoAAAA2`;
const sized = (length: number, fill = "A") => PREFIX + fill.repeat(length - PREFIX.length);
const TONY_EMAIL = "Kunliu.work@gmail.com";

const lessonInput = (extra: Record<string, unknown> = {}) => ({
  lessonDate: "2026-09-01",
  startTime: "09:00",
  finishTime: "10:00",
  startOdometer: "0",
  finishOdometer: "10",
  taughtIds: ["1"],
  adiSignature: SIG_A,
  learnerSignature: SIG_A,
  ...extra,
});

// listLessons() omits the images, so read the stored row directly.
async function storedSigs(db: ReturnType<typeof openTestD1>, lessonId: string) {
  const row = await db.prepare("SELECT adi_signature AS adi, learner_signature AS learner, finish_odometer AS finishOdometer FROM lessons WHERE id = ?").bind(lessonId).first<{ adi: string; learner: string; finishOdometer: number }>();
  return row!;
}

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Signature Limit Learner", instructorId: tony?.id });
  return { db, learner };
}

test("signature limit: 700 000 chars (two per lessons row stay well under D1's 2 MB row limit)", () => {
  assert.equal(MAX_SIGNATURE_LENGTH, 700_000);
  assert.ok(2 * MAX_SIGNATURE_LENGTH < 2_000_000);
});

// Note: openTestD1 is a node:sqlite shim, so this only proves the app's own
// validation accepts 500k. It does NOT prove Cloudflare D1's row/string limits;
// scripts/check-signature-row-limits.mjs is the manual check against a real D1.
test("new lesson: a large but allowed signature (500k chars, above the old 400k limit) passes validation and is stored as sent (sqlite shim)", async () => {
  const { db, learner } = await setup();
  const big = sized(500_000);
  const lesson = await createLesson(db, learner.id, lessonInput({ adiSignature: big }));
  assert.ok((await storedSigs(db, lesson.id)).adi === big, "stored exactly as sent");
});

test("new lesson: an over-limit signature gets its own 'too large' error, never 'required'", async () => {
  const { db, learner } = await setup();
  await assert.rejects(
    () => createLesson(db, learner.id, lessonInput({ adiSignature: sized(MAX_SIGNATURE_LENGTH + 1) })),
    (error: Error) => /^ADI signature image is too large — clear it and sign again\.$/.test(error.message),
  );
  await assert.rejects(
    () => createLesson(db, learner.id, lessonInput({ learnerSignature: sized(MAX_SIGNATURE_LENGTH + 1) })),
    (error: Error) => /^Learner signature image is too large/.test(error.message) && !/required/.test(error.message),
  );
  assert.equal((await listLessons(db, learner.id)).length, 0);
});

test("new lesson: a non-PNG signature is rejected as invalid; an empty one is still 'required'", async () => {
  const { db, learner } = await setup();
  await assert.rejects(() => createLesson(db, learner.id, lessonInput({ learnerSignature: "data:image/jpeg;base64,AAAA" })), /Learner signature is not a valid image/);
  await assert.rejects(() => createLesson(db, learner.id, lessonInput({ adiSignature: "" })), /ADI signature is required/);
});

test("History edit without a content change: a NEW over-limit signature is rejected, the old one is never silently kept", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, lessonInput());
  await assert.rejects(
    () => updateLesson(db, learner.id, lesson.id, lessonInput({ adiSignature: sized(MAX_SIGNATURE_LENGTH + 1), learnerSignature: SIG_A })),
    /ADI signature image is too large/,
  );
  await assert.rejects(
    () => updateLesson(db, learner.id, lesson.id, lessonInput({ learnerSignature: "not-a-png" })),
    /Learner signature is not a valid image/,
  );
  const stored = await storedSigs(db, lesson.id);
  assert.equal(stored.adi, SIG_A);
  assert.equal(stored.learner, SIG_A);
});

test("History edit without a content change: signatures not sent → stored ones kept (unchanged behaviour); a valid new one replaces it", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, lessonInput());
  await updateLesson(db, learner.id, lesson.id, lessonInput({ adiSignature: undefined, learnerSignature: "" }));
  let stored = await storedSigs(db, lesson.id);
  assert.equal(stored.adi, SIG_A);
  assert.equal(stored.learner, SIG_A);
  await updateLesson(db, learner.id, lesson.id, lessonInput({ adiSignature: SIG_B }));
  stored = await storedSigs(db, lesson.id);
  assert.equal(stored.adi, SIG_B);
});

test("History edit WITH a content change: an over-limit redraw gets the 'too large' error", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, lessonInput());
  await assert.rejects(
    () => updateLesson(db, learner.id, lesson.id, lessonInput({ finishOdometer: "12", adiSignature: SIG_B, learnerSignature: sized(MAX_SIGNATURE_LENGTH + 1) })),
    /Learner signature image is too large/,
  );
  assert.equal((await storedSigs(db, lesson.id)).finishOdometer, 10);
});

test("save-error summary: the 'too large' messages jump to the right signature pad", () => {
  assert.equal(issueFromServerMessage("ADI signature image is too large — clear it and sign again.").field, "adi-signature");
  assert.equal(issueFromServerMessage("Learner signature image is too large — clear it and sign again.").field, "learner-signature");
});
