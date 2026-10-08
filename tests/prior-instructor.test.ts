// Task 8 (spec §12, D10–D14): prior-instructor records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLesson } from "../lib/repo.ts";

const BASE_ROW = {
  id: "p1", learner_id: "L1", instructor_id: "I1", lesson_no: -1, lesson_date: "2025-12-01",
  start_time: null, finish_time: null, start_odometer: null, finish_odometer: null,
  duration_minutes: 1200, distance_km: 150, cumulative_minutes: 1200, cumulative_km: 150,
  taught: null, competencies_assessed: "1, 2", achieved: "1, 2", location: null, comments: null,
  adi_signature: null, learner_signature: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: null,
  updated_by_instructor_id: null, updated_by_instructor_name: null,
  record_source: "prior_instructor", signature_status: "on_paper", prior_instructor_label: "QA ADI 358", prior_lesson_count: 11,
};

test("toLesson reads prior-instructor rows and their label / lesson count", () => {
  const lesson = toLesson(BASE_ROW);
  assert.equal(lesson.recordSource, "prior_instructor");
  assert.equal(lesson.priorInstructorLabel, "QA ADI 358");
  assert.equal(lesson.priorLessonCount, 11);
  const app = toLesson({ ...BASE_ROW, lesson_no: 1, record_source: "app", signature_status: "digital", prior_instructor_label: null, prior_lesson_count: null });
  assert.equal(app.priorInstructorLabel, null);
  assert.equal(app.priorLessonCount, null);
});

test("toLesson is strict for prior rows: a prior_instructor row without label or lesson count throws naming the column", () => {
  assert.throws(() => toLesson({ ...BASE_ROW, prior_instructor_label: null }), /prior_instructor_label/);
  assert.throws(() => toLesson({ ...BASE_ROW, prior_lesson_count: null }), /prior_lesson_count/);
  assert.throws(() => toLesson({ ...BASE_ROW, duration_minutes: null }), /duration_minutes/);
  const { prior_lesson_count: _c, ...missing } = BASE_ROW;
  assert.throws(() => toLesson(missing), /prior_lesson_count/);
});

// ── Repo: import, totals, numbering, edit guard (spec §12) ──────────────

import { readFileSync } from "node:fs";
import { openTestD1 } from "../lib/db.ts";
import {
  createLearner, createLesson, findInstructorByEmail, getCompetencyEvents, getLearnerProgress, getProgressBeforeLesson, getTotals,
  importPaperLessons, listLessons, listLessonsForExport, updateLesson, ValidationError,
} from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import { matchesReceiverSemantics, matchesSchema } from "./helpers/schema-validate.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";
const schema = JSON.parse(readFileSync(new URL("../docs/integrations/lesson-upserted-v1.schema.json", import.meta.url), "utf8"));
const ALL_22_IDS = Array.from({ length: 22 }, (_, i) => String(i + 1));

type CsvRow = Partial<Record<(typeof PAPER_CSV_COLUMNS)[number], string>>;
function csvOf(...rows: CsvRow[]): string {
  return [PAPER_CSV_COLUMNS.join(","), ...rows.map((r) => PAPER_CSV_COLUMNS.map((c) => r[c] ?? "").join(","))].join("\n") + "\n";
}
const priorRow = (r: CsvRow = {}): CsvRow => ({ date: "2025-12-01", prior_instructor: "QA ADI 358", prior_lessons: "11", prior_hours: "20", prior_km: "150", ...r });
const lessonRow = (r: CsvRow = {}): CsvRow => ({ date: "2026-01-01", signature: "on_paper", instructor: "Tony", ...r });

