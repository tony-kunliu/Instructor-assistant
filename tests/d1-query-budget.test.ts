// Cloudflare Workers Free plan: at most 50 D1 queries per Worker invocation,
// and every statement inside a db.batch([...]) counts. These tests wrap the
// test D1 so every prepare(...).run/first/all call and every statement inside
// batch([...]) is counted, and pin the per-request statement budget of the
// three write paths whose writes used to fan out per row (P1b Task 4b).
// They also pin that the stored results (cumulative totals, competency
// events, outbox rows and their byte-exact payload_json) are what the
// per-row implementation produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database, D1PreparedStatement, D1Result } from "../lib/d1-types.ts";
import {
  createLearner,
  createLesson,
  findInstructorByEmail,
  getCompletionSummary,
  getLearner,
  getLearnerProgress,
  getTotals,
  listLessons,
  getLessonCompetencySelections,
  importPaperLessons,
  listLearnerArchiveEvents,
  listLearners,
  markTransferRecordsChecked,
  setLearnerArchived,
  transferLearner,
  updateLearner,
  updateLesson,
} from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { jsonInsertStatement } from "../lib/d1-json-insert.ts";
import { CORE_COMPETENCY_IDS, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { finalDriveEligibleFromReminder, finalDriveFormReminders, finalDrivePanelReminder, learnerLicenceReminder, reviewGapReminder } from "../lib/rules.ts";
import { generatedEligibility, pdfEligibility } from "../lib/c23-eligibility.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { CRON_SWEEP_LIMIT, IMMEDIATE_DELIVERY_LIMIT, processDueOutbox } from "../lib/integration/sender.ts";
import { readFileSync } from "node:fs";
import { buildLessonUpsertedPayload } from "../lib/integration/contract.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const SIG1 = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";
// Workers Free plan: about 50 D1 queries + fetch subrequests per invocation.
const FREE_PLAN_INVOCATION_LIMIT = 50;
// Queries the HTTP request makes outside the repo function measured here: the
// middleware's findInstructorByEmail and the route's own reads (getTotals etc.).
const MIDDLEWARE_AND_ROUTE_QUERIES = 3;

type Row = Record<string, unknown>;

/** Counts every statement that reaches D1: each run/first/all, and each statement inside a batch. */
function countingD1(inner: D1Database): { db: D1Database; count: () => number; reset: () => void; maxBinds: () => number } {
  let statements = 0;
  let maxBound = 0;
  class CountedStatement implements D1PreparedStatement {
    readonly inner: D1PreparedStatement;
    constructor(innerStatement: D1PreparedStatement) {
      this.inner = innerStatement;
    }
    bind(...values: unknown[]): D1PreparedStatement {
      maxBound = Math.max(maxBound, values.length);
      return new CountedStatement(this.inner.bind(...values));
    }
    first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      statements++;
      return this.inner.first<T>(colName);
    }
    all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      statements++;
      return this.inner.all<T>();
    }
    run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      statements++;
      return this.inner.run<T>();
    }
  }
  const db: D1Database = {
    prepare: (query: string) => new CountedStatement(inner.prepare(query)),
    exec: (query: string) => inner.exec(query),
    batch: async <T = Record<string, unknown>>(batchStatements: D1PreparedStatement[]) => {
      statements += batchStatements.length;
      return inner.batch<T>(batchStatements.map((statement) => (statement instanceof CountedStatement ? statement.inner : statement)));
    },
  };
  return { db, count: () => statements, reset: () => { statements = 0; }, maxBinds: () => maxBound };
}

/** Integration enabled; delivery attempts are collected (not run) so the request path is counted on its own. */
function deferredHooks(): { hooks: IntegrationHooks; runDeferred: () => Promise<void>; fetches: () => number; resetFetches: () => void } {
  const attempts: Array<() => Promise<void>> = [];
  let fetches = 0;
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => { fetches++; return new Response("{}", { status: 202 }); }) as typeof fetch,
    schedule: (attempt) => { attempts.push(attempt); },
  };
  return { hooks, runDeferred: async () => { for (const attempt of attempts.splice(0)) await attempt(); }, fetches: () => fetches, resetFetches: () => { fetches = 0; } };
}

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, TONY_EMAIL))!;
  const learner = await createLearner(db, { fullName: "QA Budget Learner", instructorId: tony.id });
  return { db, learner, tony };
}

function assertInteger(value: unknown, label: string): void {
  assert.equal(typeof value, "number", `${label} must be stored as a number, got ${typeof value} (${String(value)})`);
  assert.ok(Number.isInteger(value), `${label} must be an integer, got ${String(value)}`);
}

async function lessonRows(db: D1Database, learnerId: string): Promise<Row[]> {
  return (await db.prepare("SELECT * FROM lessons WHERE learner_id = ? ORDER BY lesson_no").bind(learnerId).all<Row>()).results;
}

/** Expected running sums in lesson_no order, NULL counted as 0 — what every write path must store. */
function assertCumulativeIsRunningSum(rows: Row[]): void {
  let minutes = 0;
  let km = 0;
  for (const row of rows) {
    minutes += row.duration_minutes === null ? 0 : Number(row.duration_minutes);
    km += row.distance_km === null ? 0 : Number(row.distance_km);
    assertInteger(row.cumulative_minutes, `lesson #${row.lesson_no} cumulative_minutes`);
    assertInteger(row.cumulative_km, `lesson #${row.lesson_no} cumulative_km`);
    assert.equal(row.cumulative_minutes, minutes, `lesson #${row.lesson_no} cumulative_minutes`);
    assert.equal(row.cumulative_km, km, `lesson #${row.lesson_no} cumulative_km`);
  }
}

/**
 * Rebuilds an outbox row's payload from the stored lesson/events with the row's own event identity and
 * version, and checks the stored payload_json is byte-identical to JSON.stringify of it (exactly what the
 * per-row INSERT stored) and that the row's own columns carry the right values and types.
 */
