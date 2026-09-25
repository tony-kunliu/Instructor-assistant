import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../lib/db.ts";
import { createLearner, createLesson, getTotals, listLearners, listLessons, ValidationError } from "../lib/repo.ts";

const SIG = "data:image/png;base64,iVBORw0KGgo=";

function setup() {
  const db = openDatabase(":memory:");
  const learner = createLearner(db, {
    fullName: "Test Learner",
    address: "1 Test St, Belconnen ACT",
    phone: "0400 000 000",
    dob: "2008-03-01",
    licenceNumber: "L1234567",
    licenceExpiry: "2029-03-01",
    eligibility: "Eligible",
    transmission: "auto",
    schoolWork: "Test High School",
    instructorName: "Test Instructor",
  });
  return { db, learner };
}

test("creates a learner with all CBT&A fields and an instructor", () => {
  const { db, learner } = setup();
  assert.equal(learner.fullName, "Test Learner");
  assert.equal(learner.transmission, "auto");
  assert.equal(learner.licenceExpiry, "2029-03-01");
  assert.equal(learner.instructorName, "Test Instructor");
  assert.equal(learner.licenceStage, "learner");
  assert.equal(listLearners(db).length, 1);
  // Same instructor name (any case) is reused, not duplicated.
  const second = createLearner(db, { fullName: "Second", instructorName: "test instructor" });
  assert.equal(second.instructorId, learner.instructorId);
});

test("lesson #1 then lesson #2: numbering, duration, km, cumulative totals, carry-forward", () => {
  const { db, learner } = setup();

  const empty = getTotals(db, learner.id);
  assert.deepEqual(empty, { lessonCount: 0, totalMinutes: 0, totalKm: 0, lastFinishOdometer: null });

  // Lesson #1: Start → start odo → checklist → location → comments → signatures → End → finish odo → Save.
  const lesson1 = createLesson(db, learner.id, {
    lessonDate: "2026-09-25",
    startTime: "09:00",
    startOdometer: "45210",
    taught: "Pre-drive checks, moving off",
    competenciesAssessed: "Moving off",
    achieved: "Moving off",
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

  let history = listLessons(db, learner.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].taught, "Pre-drive checks, moving off");
  assert.equal(history[0].location, "Belconnen");

  // Next lesson: previous finish odometer is available as the start odometer.
  const afterFirst = getTotals(db, learner.id);
  assert.equal(afterFirst.lastFinishOdometer, 45238);
  assert.equal(afterFirst.lessonCount + 1, 2);

  const lesson2 = createLesson(db, learner.id, {
    lessonDate: "2026-09-26",
    startTime: "14:15",
    finishTime: "15:45",
    startOdometer: String(afterFirst.lastFinishOdometer),
    finishOdometer: "45280",
    taught: "Roundabouts",
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

  history = listLessons(db, learner.id);
  assert.deepEqual(history.map((l) => l.lessonNo), [2, 1]);
  assert.deepEqual(getTotals(db, learner.id), { lessonCount: 2, totalMinutes: 150, totalKm: 70, lastFinishOdometer: 45280 });
});

test("totals are per learner", () => {
  const { db, learner } = setup();
  const other = createLearner(db, { fullName: "Other", instructorName: "Test Instructor" });
  createLesson(db, learner.id, { lessonDate: "2026-09-25", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "11", adiSignature: SIG, learnerSignature: SIG });
  const first = createLesson(db, other.id, { lessonDate: "2026-09-25", startTime: "11:00", finishTime: "11:30", startOdometer: "11", finishOdometer: "16", adiSignature: SIG, learnerSignature: SIG });
  assert.equal(first.lessonNo, 1);
  assert.equal(first.cumulativeMinutes, 30);
  assert.equal(first.cumulativeKm, 5);
});

test("rejects invalid lessons without saving", () => {
  const { db, learner } = setup();
  const base = { lessonDate: "2026-09-25", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "120", adiSignature: SIG, learnerSignature: SIG };
  assert.throws(() => createLesson(db, learner.id, { ...base, finishTime: "08:00" }), ValidationError);
  assert.throws(() => createLesson(db, learner.id, { ...base, finishOdometer: "90" }), ValidationError);
  assert.throws(() => createLesson(db, learner.id, { ...base, startOdometer: "" }), ValidationError);
  assert.throws(() => createLesson(db, learner.id, { ...base, adiSignature: "" }), /ADI signature/);
  assert.throws(() => createLesson(db, learner.id, { ...base, learnerSignature: "" }), /Learner signature/);
  assert.throws(() => createLearner(db, { fullName: "", instructorName: "X" }), ValidationError);
  assert.equal(listLessons(db, learner.id).length, 0);
});
