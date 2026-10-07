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
  getLearnerProgress,
  getLessonCompetencySelections,
  importPaperLessons,
  updateLesson,
} from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { jsonInsertStatement } from "../lib/d1-json-insert.ts";
import { CORE_COMPETENCY_IDS } from "../lib/competency.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { buildLessonUpsertedPayload } from "../lib/integration/contract.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const SIG1 = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";
const D1_FREE_PLAN_QUERY_LIMIT = 50;

type Row = Record<string, unknown>;

/** Counts every statement that reaches D1: each run/first/all, and each statement inside a batch. */
function countingD1(inner: D1Database): { db: D1Database; count: () => number; reset: () => void } {
  let statements = 0;
  class CountedStatement implements D1PreparedStatement {
    readonly inner: D1PreparedStatement;
    constructor(innerStatement: D1PreparedStatement) {
      this.inner = innerStatement;
    }
    bind(...values: unknown[]): D1PreparedStatement {
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
  return { db, count: () => statements, reset: () => { statements = 0; } };
}

/** Integration enabled; delivery attempts are collected (not run) so the request path is counted on its own. */
function deferredHooks(): { hooks: IntegrationHooks; runDeferred: () => Promise<void> } {
  const attempts: Array<() => Promise<void>> = [];
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
    schedule: (attempt) => { attempts.push(attempt); },
  };
  return { hooks, runDeferred: async () => { for (const attempt of attempts.splice(0)) await attempt(); } };
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

// ── updateLesson of lesson #1 on a 60-lesson learner, all exported ───────

test("budget: updateLesson of lesson #1 with 59 exported downstream lessons stays within 25 statements, and propagates the same events", async (t) => {
  const { db: raw, learner, tony } = await setup();
  const { hooks, runDeferred } = deferredHooks();
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
  reset();
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
  // On a deployed Worker the immediate delivery attempt runs via ctx.waitUntil in the same invocation.
  await runDeferred();
  t.diagnostic(`updateLesson + immediate delivery attempt: ${count()} statements`);
  assert.ok(count() <= D1_FREE_PLAN_QUERY_LIMIT, `updateLesson + its immediate delivery attempt issued ${count()} statements (D1 Free plan limit ${D1_FREE_PLAN_QUERY_LIMIT})`);
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
