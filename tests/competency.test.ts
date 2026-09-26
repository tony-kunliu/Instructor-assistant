import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, getCompletionSummary, getLearnerProgress } from "../lib/repo.ts";
import { ALL_ASSESSABLE_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, competencyFullName } from "../lib/competency.ts";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const BASE = { lessonDate: "2026-09-25", startOdometer: "0", adiSignature: SIG, learnerSignature: SIG };

async function setup() {
  const db = openTestD1(":memory:");
  const learner = await createLearner(db, { fullName: "Test Learner", instructorName: "Test Instructor" });
  return { db, learner };
}

// One lesson per call, date/odometer auto-advanced so cumulative totals never collide.
function lessonAt(n: number, extra: Record<string, unknown>) {
  const date = new Date(2026, 8, 25 + n);
  const lessonDate = date.toISOString().slice(0, 10);
  return { ...BASE, lessonDate, startTime: "09:00", finishTime: "09:30", startOdometer: String(n * 10), finishOdometer: String(n * 10 + 5), ...extra };
}

test("A: a competency can be taught repeatedly across different lessons", async () => {
  const { db, learner } = await setup();
  await createLesson(db, learner.id, lessonAt(1, { taughtIds: ["8"] }));
  await createLesson(db, learner.id, lessonAt(2, { taughtIds: ["8"] }));
  await createLesson(db, learner.id, lessonAt(3, { taughtIds: ["8"] }));
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.competencies["8"].taughtCount, 3);
});

test("B: same lesson cannot both teach and assess the same competency", async () => {
  const { db, learner } = await setup();
  await assert.rejects(
    () => createLesson(db, learner.id, lessonAt(1, { taughtIds: ["8"], assessedIds: ["8"], achievedResults: { "8": "achieved" } })),
    /taught and assessed/,
  );
});

test("C: achieved requires the competency to be assessed in the same lesson", async () => {
  const { db, learner } = await setup();
  // achievedResults references "8" without assessing it.
  await assert.rejects(
    () => createLesson(db, learner.id, lessonAt(1, { assessedIds: ["9"], achievedResults: { "8": "achieved", "9": "achieved" } })),
    /without assessing it/,
  );
  // "8" assessed but no result supplied for it.
  await assert.rejects(() => createLesson(db, learner.id, lessonAt(1, { assessedIds: ["8", "9"], achievedResults: { "9": "achieved" } })), /Assessment result/);
});

test("D: once achieved, a competency can no longer be taught", async () => {
  const { db, learner } = await setup();
  await createLesson(db, learner.id, lessonAt(1, { assessedIds: ["8"], achievedResults: { "8": "achieved" } }));
  await assert.rejects(() => createLesson(db, learner.id, lessonAt(2, { taughtIds: ["8"] })), /already achieved/);
});

test("E: Review 1-17 is locked while any of 1-16 are not achieved", async () => {
  const { db, learner } = await setup();
  let n = 1;
  for (const id of Array.from({ length: 16 }, (_, i) => String(i + 1))) {
    await createLesson(db, learner.id, lessonAt(n++, { assessedIds: [id], achievedResults: { [id]: "achieved" } }));
  }
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.review1_17.status, "locked");
  assert.equal(progress.review1_17.remaining, 1);
  await assert.rejects(
    () => createLesson(db, learner.id, lessonAt(n, { assessedIds: [REVIEW_1_17], achievedResults: { [REVIEW_1_17]: "achieved" } })),
    /Review 1-17 is locked/,
  );
});

async function achieveCompetencies(db: Awaited<ReturnType<typeof openTestD1>>, learnerId: string, ids: string[], startAt = 1) {
  let n = startAt;
  for (const id of ids) {
    await createLesson(db, learnerId, lessonAt(n++, { assessedIds: [id], achievedResults: { [id]: "achieved" } }));
  }
  return n;
}

test("F: Review 1-17 unlocks once Competency 1-17 are all achieved", async () => {
  const { db, learner } = await setup();
  const ids = Array.from({ length: 17 }, (_, i) => String(i + 1));
  const next = await achieveCompetencies(db, learner.id, ids);
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.review1_17.status, "ready");
  const lesson = await createLesson(db, learner.id, lessonAt(next, { assessedIds: [REVIEW_1_17], achievedResults: { [REVIEW_1_17]: "achieved" } }));
  assert.ok(lesson);
  const after = await getLearnerProgress(db, learner.id);
  assert.equal(after.review1_17.status, "achieved");
});

