// Learner list cards (UI redesign 2026-10-12): the ONE set-based D1 query behind the per-learner card data
// (lib/repo.ts#listLearnerSummaries). It must give exactly what the learner's own detail screen derives
// (getTotals + getLearnerProgress), for every learner, with one statement and no per-learner query.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database, D1PreparedStatement, D1Result } from "../lib/d1-types.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, getTotals, importPaperLessons, listLearners, listLearnerSummaries, setLearnerArchived, updateLesson } from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { CORE_COMPETENCY_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { summaryFromProgress } from "../lib/learner-card.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";
const range = (a: number, b: number) => CORE_COMPETENCY_IDS.slice(a - 1, b);
const ach = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => Object.fromEntries(ids.map((id) => [id, result]));

function countingD1(inner: D1Database): { db: D1Database; count: () => number; maxBinds: () => number } {
  let statements = 0;
  let maxBound = 0;
  class Counted implements D1PreparedStatement {
    readonly inner: D1PreparedStatement;
    constructor(innerStatement: D1PreparedStatement) { this.inner = innerStatement; }
    bind(...values: unknown[]): D1PreparedStatement { maxBound = Math.max(maxBound, values.length); return new Counted(this.inner.bind(...values)); }
    first<T = Record<string, unknown>>(colName?: string): Promise<T | null> { statements++; return this.inner.first<T>(colName); }
    all<T = Record<string, unknown>>(): Promise<D1Result<T>> { statements++; return this.inner.all<T>(); }
    run<T = Record<string, unknown>>(): Promise<D1Result<T>> { statements++; return this.inner.run<T>(); }
  }
  const db: D1Database = {
    prepare: (query: string) => new Counted(inner.prepare(query)),
    exec: (query: string) => inner.exec(query),
    batch: async <T = Record<string, unknown>>(batch: D1PreparedStatement[]) => { statements += batch.length; return inner.batch<T>(batch.map((s) => (s instanceof Counted ? s.inner : s))); },
  };
  return { db, count: () => statements, maxBinds: () => maxBound };
}

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  let odo = 0;
  const lesson = async (learnerId: string, date: string, extra: Record<string, unknown>, minutes = 60) => {
    const start = odo;
    odo += 7;
    const finish = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return createLesson(db, learnerId, { lessonDate: date, startTime: "09:00", finishTime: finish, startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra });
  };
  const assess = (learnerId: string, date: string, ids: string[], result: "achieved" | "not_achieved" = "achieved", minutes = 60) =>
    lesson(learnerId, date, { assessedIds: ids, achievedResults: ach(ids, result) }, minutes);
  const mk = async (name: string) => (await createLearner(db, { fullName: name, instructorId: tony.id })).id;
  return { db, tony, lesson, assess, mk };
}

/** What the detail screen derives for one learner, in the summary's shape. */
async function expected(db: D1Database, learnerId: string) {
  const [totals, progress, rows] = await Promise.all([
    getTotals(db, learnerId),
    getLearnerProgress(db, learnerId),
    db.prepare("SELECT MAX(lesson_date) AS d FROM lessons WHERE learner_id = ? AND lesson_no > 0").bind(learnerId).first<{ d: string | null }>(),
  ]);
  return summaryFromProgress(progress, totals, rows?.d ?? null);
}