async function assertOutboxRowMatchesLesson(db: D1Database, outbox: Row, lesson: Row, instructorName: string): Promise<LessonUpsertedPayloadV1> {
  const payload = JSON.parse(String(outbox.payload_json)) as LessonUpsertedPayloadV1;
  const selections = await getLessonCompetencySelections(db, String(lesson.id));
  const expected = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: String(lesson.learner_id),
    instructorId: String(lesson.instructor_id),
    instructorDisplayName: instructorName,
    lesson: {
      id: String(lesson.id),
      lessonNo: Number(lesson.lesson_no),
      lessonDate: String(lesson.lesson_date),
      startTime: String(lesson.start_time),
      finishTime: String(lesson.finish_time),
      durationMinutes: Number(lesson.duration_minutes),
      distanceKm: Number(lesson.distance_km),
      cumulativeMinutes: Number(lesson.cumulative_minutes),
      cumulativeKm: Number(lesson.cumulative_km),
      createdAt: String(lesson.created_at),
      updatedAt: payload.lesson.source_updated_at,
    },
    taughtIds: selections.taughtIds,
    assessedIds: selections.assessedIds,
    achievedIds: selections.assessedIds.filter((id) => selections.achievedResults[id] === "achieved"),
    progress: await getLearnerProgress(db, String(lesson.learner_id)),
    eventId: payload.event_id,
    occurredAt: payload.occurred_at,
  });
  assert.equal(outbox.payload_json, JSON.stringify(expected), `payload_json for lesson #${lesson.lesson_no} must be byte-identical`);
  assert.equal(outbox.event_id, payload.event_id);
  assert.equal(outbox.event_type, "lesson.upserted");
  assert.equal(outbox.learner_id, lesson.learner_id);
  assert.equal(outbox.lesson_id, lesson.id);
  assert.equal(outbox.source_updated_at, payload.lesson.source_updated_at);
  assert.equal(outbox.status, "pending");
  assert.equal(outbox.attempt_count, 0);
  assertInteger(outbox.attempt_count, "attempt_count");
  assert.match(String(outbox.next_attempt_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(outbox.last_error_code, null);
  assert.equal(outbox.delivered_at, null);
  return payload;
}

// ── Import commit: 60 lessons × 3 competency events ──────────────────────

function sixtyLessonCsv(): string {
  const lines = [PAPER_CSV_COLUMNS.join(",")];
  for (let i = 1; i <= 60; i++) {
    const day = new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);
    const blank = i % 5 === 0; // every 5th paper lesson has no times/odometer: NULLs must round-trip as NULL
    const minutes = 30 + (i % 3) * 15;
    const finish = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    lines.push([day, blank ? "" : "09:00", blank ? "" : finish, blank ? "" : String(i * 100), blank ? "" : String(i * 100 + (i % 7) + 5), "1;2", "", "3", `QA street ${i}`, i % 2 ? `QA, "quoted" note ${i}` : "", i % 4 ? "on_paper" : "unsigned", "Tony"].map((cell) => (/[",]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(","));
  }
  return lines.join("\n") + "\n";
}

test("budget: importPaperLessons commit of 60 lessons × 3 events stays within 15 statements, and stores the same rows", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const { db, count } = countingD1(raw);

  const result = await importPaperLessons(db, learner.id, sixtyLessonCsv(), "commit");
  const statements = count();
  assert.equal(result.mode === "commit" && result.lessonCount, 60);

  const rows = await lessonRows(raw, learner.id);
  assert.equal(rows.length, 60);
  rows.forEach((row, index) => {
    const i = index + 1;
    const blank = i % 5 === 0;
    const minutes = 30 + (i % 3) * 15;
    assert.equal(row.lesson_no, i);
    assertInteger(row.lesson_no, "lesson_no");
    assert.equal(row.learner_id, learner.id);
    assert.equal(row.instructor_id, tony.id);
    assert.equal(row.lesson_date, new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10));
    assert.equal(row.start_time, blank ? null : "09:00");
    assert.equal(row.duration_minutes, blank ? null : minutes);
    assert.equal(row.start_odometer, blank ? null : i * 100);
    assert.equal(row.finish_odometer, blank ? null : i * 100 + (i % 7) + 5);
    assert.equal(row.distance_km, blank ? null : (i % 7) + 5);
    if (!blank) for (const column of ["duration_minutes", "distance_km", "start_odometer", "finish_odometer"]) assertInteger(row[column], `lesson #${i} ${column}`);
    assert.equal(row.taught, "1, 2");
    assert.equal(row.competencies_assessed, "3");
    assert.equal(row.achieved, null);
    assert.equal(row.location, `QA street ${i}`);
    assert.equal(row.comments, i % 2 ? `QA, "quoted" note ${i}` : null);
    assert.equal(row.adi_signature, null);
    assert.equal(row.learner_signature, null);
    assert.equal(row.record_source, "paper_import");
    assert.equal(row.signature_status, i % 4 ? "on_paper" : "unsigned");
    assert.equal(row.updated_at, null);
    assert.equal(row.updated_by_instructor_id, null);
  });
  assertCumulativeIsRunningSum(rows);

  const events = (await raw.prepare("SELECT e.*, l.lesson_no FROM competency_events e JOIN lessons l ON l.id = e.lesson_id WHERE e.learner_id = ? ORDER BY l.lesson_no, e.action DESC, e.competency_id").bind(learner.id).all<Row>()).results;
  assert.equal(events.length, 180);
  assert.equal(new Set(events.map((event) => event.id)).size, 180, "every event gets its own id");
  for (let i = 0; i < 60; i++) {
    const own = events.slice(i * 3, i * 3 + 3).map((event) => [event.lesson_no, event.competency_id, event.action, event.result]);
    assert.deepEqual(own, [[i + 1, "1", "taught", null], [i + 1, "2", "taught", null], [i + 1, "3", "assessed", "not_achieved"]]);
  }
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n, 0, "paper lessons never produce outbox rows");

  t.diagnostic(`importPaperLessons commit: ${statements} statements`);
  assert.ok(statements <= 15, `importPaperLessons commit issued ${statements} statements (budget 15)`);
});

// ── Import commit with 3 prior-instructor rows + 60 lessons (spec §12) ───

/** The 60-lesson CSV with three prior-instructor rows in front (dates before 2026-01-01). */
function priorPlusSixtyLessonCsv(): string {
  const [header, ...lessons] = sixtyLessonCsv().trimEnd().split("\n");
  const prior = (date: string, label: string, count: number, hours: string, km: string, achieved: string) =>
    PAPER_CSV_COLUMNS.map((column) => ({ date, assessed_achieved: achieved, prior_instructor: label, prior_lessons: String(count), prior_hours: hours, prior_km: km } as Record<string, string>)[column] ?? "").join(",");
  return [header, prior("2025-03-01", "QA ADI 101", 3, "4.5", "", "4;5"), prior("2025-06-01", "QA ADI 202", 5, "7", "80", "6"), prior("2025-09-01", "QA ADI 303", 2, "2.5", "31", ""), ...lessons].join("\n") + "\n";
}

test("budget: importPaperLessons commit of 3 prior rows + 60 lessons stays within 15 statements, prior rows first in cumulative", async (t) => {
  const { db: raw, learner } = await setup();
  const { db, count } = countingD1(raw);

  const result = await importPaperLessons(db, learner.id, priorPlusSixtyLessonCsv(), "commit");
  const statements = count();
  assert.equal(result.mode === "commit" && result.lessonCount, 60);

  const rows = await lessonRows(raw, learner.id);
  assert.equal(rows.length, 63);
  assert.deepEqual(rows.slice(0, 4).map((row) => [row.lesson_no, row.record_source, row.prior_instructor_label, row.prior_lesson_count, row.duration_minutes, row.distance_km]), [
    [-3, "prior_instructor", "QA ADI 101", 3, 270, null],
    [-2, "prior_instructor", "QA ADI 202", 5, 420, 80],
    [-1, "prior_instructor", "QA ADI 303", 2, 150, 31],
    [1, "paper_import", null, null, 30 + 15, 1 + 5],
  ]);
  for (const row of rows.slice(0, 3)) {
    for (const column of ["lesson_no", "prior_lesson_count", "duration_minutes", "cumulative_minutes", "cumulative_km"]) assertInteger(row[column], `prior ${column}`);
  }
  assertCumulativeIsRunningSum(rows);
  assert.equal(rows[3].cumulative_minutes, 840 + 45, "lesson #1 cumulative starts from the prior hours");
  const priorEvents = (await raw.prepare("SELECT e.competency_id, e.action, e.result FROM competency_events e JOIN lessons l ON l.id = e.lesson_id WHERE l.lesson_no < 0 ORDER BY e.rowid").all<Row>()).results;
  assert.deepEqual(priorEvents.map((event) => [event.competency_id, event.action, event.result]), [["4", "assessed", "achieved"], ["5", "assessed", "achieved"], ["6", "assessed", "achieved"]]);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM competency_events").first<{ n: number }>())?.n, 183);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n, 0, "prior and paper rows never produce outbox rows");

  t.diagnostic(`importPaperLessons commit (3 prior + 60 lessons): ${statements} statements`);
  assert.ok(statements <= 15, `importPaperLessons commit issued ${statements} statements (budget 15)`);
});

// ── updateLesson of lesson #1 with prior rows: SQL cumulative = payload cumulative ─

test("consistency: editing lesson #1 on a learner with prior rows stores the same cumulative values the outbox payloads carry, within budget", async (t) => {
  const { db: raw, learner } = await setup();
  const { hooks, runDeferred } = deferredHooks();
  // 3 prior rows (840 min / 111 km) and no paper lessons, then 10 exported App lessons.
  const priorOnly = priorPlusSixtyLessonCsv().split("\n").slice(0, 4).join("\n") + "\n";
  await importPaperLessons(raw, learner.id, priorOnly, "commit");
  for (let i = 1; i <= 10; i++) {
    await createLesson(raw, learner.id, {
      lessonDate: new Date(Date.UTC(2026, 1, 1) + i * 86_400_000).toISOString().slice(0, 10),
      startTime: "09:00", finishTime: i % 2 ? "09:30" : "10:15",
      startOdometer: String(i * 100), finishOdometer: String(i * 100 + i + 4),
      taughtIds: [CORE_COMPETENCY_IDS[(i % 3) + 6]], adiSignature: SIG1, learnerSignature: SIG1,
    }, hooks);
  }
  await runDeferred();
  await raw.prepare("UPDATE integration_outbox SET status = 'delivered', attempt_count = 1, delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
  const maxRowidBefore = Number((await raw.prepare("SELECT MAX(rowid) AS m FROM integration_outbox").first<{ m: number }>())?.m);
  const lesson1 = (await lessonRows(raw, learner.id)).find((row) => row.lesson_no === 1)!;
  assert.equal(lesson1.cumulative_minutes, 840 + 30, "createLesson already counted the prior rows");

  const { db, count } = countingD1(raw);
  await updateLesson(db, learner.id, String(lesson1.id), {
    lessonDate: String(lesson1.lesson_date), startTime: "09:00", finishTime: "11:00", startOdometer: "100", finishOdometer: "150",
    taughtIds: [CORE_COMPETENCY_IDS[7]], adiSignature: SIG2, learnerSignature: SIG2,
  }, hooks);
  const statements = count();

  const rows = await lessonRows(raw, learner.id);
  assert.deepEqual(rows.slice(0, 3).map((row) => [row.lesson_no, row.cumulative_minutes, row.cumulative_km]), [[-3, 270, 0], [-2, 690, 80], [-1, 840, 111]], "prior rows untouched");
  assertCumulativeIsRunningSum(rows);
  assert.equal(rows[3].cumulative_minutes, 840 + 120);
  assert.equal(rows[3].cumulative_km, 111 + 50);

  const newOutbox = (await raw.prepare("SELECT lesson_id, payload_json FROM integration_outbox WHERE rowid > ? ORDER BY rowid").bind(maxRowidBefore).all<Row>()).results;
  const appRows = rows.filter((row) => Number(row.lesson_no) > 0);
  assert.deepEqual(newOutbox.map((row) => row.lesson_id), appRows.map((row) => row.id), "direct event + every exported downstream lesson; never a prior row");
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const outbox of newOutbox) {
    const payload = JSON.parse(String(outbox.payload_json)) as LessonUpsertedPayloadV1;
    const stored = byId.get(String(outbox.lesson_id))!;
    assert.equal(payload.lesson.cumulative_minutes, stored.cumulative_minutes, `lesson #${stored.lesson_no}: SQL cumulative_minutes = payload`);
    assert.equal(payload.lesson.cumulative_km, stored.cumulative_km, `lesson #${stored.lesson_no}: SQL cumulative_km = payload`);
  }

  t.diagnostic(`updateLesson #1 with 3 prior rows + 9 exported downstream: ${statements} statements`);
  assert.ok(statements <= 25, `updateLesson issued ${statements} statements (budget 25)`);
});

// ── updateLesson of lesson #1 on a 60-lesson learner, all exported ───────

test("budget: updateLesson of lesson #1 with 59 exported downstream lessons stays within 25 statements, and propagates the same events", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const { hooks, runDeferred, fetches, resetFetches } = deferredHooks();
  for (let i = 1; i <= 60; i++) {
    const minutes = 30 + (i % 3) * 15;
    await createLesson(raw, learner.id, {
      lessonDate: new Date(Date.UTC(2026, 1, 1) + i * 86_400_000).toISOString().slice(0, 10),
      startTime: "09:00",
      finishTime: `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
      startOdometer: String(i * 100),
      finishOdometer: String(i * 100 + (i % 7) + 5),
      taughtIds: [CORE_COMPETENCY_IDS[i % 5]],
      assessedIds: i % 2 ? ["6"] : [],
      achievedResults: i % 2 ? { "6": "not_achieved" } : {},
      adiSignature: SIG1,
      learnerSignature: SIG1,
    }, hooks);
  }
  // Every lesson was exported and delivered before the edit.
  await raw.prepare("UPDATE integration_outbox SET status = 'delivered', attempt_count = 1, delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
  const previous = new Map((await raw.prepare("SELECT lesson_id, source_updated_at FROM integration_outbox").all<Row>()).results.map((row) => [String(row.lesson_id), String(row.source_updated_at)]));
  const maxRowidBefore = Number((await raw.prepare("SELECT MAX(rowid) AS m FROM integration_outbox").first<{ m: number }>())?.m);
  const [lesson1] = await lessonRows(raw, learner.id);

  const { db, count, reset } = countingD1(raw);
  await runDeferred(); // creates' own delivery attempts are not part of the measured request
  // Those attempts (5 rows each) left create events pending; mark them delivered so only the edit's 60 are due.
  await raw.prepare("UPDATE integration_outbox SET status = 'delivered', attempt_count = 1, delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'pending'").run();
  reset();
  resetFetches();
  await updateLesson(db, learner.id, String(lesson1.id), {
    lessonDate: String(lesson1.lesson_date),
    startTime: "09:00",
    finishTime: "11:15",
    startOdometer: "100",
    finishOdometer: "140",
    taughtIds: [CORE_COMPETENCY_IDS[1]],
    assessedIds: ["6"],
    achievedResults: { "6": "not_achieved" },
    adiSignature: SIG2,
    learnerSignature: SIG2,
  }, hooks);
  const requestStatements = count();

  const rows = await lessonRows(raw, learner.id);
  assert.equal(rows[0].duration_minutes, 135);
  assert.equal(rows[0].distance_km, 40);
  assertCumulativeIsRunningSum(rows);

  const newOutbox = (await raw.prepare("SELECT * FROM integration_outbox WHERE rowid > ? ORDER BY rowid").bind(maxRowidBefore).all<Row>()).results;
  assert.equal(newOutbox.length, 60, "the direct edit's own event + one propagated event per exported downstream lesson");
  assert.deepEqual(newOutbox.map((row) => row.lesson_id), rows.map((row) => row.id), "direct event first, then downstream in lesson_no order");
  assert.equal(new Set(newOutbox.map((row) => row.event_id)).size, 60);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const outbox of newOutbox) {
    const lesson = byId.get(String(outbox.lesson_id))!;
    const payload = await assertOutboxRowMatchesLesson(raw, outbox, lesson, tony.fullName);
    assert.ok(new Date(payload.lesson.source_updated_at).getTime() > new Date(previous.get(String(lesson.id))!).getTime(), `lesson #${lesson.lesson_no} source_updated_at must be strictly newer`);
  }
  assert.equal(JSON.parse(String(newOutbox[59].payload_json)).lesson.cumulative_minutes, rows[59].cumulative_minutes);

  t.diagnostic(`updateLesson: ${requestStatements} statements`);
  assert.ok(requestStatements <= 25, `updateLesson issued ${requestStatements} statements (budget 25)`);
  // On a deployed Worker the immediate delivery attempt runs via ctx.waitUntil in the same invocation:
  // 60 rows are due, but only IMMEDIATE_DELIVERY_LIMIT are attempted (1 SELECT + 5 fetches + 5 UPDATEs);
  // the rest stay pending for the Cron sweep.
  assert.equal(fetches(), 0);
  reset();
  await runDeferred();
  const deliveryStatements = count();
  assert.equal(IMMEDIATE_DELIVERY_LIMIT, 5);
  assert.equal(fetches(), IMMEDIATE_DELIVERY_LIMIT, "only 5 webhook fetches");
  assert.equal(deliveryStatements, 1 + IMMEDIATE_DELIVERY_LIMIT, "1 due-rows SELECT + 5 mark-delivered UPDATEs");
  const newStatuses = (await raw.prepare("SELECT status, COUNT(*) AS n FROM integration_outbox WHERE rowid > ? GROUP BY status ORDER BY status").bind(maxRowidBefore).all<Row>()).results;
  assert.deepEqual(newStatuses.map((row) => [row.status, row.n]), [["delivered", 5], ["pending", 55]]);
  const invocationTotal = requestStatements + deliveryStatements + fetches() + MIDDLEWARE_AND_ROUTE_QUERIES;
  t.diagnostic(`updateLesson + immediate delivery + middleware/route: ${requestStatements} + ${deliveryStatements} D1 + ${fetches()} fetch + ${MIDDLEWARE_AND_ROUTE_QUERIES} = ${invocationTotal}`);
  assert.ok(invocationTotal <= FREE_PLAN_INVOCATION_LIMIT, `edit invocation total ${invocationTotal} (Free plan limit ${FREE_PLAN_INVOCATION_LIMIT})`);
});

// ── Ownership + revision (migration 0007): the revision is ONE statement in the edit's atomic batch ──

test("budget: an edit's revision is ONE INSERT...SELECT (+1 statement; signed in as the owner adds only the acting-instructor lookup on top), stays within 25, and binds <= 100 parameters", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const { hooks } = deferredHooks();
  for (let i = 1; i <= 10; i++) {
    await createLesson(raw, learner.id, {
      lessonDate: new Date(Date.UTC(2026, 1, 1) + i * 86_400_000).toISOString().slice(0, 10),
      startTime: "09:00", finishTime: "09:30", startOdometer: String(i * 100), finishOdometer: String(i * 100 + 5),
      taughtIds: [CORE_COMPETENCY_IDS[i % 5]], adiSignature: SIG1, learnerSignature: SIG1,
    }, hooks);
  }
  await raw.prepare("UPDATE integration_outbox SET status = 'delivered', attempt_count = 1, delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
  const [lesson1] = await lessonRows(raw, learner.id);
  const editInput = (i: number, extra: Record<string, unknown>) => ({
    lessonDate: String(lesson1.lesson_date), startTime: "09:00", finishTime: `10:${String(10 + i)}`, startOdometer: "100", finishOdometer: "150",
    taughtIds: [CORE_COMPETENCY_IDS[1]], adiSignature: i % 2 ? SIG2 : SIG1, learnerSignature: i % 2 ? SIG2 : SIG1, ...extra,
  });
  const anonymous = countingD1(raw);
  await updateLesson(anonymous.db, learner.id, String(lesson1.id), editInput(1, {}), hooks);
  const withoutActor = anonymous.count();
  const signedIn = countingD1(raw);
  await updateLesson(signedIn.db, learner.id, String(lesson1.id), editInput(2, { actingInstructorId: tony.id, reason: "QA reason" }), hooks);
  const withActor = signedIn.count();

  t.diagnostic(`updateLesson #1 with 9 exported downstream: ${withoutActor} statements without an acting instructor, ${withActor} signed in as the owner`);
  assert.equal(withActor, withoutActor + 1, "signed-in adds only the acting-instructor lookup; the revision INSERT is in both (always written)");
  assert.ok(withActor <= 25, `updateLesson issued ${withActor} statements (budget 25)`);
  assert.ok(signedIn.maxBinds() <= 100, `max bound parameters ${signedIn.maxBinds()} (D1 limit 100)`);
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM lesson_revisions WHERE lesson_id = ?").bind(lesson1.id).first<{ n: number }>())?.n), 2);
});

// ── Learner edit (migration 0008, learner management Phase 1 / L6) ──

test("budget: a learner edit is 5 statements (learner, actor, batch of revision + update, re-read), a no-op 2, binds <= 100", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const all = {
    fullName: "QA Budget Renamed", address: "1 QA St", phone: "0400 000 000", dob: "2008-01-02", licenceNumber: "QA1", licenceExpiry: "2027-01-02",
    eligibility: "Eligible", transmission: "auto", schoolWork: "QA", licenceStage: "p1", actingInstructorId: tony.id,
  };
  const edit = countingD1(raw);
  await updateLearner(edit.db, learner.id, all);
  const editStatements = edit.count();
  const noop = countingD1(raw);
  const result = await updateLearner(noop.db, learner.id, all);
  assert.equal(result.changed, false);
  const noopStatements = noop.count();
  const invocationTotal = editStatements + MIDDLEWARE_AND_ROUTE_QUERIES;
  t.diagnostic(`updateLearner (all 10 fields): ${editStatements} statements, no-op: ${noopStatements}, + middleware lookup = ${invocationTotal}, max bound params ${edit.maxBinds()}`);
  assert.equal(editStatements, 5);
  assert.equal(noopStatements, 2);
  assert.ok(invocationTotal <= FREE_PLAN_INVOCATION_LIMIT, `learner edit invocation total ${invocationTotal} (Free plan limit ${FREE_PLAN_INVOCATION_LIMIT})`);
  assert.ok(edit.maxBinds() <= 100, `max bound parameters ${edit.maxBinds()} (D1 limit 100)`);
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM learner_revisions").first<{ n: number }>())?.n), 1);
});

test("budget (migration 0009): a learner edit and a create with all 15 fields, incl. the 5 Competency 23 fields, keep 5 / 2 / 3 statements (edit / no-op / create), bind <= 100, enqueue nothing for ACTGDS", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const outboxBefore = Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n);
  const all = {
    fullName: "QA Budget Renamed 2", address: "1 QA St", phone: "0400 000 000", dob: "2008-01-02", licenceNumber: "QA1", licenceExpiry: "2027-01-02",
    eligibility: "Eligible", transmission: "auto", schoolWork: "QA", licenceStage: "p1",
    learnerLicenceIssuedOn: "2025-11-15", learnerLicenceFirstIssuedOn: "2024-05-01", hptPassedOn: "2026-05-05", loggedHours: 82, loggedHoursOn: "2026-10-03",
    actingInstructorId: tony.id,
  };
  const edit = countingD1(raw);
  const result = await updateLearner(edit.db, learner.id, all, new Date("2026-10-09T02:00:00Z"));
  assert.equal(result.changedFields.length, 15);
  const noop = countingD1(raw);
  assert.equal((await updateLearner(noop.db, learner.id, all, new Date("2026-10-09T02:00:00Z"))).changed, false);
  const create = countingD1(raw);
  await createLearner(create.db, { ...all, fullName: "QA Budget Created", instructorId: tony.id }, new Date("2026-10-09T02:00:00Z"));
  t.diagnostic(`updateLearner (all 15 fields): ${edit.count()} statements, max bound params ${edit.maxBinds()}; no-op: ${noop.count()}; createLearner (all fields): ${create.count()} statements incl. instructor check, max bound params ${create.maxBinds()}`);
  assert.equal(edit.count(), 5);
  assert.equal(noop.count(), 2);
  assert.ok(edit.maxBinds() <= 100 && create.maxBinds() <= 100, `max bound parameters edit ${edit.maxBinds()}, create ${create.maxBinds()} (D1 limit 100)`);
  assert.equal(edit.maxBinds(), 16, "the UPDATE binds 15 columns + the id");
  assert.equal(create.maxBinds(), 16, "the INSERT binds 16 values");
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n), outboxBefore, "a learner edit/create enqueues no ACTGDS event");
});

