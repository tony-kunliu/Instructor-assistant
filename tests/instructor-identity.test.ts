import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, listActiveInstructors, listInstructors, listLessons, updateLesson, ValidationError } from "../lib/repo.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const SIG_C = "data:image/png;base64,iVBORw0KGgoAAAA3";
const SIG_D = "data:image/png;base64,iVBORw0KGgoAAAA4";

// Seeded by lib/schema.ts (Instructor Identity V1 — the migration/schema
// this round adds). Real ids don't matter to these tests; only that the
// seeded rows resolve by their real, Tony-provided emails.
const TONY_EMAIL = "Kunliu.work@gmail.com";
const ANNA_EMAIL = "yapingqu.work@gmail.com";

test("A: the allowed Tony email resolves to the Tony instructor record", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  assert.equal(tony?.fullName, "Tony");
  assert.equal(tony?.status, "active");
});

test("B: the allowed Anna email resolves to the Anna instructor record", async () => {
  const db = openTestD1(":memory:");
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  assert.equal(anna?.fullName, "Anna");
  assert.equal(anna?.status, "active");
});

test("B (case-insensitive): email lookup is not case-sensitive, matching how mail providers treat local parts", async () => {
  const db = openTestD1(":memory:");
  const anna = await findInstructorByEmail(db, ANNA_EMAIL.toUpperCase());
  assert.equal(anna?.fullName, "Anna");
});

test("C: an unknown/unauthorized email resolves to nothing — the caller must refuse app access, never auto-create an instructor", async () => {
  const db = openTestD1(":memory:");
  const stranger = await findInstructorByEmail(db, "someone-else@example.com");
  assert.equal(stranger, null);
});

test("C: an inactive instructor's email does not resolve, even if it exists", async () => {
  const db = openTestD1(":memory:");
  const [tony] = await listInstructors(db);
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE lower(email) = lower(?)").bind(TONY_EMAIL).run();
  const resolved = await findInstructorByEmail(db, TONY_EMAIL);
  assert.equal(resolved, null);
  // listActiveInstructors must also exclude them.
  const active = await listActiveInstructors(db);
  assert.ok(!active.some((i) => i.id === tony.id && i.fullName === "Tony") || !active.some((i) => i.fullName === "Tony"));
});

test("E: a lesson created with actingInstructorId = Tony is attributed to Tony, not the learner's own default instructor", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  const learner = await createLearner(db, { fullName: "Attribution Learner", instructorId: anna?.id });
  assert.notEqual(learner.instructorId, tony?.id, "sanity: the learner's own instructor is a different record than Tony");

  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
    actingInstructorId: tony?.id,
  });
  assert.equal(lesson.instructorId, tony?.id);
});

test("F: a lesson created with actingInstructorId = Anna is attributed to Anna", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  const learner = await createLearner(db, { fullName: "Attribution Learner 2", instructorId: tony?.id });

  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
    actingInstructorId: anna?.id,
  });
  assert.equal(lesson.instructorId, anna?.id);
});

test("createLesson without actingInstructorId keeps the prior behavior (falls back to the learner's own instructor) — backward compatible", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Legacy Behavior Learner", instructorId: tony?.id });
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
  assert.equal(lesson.instructorId, learner.instructorId);
});

test("createLesson rejects an actingInstructorId that doesn't exist", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Bad Attribution Learner", instructorId: tony?.id });
  await assert.rejects(
    () =>
      createLesson(db, learner.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "09:30",
        startOdometer: "0",
        finishOdometer: "10",
        taughtIds: ["1"],
        adiSignature: SIG_A,
        learnerSignature: SIG_A,
        actingInstructorId: "not-a-real-instructor-id",
      }),
    ValidationError,
  );
});

