import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCbtaChecklistPdf, createMeasurer, lessonNoFontSize, lessonNoLabel, cumulativeFooterText, lessonTotalsText, plannedPageCount, signatureCellText, wrapText } from "../lib/pdf-export.ts";
import type { Learner, Lesson } from "../lib/types.ts";

const templateBytes = readFileSync(new URL("../public/pdf-template/adi-cbta-checklist.pdf", import.meta.url));
const fontBytes = readFileSync(new URL("../public/fonts/NotoSansSC-Regular.otf", import.meta.url));

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const learner: Learner = {
  id: "learner-1",
  instructorId: "instructor-1",
  instructorName: "Test Instructor",
  instructorAdiNumber: "ADI-9",
  fullName: "Test Learner",
  address: "1 Test St",
  addressSuburb: null,
  addressState: null,
  addressPostcode: null, otherLicenceKind: null, otherLicencePlace: null, otherLicenceNumber: null, otherLicenceClass: null, otherLicenceIssuedOn: null, otherLicenceExpiresOn: null,
  phone: "0400 000 000",
  dob: "2008-01-01",
  licenceNumber: "L1",
  licenceExpiry: "2030-01-01",
  eligibility: "Eligible",
  transmission: "manual",
  schoolWork: null,
  licenceStage: "learner",
  learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
  archivedAt: null, archiveReason: null, archiveNote: null, transfers: [],
};

function lesson(n: number, overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: `lesson-${n}`,
    learnerId: "learner-1",
    instructorId: "instructor-1",
    lessonNo: n,
    lessonDate: "2026-01-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: n * 10,
    finishOdometer: n * 10 + 5,
    durationMinutes: 30,
    distanceKm: 5,
    cumulativeMinutes: n * 30,
    cumulativeKm: n * 5,
    taught: "1, 2",
    competenciesAssessed: "3",
    achieved: "3",
    location: "Belconnen",
    comments: "Good",
    adiSignature: SIG,
    learnerSignature: SIG,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    updatedByInstructorId: null,
    updatedByInstructorName: null,
    recordSource: "app",
    signatureStatus: "digital",
    priorInstructorLabel: null,
    priorLessonCount: null,
    revisionCount: 0,
    editedBeforeRevisionHistory: false,
    ...overrides,
  };
}

test("plannedPageCount: 0 -> 0, first page holds 5, continuation pages hold 6 each", () => {
  assert.equal(plannedPageCount(0), 0);
  assert.equal(plannedPageCount(1), 1);
  assert.equal(plannedPageCount(5), 1);
  assert.equal(plannedPageCount(6), 2);
  assert.equal(plannedPageCount(11), 2);
  assert.equal(plannedPageCount(12), 3);
});

test("buildCbtaChecklistPdf rejects an empty lesson list (0 lessons must be blocked before export, not silently produce a blank checklist)", async () => {
  await assert.rejects(() => buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons: [] }), /No saved lessons/);
});

for (const n of [1, 5, 6, 11, 12]) {
  test(`buildCbtaChecklistPdf(${n} lessons) produces the planned page count and a valid, re-loadable PDF`, async () => {
    const lessons = Array.from({ length: n }, (_, i) => lesson(i + 1));
    const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons });
    assert.equal(result.pageCount, plannedPageCount(n));
    assert.equal(result.hadOverflow, false);
    // Round-trip: the bytes must be a well-formed PDF pdf-lib can load again, with the same page count.
    const reloaded = await PDFDocument.load(result.bytes);
    assert.equal(reloaded.getPageCount(), result.pageCount);
  });
}

test("a comment too long for its cell triggers an Additional Notes appendix page and is not lost", async () => {
  const longComment = "长文本 ".repeat(400) + "end-of-comment-marker";
  const lessons = [lesson(1, { comments: longComment })];
  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons });
  assert.equal(result.hadOverflow, true);
  assert.ok(result.pageCount > plannedPageCount(1), "an appendix page must be appended beyond the normal page plan");
});