test("budget (learner intake P1): the Eligibility auto-fill rides in the normal learner save (edit 5, create 3 statements); 'eligible from' and the PDF value add 0", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const dates = { dob: "2008-05-06", licenceExpiry: "2030-11-15", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null };
  const generated = generatedEligibility(dates);
  assert.equal(generated, "C23 from ~2026-11-15");
  const edit = countingD1(raw);
  const result = await updateLearner(edit.db, learner.id, { ...dates, eligibility: generated, actingInstructorId: tony.id }, new Date("2026-10-11T02:00:00Z"));
  assert.equal(result.learner.eligibility, generated);
  const create = countingD1(raw);
  await createLearner(create.db, { ...dates, eligibility: generated, fullName: "QA Budget Auto Elig", instructorId: tony.id }, new Date("2026-10-11T02:00:00Z"));
  const read = countingD1(raw);
  const stored = (await getLearner(read.db, learner.id))!;
  const reads = read.count();
  finalDriveEligibleFromReminder(stored, "2026-10-11");
  pdfEligibility(stored);
  t.diagnostic(`learner edit with the auto-filled Eligibility: ${edit.count()} statements (max binds ${edit.maxBinds()}); create: ${create.count()} (max binds ${create.maxBinds()}); eligible-from + PDF value: ${read.count() - reads} extra`);
  assert.equal(edit.count(), 5);
  assert.equal(create.count(), 3);
  assert.equal(read.count(), reads, "eligible-from and the PDF value must not touch D1");
});

