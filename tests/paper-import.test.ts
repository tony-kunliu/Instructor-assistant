import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_CSV_COLUMNS, parseCsv, planPaperImport } from "../lib/paper-import.ts";
import { POST_REVIEW_1_17_LOCK_MESSAGE } from "../lib/competency.ts";

const INSTRUCTORS = [
  { id: "ins-tony", fullName: "Tony", status: "active" as const },
  { id: "ins-anna", fullName: "Anna", status: "active" as const },
  { id: "ins-old", fullName: "Bob", status: "inactive" as const },
];
const HEADER = PAPER_CSV_COLUMNS.join(",");
type Row = Partial<Record<(typeof PAPER_CSV_COLUMNS)[number], string>>;
function csv(...rows: Row[]): string {
  const base: Row = { date: "2026-01-01", signature: "on_paper", instructor: "Tony" };
  const lines = rows.map((r) => PAPER_CSV_COLUMNS.map((c) => { const v = { ...base, ...r }[c] ?? ""; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(","));
  return [HEADER, ...lines].join("\n") + "\n";
}
function errors(text: string) {
  const plan = planPaperImport(text, INSTRUCTORS);
  assert.equal(plan.ok, false);
  return plan.ok ? [] : plan.errors;
}
const ids1to17 = Array.from({ length: 17 }, (_, i) => String(i + 1)).join(";");

test("parseCsv handles quoted fields", () => {
  assert.deepEqual(parseCsv('a,"b, ""c""",中文备注'), [["a", 'b, "c"', "中文备注"]]);
  assert.deepEqual(parseCsv('a,"x\ny"\nb,c'), [["a", "x\ny"], ["b", "c"]]);
});

test("parseCsv strips BOM and handles CRLF", () => {
  assert.deepEqual(parseCsv("﻿date,x\r\n1,2\r\n\r\n\n"), [["date", "x"], ["1", "2"]]);
});

test("header must match exactly", () => {
  const missing = PAPER_CSV_COLUMNS.filter((c) => c !== "instructor").join(",") + "\n2026-01-01\n";
  assert.deepEqual(errors(missing).filter((e) => e.row === 1).map((e) => e.message), ["Missing column: instructor"]);
  const extra = HEADER + ",email\n2026-01-01\n";
  assert.deepEqual(errors(extra).filter((e) => e.row === 1).map((e) => e.message), ["Unexpected column: email"]);
});

test("empty file / header only", () => {
  for (const text of ["", HEADER + "\n", "﻿" + HEADER + "\r\n"]) {
    assert.deepEqual(errors(text), [{ row: 1, message: "No lessons found in the file." }]);
  }
});

test("derived values", () => {
  const plan = planPaperImport(
    csv(
      { start_time: "09:00", finish_time: "10:00", start_odometer: "0", finish_odometer: "20", location: "Civic", comments: "ok" },
      { date: "2026-01-02" },
      { date: "2026-01-03", start_time: "10:00", finish_time: "10:30", start_odometer: "25", finish_odometer: "40", signature: "unsigned", instructor: "Anna" },
    ),
    INSTRUCTORS,
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.lessons.map((l) => l.lessonNo), [1, 2, 3]);
  assert.deepEqual(plan.lessons.map((l) => l.durationMinutes), [60, null, 30]);
  assert.deepEqual(plan.lessons.map((l) => l.distanceKm), [20, null, 15]);
  assert.deepEqual(plan.lessons.map((l) => l.cumulativeMinutes), [60, 60, 90]);
  assert.deepEqual(plan.lessons.map((l) => l.cumulativeKm), [20, 20, 35]);
  assert.deepEqual(plan.preview.missingDataLessonNos, [2]);
  assert.deepEqual(plan.preview.unsignedLessonNos, [3]);
  assert.equal(plan.preview.lessonCount, 3);
  assert.equal(plan.preview.totalMinutes, 90);
  assert.equal(plan.preview.totalKm, 35);
  assert.equal(plan.lessons[0].location, "Civic");
  assert.equal(plan.lessons[1].startTime, null);
  assert.equal(plan.lessons[2].instructorId, "ins-anna");
  assert.equal(plan.lessons[2].signatureStatus, "unsigned");
});

test("field errors are reported per row and all collected", () => {
  const has = (errs: { row: number; message: string }[], row: number, re: RegExp) =>
    assert.ok(errs.some((e) => e.row === row && re.test(e.message)), `row ${row} ${re}: ${JSON.stringify(errs)}`);
  const errs = errors(
    csv(
      { date: "2026-13-45" }, // 1 bad date
      { start_time: "10:00", finish_time: "09:00" }, // 2 finish <= start
      { start_time: "10:00" }, // 3 only one time
      { start_odometer: "10" }, // 4 only one odometer
      { start_odometer: "50", finish_odometer: "40" }, // 5 finish < start
      { start_odometer: "100", finish_odometer: "120" }, // 6 ok
      { start_odometer: "" }, // 7 NULL row
      { start_odometer: "110", finish_odometer: "130" }, // 8 lower than row 6 finish
      { taught: "99" }, // 9 unknown id
      { taught: "1;1" }, // 10 duplicate
      { date: "2025-12-31" }, // 11 date earlier
      { signature: "digital" }, // 12
      { instructor: "tony" }, // 13 case-sensitive
      { instructor: "Bob" }, // 14 inactive
      { assessed_achieved: "1", assessed_not_achieved: "1" }, // 15 both columns
    ),
  );
  has(errs, 2, /date/i);
  has(errs, 3, /finish time/i);
  has(errs, 4, /both start and finish time/i);
  has(errs, 5, /both start and finish odometer/i);
  has(errs, 6, /finish odometer/i);
  has(errs, 9, /row 7/);
  has(errs, 10, /99/);
  has(errs, 11, /duplicate/i);
  has(errs, 12, /earlier/i);
  has(errs, 13, /signature/i);
  has(errs, 14, /instructor/i);
  has(errs, 15, /instructor/i);
  has(errs, 16, /both/i);
  assert.ok(!errs.some((e) => e.row === 8));
});

test("competency gates enforced cumulatively", () => {
  const bad = errors(csv({ assessed_achieved: "18" }));
  assert.deepEqual(bad, [{ row: 2, message: POST_REVIEW_1_17_LOCK_MESSAGE }]);

  const good = planPaperImport(
    csv(
      { date: "2026-01-01", taught: ids1to17 },
      { date: "2026-01-02", assessed_achieved: ids1to17 },
      { date: "2026-01-03", assessed_achieved: "review-1-17" },
      { date: "2026-01-04", assessed_achieved: "18" },
    ),
    INSTRUCTORS,
  );
  assert.equal(good.ok, true, JSON.stringify(good));
  if (!good.ok) return;
  assert.equal(good.lessons[3].achievedResults["18"], "achieved");
  assert.equal(good.preview.progress.competencies["18"].achieved, true);
  assert.deepEqual(good.lessons[1].assessedIds.length, 17);
});

test("not_achieved results and column order are preserved", () => {
  const plan = planPaperImport(csv({ taught: "1;2", assessed_achieved: "3", assessed_not_achieved: "4" }), INSTRUCTORS);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.lessons[0].taughtIds, ["1", "2"]);
  assert.deepEqual(plan.lessons[0].assessedIds, ["3", "4"]);
  assert.deepEqual(plan.lessons[0].achievedResults, { "3": "achieved", "4": "not_achieved" });
});

test("rows after completion rejected", () => {
  const rows = [
    { date: "2026-01-01", assessed_achieved: ids1to17 },
    { date: "2026-01-02", assessed_achieved: "review-1-17" },
    { date: "2026-01-03", assessed_achieved: "18;19;20;21;22" },
    { date: "2026-01-04", assessed_achieved: "review-1-22" },
    { date: "2026-01-05", assessed_achieved: "final-drive-23" },
    { date: "2026-01-06", location: "extra" },
  ];
  const errs = errors(csv(...rows));
  assert.deepEqual(errs, [{ row: 7, message: "CBT&A is already completed for this learner — no further CBT&A lessons can be recorded." }]);
  const ok = planPaperImport(csv(...rows.slice(0, 5)), INSTRUCTORS);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  if (ok.ok) assert.equal(ok.preview.progress.completed, true);
});

test("taught and assessed overlap rejected", () => {
  assert.deepEqual(errors(csv({ taught: "1", assessed_achieved: "1" })), [
    { row: 2, message: "Competency 1 cannot be both taught and assessed in the same lesson." },
  ]);
});

test("text limits", () => {
  const plan = planPaperImport(csv({ location: "x".repeat(300), comments: "y".repeat(4000) }), INSTRUCTORS);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.lessons[0].location?.length, 200);
  assert.equal(plan.lessons[0].comments?.length, 3000);
});