test("listLearnerSummaries: one statement, no bound parameters, exactly the detail screen's values for every pattern of learner", async (t) => {
  const { db, lesson, assess, mk } = await setup();
  const ids: Record<string, string> = {};
  // No lessons at all.
  ids.none = await mk("QA Card None");
  // Taught only: lessons and hours, nothing achieved.
  ids.taught = await mk("QA Card Taught");
  await lesson(ids.taught, "2026-09-03", { taughtIds: ["1", "2"] }, 45);
  await lesson(ids.taught, "2026-09-01", { taughtIds: ["3"] }, 30); // an earlier DATE recorded later: last lesson date is the latest date, not the latest lesson
  // Not achieved first, achieved later.
  ids.retry = await mk("QA Card Retry");
  await assess(ids.retry, "2026-09-02", ["1", "2"], "not_achieved");
  await assess(ids.retry, "2026-09-05", ["1"], "achieved", 90);
  // Review 1-17 ready (1-17 achieved, review not yet assessed).
  ids.r17Ready = await mk("QA Card R17 Ready");
  await assess(ids.r17Ready, "2026-09-04", range(1, 17));
  // Review 1-17 achieved in a later lesson (valid), 18-22 partly.
  ids.r17Done = await mk("QA Card R17 Done");
  await assess(ids.r17Done, "2026-09-04", range(1, 17));
  await assess(ids.r17Done, "2026-09-06", [REVIEW_1_17]);
  await assess(ids.r17Done, "2026-09-07", ["19", "22"]);
  // Final Drive ready.
  ids.fdReady = await mk("QA Card FD Ready");
  await assess(ids.fdReady, "2026-09-04", range(1, 17));
  await assess(ids.fdReady, "2026-09-06", [REVIEW_1_17]);
  await assess(ids.fdReady, "2026-09-08", range(18, 22));
  await assess(ids.fdReady, "2026-09-09", [REVIEW_1_22]);
  // Completed.
  ids.done = await mk("QA Card Completed");
  await assess(ids.done, "2026-09-04", range(1, 17));
  await assess(ids.done, "2026-09-06", [REVIEW_1_17]);
  await assess(ids.done, "2026-09-08", range(18, 22));
  await assess(ids.done, "2026-09-09", [REVIEW_1_22]);
  await assess(ids.done, "2026-09-10", [FINAL_DRIVE_23]);
  // Review invalidated by a History Edit of an earlier lesson (the raw Achieved event stays; the derived status falls back).
  ids.invalid = await mk("QA Card Invalid R17");
  const inv1 = await assess(ids.invalid, "2026-09-04", range(1, 17));
  await assess(ids.invalid, "2026-09-06", [REVIEW_1_17]);
  await updateLesson(db, ids.invalid, inv1.id, {
    lessonDate: inv1.lessonDate, startTime: inv1.startTime, finishTime: inv1.finishTime, startOdometer: String(inv1.startOdometer), finishOdometer: String(inv1.finishOdometer),
    assessedIds: range(1, 17), achievedResults: { ...ach(range(1, 16)), "17": "not_achieved" }, adiSignature: SIG2, learnerSignature: SIG2,
  });
  // Prior-instructor rows (negative lesson numbers; their hours count, their lessons do not) plus one App lesson.
  ids.prior = await mk("QA Card Prior");
  const prior = PAPER_CSV_COLUMNS.map((column) => ({ date: "2025-03-01", assessed_achieved: "4;5", prior_instructor: "QA ADI 101", prior_lessons: "3", prior_hours: "4.5", prior_km: "40" } as Record<string, string>)[column] ?? "").join(",");
  await importPaperLessons(db, ids.prior, `${PAPER_CSV_COLUMNS.join(",")}\n${prior}\n`, "commit");
  await assess(ids.prior, "2026-09-11", ["6"]);
  // Archived: in the archived set only.
  ids.archived = await mk("QA Card Archived");
  await assess(ids.archived, "2026-09-12", ["1"]);
  await setLearnerArchived(db, ids.archived, true);

  const counted = countingD1(db);
  const active = await listLearnerSummaries(counted.db);
  assert.equal(counted.count(), 1, "one statement for the whole active list");
  assert.equal(counted.maxBinds(), 0, "no bound parameters");
  const archived = await listLearnerSummaries(counted.db, { archived: true });
  assert.equal(counted.count(), 2);

  const activeList = await listLearners(db);
  assert.deepEqual(Object.keys(active).sort(), activeList.map((l) => l.id).sort(), "one summary per active learner, keyed by id");
  assert.deepEqual(Object.keys(archived), [ids.archived]);
  for (const [name, id] of Object.entries(ids)) {
    const summary = (name === "archived" ? archived : active)[id];
    assert.deepEqual(summary, await expected(db, id), `${name}: summary = detail screen`);
    assert.deepEqual(Object.keys(summary), ["lessonCount", "totalMinutes", "lastLessonDate", "achievedCount", "achievedIds", "review1_17", "review1_22", "finalDrive23", "completed"], `${name}: payload shape`);
  }
  // Spot checks of the semantics (not just self-consistency).
  assert.deepEqual(active[ids.none], { lessonCount: 0, totalMinutes: 0, lastLessonDate: null, achievedCount: 0, achievedIds: [], review1_17: "locked", review1_22: "locked", finalDrive23: "locked", completed: false });
  assert.equal(active[ids.taught].lessonCount, 2);
  assert.equal(active[ids.taught].totalMinutes, 75);
  assert.equal(active[ids.taught].lastLessonDate, "2026-09-03");
  assert.equal(active[ids.taught].achievedCount, 0);
  assert.deepEqual(active[ids.retry].achievedIds, ["1"]);
  assert.equal(active[ids.retry].totalMinutes, 150);
  assert.equal(active[ids.r17Ready].review1_17, "ready");
  assert.equal(active[ids.r17Done].review1_17, "achieved");
  assert.equal(active[ids.r17Done].achievedCount, 19);
  assert.deepEqual([active[ids.fdReady].review1_17, active[ids.fdReady].review1_22, active[ids.fdReady].finalDrive23], ["achieved", "achieved", "ready"]);
  assert.deepEqual([active[ids.done].finalDrive23, active[ids.done].completed, active[ids.done].lessonCount, active[ids.done].lastLessonDate], ["achieved", true, 5, "2026-09-10"]);
  assert.equal(active[ids.invalid].review1_17, "locked", "the edited lesson leaves 17 not achieved: Review 1-17 is derived locked, never done");
  assert.equal(active[ids.invalid].achievedCount, 16);
  assert.equal(active[ids.prior].lessonCount, 1, "prior-instructor rows are not lessons");
  assert.equal(active[ids.prior].totalMinutes, 270 + 60, "their hours count");
  assert.deepEqual(active[ids.prior].achievedIds, ["4", "5", "6"], "their achievements count");
  assert.equal(active[ids.prior].lastLessonDate, "2026-09-11", "the prior row's date is not a lesson date");
  assert.equal(archived[ids.archived].achievedCount, 1);
  t.diagnostic(`active summaries: ${Object.keys(active).length} learners in ${counted.count() === 2 ? 1 : "?"} statement each`);
});