test("G: Review 1-22 stays locked when 1-22 are achieved but Review 1-17 is not", async () => {
  const { db, learner } = await setup();
  const ids = Array.from({ length: 22 }, (_, i) => String(i + 1));
  const next = await achieveCompetencies(db, learner.id, ids);
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.review1_22.status, "locked");
  await assert.rejects(
    () => createLesson(db, learner.id, lessonAt(next, { assessedIds: [REVIEW_1_22], achievedResults: { [REVIEW_1_22]: "achieved" } })),
    /Review 1-22 is locked/,
  );
});

test("H: Review 1-22 unlocks once 1-22 are achieved and Review 1-17 is achieved", async () => {
  const { db, learner } = await setup();
  const ids = Array.from({ length: 22 }, (_, i) => String(i + 1));
  let next = await achieveCompetencies(db, learner.id, ids);
  next = await achieveCompetencies(db, learner.id, [REVIEW_1_17], next);
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.review1_22.status, "ready");
  await createLesson(db, learner.id, lessonAt(next, { assessedIds: [REVIEW_1_22], achievedResults: { [REVIEW_1_22]: "achieved" } }));
  const after = await getLearnerProgress(db, learner.id);
  assert.equal(after.review1_22.status, "achieved");
});

test("I: Final Drive 23 is locked until 1-22, Review 1-17 and Review 1-22 are all achieved", async () => {
  const { db, learner } = await setup();
  await assert.rejects(
    () => createLesson(db, learner.id, lessonAt(1, { assessedIds: [FINAL_DRIVE_23], achievedResults: { [FINAL_DRIVE_23]: "achieved" } })),
    /23 Final Drive is locked/,
  );
});

test("J: Final Drive 23 Assessed + Achieved (after full unlock) marks CBT&A completed, with a recorded completion summary", async () => {
  const { db, learner } = await setup();
  const before = await getCompletionSummary(db, learner.id);
  assert.equal(before, null);

  const ids = Array.from({ length: 22 }, (_, i) => String(i + 1));
  let next = await achieveCompetencies(db, learner.id, ids);
  next = await achieveCompetencies(db, learner.id, [REVIEW_1_17], next);
  next = await achieveCompetencies(db, learner.id, [REVIEW_1_22], next);

  const progressBefore = await getLearnerProgress(db, learner.id);
  assert.equal(progressBefore.finalDrive23.status, "ready");

  const lesson = await createLesson(db, learner.id, lessonAt(next, { assessedIds: [FINAL_DRIVE_23], achievedResults: { [FINAL_DRIVE_23]: "achieved" } }));
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.completed, true);
  assert.equal(progress.finalDrive23.status, "achieved");

  const summary = await getCompletionSummary(db, learner.id);
  assert.ok(summary);
  assert.equal(summary?.completingLessonNo, lesson.lessonNo);
  assert.equal(summary?.instructorName, "Test Instructor");
  assert.equal(summary?.totalLessons, lesson.lessonNo);
  assert.equal(summary?.cumulativeKm, lesson.cumulativeKm);
});

test("taughtIds silently drops ids that aren't a core competency (e.g. a special assessment id)", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, lessonAt(1, { taughtIds: [REVIEW_1_17, "8"] }));
  assert.equal(lesson.taught, "8");
});

test("competencyFullName returns the official ACT government CBT&A title for every competency/review id, display-only", () => {
  for (const id of ALL_ASSESSABLE_IDS) {
    const name = competencyFullName(id);
    assert.ok(name && name.length > 0, `expected a full name for ${id}`);
  }
  assert.equal(competencyFullName("1"), "Vehicle Controls");
  assert.equal(competencyFullName("23"), null, "23 Final Drive uses the FINAL_DRIVE_23 id, not the bare string '23'");
  assert.equal(competencyFullName(FINAL_DRIVE_23), "Driving on Busy Roads and Unfamiliar Roads");
  assert.equal(competencyFullName("not-a-real-id"), null);
});