/** Two prior instructors (1-17 stamped, then 18-22 + both reviews) and two paper lessons. */
const TRANSFER_CSV = csvOf(
  priorRow({ date: "2025-06-01", prior_instructor: "QA Old School", prior_lessons: "4", prior_hours: "6.5", prior_km: "", assessed_achieved: ALL_22_IDS.slice(0, 17).join(";") }),
  priorRow({ assessed_achieved: [...ALL_22_IDS.slice(17), "review-1-17", "review-1-22"].join(";") }),
  lessonRow({ start_time: "09:00", finish_time: "10:00", start_odometer: "100", finish_odometer: "120" }),
  lessonRow({ date: "2026-01-02" }),
);

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const anna = (await findInstructorByEmail(db, "yapingqu.work@gmail.com"))!;
  // The learner belongs to Anna, so "owner of the record" is distinguishable from the paper rows' instructor (Tony).
  const learner = await createLearner(db, { fullName: "QA Transfer Learner", instructorId: anna.id });
  return { db, learner, tony, anna };
}
function enabledHooks(): { hooks: IntegrationHooks; settle: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  return {
    hooks: {
      config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic", ACTGDS_INTEGRATION_ENV: "staging" }),
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
      schedule: (attempt) => pending.push(attempt()),
    },
    settle: async () => { await Promise.all(pending); },
  };
}
const appLesson = (extra = {}) => ({ lessonDate: "2026-02-01", startTime: "09:00", finishTime: "09:45", startOdometer: "120", finishOdometer: "130", adiSignature: SIG, learnerSignature: SIG, taughtIds: [], assessedIds: [], achievedResults: {}, ...extra });
type Row = Record<string, unknown>;
const rowsOf = async (db: ReturnType<typeof openTestD1>, learnerId: string) => (await db.prepare("SELECT * FROM lessons WHERE learner_id = ? ORDER BY lesson_no").bind(learnerId).all<Row>()).results;

test("import writes one prior_instructor row per prior record with negative lesson_no, owned by the learner's instructor, and no outbox rows", async () => {
  const { db, learner, tony, anna } = await setup();
  const result = await importPaperLessons(db, learner.id, TRANSFER_CSV, "commit");
  assert.equal(result.mode === "commit" && result.lessonCount, 2);
  const rows = await rowsOf(db, learner.id);
  assert.deepEqual(rows.map((r) => [r.lesson_no, r.record_source]), [[-2, "prior_instructor"], [-1, "prior_instructor"], [1, "paper_import"], [2, "paper_import"]]);
  const [p1, p2] = rows;
  for (const p of [p1, p2]) {
    for (const k of ["start_time", "finish_time", "start_odometer", "finish_odometer", "adi_signature", "learner_signature", "taught", "location", "comments"]) assert.equal(p[k], null, k);
    assert.equal(p.signature_status, "on_paper");
    assert.equal(p.instructor_id, anna.id, "owner of the record = the learner's own instructor");
  }
  assert.deepEqual([p1.prior_instructor_label, p1.prior_lesson_count, p1.duration_minutes, p1.distance_km, p1.lesson_date], ["QA Old School", 4, 390, null, "2025-06-01"]);
  assert.deepEqual([p2.prior_instructor_label, p2.prior_lesson_count, p2.duration_minutes, p2.distance_km], ["QA ADI 358", 11, 1200, 150]);
  assert.equal(p2.achieved, "18, 19, 20, 21, 22, Review 1-17, Review 1-22");
  assert.equal(p2.competencies_assessed, p2.achieved);
  assert.equal(rows[2].instructor_id, tony.id);
  assert.equal(rows[2].prior_instructor_label, null);
  assert.equal(rows[2].prior_lesson_count, null);
  // Cumulative = running sum, prior rows first (NULL counts 0).
  assert.deepEqual(rows.map((r) => [r.cumulative_minutes, r.cumulative_km]), [[390, 0], [1590, 150], [1650, 170], [1650, 170]]);
  // Achievements → assessed/achieved competency events on the prior rows.
  const events = (await db.prepare("SELECT e.competency_id, e.action, e.result, l.lesson_no FROM competency_events e JOIN lessons l ON l.id = e.lesson_id WHERE e.learner_id = ? ORDER BY e.rowid").bind(learner.id).all<Row>()).results;
  assert.equal(events.length, 24);
  assert.ok(events.every((e) => e.action === "assessed" && e.result === "achieved" && Number(e.lesson_no) < 0));
  assert.equal((await getLearnerProgress(db, learner.id)).finalDrive23.status, "ready");
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n), 0);
});

test("lessonCount and numbering ignore prior rows; cumulative totals include them; the next App lesson is #(N+1)", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, TRANSFER_CSV, "commit");
  const totals = await getTotals(db, learner.id);
  assert.deepEqual(totals, { lessonCount: 2, totalMinutes: 1650, totalKm: 170, lastFinishOdometer: 120 });
  const lesson = await createLesson(db, learner.id, appLesson());
  assert.equal(lesson.lessonNo, 3);
  assert.equal(lesson.cumulativeMinutes, 1650 + 45);
  assert.equal(lesson.cumulativeKm, 170 + 10);
  const listed = await listLessons(db, learner.id);
  assert.deepEqual(listed.map((l) => l.lessonNo), [3, 2, 1, -1, -2]);
  assert.deepEqual(listed.slice(-2).map((l) => [l.recordSource, l.priorInstructorLabel, l.priorLessonCount]), [["prior_instructor", "QA ADI 358", 11], ["prior_instructor", "QA Old School", 4]]);
  assert.deepEqual((await listLessonsForExport(db, learner.id)).map((l) => l.lessonNo), [-2, -1, 1, 2, 3]);
});