// ── Archive reason + restore history (migration 0010, learner management Phase 3b) ──

test("budget (migration 0010): archive with/without a reason and restore are 3 statements each (batch of event INSERT + UPDATE, re-read); repeats too; list and getLearner stay 1, history 1; binds <= 100; nothing enqueued", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const outboxBefore = Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n);
  const archive = countingD1(raw);
  await setLearnerArchived(archive.db, learner.id, true, { reason: "moved_away", note: "QA note", actingInstructorId: tony.id });
  const again = countingD1(raw);
  await setLearnerArchived(again.db, learner.id, true, { reason: "stopped" });
  const list = countingD1(raw);
  const archivedList = await listLearners(list.db, { archived: true });
  assert.equal(archivedList[0].archiveReason, "moved_away");
  const get = countingD1(raw);
  await getLearner(get.db, learner.id);
  const history = countingD1(raw);
  assert.equal((await listLearnerArchiveEvents(history.db, learner.id)).length, 1);
  const restore = countingD1(raw);
  await setLearnerArchived(restore.db, learner.id, false, { actingInstructorId: tony.id });
  const plain = countingD1(raw);
  await setLearnerArchived(plain.db, learner.id, true);
  t.diagnostic(`archive (reason+note): ${archive.count()} statements, max binds ${archive.maxBinds()}; repeat archive: ${again.count()}; restore: ${restore.count()}; archive without reason: ${plain.count()}; list: ${list.count()}; getLearner: ${get.count()}; history: ${history.count()}`);
  assert.equal(archive.count(), 3);
  assert.equal(again.count(), 3);
  assert.equal(restore.count(), 3);
  assert.equal(plain.count(), 3);
  assert.equal(list.count(), 1, "the list endpoint gains no D1 query for the reason");
  assert.equal(get.count(), 1);
  assert.equal(history.count(), 1);
  assert.equal(archive.maxBinds(), 8, "the event INSERT binds 8 values");
  assert.ok(archive.count() + MIDDLEWARE_AND_ROUTE_QUERIES <= FREE_PLAN_INVOCATION_LIMIT);
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM learner_archive_events").first<{ n: number }>())?.n), 3);
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n), outboxBefore, "archive/restore enqueue nothing for ACTGDS");
});