test("spreadsheet row numbers: header is row 1, skipped blank and all-empty rows still count", () => {
  const text = `${HEADER}\n\n,,,,,,,,,,,\n2026-01-01,,,,,,,,,,bad,Tony\n`;
  assert.deepEqual(errors(text), [{ row: 4, message: "Signature must be on_paper or unsigned." }]);
});

test("an all-empty row is skipped like a blank line", () => {
  const text = csv({}).trimEnd() + "\n,,,,,,,,,,,\n" + csv({ date: "2026-01-02" }).split("\n")[1] + "\n";
  const plan = planPaperImport(text, INSTRUCTORS);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (plan.ok) assert.deepEqual(plan.lessons.map((l) => l.lessonDate), ["2026-01-01", "2026-01-02"]);
});

test("spreadsheet-style times H:MM and HH:MM:SS are normalised to HH:MM", () => {
  const plan = planPaperImport(csv({ start_time: "9:00", finish_time: "10:30:00" }), INSTRUCTORS);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (!plan.ok) return;
  assert.equal(plan.lessons[0].startTime, "09:00");
  assert.equal(plan.lessons[0].finishTime, "10:30");
  assert.equal(plan.lessons[0].durationMinutes, 90);
  const bad = errors(csv({ start_time: "09:00:30", finish_time: "10:00" }));
  assert.match(bad[0].message, /HH:MM/);
});