test("prior achievements satisfy App-lesson gates: Final Drive 23 can be assessed after prior 1-22 + both reviews", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, csvOf(priorRow({ assessed_achieved: [...ALL_22_IDS, "review-1-17", "review-1-22"].join(";") })), "commit");
  assert.equal((await getTotals(db, learner.id)).lessonCount, 0);
  const lesson = await createLesson(db, learner.id, appLesson({ startOdometer: "0", finishOdometer: "10", assessedIds: ["final-drive-23"], achievedResults: { "final-drive-23": "achieved" } }));
  assert.equal(lesson.lessonNo, 1);
  assert.equal((await getLearnerProgress(db, learner.id)).completed, true);
});

test("the import guard checks for no rows at all: a learner with only prior records cannot be imported into again", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, csvOf(priorRow()), "commit");
  assert.equal((await getTotals(db, learner.id)).lessonCount, 0);
  await assert.rejects(importPaperLessons(db, learner.id, csvOf(priorRow()), "preview"), (e) => e instanceof ValidationError && e.message === "Paper records can only be imported into a learner with no lessons.");
  await assert.rejects(importPaperLessons(db, learner.id, csvOf(priorRow()), "commit"), ValidationError);
  assert.equal((await rowsOf(db, learner.id)).length, 1);
});

test("updateLesson rejects prior-instructor records and changes nothing", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, TRANSFER_CSV, "commit");
  const before = await rowsOf(db, learner.id);
  const eventsBefore = await getCompetencyEvents(db, learner.id);
  const priorId = String(before[1].id);
  await assert.rejects(
    updateLesson(db, learner.id, priorId, { lessonDate: "2025-12-02", signatureStatus: "on_paper", taughtIds: [], assessedIds: [], achievedResults: {} }),
    (e) => e instanceof ValidationError && e.message === "Prior-instructor records cannot be edited.",
  );
  assert.deepEqual(await rowsOf(db, learner.id), before);
  assert.deepEqual(await getCompetencyEvents(db, learner.id), eventsBefore);
});

test("editing lesson #1 keeps prior rows in every cumulative total and judges its gates with prior achievements", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, TRANSFER_CSV, "commit");
  await createLesson(db, learner.id, appLesson());
  const lesson1 = (await rowsOf(db, learner.id)).find((r) => r.lesson_no === 1)!;
  // Edit-time gate judged by earlier lessons, which include the prior rows (1-17 + Review 1-17 achieved there).
  assert.equal((await getProgressBeforeLesson(db, learner.id, String(lesson1.id))).review1_17.status, "achieved");
  const { lesson } = await updateLesson(db, learner.id, String(lesson1.id), {
    lessonDate: "2026-01-01", startTime: "09:00", finishTime: "11:00", startOdometer: "100", finishOdometer: "118",
    signatureStatus: "on_paper", taughtIds: [], assessedIds: ["18"], achievedResults: { "18": "not_achieved" },
  });
  assert.equal(lesson.cumulativeMinutes, 1590 + 120);
  assert.equal(lesson.cumulativeKm, 150 + 18);
  const rows = await rowsOf(db, learner.id);
  assert.deepEqual(rows.map((r) => [r.lesson_no, r.cumulative_minutes, r.cumulative_km]), [[-2, 390, 0], [-1, 1590, 150], [1, 1710, 168], [2, 1710, 168], [3, 1755, 178]]);
});

test("a later App lesson's integration payload includes prior hours/km in cumulative and prior achievements in progress (contract unchanged)", async () => {
  const { db, learner } = await setup();
  const { hooks, settle } = enabledHooks();
  await importPaperLessons(db, learner.id, TRANSFER_CSV, "commit");
  await createLesson(db, learner.id, appLesson({ taughtIds: [] }), hooks);
  await settle();
  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 1, "only the App lesson is sent; prior and paper rows never are");
  const payload = JSON.parse(rows[0].payloadJson);
  assert.equal(payload.contract_version, 1);
  assert.equal(payload.lesson.lesson_number, 3);
  assert.equal(payload.lesson.cumulative_minutes, 1695);
  assert.equal(payload.lesson.cumulative_km, 180);
  assert.equal(payload.progress.achieved_count, 22);
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});
