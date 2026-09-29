import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import {
  createLearner,
  createLesson,
  findInstructorByEmail,
  getCompletionSummary,
  getLearnerProgress,
  getLearner,
  listLearners,
  listLessons,
  setLearnerArchived,
  updateLesson,
} from "../lib/repo.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { learnerPanel } from "../lib/learner-picker.ts";

// Tony's rule: once CBT&A is Completed (Final Drive 23 valid), no further
// ordinary CBT&A lessons can be created. Completion is a derived state, so
// History Edit that invalidates it re-opens lesson creation. Archiving is a
// separate, manual lifecycle step and is never automatic.

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_NEW = "data:image/png;base64,iVBORw0KGgoAAAA9";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Completed Learner", instructorId: tony.id });
  let odo = 0;
  const input = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  const assess = (ids: string[], result: "achieved" | "not_achieved" = "achieved") =>
    createLesson(db, learner.id, input({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, result])) }));
  const complete = async () => {
    const first = await assess(range(1, 17));
    await assess([REVIEW_1_17]);
    await assess(range(18, 22));
    await assess([REVIEW_1_22]);
    const last = await assess([FINAL_DRIVE_23]);
    return { first, last };
  };
  return { db, learner, input, assess, complete };
}

const COMPLETED_MESSAGE = /CBT&A is already completed/;

test("Final Drive 23 Achieved (valid chain) → progress.completed true and a completion summary exists", async () => {
  const { db, learner, complete } = await setup();
  assert.equal((await getLearnerProgress(db, learner.id)).completed, false);
  const { last } = await complete();
  assert.equal((await getLearnerProgress(db, learner.id)).completed, true);
  const summary = await getCompletionSummary(db, learner.id);
  assert.equal(summary?.completingLessonNo, last.lessonNo);
});

test("panel state: completed learner shows the CBT&A Completed card (archive suggestion), never the Start Lesson panel", async () => {
  const { db, learner, complete } = await setup();
  assert.equal(learnerPanel({ archivedAt: null, completed: (await getLearnerProgress(db, learner.id)).completed }), "active");
  await complete();
  const progress = await getLearnerProgress(db, learner.id);
  const fresh = await getLearner(db, learner.id);
  assert.equal(learnerPanel({ archivedAt: fresh.archivedAt, completed: progress.completed }), "completed");
});

test("panel state: archived wins over completed (restore is the only lifecycle action), active otherwise", () => {
  assert.equal(learnerPanel({ archivedAt: "2026-09-29T00:00:00.000Z", completed: true }), "archived");
  assert.equal(learnerPanel({ archivedAt: "2026-09-29T00:00:00.000Z", completed: false }), "archived");
  assert.equal(learnerPanel({ archivedAt: null, completed: false }), "active");
  assert.equal(learnerPanel({ archivedAt: null, completed: true }), "completed");
});

test("completion never auto-archives: learner stays active and listed until an instructor archives", async () => {
  const { db, learner, complete } = await setup();
  await complete();
  assert.equal((await getLearner(db, learner.id)).archivedAt, null);
  assert.ok((await listLearners(db)).some((l) => l.id === learner.id));
});

test("server rejects an ordinary CBT&A lesson for a completed learner, and nothing is written", async () => {
  const { db, learner, input, complete } = await setup();
  await complete();
  const before = (await listLessons(db, learner.id)).length;
  await assert.rejects(() => createLesson(db, learner.id, input({ taughtIds: ["1"] })), COMPLETED_MESSAGE);
  await assert.rejects(() => createLesson(db, learner.id, input({})), COMPLETED_MESSAGE);
  assert.equal((await listLessons(db, learner.id)).length, before);
});

test("the completed-learner block does not affect a learner who has not completed (only Final Drive achieved counts)", async () => {
  const { assess, db, learner } = await setup();
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22));
  await assess([REVIEW_1_22]);
  await assess([FINAL_DRIVE_23], "not_achieved");
  assert.equal((await getLearnerProgress(db, learner.id)).completed, false);
  await assess([FINAL_DRIVE_23]);
  assert.equal((await getLearnerProgress(db, learner.id)).completed, true);
});

test("archiving a completed learner is possible, keeps completion, and restoring returns them to the completed panel (still no new lessons)", async () => {
  const { db, learner, input, complete } = await setup();
  await complete();
  const archived = await setLearnerArchived(db, learner.id, true);
  assert.equal(learnerPanel({ archivedAt: archived.archivedAt, completed: (await getLearnerProgress(db, learner.id)).completed }), "archived");
  const restored = await setLearnerArchived(db, learner.id, false);
  assert.equal(learnerPanel({ archivedAt: restored.archivedAt, completed: (await getLearnerProgress(db, learner.id)).completed }), "completed");
  await assert.rejects(() => createLesson(db, learner.id, input({ taughtIds: ["1"] })), COMPLETED_MESSAGE);
});

test("History Edit on a completed learner's earlier lesson still works (completion blocks new lessons, not corrections)", async () => {
  const { db, learner, complete } = await setup();
  const { first } = await complete();
  const result = await updateLesson(db, learner.id, first.id, {
    lessonDate: first.lessonDate,
    startTime: first.startTime,
    finishTime: "10:30",
    startOdometer: String(first.startOdometer),
    finishOdometer: String(first.finishOdometer),
    assessedIds: range(1, 17),
    achievedResults: Object.fromEntries(range(1, 17).map((id) => [id, "achieved"])),
    adiSignature: SIG_NEW,
    learnerSignature: SIG_NEW,
  });
  assert.equal(result.lesson.durationMinutes, 90);
  assert.equal(result.progress.completed, true);
});

test("completion is derived: a History Edit that invalidates it re-opens lesson creation, and the panel returns to active", async () => {
  const { db, learner, input, complete } = await setup();
  const { first } = await complete();
  const ids = range(1, 17);
  const result = await updateLesson(db, learner.id, first.id, {
    lessonDate: first.lessonDate,
    startTime: first.startTime,
    finishTime: first.finishTime,
    startOdometer: String(first.startOdometer),
    finishOdometer: String(first.finishOdometer),
    assessedIds: ids,
    achievedResults: Object.fromEntries(ids.map((id) => [id, id === "17" ? "not_achieved" : "achieved"])),
    adiSignature: SIG_NEW,
    learnerSignature: SIG_NEW,
  });
  assert.equal(result.progress.completed, false);
  assert.equal(result.invalidated.completed, true);
  assert.equal(learnerPanel({ archivedAt: null, completed: (await getLearnerProgress(db, learner.id)).completed }), "active");
  await createLesson(db, learner.id, input({ taughtIds: ["17"] }));
});
