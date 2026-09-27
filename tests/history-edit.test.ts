import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, listLessons, updateLesson } from "../lib/repo.ts";
import { REVIEW_1_17 } from "../lib/competency.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const SIG_C = "data:image/png;base64,iVBORw0KGgoAAAA3";

// Seeded by lib/schema.ts — see tests/instructor-identity.test.ts.
const TONY_EMAIL = "Kunliu.work@gmail.com";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Edit Test Learner", instructorId: tony?.id });
  return { db, learner };
}

test("history edit: editable fields (date/times/odometer/competencies/location/comments) all take effect", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    location: "Belconnen",
    comments: "first draft",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });

  const result = await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-02",
    startTime: "10:00",
    finishTime: "10:45",
    startOdometer: "0",
    finishOdometer: "20",
    assessedIds: ["3"],
    achievedResults: { "3": "achieved" },
    location: "Gungahlin",
    comments: "corrected",
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });

  assert.equal(result.lesson.lessonDate, "2026-09-02");
  assert.equal(result.lesson.startTime, "10:00");
  assert.equal(result.lesson.finishTime, "10:45");
  assert.equal(result.lesson.finishOdometer, 20);
  assert.equal(result.lesson.taught, null); // taughtIds omitted this time -> cleared
  assert.equal(result.lesson.competenciesAssessed, "3");
  assert.equal(result.lesson.achieved, "3");
  assert.equal(result.lesson.location, "Gungahlin");
  assert.equal(result.lesson.comments, "corrected");
});

test("recalculation: lesson number is never editable; duration/distance/cumulative are always derived, never taken from input", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  assert.equal(lesson.lessonNo, 1);
  assert.equal(lesson.durationMinutes, 30);
  assert.equal(lesson.distanceKm, 10);

  // Even if lessonNo/duration/cumulative-like values were smuggled into the input, only
  // lessonDate/startTime/finishTime/startOdometer/finishOdometer drive the recalculation.
  const result = await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "0",
    finishOdometer: "40",
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
    // @ts-expect-error -- lessonNo/durationMinutes are not part of LessonInput; verifying they're ignored even if present
    lessonNo: 999,
    durationMinutes: 1,
    cumulativeMinutes: 1,
  });
  assert.equal(result.lesson.lessonNo, 1); // unchanged
  assert.equal(result.lesson.durationMinutes, 60); // recalculated from times, not the smuggled "1"
  assert.equal(result.lesson.distanceKm, 40);
  assert.equal(result.lesson.cumulativeMinutes, 60);
  assert.equal(result.lesson.cumulativeKm, 40);
});

test("recalculation cascades to every subsequent lesson's cumulative totals", async () => {
  const { db, learner } = await setup();
  const lesson1 = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  await createLesson(db, learner.id, {
    lessonDate: "2026-09-02",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "20", // gap left on purpose: monotonic, not necessarily adjacent
    finishOdometer: "35",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  let history = await listLessons(db, learner.id);
  assert.deepEqual(history.map((l) => [l.lessonNo, l.cumulativeMinutes, l.cumulativeKm]), [
    [2, 60, 25],
    [1, 30, 10],
  ]);

  // Extend lesson #1's duration and distance (still within the gap before lesson #2 starts at 20) —
  // lesson #2's cumulative totals must shift too.
  await updateLesson(db, learner.id, lesson1.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00", // 60 min instead of 30
    startOdometer: "0",
    finishOdometer: "18", // 18 km instead of 10
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });

  history = await listLessons(db, learner.id);
  const byNo = new Map(history.map((l) => [l.lessonNo, l]));
  assert.equal(byNo.get(1)?.durationMinutes, 60);
  assert.equal(byNo.get(1)?.distanceKm, 18);
  assert.equal(byNo.get(1)?.cumulativeMinutes, 60);
  assert.equal(byNo.get(1)?.cumulativeKm, 18);
  // Lesson #2 itself is unchanged (30 min / 15 km) but its cumulative total now builds on the new lesson #1.
  assert.equal(byNo.get(2)?.durationMinutes, 30);
  assert.equal(byNo.get(2)?.distanceKm, 15);
  assert.equal(byNo.get(2)?.cumulativeMinutes, 90);
  assert.equal(byNo.get(2)?.cumulativeKm, 33);
});

test("carry-forward consistency: editing odometer past a neighbouring lesson's reading is rejected", async () => {
  const { db, learner } = await setup();
  const lesson1 = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  await createLesson(db, learner.id, {
    lessonDate: "2026-09-02",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "10",
    finishOdometer: "25",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });

  await assert.rejects(
    () =>
      updateLesson(db, learner.id, lesson1.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "30", // exceeds lesson #2's start odometer (10)
        adiSignature: SIG_B,
        learnerSignature: SIG_B,
      }),
    /cannot exceed Lesson #2's start odometer/,
  );
});

