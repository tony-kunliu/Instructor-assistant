// History Edit for paper-imported lessons (P1b Paper Records Import, Task 2).
// Paper lessons are seeded with direct SQL INSERTs here — the importer itself
// arrives in a later task.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { createLearner, createLesson, findInstructorByEmail, getLesson, listLessons, listLessonsForExport, toLesson, updateLesson, ValidationError } from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";
import { createFakeReceiver } from "./helpers/fake-actgds-receiver.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const SECRET = "synthetic-test-secret-never-real";
const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "QA Paper Edit Learner", instructorId: tony?.id });
  return { db, learner, tony: tony! };
}

type PaperSeed = {
  lessonNo: number;
  date?: string;
  startTime?: string | null;
  finishTime?: string | null;
  startOdometer?: number | null;
  finishOdometer?: number | null;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  cumulativeMinutes?: number;
  cumulativeKm?: number;
  assessedAchieved?: string[];
};

async function seedPaper(db: D1Database, learnerId: string, instructorId: string, seed: PaperSeed): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time, start_odometer, finish_odometer,
         duration_minutes, distance_km, cumulative_minutes, cumulative_km, competencies_assessed, achieved, record_source, signature_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paper_import', 'on_paper')`,
    )
    .bind(
      id, learnerId, instructorId, seed.lessonNo, seed.date ?? `2026-08-0${seed.lessonNo}`,
      seed.startTime ?? null, seed.finishTime ?? null, seed.startOdometer ?? null, seed.finishOdometer ?? null,
      seed.durationMinutes ?? null, seed.distanceKm ?? null, seed.cumulativeMinutes ?? 0, seed.cumulativeKm ?? 0,
      seed.assessedAchieved?.join(", ") ?? null, seed.assessedAchieved?.join(", ") ?? null,
    )
    .run();
  for (const competencyId of seed.assessedAchieved ?? []) {
    await db
      .prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, 'assessed', 'achieved')")
      .bind(crypto.randomUUID(), learnerId, id, competencyId)
      .run();
  }
  return id;
}

const paperEdit = (overrides: Record<string, unknown> = {}) => ({
  lessonDate: "2026-08-01",
  startTime: "",
  finishTime: "",
  startOdometer: "",
  finishOdometer: "",
  signatureStatus: "on_paper",
  ...overrides,
});

test("paper edit: blank times and odometer save as NULL and recompute downstream cumulative treating NULL as 0", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1, startTime: "09:00", finishTime: "10:00", startOdometer: 0, finishOdometer: 10, durationMinutes: 60, distanceKm: 10, cumulativeMinutes: 60, cumulativeKm: 10 });
  const p2 = await seedPaper(db, learner.id, tony.id, { lessonNo: 2, startTime: "09:00", finishTime: "09:30", startOdometer: 20, finishOdometer: 30, durationMinutes: 30, distanceKm: 10, cumulativeMinutes: 90, cumulativeKm: 20 });

  const result = await updateLesson(db, learner.id, p1, paperEdit());
  assert.equal(result.lesson.startTime, null);
  assert.equal(result.lesson.finishTime, null);
  assert.equal(result.lesson.startOdometer, null);
  assert.equal(result.lesson.finishOdometer, null);
  assert.equal(result.lesson.durationMinutes, null);
  assert.equal(result.lesson.distanceKm, null);
  assert.equal(result.lesson.cumulativeMinutes, 0);
  assert.equal(result.lesson.cumulativeKm, 0);

  const second = await getLesson(db, learner.id, p2);
  assert.equal(second.cumulativeMinutes, 30);
  assert.equal(second.cumulativeKm, 10);

  // Reading back through both accessors yields real nulls, never 0 / "null".
  const listed = (await listLessons(db, learner.id)).find((l) => l.id === p1)!;
  for (const lesson of [await getLesson(db, learner.id, p1), listed]) {
    assert.strictEqual(lesson.startTime, null);
    assert.strictEqual(lesson.finishTime, null);
    assert.strictEqual(lesson.startOdometer, null);
    assert.strictEqual(lesson.finishOdometer, null);
    assert.strictEqual(lesson.durationMinutes, null);
    assert.strictEqual(lesson.distanceKm, null);
  }
});

test("paper edit: filling in times and odometer derives duration, distance and cumulative", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  const result = await updateLesson(db, learner.id, p1, paperEdit({ startTime: "09:00", finishTime: "10:30", startOdometer: "100", finishOdometer: "125" }));
  assert.equal(result.lesson.durationMinutes, 90);
  assert.equal(result.lesson.distanceKm, 25);
  assert.equal(result.lesson.cumulativeMinutes, 90);
  assert.equal(result.lesson.cumulativeKm, 25);
  assert.equal(result.lesson.recordSource, "paper_import");
});

