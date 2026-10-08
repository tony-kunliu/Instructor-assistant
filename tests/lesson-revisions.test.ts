// Lesson edit ownership + revision history (design 2026-10-08, E1-E8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import {
  createLearner, createLesson, findInstructorByEmail, importPaperLessons, listLessonRevisions, listLessons, listLessonsForExport, updateLesson, ValidationError,
} from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const SIG_C = "data:image/png;base64,iVBORw0KGgoAAAA3";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const anna = (await findInstructorByEmail(db, "yapingqu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "QA Revision Learner", instructorId: tony.id });
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10",
    taughtIds: ["1"], location: "Belconnen", comments: "first draft", adiSignature: SIG_A, learnerSignature: SIG_A, actingInstructorId: tony.id,
  });
  return { db, tony, anna, learner, lesson };
}

const edit = (overrides: Record<string, unknown> = {}) => ({
  lessonDate: "2026-09-02", startTime: "10:00", finishTime: "10:45", startOdometer: "0", finishOdometer: "20",
  taughtIds: ["1"], location: "Gungahlin", comments: "corrected", adiSignature: SIG_B, learnerSignature: SIG_B, ...overrides,
});
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

test("owner can edit their own lesson when signed in", async () => {
  const { db, tony, learner, lesson } = await setup();
  const result = await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id }));
  assert.equal(result.lesson.location, "Gungahlin");
  assert.equal(result.lesson.updatedByInstructorId, tony.id);
  assert.equal(result.lesson.revisionCount, 1);
});

test("non-owner is rejected with the Code of Practice message and nothing is written", async () => {
  const { db, anna, learner, lesson } = await setup();
  const before = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(lesson.id).first();
  await assert.rejects(
    () => updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: anna.id })),
    (error: unknown) => error instanceof ValidationError && error.message === "This lesson was recorded by Tony; only they can change it (Code of Practice 9.2).",
  );
  assert.deepEqual(await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(lesson.id).first(), before);
  assert.equal(await count(db, "lesson_revisions"), 0);
  assert.equal(await count(db, "integration_outbox"), 0);
});

test("without an acting instructor (local dev / tests) today's behaviour is kept: anyone may edit, revision has no editor", async () => {
  const { db, learner, lesson } = await setup();
  await updateLesson(db, learner.id, lesson.id, edit());
  const [revision] = await listLessonRevisions(db, learner.id, lesson.id);
  assert.equal(revision.editedByInstructorId, null);
  assert.equal(revision.editedByName, null);
});

test("snapshot holds the PREVIOUS values of every editable field, signature_status and signature presence flags only (no images)", async () => {
  const { db, tony, learner, lesson } = await setup();
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, reason: "Wrong odometer" }));
  const raw = await db.prepare("SELECT snapshot_json, revision_no, reason, edited_by_instructor_id, edited_at FROM lesson_revisions WHERE lesson_id = ?").bind(lesson.id).first<Record<string, string>>();
  assert.ok(!raw!.snapshot_json.includes("base64"), "signature images must never be stored in the snapshot");
  const [revision] = await listLessonRevisions(db, learner.id, lesson.id);
  assert.equal(revision.revisionNo, 1);
  assert.equal(revision.reason, "Wrong odometer");
  assert.equal(revision.editedByInstructorId, tony.id);
  assert.equal(revision.editedByName, "Tony");
  assert.match(revision.editedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(revision.snapshot, {
    lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: 0, finishOdometer: 10,
    taught: "1", competenciesAssessed: null, achieved: null, location: "Belconnen", comments: "first draft",
    signatureStatus: "digital", adiSignaturePresent: true, learnerSignaturePresent: true,
  });
  // A second edit snapshots the first edit's result.
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, location: "Woden", adiSignature: SIG_C, learnerSignature: SIG_C }));
  const revisions = await listLessonRevisions(db, learner.id, lesson.id);
  assert.deepEqual(revisions.map((r) => r.revisionNo), [1, 2]);
  assert.equal(revisions[1].snapshot.location, "Gungahlin");
  assert.equal(revisions[1].reason, null);
  assert.equal((await listLessons(db, learner.id))[0].revisionCount, 2);
  assert.equal((await listLessonsForExport(db, learner.id))[0].revisionCount, 2);
});

test("a lesson never edited has revisionCount 0", async () => {
  const { db, learner } = await setup();
  assert.equal((await listLessons(db, learner.id))[0].revisionCount, 0);
});

test("the revision and the edit commit in ONE db.batch(): a forced batch failure leaves neither", async () => {
  const { db, tony, learner, lesson } = await setup();
  let batches = 0;
  const failing: D1Database = { prepare: (q) => db.prepare(q), exec: (q) => db.exec(q), batch: async () => { batches++; throw new Error("simulated D1 batch failure"); } };
  const before = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(lesson.id).first();
  await assert.rejects(() => updateLesson(failing, learner.id, lesson.id, edit({ actingInstructorId: tony.id })), /simulated/);
  assert.equal(batches, 1);
  assert.deepEqual(await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(lesson.id).first(), before);
  assert.equal(await count(db, "lesson_revisions"), 0);

  // And a real batch where a statement after the revision fails rolls the revision back too.
  const sabotage: D1Database = {
    prepare: (q) => db.prepare(q), exec: (q) => db.exec(q),
    batch: (statements) => db.batch([...statements, db.prepare("INSERT INTO lessons (id) VALUES ('boom')")]),
  };
  await assert.rejects(() => updateLesson(sabotage, learner.id, lesson.id, edit({ actingInstructorId: tony.id })));
  assert.equal(await count(db, "lesson_revisions"), 0);
  assert.deepEqual(await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(lesson.id).first(), before);
});

