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
  const beyond = errors(`${HEADER}\n2026-01-01,,,,,,,,,,on_paper,Tony,extra\n`);
  assert.deepEqual(beyond, [{ row: 2, message: "Row has more fields than the header." }]);
});