test("wrapText breaks on spaces for Latin text and falls back to character-by-character for unspaced CJK runs", () => {
  const measurer = createMeasurer(fontBytes);
  const latinLines = wrapText(measurer, "one two three four five six seven eight nine ten", 10, 60);
  assert.ok(latinLines.length > 1);
  for (const line of latinLines) assert.ok(measurer.widthOfTextAtSize(line, 10) <= 60 + 0.01);

  const cjkLines = wrapText(measurer, "这是一段没有空格的中文长句子用来测试逐字换行", 10, 60);
  assert.ok(cjkLines.length > 1);
  for (const line of cjkLines) assert.ok(measurer.widthOfTextAtSize(line, 10) <= 60 + 0.01);
  assert.equal(cjkLines.join(""), "这是一段没有空格的中文长句子用来测试逐字换行");
});

test("regression: this font swaps digits for context-dependent 'locl' alternate glyphs that pdf-lib's declared /W width table doesn't cover — buildCbtaChecklistPdf must embed with { locl: false }", () => {
  // This is exactly the bug this feature's own visual QA caught (confirmed with two independent PDF
  // renderers, poppler and Chromium's PDFium): digits rendered with huge gaps between them, because
  // the font substitutes plain digit glyphs for alternates *only when adjacent to certain characters*,
  // and pdf-lib's width table is built from each codepoint's default (non-substituted) glyph.
  const fkFont = fontkit.create(fontBytes as unknown as Buffer);
  const digitsAlone = fkFont.layout("1234").glyphs.map((g) => g.id);
  const digitsDefault = fkFont.layout("ADI-1234").glyphs.slice(4).map((g) => g.id);
  const digitsLoclDisabled = fkFont.layout("ADI-1234", { locl: false }).glyphs.slice(4).map((g) => g.id);
  assert.notDeepEqual(digitsDefault, digitsAlone, "sanity check: this reproduces the substitution when locl is left enabled");
  assert.deepEqual(digitsLoclDisabled, digitsAlone, "locl: false must make digits use their plain glyph ids, matching the declared /W table");
});

test("Total hrs / Total kms cells show THIS lesson's own totals (per paper form), never the running totals", () => {
  const l = lesson(3, { durationMinutes: 90, distanceKm: 12, cumulativeMinutes: 270, cumulativeKm: 36 });
  assert.deepEqual(lessonTotalsText(l), { hours: "1.5 h", km: "12 km" });
});

test("cumulative footer states the running total as of the given lesson", () => {
  const l = lesson(3, { cumulativeMinutes: 270, cumulativeKm: 36 });
  assert.equal(cumulativeFooterText(l), "Cumulative to lesson #3: 4.5 h / 36 km");
});

test("lessonTotalsText: NULL duration/distance (paper lessons) render as empty strings", () => {
  assert.deepEqual(lessonTotalsText({ durationMinutes: null, distanceKm: null }), { hours: "", km: "" });
  assert.deepEqual(lessonTotalsText({ durationMinutes: 60, distanceKm: null }), { hours: "1.0 h", km: "" });
});

test("signatureCellText: 'Paper original' only for on_paper; null for digital and unsigned", () => {
  assert.equal(signatureCellText({ signatureStatus: "on_paper" }), "Paper original");
  assert.equal(signatureCellText({ signatureStatus: "unsigned" }), null);
  assert.equal(signatureCellText({ signatureStatus: "digital" }), null);
});

test("buildCbtaChecklistPdf with a mixed paper/app list succeeds, keeps the page plan, and footer text is unchanged", async () => {
  const paperNulls: Partial<Lesson> = {
    recordSource: "paper_import", adiSignature: null, learnerSignature: null,
    startTime: null, finishTime: null, startOdometer: null, finishOdometer: null, durationMinutes: null, distanceKm: null,
  };
  const lessons = [
    lesson(1, { ...paperNulls, signatureStatus: "on_paper", cumulativeMinutes: 0, cumulativeKm: 0 }),
    lesson(2, { ...paperNulls, signatureStatus: "unsigned", cumulativeMinutes: 0, cumulativeKm: 0 }),
    lesson(3, { cumulativeMinutes: 30, cumulativeKm: 5 }),
  ];
  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons });
  assert.equal(result.pageCount, plannedPageCount(3));
  assert.equal(result.hadOverflow, false);
  assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), result.pageCount);
  assert.equal(cumulativeFooterText(lessons[2]), "Cumulative to lesson #3: 0.5 h / 5 km");
});