test("a rejected edit (validation) writes no revision", async () => {
  const { db, tony, learner, lesson } = await setup();
  await assert.rejects(() => updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, finishTime: "08:00" })), ValidationError);
  assert.equal(await count(db, "lesson_revisions"), 0);
});

test("reason: optional, trimmed, max 200 characters (longer is rejected, nothing written)", async () => {
  const { db, tony, learner, lesson } = await setup();
  await assert.rejects(() => updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, reason: "x".repeat(201) })), /Reason must be 200 characters or fewer/);
  assert.equal(await count(db, "lesson_revisions"), 0);
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, reason: `  ${"y".repeat(200)}  ` }));
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id, reason: "   ", location: "Woden", adiSignature: SIG_C, learnerSignature: SIG_C }));
  const revisions = await listLessonRevisions(db, learner.id, lesson.id);
  assert.equal(revisions[0].reason, "y".repeat(200));
  assert.equal(revisions[1].reason, null);
});

test("prior-instructor rows stay uneditable, with no revision", async () => {
  const { db, tony, learner } = await setup();
  const other = await createLearner(db, { fullName: "QA Transfer Learner", instructorId: tony.id });
  const csv = [PAPER_CSV_COLUMNS.join(","), PAPER_CSV_COLUMNS.map((c) => ({ date: "2025-12-01", prior_instructor: "QA ADI 358", prior_lessons: "11", prior_hours: "20", prior_km: "150" } as Record<string, string>)[c] ?? "").join(",")].join("\n") + "\n";
  await importPaperLessons(db, other.id, csv, "commit");
  const prior = (await listLessons(db, other.id)).find((l) => l.recordSource === "prior_instructor")!;
  await assert.rejects(() => updateLesson(db, other.id, prior.id, edit({ actingInstructorId: tony.id })), /Prior-instructor records cannot be edited/);
  assert.equal(await count(db, "lesson_revisions"), 0);
  void learner;
});

test("paper-imported lessons belong to the instructor named in the CSV row: owner edits, the other instructor is rejected", async () => {
  const { db, tony, anna } = await setup();
  const learner = await createLearner(db, { fullName: "QA Paper Learner", instructorId: tony.id });
  const row: Record<string, string> = { date: "2026-01-01", signature: "on_paper", instructor: "Anna" };
  const csv = [PAPER_CSV_COLUMNS.join(","), PAPER_CSV_COLUMNS.map((c) => row[c] ?? "").join(",")].join("\n") + "\n";
  await importPaperLessons(db, learner.id, csv, "commit");
  const paper = (await listLessons(db, learner.id)).find((l) => l.recordSource === "paper_import")!;
  assert.equal(paper.instructorId, anna.id);
  const input = { lessonDate: "2026-01-01", signatureStatus: "on_paper", comments: "fixed" };
  await assert.rejects(() => updateLesson(db, learner.id, paper.id, { ...input, actingInstructorId: tony.id }), /recorded by Anna/);
  await updateLesson(db, learner.id, paper.id, { ...input, actingInstructorId: anna.id });
  const [revision] = await listLessonRevisions(db, learner.id, paper.id);
  assert.equal(revision.snapshot.signatureStatus, "on_paper");
  assert.equal(revision.snapshot.adiSignaturePresent, false);
});

test("listLessonRevisions is scoped to the learner: a lesson id under another learner is not found", async () => {
  const { db, tony, learner, lesson } = await setup();
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id }));
  const other = await createLearner(db, { fullName: "QA Other Learner", instructorId: tony.id });
  assert.deepEqual(await listLessonRevisions(db, other.id, lesson.id), []);
});

test("a lesson edited before revision history existed (updated_at set, no revision rows) is flagged; a created-only lesson is not; once revised the flag clears", async () => {
  const { db, tony, learner, lesson } = await setup();
  assert.equal(lesson.editedBeforeRevisionHistory, false, "createLesson never sets updated_at");
  // Simulate a pre-0007 edit: updateLesson used to set updated_at and nothing else.
  await db.prepare("UPDATE lessons SET updated_at = '2026-09-05T00:00:00.000Z', updated_by_instructor_id = ? WHERE id = ?").bind(tony.id, lesson.id).run();
  assert.equal((await listLessons(db, learner.id))[0].editedBeforeRevisionHistory, true);
  assert.equal((await listLessonsForExport(db, learner.id))[0].editedBeforeRevisionHistory, true);
  await updateLesson(db, learner.id, lesson.id, edit({ actingInstructorId: tony.id }));
  const after = (await listLessons(db, learner.id))[0];
  assert.equal(after.revisionCount, 1);
  assert.equal(after.editedBeforeRevisionHistory, false);
});