// ── Learner transfer (migration 0011, learner management 3c T1) ──

test("budget (migration 0011): transfer is 6 statements (actor, target, learner, batch of event INSERT + UPDATE, re-read), also when it loses the race; Checked is 3; list and getLearner stay 1; binds <= 100; nothing enqueued", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const anna = (await findInstructorByEmail(raw, "yapingqu.work@gmail.com"))!;
  const outboxBefore = Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n);
  const transfer = countingD1(raw);
  await transferLearner(transfer.db, learner.id, { toInstructorId: anna.id, note: "QA note", actingInstructorId: tony.id });
  const lost = countingD1(raw);
  await assert.rejects(() => transferLearner(lost.db, learner.id, { toInstructorId: anna.id, actingInstructorId: anna.id }), /already belongs to Anna/);
  const checked = countingD1(raw);
  await markTransferRecordsChecked(checked.db, learner.id, { actingInstructorId: anna.id });
  const list = countingD1(raw);
  assert.equal((await listLearners(list.db)).find((l) => l.id === learner.id)?.transfers.length, 1);
  const get = countingD1(raw);
  await getLearner(get.db, learner.id);
  // A transfer whose compare-and-set loses (simulated: the learner already moved between the reads and the batch).
  const raced = countingD1(raw);
  const racing = { ...raced.db, batch: async (statements: Parameters<D1Database["batch"]>[0]) => { await raw.prepare("UPDATE learners SET instructor_id = ? WHERE id = ?").bind(tony.id, learner.id).run(); return raced.db.batch(statements); } } as D1Database;
  await raw.prepare("UPDATE learners SET instructor_id = ? WHERE id = ?").bind(anna.id, learner.id).run();
  await assert.rejects(() => transferLearner(racing, learner.id, { toInstructorId: tony.id, actingInstructorId: anna.id }), /by someone else|already belongs/);
  t.diagnostic(`transfer: ${transfer.count()} statements, max binds ${transfer.maxBinds()}; lost race: ${raced.count()}; rejected early: ${lost.count()}; checked: ${checked.count()} (max binds ${checked.maxBinds()}); list: ${list.count()}; getLearner: ${get.count()}`);
  assert.equal(transfer.count(), 6);
  assert.equal(raced.count(), 6);
  assert.equal(checked.count(), 3);
  assert.equal(list.count(), 1, "the list endpoint gains no D1 query for transfers");
  assert.equal(get.count(), 1);
  assert.equal(transfer.maxBinds(), 8, "the event INSERT binds 8 values");
  assert.equal(checked.maxBinds(), 6);
  assert.ok(transfer.count() + MIDDLEWARE_AND_ROUTE_QUERIES <= FREE_PLAN_INVOCATION_LIMIT);
  assert.equal(Number((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox").first<{ n: number }>())?.n), outboxBefore, "a transfer / Checked enqueues nothing for ACTGDS");
});

// ── createLesson assessing 22 competencies ──────────────────────────────

test("budget: createLesson assessing 22 competencies stays within 20 statements, and stores the same rows", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const { hooks, runDeferred } = deferredHooks();
  const core17 = CORE_COMPETENCY_IDS.slice(0, 17);
  const base = { startTime: "09:00", finishTime: "10:00", adiSignature: SIG1, learnerSignature: SIG1 };
  await createLesson(raw, learner.id, { ...base, lessonDate: "2026-03-01", startOdometer: "0", finishOdometer: "10", assessedIds: core17, achievedResults: Object.fromEntries(core17.map((id) => [id, "achieved"])) }, hooks);
  await createLesson(raw, learner.id, { ...base, lessonDate: "2026-03-02", startOdometer: "10", finishOdometer: "25", assessedIds: ["review-1-17"], achievedResults: { "review-1-17": "achieved" } }, hooks);
  await runDeferred();

  const assessed = [...CORE_COMPETENCY_IDS];
  assert.equal(assessed.length, 22);
  const results = Object.fromEntries(assessed.map((id, index) => [id, index % 4 ? "achieved" : "not_achieved"]));
  const { db, count } = countingD1(raw);
  const lesson = await createLesson(db, learner.id, { ...base, finishTime: "10:45", lessonDate: "2026-03-03", startOdometer: "25", finishOdometer: "61", assessedIds: assessed, achievedResults: results, location: "QA place" }, hooks);
  const statements = count();

  const rows = await lessonRows(raw, learner.id);
  assert.equal(rows.length, 3);
  assertCumulativeIsRunningSum(rows);
  assert.equal(lesson.cumulativeMinutes, 225);
  assert.equal(lesson.cumulativeKm, 61);
  const events = (await raw.prepare("SELECT * FROM competency_events WHERE lesson_id = ? ORDER BY rowid").bind(lesson.id).all<Row>()).results;
  assert.deepEqual(events.map((event) => [event.learner_id, event.competency_id, event.action, event.result]), assessed.map((id) => [learner.id, id, "assessed", results[id]]));
  assert.equal(new Set(events.map((event) => event.id)).size, 22);
  assert.ok(events.every((event) => typeof event.created_at === "string" && event.created_at !== ""));
  const outbox = (await raw.prepare("SELECT * FROM integration_outbox WHERE lesson_id = ?").bind(lesson.id).all<Row>()).results;
  assert.equal(outbox.length, 1);
  const payload = await assertOutboxRowMatchesLesson(raw, outbox[0], rows[2], tony.fullName);
  assert.deepEqual(payload.lesson.assessed, assessed);
  assert.equal(payload.lesson.cumulative_minutes, 225);

  t.diagnostic(`createLesson: ${statements} statements`);
  assert.ok(statements <= 20, `createLesson issued ${statements} statements (budget 20)`);
});

