// Save now, sign later (Tony 2026-10-22): an app lesson may be saved without signatures ("unsigned") and both
// signatures added later in the To sign queue. The content of an unsigned lesson can still be corrected; signing never
// changes content; Final Drive 23 waits until every earlier app lesson is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLesson, listUnsignedLessons, setLearnerArchived, signLesson, updateLesson, ValidationError } from "../lib/repo.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

async function setup(name = "QA Sign Later") {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: name, instructorId: tony.id });
  let odo = 100;
  const input = (extra: Record<string, unknown> = {}) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), taughtIds: ["1"], ...extra };
  };
  return { db, learner, tony, input };
}

test("an app lesson saved with signLater and no signatures is stored unsigned", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  assert.equal(lesson.signatureStatus, "unsigned");
  assert.equal(lesson.recordSource, "app");
  assert.equal(lesson.adiSignature, null);
});

test("without signLater both signatures are still required; with it, one signature alone is refused", async () => {
  const { db, learner, input } = await setup();
  await assert.rejects(createLesson(db, learner.id, input()), /ADI signature is required/);
  await assert.rejects(createLesson(db, learner.id, input({ signLater: true, adiSignature: SIG_A })), /both signatures, or neither/);
  const signed = await createLesson(db, learner.id, input({ signLater: true, adiSignature: SIG_A, learnerSignature: SIG_B }));
  assert.equal(signed.signatureStatus, "digital");
});

test("signing keeps every content field and makes the lesson digital; signing twice is refused", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true, comments: "Good lesson", location: "Belconnen" }));
  const signed = await signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B });
  assert.equal(signed.signatureStatus, "digital");
  const stored = await getLesson(db, learner.id, lesson.id);
  assert.equal(stored.adiSignature, SIG_A);
  assert.equal(stored.learnerSignature, SIG_B);
  for (const k of ["lessonDate", "startTime", "finishTime", "startOdometer", "finishOdometer", "taught", "comments", "location", "durationMinutes", "distanceKm"] as const) assert.equal(stored[k], lesson[k], k);
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B }), /already signed/);
});

test("signing needs both signatures", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A }), ValidationError);
  assert.equal((await getLesson(db, learner.id, lesson.id)).signatureStatus, "unsigned");
});

test("an unsigned lesson can be corrected without signatures and stays unsigned; with both it becomes signed", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  const edited = await updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "fixed typo" });
  assert.equal(edited.lesson.signatureStatus, "unsigned");
  assert.equal(edited.lesson.comments, "fixed typo");
  const signed = await updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "fixed typo", adiSignature: SIG_A, learnerSignature: SIG_B });
  assert.equal(signed.lesson.signatureStatus, "digital");
});

test("Final Drive 23 cannot be recorded while an earlier app lesson is unsigned", async () => {
  const { db, learner, input } = await setup();
  const sig = { adiSignature: SIG_A, learnerSignature: SIG_B };
  const assess = (ids: string[], extra: Record<string, unknown> = sig) =>
    createLesson(db, learner.id, input({ taughtIds: [], assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), ...extra }));
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  const unsigned = await assess(range(18, 22), { signLater: true });
  await assess([REVIEW_1_22]);
  await assert.rejects(assess([FINAL_DRIVE_23]), /Sign Lesson #3 first/);
  await signLesson(db, learner.id, unsigned.id, sig);
  await assert.rejects(assess([FINAL_DRIVE_23], { signLater: true }), /Final Drive 23 must be signed/);
  const last = await assess([FINAL_DRIVE_23]);
  assert.equal(last.signatureStatus, "digital");
});

test("the To sign list holds unsigned app lessons of active learners, oldest first", async () => {
  const { db, learner, input } = await setup("QA Sign Queue");
  const a = await createLesson(db, learner.id, input({ signLater: true, lessonDate: "2026-10-19" }));
  await createLesson(db, learner.id, input({ adiSignature: SIG_A, learnerSignature: SIG_B }));
  const c = await createLesson(db, learner.id, input({ signLater: true, lessonDate: "2026-10-21" }));
  const list = await listUnsignedLessons(db);
  assert.deepEqual(list.map((l) => l.lessonId), [a.id, c.id]);
  assert.equal(list[0].learnerName, "QA Sign Queue");
  assert.equal(list[0].lessonNo, 1);
  await setLearnerArchived(db, learner.id, true);
  assert.deepEqual(await listUnsignedLessons(db), []);
});