test("blank header column, duplicate header column and cells beyond the header are rejected", () => {
  const blank = HEADER + ",\n2026-01-01\n";
  assert.deepEqual(errors(blank).map((e) => e.message), ["Unexpected column: (blank)"]);
  const dup = HEADER + ",date\n2026-01-01\n";
  assert.deepEqual(errors(dup).map((e) => e.message), ["Duplicate column: date"]);
  const beyond = errors(`${HEADER}\n2026-01-01,,,,,,,,,,on_paper,Tony,,,,,extra\n`);
  assert.deepEqual(beyond, [{ row: 2, message: "Row has more fields than the header." }]);
});

test("more than 1000 data rows is rejected with one row-1 error; exactly 1000 is allowed", () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({ taught: "1" }));
  assert.deepEqual(errors(csv(...rows(1001))), [{ row: 1, message: "Too many rows (max 1000). Split the file per learner." }]);
  const plan = planPaperImport(csv(...rows(1000)), INSTRUCTORS);
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.lessons.length, 1000);
});

// ── Task 8: prior-instructor rows (spec §12) ─────────────────────────────

const ALL_22 = Array.from({ length: 22 }, (_, i) => String(i + 1)).join(";");
const prior = (r: Row = {}): Row => ({ signature: "", instructor: "", prior_instructor: "QA ADI 358", prior_lessons: "11", prior_hours: "20", ...r });

test("PAPER_CSV_COLUMNS ends with the four prior_* columns", () => {
  assert.deepEqual(PAPER_CSV_COLUMNS.slice(-4), ["prior_instructor", "prior_lessons", "prior_hours", "prior_km"]);
  const missing = PAPER_CSV_COLUMNS.filter((c) => c !== "prior_km").join(",") + "\n2026-01-01\n";
  assert.deepEqual(errors(missing).filter((e) => e.row === 1).map((e) => e.message), ["Missing column: prior_km"]);
});