test("paper edit: one of start/finish time given -> ValidationError", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  for (const overrides of [{ startTime: "09:00" }, { finishTime: "10:00" }]) {
    await assert.rejects(updateLesson(db, learner.id, p1, paperEdit(overrides)), (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, "Enter both start and finish time, or leave both blank.");
      return true;
    });
  }
});

test("paper edit: one of start/finish odometer given -> ValidationError", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  for (const overrides of [{ startOdometer: "100" }, { finishOdometer: "110" }]) {
    await assert.rejects(updateLesson(db, learner.id, p1, paperEdit(overrides)), (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, "Enter both start and finish odometer, or leave both blank.");
      return true;
    });
  }
});

test("paper edit: no signatures required; signatureStatus changes to unsigned", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  const result = await updateLesson(db, learner.id, p1, paperEdit({ signatureStatus: "unsigned", comments: "changed" }));
  assert.equal(result.lesson.signatureStatus, "unsigned");
  assert.equal(result.lesson.comments, "changed");
  assert.equal(result.lesson.adiSignature, null);
  assert.equal(result.lesson.learnerSignature, null);
  assert.equal(result.lesson.recordSource, "paper_import");
});

test("paper edit: invalid or missing signatureStatus -> ValidationError ('digital' is not allowed for paper)", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  for (const signatureStatus of ["digital", "bogus", "", undefined]) {
    await assert.rejects(updateLesson(db, learner.id, p1, paperEdit({ signatureStatus })), ValidationError);
  }
  assert.equal((await getLesson(db, learner.id, p1)).signatureStatus, "on_paper");
});

test("paper edit: competency rules unchanged (teaching an already-achieved competency is still rejected)", async () => {
  const { db, learner, tony } = await setup();
  await seedPaper(db, learner.id, tony.id, { lessonNo: 1, assessedAchieved: ["3"] });
  const p2 = await seedPaper(db, learner.id, tony.id, { lessonNo: 2 });
  await assert.rejects(updateLesson(db, learner.id, p2, paperEdit({ lessonDate: "2026-08-02", taughtIds: ["3"] })), ValidationError);
  const ok = await updateLesson(db, learner.id, p2, paperEdit({ lessonDate: "2026-08-02", taughtIds: ["4"] }));
  assert.equal(ok.lesson.taught, "4");
});

test("paper edit: odometer monotonicity skips NULL neighbours", async () => {
  const { db, learner, tony } = await setup();
  await seedPaper(db, learner.id, tony.id, { lessonNo: 1, startOdometer: 50, finishOdometer: 100, distanceKm: 50 });
  await seedPaper(db, learner.id, tony.id, { lessonNo: 2 }); // NULL readings in between
  const p3 = await seedPaper(db, learner.id, tony.id, { lessonNo: 3, startOdometer: 150, finishOdometer: 160, distanceKm: 10 });

  await assert.rejects(
    updateLesson(db, learner.id, p3, paperEdit({ lessonDate: "2026-08-03", startOdometer: "90", finishOdometer: "160" })),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, /Lesson #1/);
      assert.match(error.message, /\(100\)/);
      assert.doesNotMatch(error.message, /null/);
      return true;
    },
  );
  const ok = await updateLesson(db, learner.id, p3, paperEdit({ lessonDate: "2026-08-03", startOdometer: "110", finishOdometer: "160" }));
  assert.equal(ok.lesson.startOdometer, 110);
});

test("paper edit: finish odometer is checked against the nearest LATER non-NULL start (a NULL neighbour does not read as 0)", async () => {
  const { db, learner, tony } = await setup();
  const p1 = await seedPaper(db, learner.id, tony.id, { lessonNo: 1, startOdometer: 50, finishOdometer: 100, distanceKm: 50 });
  await seedPaper(db, learner.id, tony.id, { lessonNo: 2 }); // NULL: must not make any finish > 0 fail
  await seedPaper(db, learner.id, tony.id, { lessonNo: 3, startOdometer: 150, finishOdometer: 160, distanceKm: 10 });

  const ok = await updateLesson(db, learner.id, p1, paperEdit({ startOdometer: "50", finishOdometer: "120" }));
  assert.equal(ok.lesson.finishOdometer, 120);

  await assert.rejects(updateLesson(db, learner.id, p1, paperEdit({ startOdometer: "50", finishOdometer: "151" })), (error: unknown) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /Lesson #3/);
    assert.match(error.message, /\(150\)/);
    return true;
  });
});

test("app edit: a NULL-odometer paper neighbour does not wrongly reject or skip the check", async () => {
  const { db, learner, tony } = await setup();
  const a1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", adiSignature: SIG_A, learnerSignature: SIG_A });
  await seedPaper(db, learner.id, tony.id, { lessonNo: 2 });
  await seedPaper(db, learner.id, tony.id, { lessonNo: 3, startOdometer: 200, finishOdometer: 210, distanceKm: 10 });
  const edit = (finishOdometer: string) => ({ lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer, adiSignature: SIG_B, learnerSignature: SIG_B });
  await updateLesson(db, learner.id, a1.id, edit("150")); // > 0 with a NULL adjacent neighbour: fine
  await assert.rejects(updateLesson(db, learner.id, a1.id, edit("201")), (error: unknown) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /Lesson #3/);
    return true;
  });
});