test("G: Anna editing a history lesson originally created under a different instructor does not change the original instructor_id, only records updated_by_instructor_id = Anna", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  const learner = await createLearner(db, { fullName: "Shared Learner", instructorId: anna?.id });

  const created = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
    actingInstructorId: tony?.id,
  });
  assert.equal(created.instructorId, tony?.id);
  assert.equal(created.updatedByInstructorId, null, "never edited yet");

  const result = await updateLesson(db, learner.id, created.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "0",
    finishOdometer: "20",
    taughtIds: ["1"],
    location: "Belconnen",
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
    actingInstructorId: anna?.id,
  });

  assert.equal(result.lesson.instructorId, tony?.id, "the original creating instructor must never be silently rewritten by someone else's edit");
  assert.equal(result.lesson.updatedByInstructorId, anna?.id);
});

test("H: history (listLessons) surfaces the editor's display name (\"Last edited by <name>\") alongside updatedAt", async () => {
  const db = openTestD1(":memory:");
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  const learner = await createLearner(db, { fullName: "History Display Learner", instructorId: anna?.id });
  const created = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_C,
    learnerSignature: SIG_C,
  });

  await updateLesson(db, learner.id, created.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "0",
    finishOdometer: "20",
    taughtIds: ["1"],
    adiSignature: SIG_D,
    learnerSignature: SIG_D,
    actingInstructorId: anna?.id,
  });

  const [lesson] = await listLessons(db, learner.id);
  assert.equal(lesson.updatedByInstructorId, anna?.id);
  assert.equal(lesson.updatedByInstructorName, "Anna");
  assert.ok(lesson.updatedAt, "updatedAt must still be recorded as before");
});

test("editing a lesson without actingInstructorId leaves updatedByInstructorId exactly as it was — never guessed (STEP 6/7)", async () => {
  const db = openTestD1(":memory:");
  const anna = await findInstructorByEmail(db, ANNA_EMAIL);
  const learner = await createLearner(db, { fullName: "No-Attribution Edit Learner", instructorId: anna?.id });
  const created = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });

  // First edit: attributed to Anna.
  await updateLesson(db, learner.id, created.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "0",
    finishOdometer: "20",
    taughtIds: ["1"],
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
    actingInstructorId: anna?.id,
  });

  // Second edit, this time with no actingInstructorId supplied (e.g. an
  // older client, or before Access is wired up) — must not clear or guess it.
  const result = await updateLesson(db, learner.id, created.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "11:00",
    startOdometer: "0",
    finishOdometer: "30",
    taughtIds: ["1"],
    adiSignature: SIG_C,
    learnerSignature: SIG_C,
  });

  assert.equal(result.lesson.updatedByInstructorId, anna?.id, "must stay as the last known attribution, not be cleared");
});

test("updateLesson rejects an actingInstructorId that doesn't exist", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Bad Edit Attribution Learner", instructorId: tony?.id });
  const created = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, created.id, {
        lessonDate: "2026-09-01",
        startTime: "09:00",
        finishTime: "10:00",
        startOdometer: "0",
        finishOdometer: "20",
        taughtIds: ["1"],
        adiSignature: SIG_B,
        learnerSignature: SIG_B,
        actingInstructorId: "not-a-real-instructor-id",
      }),
    ValidationError,
  );
});

test("listInstructors / listActiveInstructors surface the seeded Tony and Anna without touching any pre-existing instructor row", async () => {
  const db = openTestD1(":memory:");
  // Simulate a real pre-existing production instructor (e.g. "ADI601")
  // that must never be renamed/merged into "Tony"/"Anna" by guessing.
  await db.prepare("INSERT INTO instructors (id, full_name, adi_number) VALUES (?, ?, ?)").bind("legacy-1", "ADI601", "604").run();

  const all = await listInstructors(db);
  const names = all.map((i) => i.fullName).sort();
  assert.deepEqual(names, ["ADI601", "Anna", "Tony"]);

  const legacy = all.find((i) => i.fullName === "ADI601");
  assert.equal(legacy?.email, null, "pre-existing instructor rows are left exactly as they were — no email/status guessed onto them beyond the schema default");
  assert.equal(legacy?.status, "active", "the additive column's own DEFAULT 'active' applies uniformly; nothing else about the row was touched");

  const active = await listActiveInstructors(db);
  assert.equal(active.length, 3);
});