test("prior rows are parsed into priorRecords with negative lesson numbers (oldest first) and do not take a lesson number", () => {
  const plan = planPaperImport(
    csv(
      prior({ date: "2025-06-01", prior_instructor: "QA Old School", prior_lessons: "4", prior_hours: "6.5", assessed_achieved: "1;2" }),
      prior({ date: "2025-12-01", prior_km: "150", assessed_achieved: "3" }),
      { date: "2026-01-01", start_time: "09:00", finish_time: "10:00", start_odometer: "0", finish_odometer: "20" },
      { date: "2026-01-02" },
    ),
    INSTRUCTORS,
  );
  assert.equal(plan.ok, true, JSON.stringify(!plan.ok && plan.errors));
  if (!plan.ok) return;
  assert.deepEqual(plan.priorRecords.map((p) => [p.lessonNo, p.label, p.lessonCount, p.minutes, p.km, p.date, p.achievedIds]), [
    [-2, "QA Old School", 4, 390, null, "2025-06-01", ["1", "2"]],
    [-1, "QA ADI 358", 11, 1200, 150, "2025-12-01", ["3"]],
  ]);
  assert.deepEqual(plan.priorRecords.map((p) => [p.cumulativeMinutes, p.cumulativeKm]), [[390, 0], [1590, 150]]);
  assert.deepEqual(plan.lessons.map((l) => l.lessonNo), [1, 2]);
  // Cumulative = running sum across prior rows first, then lesson rows.
  assert.deepEqual(plan.lessons.map((l) => [l.cumulativeMinutes, l.cumulativeKm]), [[1650, 170], [1650, 170]]);
  assert.equal(plan.preview.lessonCount, 2);
  assert.equal(plan.preview.totalMinutes, 1650);
  assert.equal(plan.preview.totalKm, 170);
  assert.deepEqual(plan.preview.priorRecords, [
    { label: "QA Old School", lessonCount: 4, minutes: 390, km: null },
    { label: "QA ADI 358", lessonCount: 11, minutes: 1200, km: 150 },
  ]);
  assert.equal(plan.preview.progress.achievedCount, 3);
  assert.deepEqual(plan.preview.missingDataLessonNos, [2]);
});

test("a file with only prior rows is a valid plan with no lessons", () => {
  const plan = planPaperImport(csv(prior()), INSTRUCTORS);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.lessons.length, 0);
  assert.equal(plan.priorRecords.length, 1);
  assert.equal(plan.preview.lessonCount, 0);
  assert.equal(plan.preview.totalMinutes, 1200);
});

test("prior rows must come before the first lesson row", () => {
  const errs = errors(csv({ date: "2025-01-01" }, prior({ date: "2025-02-01" })));
  assert.deepEqual(errs, [{ row: 3, message: "Prior-instructor rows must come before lesson rows." }]);
});

test("prior rows only use date, assessed_achieved and the prior_* columns", () => {
  const forbidden: Row[] = [
    { start_time: "09:00" }, { finish_time: "10:00" }, { start_odometer: "1" }, { finish_odometer: "2" },
    { taught: "1" }, { assessed_not_achieved: "2" }, { location: "QA" }, { comments: "QA" }, { signature: "on_paper" }, { instructor: "Tony" },
  ];
  for (const extra of forbidden) {
    assert.deepEqual(errors(csv(prior(extra))), [{ row: 2, message: "Prior-instructor rows only use date, assessed_achieved and the prior_* columns." }], JSON.stringify(extra));
  }
});

