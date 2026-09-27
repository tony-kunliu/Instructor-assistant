import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, getTotals, listInstructors, listLearners, listLessons, ValidationError } from "../lib/repo.ts";

const SIG = "data:image/png;base64,iVBORw0KGgo=";

// Seeded by lib/schema.ts — see tests/instructor-identity.test.ts.
const TONY_EMAIL = "Kunliu.work@gmail.com";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, {
    fullName: "Test Learner",
    address: "1 Test St, Belconnen ACT",
    phone: "0400 000 000",
    dob: "2008-03-01",
    licenceNumber: "L1234567",
    licenceExpiry: "2029-03-01",
    eligibility: "Eligible",
    transmission: "auto",
    schoolWork: "Test High School",
    instructorId: tony?.id,
  });
  return { db, learner, tony: tony! };
}

test("creates a learner with all CBT&A fields and an instructor", async () => {
  const { db, learner } = await setup();
  assert.equal(learner.fullName, "Test Learner");
  assert.equal(learner.transmission, "auto");
  assert.equal(learner.licenceExpiry, "2029-03-01");
  assert.equal(learner.instructorName, "Tony");
  assert.equal(learner.licenceStage, "learner");
  assert.equal((await listLearners(db)).length, 1);
});

test("createLearner requires an existing, active instructor — unknown or inactive instructorId is rejected (400) and never creates a new instructor row", async () => {
  const { db } = await setup();
  const before = await listInstructors(db);

  await assert.rejects(() => createLearner(db, { fullName: "Second", instructorId: "not-a-real-instructor-id" }), ValidationError);
  await assert.rejects(() => createLearner(db, { fullName: "Third" }), ValidationError, "instructorId is required");

  const anna = before.find((i) => i.fullName === "Anna")!;
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE id = ?").bind(anna.id).run();
  await assert.rejects(() => createLearner(db, { fullName: "Fourth", instructorId: anna.id }), ValidationError);

  const after = await listInstructors(db);
  assert.equal(after.length, before.length, "instructors table row count must be unchanged");
});

test("lesson #1 then lesson #2: numbering, duration, km, cumulative totals, carry-forward", async () => {
  const { db, learner } = await setup();

  const empty = await getTotals(db, learner.id);
  assert.deepEqual(empty, { lessonCount: 0, totalMinutes: 0, totalKm: 0, lastFinishOdometer: null });

  // Lesson #1: Start → start odo → checklist → location → comments → signatures → End → finish odo → Save.
  const lesson1 = await createLesson(db, learner.id, {
    lessonDate: "2026-09-25",
    startTime: "09:00",
    startOdometer: "45210",
    taughtIds: ["1", "2"],
    location: "Belconnen",
    comments: "Good first lesson",
    adiSignature: SIG,
    learnerSignature: SIG,
    finishTime: "10:00",
    finishOdometer: "45238",
  });
  assert.equal(lesson1.lessonNo, 1);
  assert.equal(lesson1.durationMinutes, 60);
  assert.equal(lesson1.distanceKm, 28);
  assert.equal(lesson1.cumulativeMinutes, 60);
  assert.equal(lesson1.cumulativeKm, 28);
  assert.equal(lesson1.instructorId, learner.instructorId);
  assert.equal(lesson1.adiSignature, SIG);

  let history = await listLessons(db, learner.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].taught, "1, 2");
  assert.equal(history[0].location, "Belconnen");

  // Next lesson: previous finish odometer is available as the start odometer.
  const afterFirst = await getTotals(db, learner.id);
  assert.equal(afterFirst.lastFinishOdometer, 45238);
  assert.equal(afterFirst.lessonCount + 1, 2);

  const lesson2 = await createLesson(db, learner.id, {
    lessonDate: "2026-09-26",
    startTime: "14:15",
    finishTime: "15:45",
    startOdometer: String(afterFirst.lastFinishOdometer),
    finishOdometer: "45280",
    taughtIds: ["3"],
    assessedIds: ["1"],
    achievedResults: { "1": "achieved" },
    location: "Gungahlin",
    adiSignature: SIG,
    learnerSignature: SIG,
  });
  assert.equal(lesson2.lessonNo, 2);
  assert.equal(lesson2.startOdometer, 45238);
  assert.equal(lesson2.durationMinutes, 90);
  assert.equal(lesson2.distanceKm, 42);
  assert.equal(lesson2.cumulativeMinutes, 150);
  assert.equal(lesson2.cumulativeKm, 70);

  history = await listLessons(db, learner.id);
  assert.deepEqual(history.map((l) => l.lessonNo), [2, 1]);
  assert.equal(history[0].taught, "3");
  assert.equal(history[0].competenciesAssessed, "1");
  assert.equal(history[0].achieved, "1");
  assert.deepEqual(await getTotals(db, learner.id), { lessonCount: 2, totalMinutes: 150, totalKm: 70, lastFinishOdometer: 45280 });

  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.competencies["1"].achieved, true);
  assert.equal(progress.competencies["2"].taughtCount, 1);
  assert.equal(progress.competencies["3"].taughtCount, 1);
});

test("totals are per learner", async () => {
  const { db, learner, tony } = await setup();
  const other = await createLearner(db, { fullName: "Other", instructorId: tony.id });
  await createLesson(db, learner.id, { lessonDate: "2026-09-25", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "11", adiSignature: SIG, learnerSignature: SIG });
  const first = await createLesson(db, other.id, { lessonDate: "2026-09-25", startTime: "11:00", finishTime: "11:30", startOdometer: "11", finishOdometer: "16", adiSignature: SIG, learnerSignature: SIG });
  assert.equal(first.lessonNo, 1);
  assert.equal(first.cumulativeMinutes, 30);
  assert.equal(first.cumulativeKm, 5);
});

test("rejects invalid lessons without saving", async () => {
  const { db, learner, tony } = await setup();
  const base = { lessonDate: "2026-09-25", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "120", adiSignature: SIG, learnerSignature: SIG };
  await assert.rejects(() => createLesson(db, learner.id, { ...base, finishTime: "08:00" }), ValidationError);
  await assert.rejects(() => createLesson(db, learner.id, { ...base, finishOdometer: "90" }), ValidationError);
  await assert.rejects(() => createLesson(db, learner.id, { ...base, startOdometer: "" }), ValidationError);
  await assert.rejects(() => createLesson(db, learner.id, { ...base, adiSignature: "" }), /ADI signature/);
  await assert.rejects(() => createLesson(db, learner.id, { ...base, learnerSignature: "" }), /Learner signature/);
  await assert.rejects(() => createLearner(db, { fullName: "", instructorId: tony.id }), ValidationError);
  assert.equal((await listLessons(db, learner.id)).length, 0);
});