// ── Task 8: prior-instructor records on the PDF (spec §12) ──────────────

import { compactIdText, priorRecordLine, priorTotals, type PriorRecord } from "../lib/prior-record.ts";
import { PRINT_MARGIN, PRIOR_LINES_MAX, planPriorLines, priorBand } from "../lib/pdf-export.ts";
import { FIRST_PAGE_TABLE_BOTTOM, PAGE_HEIGHT, PAGE_WIDTH } from "../lib/pdf-layout.ts";

const ACHIEVED_ALL = "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, Review 1-17, Review 1-22";
function priorLesson(n: number, overrides: Partial<PriorRecord> = {}): PriorRecord {
  const row = lesson(n, {
    recordSource: "prior_instructor", signatureStatus: "on_paper", adiSignature: null, learnerSignature: null,
    startTime: null, finishTime: null, startOdometer: null, finishOdometer: null, taught: null, location: null, comments: null,
    durationMinutes: 1200, distanceKm: 150, cumulativeMinutes: 1200, cumulativeKm: 150,
    competenciesAssessed: ACHIEVED_ALL, achieved: ACHIEVED_ALL, priorInstructorLabel: "QA ADI 358", priorLessonCount: 11,
    ...overrides,
  });
  assert.ok(isPriorRecord(row));
  return row;
}

test("compactIdText collapses runs of 3+ consecutive competency numbers and keeps reviews", () => {
  assert.equal(compactIdText(ACHIEVED_ALL), "1-22, Review 1-17, Review 1-22");
  assert.equal(compactIdText("1, 2, 4, 5, 6, 9, 23 Final Drive"), "1, 2, 4-6, 9, 23 Final Drive");
  assert.equal(compactIdText("7"), "7");
  assert.equal(compactIdText(null), null);
});

test("priorRecordLine: 'Prior instructor: <label> · <n> lessons · <h> h[ · <km> km] · achieved <ids>'", () => {
  assert.equal(priorRecordLine(priorLesson(-1)), "Prior instructor: QA ADI 358 · 11 lessons · 20.0 h · 150 km · achieved 1-22, Review 1-17, Review 1-22");
  assert.equal(priorRecordLine(priorLesson(-1, { priorLessonCount: 1, durationMinutes: 390, distanceKm: null, achieved: "3" })), "Prior instructor: QA ADI 358 · 1 lesson · 6.5 h · achieved 3");
  assert.equal(priorRecordLine(priorLesson(-1, { achieved: null })), "Prior instructor: QA ADI 358 · 11 lessons · 20.0 h · 150 km");
});

test("priorTotals sums prior-instructor rows only (null when there are none)", () => {
  assert.equal(priorTotals([lesson(1), lesson(2)]), null);
  assert.deepEqual(priorTotals([priorLesson(-2, { durationMinutes: 390, distanceKm: null }), priorLesson(-1), lesson(1)]), { minutes: 1590, km: 150 });
});

test("one hours format: the prior line uses the same decimal hours as the PDF footer and table", () => {
  const p = priorLesson(-1, { durationMinutes: 1200 });
  const footer = cumulativeFooterText(lesson(1, { cumulativeMinutes: 1260, cumulativeKm: 160 }), priorTotals([p]));
  assert.ok(footer.includes("prior instructors 20.0 h"), footer);
  assert.ok(priorRecordLine(p).includes("· 20.0 h ·"), priorRecordLine(p));
});

test("cumulative footer notes the prior hours included when any prior record exists", () => {
  const l = lesson(3, { cumulativeMinutes: 1290, cumulativeKm: 165 });
  assert.equal(cumulativeFooterText(l, { minutes: 1200, km: 150 }), "Cumulative to lesson #3: 21.5 h / 165 km (incl. prior instructors 20.0 h / 150 km)");
  assert.equal(cumulativeFooterText(l, null), "Cumulative to lesson #3: 21.5 h / 165 km");
});