test("prior row field validation: date, prior_lessons, prior_hours, prior_km, ids", () => {
  const msgs = (r: Row) => errors(csv(prior(r))).map((e) => e.message);
  assert.deepEqual(msgs({ date: "2025-02-30" }), ["Date must be a valid date in YYYY-MM-DD format."]);
  for (const v of ["", "0", "-1", "1.5", "x"]) assert.deepEqual(msgs({ prior_lessons: v }), ["prior_lessons must be a positive whole number."], v);
  for (const v of ["", "0", "0.0", "-2", "1.25", "abc", "1,5"]) assert.deepEqual(msgs({ prior_hours: v }), ["prior_hours must be a positive number of hours with at most one decimal place (e.g. 20 or 12.5)."], v);
  for (const v of ["-1", "1.5", "x"]) assert.deepEqual(msgs({ prior_km: v }), ["prior_km must be a whole number of km, or blank."], v);
  assert.deepEqual(msgs({ assessed_achieved: "1;99" }), ["Unknown competency id in assessed_achieved: 99"]);
  assert.deepEqual(msgs({ assessed_achieved: "final-drive-23" }), ["23 Final Drive cannot be imported as a prior-instructor achievement."]);
  // A label over 80 characters is a row error (with its spreadsheet row number), never silently cut.
  assert.deepEqual(errors(csv(prior({ prior_instructor: "QA " + "x".repeat(78) }))), [{ row: 2, message: "prior_instructor must be at most 80 characters." }]);
  const at80 = planPaperImport(csv(prior({ prior_instructor: "QA " + "x".repeat(77) })), INSTRUCTORS);
  assert.equal(at80.ok && at80.priorRecords[0].label, "QA " + "x".repeat(77));
  // prior_km blank and 0 are fine; hours keep one decimal.
  const plan = planPaperImport(csv(prior({ prior_km: "0", prior_hours: "12.5" })), INSTRUCTORS);
  assert.equal(plan.ok && plan.priorRecords[0].km, 0);
  assert.equal(plan.ok && plan.priorRecords[0].minutes, 750);
});

test("lesson rows must leave the prior_* columns empty", () => {
  for (const extra of [{ prior_lessons: "1" }, { prior_hours: "2" }, { prior_km: "3" }]) {
    assert.deepEqual(errors(csv(extra)).map((e) => e.message), ["Lesson rows must leave prior_lessons, prior_hours and prior_km empty."], JSON.stringify(extra));
  }
});

test("prior rows count in chronological order: a lesson dated before a prior record is rejected", () => {
  const errs = errors(csv(prior({ date: "2026-02-01" }), { date: "2026-01-01" }));
  assert.equal(errs.length, 1);
  assert.equal(errs[0].row, 3);
  assert.match(errs[0].message, /earlier than the previous row/);
});

test("gates are not checked for prior achievements, but later lesson rows are validated against progress that includes them", () => {
  // Prior instructor stamped 1-22 + both reviews: a lesson row assessing 23 Final Drive is valid.
  const ok = planPaperImport(csv(prior({ assessed_achieved: `${ALL_22};review-1-17;review-1-22` }), { date: "2026-01-02", assessed_achieved: "final-drive-23" }), INSTRUCTORS);
  assert.equal(ok.ok, true, JSON.stringify(!ok.ok && ok.errors));
  assert.equal(ok.ok && ok.preview.progress.completed, true);
  // A prior record may carry a gated stamp without its prerequisites (recorded as stamped, D12).
  const stamped = planPaperImport(csv(prior({ assessed_achieved: "18;review-1-22" })), INSTRUCTORS);
  assert.equal(stamped.ok, true);
  // Union across prior instructors: 1-17 from one, Review 1-17 from another → 18 can be assessed in a lesson row.
  const union = planPaperImport(csv(prior({ date: "2025-01-01", assessed_achieved: ids1to17 }), prior({ date: "2025-02-01", prior_instructor: "QA B", assessed_achieved: "review-1-17" }), { date: "2026-01-02", assessed_achieved: "18" }), INSTRUCTORS);
  assert.equal(union.ok, true, JSON.stringify(!union.ok && union.errors));
  // Without the prior review, the same lesson row is still gated.
  const gated = errors(csv(prior({ assessed_achieved: ids1to17 }), { date: "2026-01-02", assessed_achieved: "18" }));
  assert.deepEqual(gated, [{ row: 3, message: POST_REVIEW_1_17_LOCK_MESSAGE }]);
  // A competency achieved with a prior instructor can no longer be taught.
  assert.match(errors(csv(prior({ assessed_achieved: "5" }), { date: "2026-01-02", taught: "5" }))[0].message, /already achieved/);
});