test("signature invalidation: changing a protected field requires two freshly redrawn, distinct signatures", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    location: "Belconnen",
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });

  // Same signatures resubmitted while a protected field (location) changed -> rejected.
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, lesson.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "10",
        location: "Gungahlin",
        adiSignature: SIG_A,
        learnerSignature: SIG_A,
      }),
    /no longer valid/,
  );

  // Only one signature redrawn -> still rejected (both must change).
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, lesson.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "10",
        location: "Gungahlin",
        adiSignature: SIG_B,
        learnerSignature: SIG_A,
      }),
    /no longer valid/,
  );

  // Both freshly redrawn -> accepted.
  const result = await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    location: "Gungahlin",
    adiSignature: SIG_B,
    learnerSignature: SIG_C,
  });
  assert.equal(result.lesson.location, "Gungahlin");

  // No protected field changed this time (identical to the previous save) -> resubmitting the
  // same (already-fresh) signatures is fine, no re-sign forced.
  const again = await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    location: "Gungahlin",
    adiSignature: SIG_B,
    learnerSignature: SIG_C,
  });
  assert.equal(again.lesson.location, "Gungahlin");

  // Now change comments (also a protected field) while resubmitting the same signatures -> rejected.
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, lesson.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "10",
        location: "Gungahlin",
        comments: "now this changed too",
        adiSignature: SIG_B,
        learnerSignature: SIG_C,
      }),
    /no longer valid/,
  );
});

test("editing a lesson away from Achieved rolls back an already-Achieved Review 1-17 (and reports it)", async () => {
  const { db, learner } = await setup();
  const ids = Array.from({ length: 17 }, (_, i) => String(i + 1));
  const lessons = [];
  let n = 1;
  for (const id of ids) {
    const lesson = await createLesson(db, learner.id, {
      lessonDate: `2026-09-${String(n).padStart(2, "0")}`,
      startTime: "09:00",
      finishTime: "09:30",
      startOdometer: String(n * 10),
      finishOdometer: String(n * 10 + 5),
      assessedIds: [id],
      achievedResults: { [id]: "achieved" },
      adiSignature: SIG_A,
      learnerSignature: SIG_A,
    });
    lessons.push(lesson);
    n++;
  }
  await createLesson(db, learner.id, {
    lessonDate: `2026-09-${String(n).padStart(2, "0")}`,
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: String(n * 10),
    finishOdometer: String(n * 10 + 5),
    assessedIds: [REVIEW_1_17],
    achievedResults: { [REVIEW_1_17]: "achieved" },
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });

  const before = await getLearnerProgress(db, learner.id);
  assert.equal(before.review1_17.status, "achieved");

  // Edit the lesson that achieved competency "5" to mark it not_achieved instead.
  const lessonForFive = lessons[4];
  const editResult = await updateLesson(db, learner.id, lessonForFive.id, {
    lessonDate: lessonForFive.lessonDate,
    startTime: lessonForFive.startTime,
    finishTime: lessonForFive.finishTime,
    startOdometer: String(lessonForFive.startOdometer),
    finishOdometer: String(lessonForFive.finishOdometer),
    assessedIds: ["5"],
    achievedResults: { "5": "not_achieved" },
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });

  assert.equal(editResult.invalidated.review1_17, true);
  assert.equal(editResult.progress.review1_17.status, "locked");
  assert.equal(editResult.progress.competencies["5"].achieved, false);

  const after = await getLearnerProgress(db, learner.id);
  assert.equal(after.review1_17.status, "locked");
});

test("editing an unrelated lesson leaves other milestones' invalidation flags false", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  const result = await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:45",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1", "2"],
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });
  assert.deepEqual(result.invalidated, { review1_17: false, review1_22: false, finalDrive23: false, completed: false });
});

test("rejects editing a lesson that doesn't exist", async () => {
  const { db, learner } = await setup();
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, "does-not-exist", {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "10",
        adiSignature: SIG_A,
        learnerSignature: SIG_A,
      }),
    /not found/i,
  );
});