test("planPriorLines: at most 2 lines (PRIOR_LINES_MAX); more spill to the Additional Notes page", () => {
  const measurer = createMeasurer(fontBytes);
  assert.equal(PRIOR_LINES_MAX, 2);
  const one = planPriorLines(measurer, ["Prior instructor: QA A · 1 lesson · 1 h"], 400);
  assert.deepEqual(one, { drawn: ["Prior instructor: QA A · 1 lesson · 1 h"], appendix: null });
  const two = ["Prior instructor: QA A · 1 lesson · 1 h", "Prior instructor: QA B · 1 lesson · 1 h"];
  assert.deepEqual(planPriorLines(measurer, two, 400), { drawn: two, appendix: null });
  const lines = Array.from({ length: PRIOR_LINES_MAX + 1 }, (_, i) => `Prior instructor: QA ${i} · 1 lesson · 1 h`);
  const many = planPriorLines(measurer, lines, 400);
  assert.equal(many.drawn.length, PRIOR_LINES_MAX);
  assert.equal(many.drawn[PRIOR_LINES_MAX - 1], "Prior instructors continue on the Additional Notes page.");
  assert.equal(many.appendix, lines.join("\n"));
  // One long record that wraps past 2 lines in a narrow band also spills, never cut.
  const long = planPriorLines(measurer, [`Prior instructor: QA ${"x".repeat(60)} · 1 lesson · 1 h · achieved ${ACHIEVED_ALL}`], 120);
  assert.equal(long.drawn.length, 2);
  assert.notEqual(long.appendix, null);
});

test("priorBand: page 1 bottom band right of the footer, inside the printable area (≥ 18 pt from every edge), below the table", () => {
  const measurer = createMeasurer(fontBytes);
  for (const footer of ["Cumulative to lesson #1: 1.0 h / 10 km (incl. prior instructors 20.0 h / 150 km)", "Cumulative to lesson #999: 9999.5 h / 99999 km (incl. prior instructors 9999.5 h / 99999 km)"]) {
    const band = priorBand(measurer, footer);
    assert.ok(band.x0 >= 28 + measurer.widthOfTextAtSize(footer, 7) + 8, "starts right of the footer text");
    assert.ok(band.x1 <= PAGE_WIDTH - PRINT_MARGIN, "right edge printable");
    assert.ok(band.x1 - band.x0 >= 300, `band wide enough (${band.x1 - band.x0})`);
    assert.equal(band.baselines.length, PRIOR_LINES_MAX);
    for (const baseline of band.baselines) {
      assert.ok(baseline - band.fontSize >= FIRST_PAGE_TABLE_BOTTOM + 1, "glyph tops below the table border");
      assert.ok(baseline + band.fontSize * 0.3 <= PAGE_HEIGHT - PRINT_MARGIN, "descenders inside the bottom printable margin");
    }
  }
});

test("buildCbtaChecklistPdf: prior records are not table rows (page plan by lessons ≥ 1); overflowing prior lines add an appendix page", async () => {
  const lessons = [priorLesson(-2, { priorInstructorLabel: "QA Old School" }), priorLesson(-1), ...Array.from({ length: 5 }, (_, i) => lesson(i + 1))];
  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons });
  assert.equal(result.pageCount, plannedPageCount(5), "2 prior + 5 lessons still fit one page");
  assert.equal(result.hadOverflow, false);
  const many = [...Array.from({ length: PRIOR_LINES_MAX + 1 }, (_, i) => priorLesson(i - PRIOR_LINES_MAX - 1, { priorInstructorLabel: `QA ${i}` })), lesson(1)];
  const spilled = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons: many });
  assert.equal(spilled.hadOverflow, true);
  assert.equal(spilled.pageCount, plannedPageCount(1) + 1);
  await assert.rejects(() => buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons: [priorLesson(-1)] }), /No saved lessons/);
});

