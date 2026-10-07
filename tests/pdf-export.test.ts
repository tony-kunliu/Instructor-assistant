import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildCbtaChecklistPdf, createMeasurer, cumulativeFooterText, lessonTotalsText, plannedPageCount, wrapText } from "../lib/pdf-export.ts";
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
  phone: "0400 000 000",
  dob: "2008-01-01",
  licenceNumber: "L1",
  licenceExpiry: "2030-01-01",
  eligibility: "Eligible",
  transmission: "manual",
  schoolWork: null,
  licenceStage: "learner",
  archivedAt: null,
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
