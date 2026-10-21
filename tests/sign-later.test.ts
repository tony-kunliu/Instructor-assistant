// Save now, sign later (Tony 2026-10-22): an app lesson may be saved without signatures ("unsigned") and both
// signatures added later in the To sign queue. The content of an unsigned lesson can still be corrected; signing never
// changes content; Final Drive 23 waits until every earlier app lesson is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLesson, getOwnAdiSignature, listLessonRevisions, setOwnAdiSignature, listUnsignedLessons, setLearnerArchived, signLesson, updateLesson, ValidationError } from "../lib/repo.ts";
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
  const signed = await signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: null });
  assert.equal(signed.signatureStatus, "digital");
  const stored = await getLesson(db, learner.id, lesson.id);
  assert.equal(stored.adiSignature, SIG_A);
  assert.equal(stored.learnerSignature, SIG_B);
  for (const k of ["lessonDate", "startTime", "finishTime", "startOdometer", "finishOdometer", "taught", "comments", "location", "durationMinutes", "distanceKm"] as const) assert.equal(stored[k], lesson[k], k);
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: stored.updatedAt }), /already signed/);
  assert.equal(stored.revisionCount, 0, "signing is not a correction: no \"Edited\" and no PDF (amended)");
  assert.equal(stored.signedLater, true);
  assert.equal(stored.editedBeforeRevisionHistory, false);
  assert.equal((await listLessonRevisions(db, learner.id, lesson.id)).length, 1, "the unsigned version is kept as a revision");
});

test("signing needs both signatures", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, expectedUpdatedAt: null }), ValidationError);
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
  await signLesson(db, learner.id, unsigned.id, { ...sig, expectedUpdatedAt: null });
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

test("signing refuses a lesson changed after the To sign screen loaded it", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  await updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "changed on another device" });
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: null }), /changed after it was opened/);
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B }), /changed after it was opened/);
  const fresh = await getLesson(db, learner.id, lesson.id);
  assert.equal((await signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: fresh.updatedAt })).signatureStatus, "digital");
  const revisions = await listLessonRevisions(db, learner.id, lesson.id);
  assert.equal(revisions.at(-1)?.reason, "Signed later");
});

test("only the instructor who recorded the lesson can sign it, and the queue shows only their own", async () => {
  const { db, learner, tony, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true, actingInstructorId: tony.id }));
  const other = (await db.prepare("SELECT id FROM instructors WHERE id <> ? AND status = 'active' LIMIT 1").bind(tony.id).first<{ id: string }>())!;
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: null, actingInstructorId: other.id }), /only they can sign it/);
  assert.equal((await listUnsignedLessons(db, other.id)).length, 0);
  assert.equal((await listUnsignedLessons(db, tony.id)).length, 1);
});

test("History Edit cannot add Final Drive 23 while another app lesson is unsigned", async () => {
  const { db, learner, input } = await setup();
  const sig = { adiSignature: SIG_A, learnerSignature: SIG_B };
  const assess = (ids: string[], extra: Record<string, unknown> = sig) =>
    createLesson(db, learner.id, input({ taughtIds: [], assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), ...extra }));
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22), { signLater: true });
  await assess([REVIEW_1_22]);
  const plain = await createLesson(db, learner.id, input({ ...sig, taughtIds: [] }));
  const ids = [FINAL_DRIVE_23];
  await assert.rejects(
    updateLesson(db, learner.id, plain.id, { ...input(), startOdometer: plain.startOdometer, finishOdometer: plain.finishOdometer, taughtIds: [], assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), adiSignature: "data:image/png;base64,iVBORw0KGgoAAAA7", learnerSignature: "data:image/png;base64,iVBORw0KGgoAAAA8" }),
    /Sign Lesson #3 first/,
  );
});

test("a signing that loses a race writes no revision, and the reserved reason cannot be typed in an edit", async () => {
  const { db, learner, input } = await setup();
  const lesson = await createLesson(db, learner.id, input({ signLater: true }));
  // Simulate the other device signing between this request's checks and its batch.
  await db.prepare("UPDATE lessons SET signature_status = 'digital', adi_signature = ?, learner_signature = ? WHERE id = ?").bind(SIG_A, SIG_B, lesson.id).run();
  await db.prepare("UPDATE lessons SET signature_status = 'unsigned' WHERE id = ?").bind(lesson.id).run();
  await db.prepare("UPDATE lessons SET updated_at = '2026-10-22T00:00:00.000Z' WHERE id = ?").bind(lesson.id).run();
  await assert.rejects(signLesson(db, learner.id, lesson.id, { adiSignature: SIG_A, learnerSignature: SIG_B, expectedUpdatedAt: null }), /changed/);
  assert.equal((await listLessonRevisions(db, learner.id, lesson.id)).length, 0);
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, reason: " signed LATER " }), /kept for signing/);
});