// ── Assessment-rules reminders (T1): pure client computation, zero D1 statements ──

test("budget: the rules reminders add 0 D1 statements (the learner GET reads are the same 4 (5 once completed), reminders run on their result)", async (t) => {
  const { db: raw, learner } = await setup();
  const base = { startTime: "09:00", finishTime: "10:00", adiSignature: SIG1, learnerSignature: SIG1 };
  const core17 = CORE_COMPETENCY_IDS.slice(0, 17);
  await createLesson(raw, learner.id, { ...base, lessonDate: "2026-03-01", startOdometer: "0", finishOdometer: "10", assessedIds: core17, achievedResults: Object.fromEntries(core17.map((id) => [id, "achieved"])) });
  const { db, count } = countingD1(raw);
  // Mirrors GET /api/learners/[id]: the completion summary comes from the same derived progress, and
  // costs no statement while the learner is not completed (1 when completed): 4 reads here, at most 5.
  const [detailLearner, , lessons, progress] = await Promise.all([getLearner(db, learner.id), getTotals(db, learner.id), listLessons(db, learner.id), getLearnerProgress(db, learner.id)]);
  await getCompletionSummary(db, learner.id, progress);
  const reads = count();
  const now = new Date("2026-10-09T01:00:00Z");
  reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now }, where: "panel" });
  reviewGapReminder({ review: REVIEW_1_22, progress, lessons, moment: { kind: "draft", date: "2026-10-09", startTime: "09:00" }, where: "form" });
  finalDrivePanelReminder(now);
  finalDriveFormReminders({ date: "2026-10-09", startTime: "09:00", finishTime: "10:00" });
  learnerLicenceReminder(detailLearner!, "2026-10-09");
  t.diagnostic(`learner GET reads: ${reads} statements; after computing every reminder: ${count()}`);
  assert.equal(reads, 4);
  assert.equal(count(), reads, "the reminders must not touch D1");
});