test("app edit unchanged: blank times still rejected; signatures still required", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", adiSignature: SIG_A, learnerSignature: SIG_A });
  const base = { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", adiSignature: SIG_B, learnerSignature: SIG_B };

  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...base, startTime: "", finishTime: "" }), /Start and finish time are required/);
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...base, startOdometer: "", finishOdometer: "" }), /Start odometer is required/);
  await assert.rejects(updateLesson(db, learner.id, lesson.id, { ...base, comments: "changed", adiSignature: undefined, learnerSignature: undefined }), /signatures must be redrawn/);
  // signatureStatus input is ignored for app lessons: stays digital.
  const ok = await updateLesson(db, learner.id, lesson.id, { ...base, signatureStatus: "unsigned" });
  assert.equal(ok.lesson.signatureStatus, "digital");
  assert.equal(ok.lesson.recordSource, "app");
});

test("paper edit with integration enabled: no outbox row for the paper lesson; a downstream App lesson that already has an event gets a propagated event with new cumulative", async () => {
  const { db, learner, tony } = await setup();
  const receiver = createFakeReceiver(SECRET);
  const pending: Promise<void>[] = [];
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: SECRET, ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: receiver.fetchImpl,
    schedule: (attempt) => pending.push(attempt()),
  };
  const settle = async () => { await Promise.all(pending); };

  receiver.queueResponse(202); // App lesson #1 create
  const app1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  const paper2 = await seedPaper(db, learner.id, tony.id, { lessonNo: 2, date: "2026-09-02", cumulativeMinutes: 60, cumulativeKm: 10 });
  receiver.queueResponse(202); // App lesson #3 create
  const app3 = await createLesson(db, learner.id, { lessonDate: "2026-09-03", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();
  assert.equal(app3.lessonNo, 3);
  assert.equal(app3.cumulativeMinutes, 120);

  receiver.queueResponse(202); // propagated event for #3
  const result = await updateLesson(db, learner.id, paper2, paperEdit({ lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "20", finishOdometer: "30" }), hooks);
  await settle();
  assert.equal(result.lesson.cumulativeMinutes, 120);

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.filter((row) => row.lessonId === paper2).length, 0, "paper lesson must never get an outbox row");
  assert.equal(rows.filter((row) => row.lessonId === app1.id).length, 1);
  const app3Rows = rows.filter((row) => row.lessonId === app3.id);
  assert.equal(app3Rows.length, 2, "downstream App lesson gains a propagated event");
  const newest = app3Rows.map((row) => JSON.parse(row.payloadJson) as LessonUpsertedPayloadV1).sort((a, b) => a.lesson.source_updated_at.localeCompare(b.lesson.source_updated_at)).at(-1)!;
  assert.equal(newest.lesson.cumulative_minutes, 180);
  assert.equal(newest.lesson.cumulative_km, 30);
});

test("listLessonsForExport carries a paper lesson's real recordSource/signatureStatus (not defaulted)", async () => {
  const { db, learner, tony } = await setup();
  await seedPaper(db, learner.id, tony.id, { lessonNo: 1 });
  const lessons = await listLessonsForExport(db, learner.id);
  assert.equal(lessons[0].recordSource, "paper_import");
  assert.equal(lessons[0].signatureStatus, "on_paper");
});

const BASE_ROW = { id: "l1", learner_id: "x", instructor_id: "i", lesson_no: 1, lesson_date: "2026-01-01", cumulative_minutes: 0, cumulative_km: 0, created_at: "2026-01-01T00:00:00Z" };

test("toLesson is strict: missing/unknown record_source or signature_status throws naming the column; valid values pass", () => {
  const ok = { ...BASE_ROW, record_source: "paper_import", signature_status: "on_paper" };
  assert.equal(toLesson(ok).recordSource, "paper_import");
  assert.equal(toLesson(ok).signatureStatus, "on_paper");
  assert.equal(toLesson({ ...ok, record_source: "app", signature_status: "digital" }).signatureStatus, "digital");
  assert.equal(toLesson({ ...ok, signature_status: "unsigned" }).signatureStatus, "unsigned");

  const { record_source: _r, ...noSource } = ok;
  const { signature_status: _s, ...noStatus } = ok;
  assert.throws(() => toLesson(noSource), /record_source/);
  assert.throws(() => toLesson({ ...ok, record_source: "bogus" }), /record_source/);
  assert.throws(() => toLesson(noStatus), /signature_status/);
  assert.throws(() => toLesson({ ...ok, signature_status: "bogus" }), /signature_status/);
});