test("correcting a signed lesson without new signatures leaves it unsigned, keeps the old version, and joins the To sign list", async () => {
  const { db, learner, tony, input } = await setup("QA Edit Unsigned");
  const lesson = await createLesson(db, learner.id, input({ adiSignature: SIG_A, learnerSignature: SIG_B }));
  const edited = await updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "corrected", actingInstructorId: tony.id });
  assert.equal(edited.lesson.signatureStatus, "unsigned");
  const stored = await getLesson(db, learner.id, lesson.id);
  assert.equal(stored.adiSignature, null);
  assert.equal(stored.learnerSignature, null);
  assert.equal(stored.comments, "corrected");
  assert.equal(stored.revisionCount, 1, "a real correction: Edited 1 time");
  assert.equal((await listLessonRevisions(db, learner.id, lesson.id))[0].snapshot.adiSignaturePresent, true, "the signed version stays in the history");
  assert.deepEqual((await listUnsignedLessons(db, tony.id)).map((l) => l.lessonId), [lesson.id]);
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "x", adiSignature: SIG_A }), /both signatures, or leave both blank/);
});

test("an unchanged signed lesson keeps its signatures; one new signature alone is refused", async () => {
  const { db, learner, input } = await setup("QA Edit Signed");
  const lesson = await createLesson(db, learner.id, input({ adiSignature: SIG_A, learnerSignature: SIG_B }));
  const same = { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: lesson.comments };
  assert.equal((await updateLesson(db, learner.id, lesson.id, same)).lesson.signatureStatus, "digital");
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...same, comments: "changed", adiSignature: SIG_B }), /must be redrawn/);
});

test("a Final Drive 23 lesson still needs both signatures redrawn after an edit", async () => {
  const { db, learner, input } = await setup("QA Edit FD");
  const sig = { adiSignature: SIG_A, learnerSignature: SIG_B };
  const assess = (ids: string[]) => createLesson(db, learner.id, input({ taughtIds: [], assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), ...sig }));
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22));
  await assess([REVIEW_1_22]);
  const last = await assess([FINAL_DRIVE_23]);
  await assert.rejects(
    updateLesson(db, learner.id, last.id, { ...input(), startOdometer: last.startOdometer, finishOdometer: last.finishOdometer, taughtIds: [], assessedIds: [FINAL_DRIVE_23], achievedResults: { [FINAL_DRIVE_23]: "achieved" }, comments: "corrected" }),
    /Final Drive 23 is signed when it is saved/,
  );
});

test("an instructor's saved ADI signature is private to them", async () => {
  const { db, tony } = await setup("QA Saved Sig");
  const other = (await db.prepare("SELECT id FROM instructors WHERE id <> ? AND status = 'active' LIMIT 1").bind(tony.id).first<{ id: string }>())!;
  assert.equal(await getOwnAdiSignature(db, tony.id), null);
  assert.equal(await setOwnAdiSignature(db, tony.id, SIG_A), SIG_A);
  assert.equal(await getOwnAdiSignature(db, tony.id), SIG_A);
  assert.equal(await getOwnAdiSignature(db, other.id), null);
  await assert.rejects(setOwnAdiSignature(db, tony.id, "not a png"), /not a valid image/);
  assert.equal(await setOwnAdiSignature(db, tony.id, ""), null);
  assert.equal(await getOwnAdiSignature(db, tony.id), null);
  const listed = JSON.stringify(await db.prepare("SELECT * FROM instructors").all());
  assert.ok(!listed.includes(SIG_B));
});

test("re-signing a corrected lesson: the ADI signature may be the saved (identical) one, the learner's must be new", async () => {
  const { db, learner, input } = await setup("QA Resign");
  const lesson = await createLesson(db, learner.id, input({ adiSignature: SIG_A, learnerSignature: SIG_B }));
  const edit = { ...input(), startOdometer: lesson.startOdometer, finishOdometer: lesson.finishOdometer, comments: "corrected" };
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...edit, adiSignature: SIG_A, learnerSignature: SIG_B }), /learner must sign again/);
  const ok = await updateLesson(db, learner.id, lesson.id, { ...edit, adiSignature: SIG_A, learnerSignature: "data:image/png;base64,iVBORw0KGgoAAAA3" });
  assert.equal(ok.lesson.signatureStatus, "digital");
});

test("an earlier lesson cannot be left unsigned while a later lesson holds a signed Final Drive 23", async () => {
  const { db, learner, input } = await setup("QA Later FD");
  const sig = { adiSignature: SIG_A, learnerSignature: SIG_B };
  const assess = (ids: string[]) => createLesson(db, learner.id, input({ taughtIds: [], assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), ...sig }));
  const first = await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22));
  await assess([REVIEW_1_22]);
  await assess([FINAL_DRIVE_23]);
  await assert.rejects(
    updateLesson(db, learner.id, first.id, { ...input(), startOdometer: first.startOdometer, finishOdometer: first.finishOdometer, taughtIds: [], assessedIds: range(1, 17), achievedResults: Object.fromEntries(range(1, 17).map((id) => [id, "achieved"])), comments: "corrected" }),
    /\(Final Drive 23\) is signed after this lesson/,
  );
});