// ── jsonInsertStatement: types and guards ────────────────────────────────

test("jsonInsertStatement round-trips integers, NULLs and exact strings, keeps row order, and refuses non-constant identifiers", async () => {
  const raw = openTestD1(":memory:");
  await raw.exec("CREATE TABLE t (n INTEGER, s TEXT, z TEXT)");
  const tricky = `QA "quoted", back\\slash, ünïcode ✓, 'single', $.path, {"json":[1]}`;
  const rows = [
    { n: 0, s: tricky, z: null },
    { n: -7, s: "", z: "123" },
    { n: 9_007_199_254_740_991, s: "2026-01-01", z: null },
  ];
  await jsonInsertStatement(raw, "t", ["n", "s", "z"], rows)!.run();
  const stored = (await raw.prepare("SELECT n, s, z, typeof(n) AS tn, typeof(z) AS tz FROM t ORDER BY rowid").all<Row>()).results;
  assert.deepEqual(stored.map((row) => [row.n, row.s, row.z]), rows.map((row) => [row.n, row.s, row.z]));
  assert.deepEqual(stored.map((row) => [row.tn, row.tz]), [["integer", "null"], ["integer", "text"], ["integer", "null"]]);

  assert.equal(jsonInsertStatement(raw, "t", ["n"], []), null);
  assert.throws(() => jsonInsertStatement(raw, "t; DROP TABLE t", ["n"], [{ n: 1 }]), /invalid identifier/);
  assert.throws(() => jsonInsertStatement(raw, "t", ["n'"], [{ "n'": 1 }]), /invalid identifier/);
  assert.throws(() => jsonInsertStatement(raw, "t", ["n", "s"], [{ n: 1 }]), /missing column s/);
});