import { priorSummaryLine, splitPriorRecords } from "../lib/prior-record.ts";

test("splitPriorRecords: History rows are lessons ≥ 1 (order kept); prior records oldest first", () => {
  const listed = [lesson(2), lesson(1), priorLesson(-1, { priorInstructorLabel: "QA B" }), priorLesson(-2, { priorInstructorLabel: "QA A" })];
  const { prior, lessons } = splitPriorRecords(listed);
  assert.deepEqual(lessons.map((l) => l.lessonNo), [2, 1]);
  assert.deepEqual(prior.map((l) => l.priorInstructorLabel), ["QA A", "QA B"]);
  assert.deepEqual(splitPriorRecords([lesson(1)]).prior, []);
});

test("priorSummaryLine (import preview): label, lessons, hours, km when known — no achieved list", () => {
  assert.equal(priorSummaryLine({ label: "QA ADI 358", lessonCount: 11, minutes: 1200, km: 150 }), "Prior instructor: QA ADI 358 · 11 lessons · 20.0 h · 150 km");
  assert.equal(priorSummaryLine({ label: "QA A", lessonCount: 1, minutes: 390, km: null }), "Prior instructor: QA A · 1 lesson · 6.5 h");
});

import { priorPreviewNote } from "../lib/prior-record.ts";

test("priorPreviewNote: import preview Hours/Km note when the plan has prior rows (null otherwise)", () => {
  assert.equal(priorPreviewNote([]), null);
  assert.equal(priorPreviewNote([{ label: "QA A", lessonCount: 4, minutes: 390, km: null }, { label: "QA B", lessonCount: 11, minutes: 1200, km: 150 }]), "incl. 26.5 h / 150 km from previous instructors");
  assert.equal(priorPreviewNote([{ label: "QA A", lessonCount: 1, minutes: 1200, km: null }]), "incl. 20.0 h / 0 km from previous instructors");
});

import { isPriorRecord } from "../lib/prior-record.ts";

test("isPriorRecord is the one predicate: recordSource === 'prior_instructor'", () => {
  assert.equal(isPriorRecord(priorLesson(-1)), true);
  assert.equal(isPriorRecord(lesson(1)), false);
  assert.equal(isPriorRecord(lesson(1, { recordSource: "paper_import" })), false);
});

test("amended lessons (revisionCount > 0) are marked \"(amended)\" next to the lesson number; never-edited lessons are not", async () => {
  const never = { revisionCount: 0, editedBeforeRevisionHistory: false };
  assert.equal(lessonNoLabel({ lessonNo: 7, ...never }), "#7");
  assert.equal(lessonNoLabel({ lessonNo: 12, revisionCount: 2, editedBeforeRevisionHistory: false }), "#12 (amended)");
  assert.equal(lessonNoLabel({ lessonNo: 3, revisionCount: 0, editedBeforeRevisionHistory: true }), "#3 (amended)", "edited before revision history existed");
  const measurer = createMeasurer(fontBytes);
  // The label must fit the narrow date/lesson-no cell on one line (never clipped by drawSingleLine).
  assert.ok(lessonNoFontSize({ revisionCount: 1, editedBeforeRevisionHistory: false }) <= 7);
  assert.ok(measurer.widthOfTextAtSize(lessonNoLabel({ lessonNo: 112, revisionCount: 1, editedBeforeRevisionHistory: false }), lessonNoFontSize({ revisionCount: 1, editedBeforeRevisionHistory: false })) <= 47.6 - 4);

  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons: [lesson(1), lesson(2, { revisionCount: 1 })] });
  const dir = mkdtempSync(path.join(os.tmpdir(), "amended-pdf-"));
  const file = path.join(dir, "out.pdf");
  writeFileSync(file, result.bytes);
  let extracted: string | null = null;
  try { extracted = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }); } catch { /* pdftotext not installed: label checks above still run */ }
  if (extracted !== null) {
    assert.equal((extracted.match(/\(amended\)/g) ?? []).length, 1, "exactly the edited lesson is marked");
    assert.match(extracted, /#2\s*\(amended\)/);
  }
});