test("listLearnerSummaries: 100 learners with lessons stay ONE statement, 0 binds, and match the detail screen (set-based, never per learner)", async (t) => {
  const { db, assess, mk, tony } = await setup();
  void tony;
  const ids: string[] = [];
  for (let i = 0; i < 100; i++) {
    const id = await mk(`QA Card ${String(i).padStart(3, "0")}`);
    ids.push(id);
    const stage = i % 5;
    if (stage >= 1) await assess(id, "2026-08-01", range(1, 17));
    if (stage >= 2) await assess(id, "2026-08-02", [REVIEW_1_17]);
    if (stage >= 3) await assess(id, "2026-08-03", range(18, 22));
    if (stage >= 4) await assess(id, "2026-08-04", [REVIEW_1_22]);
  }
  const counted = countingD1(db);
  const started = performance.now();
  const summaries = await listLearnerSummaries(counted.db);
  const ms = performance.now() - started;
  assert.equal(counted.count(), 1);
  assert.equal(counted.maxBinds(), 0);
  assert.equal(Object.keys(summaries).length, 100);
  for (const id of ids) assert.deepEqual(summaries[id], await expected(db, id));
  const bytes = Buffer.byteLength(JSON.stringify(summaries), "utf8");
  t.diagnostic(`100 learners: 1 statement, ${ms.toFixed(0)} ms locally, response payload ${bytes} bytes (${Math.round(bytes / 100)} bytes per learner)`);
  assert.ok(bytes < 100 * 400, `summaries payload ${bytes} bytes for 100 learners (budget 400 bytes each)`);
  assert.deepEqual(Object.values(summaries).map((s) => s.finalDrive23).filter((s) => s === "ready").length, 20);
});