test("jsonInsertStatement stores a lone surrogate as U+FFFD, exactly like a directly bound value", async () => {
  const raw = openTestD1(":memory:");
  await raw.exec("CREATE TABLE t (s TEXT)");
  const lone = "QA a\uD800b \uDC00c";
  await raw.prepare("INSERT INTO t (s) VALUES (?)").bind(lone).run();
  await jsonInsertStatement(raw, "t", ["s"], [{ s: lone }])!.run();
  const [direct, viaJson] = (await raw.prepare("SELECT s, hex(s) AS h FROM t ORDER BY rowid").all<Row>()).results;
  assert.equal(viaJson.s, "QA a\uFFFDb \uFFFDc");
  assert.equal(viaJson.h, direct.h, "byte-identical to the directly bound value");
});

// ── Cron sweep cap ──────────────────────────────────────────────────────

test("the Cron sweep processes at most 24 due rows per invocation (1 SELECT + 24 × (fetch + UPDATE) = 49)", async () => {
  const { db: raw, learner } = await setup();
  const { hooks } = deferredHooks();
  for (let i = 1; i <= 30; i++) {
    await createLesson(raw, learner.id, { lessonDate: "2026-04-01", startTime: "09:00", finishTime: "09:30", startOdometer: String(i * 10), finishOdometer: String(i * 10 + 5), taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  }
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox WHERE status = 'pending'").first<{ n: number }>())?.n, 30);
  let fetches = 0;
  const fetchImpl = (async () => { fetches++; return new Response("{}", { status: 202 }); }) as typeof fetch;
  const { db, count } = countingD1(raw);

  // worker/scheduled-entry.ts must pass the cap explicitly (it can't be imported here: it needs the OpenNext build).
  assert.match(readFileSync(new URL("../worker/scheduled-entry.ts", import.meta.url), "utf8"), /processDueOutbox\(env\.DB, config, fetch, new Date\(\), CRON_SWEEP_LIMIT\)/);
  assert.equal(CRON_SWEEP_LIMIT, 24);
  await processDueOutbox(db, hooks.config, fetchImpl, new Date(Date.now() + 60_000), CRON_SWEEP_LIMIT);
  assert.equal(fetches, 24);
  assert.equal(count(), 1 + 24);
  assert.ok(fetches + count() <= FREE_PLAN_INVOCATION_LIMIT);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM integration_outbox WHERE status = 'pending'").first<{ n: number }>())?.n, 6);

  // The default limit is the sweep cap too.
  fetches = 0;
  await processDueOutbox(raw, hooks.config, fetchImpl, new Date(Date.now() + 60_000));
  assert.equal(fetches, 6);
});

// ── Derived milestone validity + completion summary (progress-invalidation fix): no new D1 statement ──

test("budget: an edit that invalidates Review 1-22 / Final Drive / Completed stays within 25 statements, and the learner GET of a completed learner is 5 reads (4 once completion is invalid)", async (t) => {
  const { db: raw, learner } = await setup();
  const { hooks } = deferredHooks();
  const range = (a: number, b: number) => CORE_COMPETENCY_IDS.slice(a - 1, b);
  const steps = [range(1, 17), [REVIEW_1_17], range(18, 22), [REVIEW_1_22], ["final-drive-23"]];
  for (const [i, ids] of steps.entries()) {
    await createLesson(raw, learner.id, {
      lessonDate: "2026-03-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(i * 10), finishOdometer: String(i * 10 + 5),
      assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])), adiSignature: SIG1, learnerSignature: SIG1,
    }, hooks);
  }
  const getReads = async () => {
    const { db, count } = countingD1(raw);
    const [, , , progress] = await Promise.all([getLearner(db, learner.id), getTotals(db, learner.id), listLessons(db, learner.id), getLearnerProgress(db, learner.id)]);
    const completion = await getCompletionSummary(db, learner.id, progress);
    return { reads: count(), completion };
  };
  const completedGet = await getReads();
  assert.equal(completedGet.reads, 5);
  assert.equal(completedGet.completion?.completingLessonNo, 5);

  const lesson3 = (await lessonRows(raw, learner.id))[2];
  const { db, count } = countingD1(raw);
  const result = await updateLesson(db, learner.id, String(lesson3.id), {
    lessonDate: "2026-03-01", startTime: "09:00", finishTime: "10:00", startOdometer: "20", finishOdometer: "25",
    assessedIds: range(18, 22), achievedResults: { ...Object.fromEntries(range(18, 21).map((id) => [id, "achieved"])), "22": "not_achieved" }, adiSignature: SIG2, learnerSignature: SIG2,
  }, hooks);
  const editStatements = count();
  assert.equal(result.invalidated.completed, true);
  assert.equal(result.completion, null);
  const invalidGet = await getReads();
  t.diagnostic(`invalidating edit: ${editStatements} statements; learner GET: ${completedGet.reads} reads while completed, ${invalidGet.reads} after`);
  assert.ok(editStatements <= 25, `updateLesson issued ${editStatements} statements (budget 25)`);
  assert.equal(invalidGet.reads, 4);
  assert.equal(invalidGet.completion, null);
});
