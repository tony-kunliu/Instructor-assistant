// Builds the official ADI CBT&A Checklist PDF (public/pdf-template/adi-cbta-checklist.pdf)
// filled in with a learner's saved lesson history, using pdf-lib. Runs in
// the browser (this is plain, isomorphic TS — no DOM/Node-only APIs, so it
// also runs under `node --test` for automated checks).
//
// Design constraints (per Tony's brief):
//  - The original template's page size/orientation/columns/header/first-
//    and-continuation-page structure is never redrawn — we copy the actual
//    template pages and overlay text/signatures on top.
//  - Only saved lessons are exported (never a draft), in stable lesson_no
//    order.
//  - Nothing is silently truncated: text that doesn't fit a cell gets a
//    "(see Additional Notes page)" marker in the cell and its full content
//    on an appendix page, never cut off.
//  - Signatures are scaled to fit their cell, preserving aspect ratio.
//  - Prior-instructor records (spec §12, negative lesson_no) are never table
//    rows: page 1 prints their "Prior instructor: …" lines (max 2) in the
//    printable strip below the table, right of the cumulative footer, and
//    every cumulative footer notes the prior hours/km it includes.
//
// Font embedding: the output PDF embeds only the glyphs it uses (a ~30-200 KB font program instead of
// the 16 MB Noto Sans SC, which made every export 10+ MB). `fontBytes` is the static compact font
// (public/fonts/NotoSansSC-Subset.otf, built by scripts/build-pdf-font-subset.py: Latin, punctuation and
// all GB2312 hanzi, with subroutines removed). Two fontkit/pdf-lib CFF-subsetting defects are worked
// around here, both found by rendering with poppler + MuPDF + PDFium and diffing against the whole-font
// export (text extraction alone looked fine while glyphs were silently missing):
//   1. fontkit's subsetter mangles local subroutines, so CJK glyphs of a font that still has subrs
//      disappear. We therefore only subset fonts without subrs (`fontHasSubroutines`); any other font
//      is embedded whole, exactly as before.
//   2. fontkit writes an invalid CFF header (offSize byte), which FreeType-based renderers reject
//      (`patchCffHeader`).
// If a document uses a character the compact font lacks, the optional `fallbackFontBytes` loader supplies
// the full font (embedded whole, as before), so no character is ever dropped that the full font has.
// Characters neither font has are drawn as the font's .notdef glyph and listed in `unsupportedChars`.
//
// Text-width measurement uses a plain `fontkit` font object (`Measurer`)
// that is never embedded into the output PDF, kept entirely separate from
// the pdf-lib `PDFFont` used for actual drawing. Measuring glyphs through
// the *embedded, subsetted* font (i.e. calling `PDFFont#widthOfTextAtSize`
// during layout, before all the real `drawText` calls) was found — via this
// feature's own visual QA — to corrupt pdf-lib/fontkit's subsetting and
// silently drop glyphs from the rendered PDF. Keeping measurement on an
// unrelated, unembedded font object sidesteps that entirely.
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { decimalHours } from "./calc.ts";
import { isPriorRecord, priorRecordLine, priorTotals } from "./prior-record.ts";
import {
  COLUMNS,
  CONTINUATION_PAGE_ROWS,
  CONTINUATION_ROW_TOPS,
  CONTINUATION_TABLE_BOTTOM,
  CUMULATIVE_FOOTER_GAP,
  FIRST_PAGE_ROWS,
  FIRST_PAGE_ROW_TOPS,
  FIRST_PAGE_TABLE_BOTTOM,
  HEADER_FIELDS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  ROW_SUB_OFFSETS,
} from "./pdf-layout.ts";
import type { Learner, Lesson } from "./types.ts";

export type PdfExportResult = {
  bytes: Uint8Array;
  pageCount: number;
  hadOverflow: boolean;
  /** Characters in the exported text that no available font has (drawn as .notdef boxes). Empty in normal use. */
  unsupportedChars: string[];
};

export type PdfExportInput = {
  templateBytes: Uint8Array | ArrayBuffer;
  /** The compact font (public/fonts/NotoSansSC-Subset.otf); embedded as a per-document subset. Any font works, but one with subroutines is embedded whole. */
  fontBytes: Uint8Array | ArrayBuffer;
  /** Loads the full font (public/fonts/NotoSansSC-Regular.otf); called only if the text has characters `fontBytes` lacks. */
  fallbackFontBytes?: () => Promise<Uint8Array | ArrayBuffer>;
  learner: Learner;
  lessons: Lesson[];
};

type Box = { x0: number; x1: number; top: number; bottom: number };

/** Text-width measurement only — never embedded into the output PDF (see file header comment). */
export type Measurer = { widthOfTextAtSize(text: string, size: number): number };

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

type FkFont = ReturnType<typeof fontkit.create>;

function loadFont(fontBytes: Uint8Array | ArrayBuffer): FkFont {
  return fontkit.create(toUint8Array(fontBytes) as unknown as Buffer);
}

/** True if a CFF font still has global or local subroutines (fontkit's subsetter corrupts those glyphs; see file header). */
export function fontHasSubroutines(font: FkFont): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fontkit's typings don't expose the CFF table internals.
  const cff = (font as any)["CFF "];
  if (!cff) return false;
  if (cff.globalSubrIndex?.length > 0) return true;
  const privates = [cff.topDict?.Private, ...(cff.topDict?.FDArray ?? []).map((fd: { Private?: unknown }) => fd.Private)];
  return privates.some((p) => ((p as { Subrs?: { length: number } } | undefined)?.Subrs?.length ?? 0) > 0);
}

/** fontkit writes a nonsense CFF header offSize byte; FreeType (poppler, MuPDF, PDFium) rejects the font program, so glyphs vanish. */
export function patchCffHeader(font: unknown) {
  const embedder = (font as { embedder?: { serializeFont?: () => Promise<Uint8Array> } }).embedder;
  const original = embedder?.serializeFont?.bind(embedder);
  // Fail loudly if a pdf-lib upgrade removes this hook: a silent skip would ship a PDF with missing glyphs.
  if (!embedder || !original) throw new Error("pdf-lib internals changed: PDFFont.embedder.serializeFont is required to repair the subset CFF header");
  embedder.serializeFont = async () => {
    const bytes = await original();
    if (bytes[0] === 1 && !(bytes[3] >= 1 && bytes[3] <= 4)) bytes[3] = 4;
    return bytes;
  };
}

/** Distinct printable characters (code points) of `text` that `font` has no glyph for. */
function missingChars(font: FkFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue; // control characters are never drawn
    if (!font.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return [...missing];
}

/** Every user-entered string that ends up in the PDF (signatures and ids excluded). */
function exportedText(learner: Learner, lessons: Lesson[]): string {
  const parts: string[] = [];
  const collect = (row: object) => {
    for (const [key, value] of Object.entries(row)) if (typeof value === "string" && key !== "adiSignature" && key !== "learnerSignature") parts.push(value);
  };
  collect(learner);
  for (const lesson of lessons) {
    collect(lesson);
    if (isPriorRecord(lesson)) parts.push(priorRecordLine(lesson));
  }
  return parts.join("\n");
}

export function createMeasurer(fontBytes: Uint8Array | ArrayBuffer): Measurer {
  return measurerFor(loadFont(fontBytes));
}

function measurerFor(fkFont: FkFont): Measurer {
  return {
    widthOfTextAtSize(text: string, size: number): number {
      if (!text) return 0;
      return (fkFont.layout(text).advanceWidth / fkFont.unitsPerEm) * size;
    },
  };
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node fallback only (tests/scripts); browsers always have atob.
  return new Uint8Array((globalThis as any).Buffer.from(base64, "base64"));
}

/** Word-wrap that also breaks unspaced runs (CJK has no spaces) character by character if a token alone overflows. */
export function wrapText(measurer: Measurer, text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      let remaining = word;
      while (remaining.length > 0) {
        const candidate = line ? `${line} ${remaining}` : remaining;
        if (measurer.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          line = candidate;
          remaining = "";
        } else if (line) {
          lines.push(line);
          line = "";
        } else {
          let cut = 1;
          while (cut < remaining.length && measurer.widthOfTextAtSize(remaining.slice(0, cut + 1), fontSize) <= maxWidth) cut++;
          lines.push(remaining.slice(0, cut));
          remaining = remaining.slice(cut);
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawSingleLine(page: PDFPage, font: PDFFont, measurer: Measurer, text: string, box: Box, fontSize = 8) {
  if (!text) return;
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.bottom - box.top;
  const clipped = measurer.widthOfTextAtSize(text, fontSize) > boxWidth - 4 ? wrapText(measurer, text, fontSize, boxWidth - 4)[0] : text;
  const y = PAGE_HEIGHT - box.bottom + (boxHeight - fontSize) / 2 + fontSize * 0.2;
  page.drawText(clipped, { x: box.x0 + 2, y, size: fontSize, font });
}

/** Lesson number cell text; a lesson edited after it was first saved is marked "(amended)" (Code of Practice 9.2: corrections must be visible). */
export function isAmended(lesson: Pick<Lesson, "revisionCount" | "editedBeforeRevisionHistory">): boolean {
  return lesson.revisionCount > 0 || lesson.editedBeforeRevisionHistory;
}

export function lessonNoLabel(lesson: Pick<Lesson, "lessonNo" | "revisionCount" | "editedBeforeRevisionHistory">): string {
  return isAmended(lesson) ? `#${lesson.lessonNo} (amended)` : `#${lesson.lessonNo}`;
}

/** Amended labels are longer, so they use a smaller size to stay on one line in the narrow date/lesson-no cell. */
export function lessonNoFontSize(lesson: Pick<Lesson, "revisionCount" | "editedBeforeRevisionHistory">): number {
  return isAmended(lesson) ? 5.5 : 7;
}

export type OverflowNote = { lessonNo: number; field: string; text: string; /** Replaces the "Lesson #n — field:" heading (prior-instructor lines). */ heading?: string };

/** Draws wrapped text top-aligned in a cell; on overflow, the last visible line becomes a pointer to the appendix (nothing is cut off — the full text goes on the appendix page). */
function drawCellText(page: PDFPage, font: PDFFont, measurer: Measurer, text: string | null, box: Box, lessonNo: number, field: string, overflowNotes: OverflowNote[]) {
  if (!text) return;
  const fontSize = 7;
  const lineHeight = fontSize + 2.5;
  const maxWidth = box.x1 - box.x0 - 4;
  const maxHeight = box.bottom - box.top - 4;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  const allLines = wrapText(measurer, text, fontSize, maxWidth);

  let lines = allLines;
  if (allLines.length > maxLines) {
    lines = allLines.slice(0, Math.max(0, maxLines - 1));
    lines.push("(see Additional Notes page)");
    overflowNotes.push({ lessonNo, field, text });
  }

  let y = PAGE_HEIGHT - box.top - 2 - fontSize;
  for (const line of lines) {
    page.drawText(line, { x: box.x0 + 2, y, size: fontSize, font });
    y -= lineHeight;
  }
}

async function drawSignature(doc: PDFDocument, page: PDFPage, dataUrl: string | null, box: Box) {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return;
  const bytes = base64ToBytes(dataUrl.slice("data:image/png;base64,".length));
  const png = await doc.embedPng(bytes);
  const boxWidth = box.x1 - box.x0 - 4;
  const boxHeight = box.bottom - box.top - 4;
  const scale = Math.min(boxWidth / png.width, boxHeight / png.height);
  const drawWidth = png.width * scale;
  const drawHeight = png.height * scale;
  const x = box.x0 + (box.x1 - box.x0 - drawWidth) / 2;
  const topY = box.top + (box.bottom - box.top - drawHeight) / 2;
  page.drawImage(png, { x, y: PAGE_HEIGHT - topY - drawHeight, width: drawWidth, height: drawHeight });
}

function subRows(top: number, bottom: number): { start: Box; finish: Box; total: Box; half1: Box; half2: Box } {
  const startFinish = top + ROW_SUB_OFFSETS.startFinishSplit;
  const finishTotal = top + ROW_SUB_OFFSETS.finishTotalSplit;
  const half = top + ROW_SUB_OFFSETS.dateSplit;
  const mk = (t: number, b: number, x0: number, x1: number): Box => ({ x0, x1, top: t, bottom: b });
  return {
    start: mk(top, startFinish, 0, 0),
    finish: mk(startFinish, finishTotal, 0, 0),
    total: mk(finishTotal, bottom, 0, 0),
    half1: mk(top, half, 0, 0),
    half2: mk(half, bottom, 0, 0),
  };
}

function drawHeader(page: PDFPage, font: PDFFont, measurer: Measurer, learner: Learner, pageNo: number, totalPages: number) {
  const f = HEADER_FIELDS;
  drawSingleLine(page, font, measurer, learner.instructorName, f.adiName, 9);
  drawSingleLine(page, font, measurer, learner.instructorAdiNumber ?? "", f.adiNumber, 9);
  drawSingleLine(page, font, measurer, learner.fullName, f.studentName, 9);
  drawSingleLine(page, font, measurer, String(pageNo), f.pageNo, 9);
  drawSingleLine(page, font, measurer, String(totalPages), f.pageOf, 9);
  drawSingleLine(page, font, measurer, learner.address ?? "", f.address, 8);
  drawSingleLine(page, font, measurer, learner.phone ?? "", f.phone, 8);
  drawSingleLine(page, font, measurer, learner.dob ?? "", f.dob, 8);
  drawSingleLine(page, font, measurer, learner.licenceNumber ?? "", f.licenceNumber, 8);
  drawSingleLine(page, font, measurer, learner.licenceExpiry ?? "", f.expiryDate, 8);
  drawSingleLine(page, font, measurer, learner.eligibility ?? "", f.eligibility, 8);
  drawSingleLine(page, font, measurer, learner.schoolWork ?? "", f.schoolWork, 8);

  const checkbox = (box: { x0: number; x1: number; top: number; bottom: number }) => {
    const size = 7;
    const x = box.x0 + (box.x1 - box.x0 - size) / 2;
    const y = PAGE_HEIGHT - box.bottom + (box.bottom - box.top - size) / 2;
    page.drawText("X", { x, y, size, font });
  };
  if (learner.transmission === "manual") checkbox(f.manualCheckbox);
  if (learner.transmission === "auto") checkbox(f.autoCheckbox);
}

/** This lesson's own "Total hrs" / "Total kms" cell text (not running totals — those are `cumulativeFooterText`). */
export function lessonTotalsText(lesson: Pick<Lesson, "durationMinutes" | "distanceKm">): { hours: string; km: string } {
  return {
    hours: lesson.durationMinutes === null ? "" : `${decimalHours(lesson.durationMinutes)} h`,
    km: lesson.distanceKm === null ? "" : `${lesson.distanceKm} km`,
  };
}

/** Text printed in both signature boxes: "Paper original" for lessons whose signatures are on the paper original; null otherwise (digital draws the PNG, unsigned draws nothing). */
export function signatureCellText(lesson: Pick<Lesson, "signatureStatus">): string | null {
  return lesson.signatureStatus === "on_paper" ? "Paper original" : null;
}

/** Running total shown under the table, as of the last lesson on the page; notes the prior-instructor hours/km it includes, if any. */
export function cumulativeFooterText(lesson: Pick<Lesson, "lessonNo" | "cumulativeMinutes" | "cumulativeKm">, prior: { minutes: number; km: number } | null = null): string {
  const base = `Cumulative to lesson #${lesson.lessonNo}: ${decimalHours(lesson.cumulativeMinutes)} h / ${lesson.cumulativeKm} km`;
  return prior ? `${base} (incl. prior instructors ${decimalHours(prior.minutes)} h / ${prior.km} km)` : base;
}

const CUMULATIVE_FOOTER_SIZE = 7;

function drawCumulativeFooter(page: PDFPage, font: PDFFont, lesson: Lesson, tableBottom: number, prior: { minutes: number; km: number } | null) {
  const size = CUMULATIVE_FOOTER_SIZE;
  const topDownBaseline = tableBottom + CUMULATIVE_FOOTER_GAP + size;
  page.drawText(cumulativeFooterText(lesson, prior), { x: COLUMNS.dateLessonNo.x0, y: PAGE_HEIGHT - topDownBaseline, size, font });
}

// Prior-instructor lines. Printers cannot print the outer ~6 mm of the sheet, so the old band
// above the title (8 pt from the top) was lost on paper. Measured on the template (poppler, 288 dpi):
// above the title only 18-29 pt is printable and free (one line); the gap between the title and the
// header boxes is 8 pt. The one band with room for two lines is page 1's bottom strip between the
// table border (560.25 pt) and the bottom printable edge, right of the cumulative footer.
export const PRINT_MARGIN = 18;
export const PRIOR_LINES_MAX = 2;
const PRIOR_FONT_SIZE = 6.5;
const PRIOR_BASELINES = [568, 575]; // top-down; glyph tops ≥ 562, last descender ≈ 576 (≤ 595 - 18)
const PRIOR_FOOTER_GAP = 12;
const PRIOR_CONTINUED = "Prior instructors continue on the Additional Notes page.";

export type PriorBand = { x0: number; x1: number; baselines: number[]; fontSize: number };

/** Where page 1's prior lines go: the bottom strip, starting right of that page's cumulative footer text. */
export function priorBand(measurer: Measurer, footerText: string): PriorBand {
  const x0 = COLUMNS.dateLessonNo.x0 + measurer.widthOfTextAtSize(footerText, CUMULATIVE_FOOTER_SIZE) + PRIOR_FOOTER_GAP;
  return { x0, x1: PAGE_WIDTH - PRINT_MARGIN, baselines: PRIOR_BASELINES, fontSize: PRIOR_FONT_SIZE };
}

/** Lines wrapped to the band width, at most PRIOR_LINES_MAX; if they don't fit, the full text goes to the Additional Notes page instead of being cut. */
export function planPriorLines(measurer: Measurer, lines: readonly string[], width: number): { drawn: string[]; appendix: string | null } {
  const wrapped = lines.flatMap((line) => wrapText(measurer, line, PRIOR_FONT_SIZE, width));
  if (wrapped.length <= PRIOR_LINES_MAX) return { drawn: wrapped, appendix: null };
  return { drawn: [...wrapped.slice(0, PRIOR_LINES_MAX - 1), PRIOR_CONTINUED], appendix: lines.join("\n") };
}

function drawPriorLines(page: PDFPage, font: PDFFont, band: PriorBand, lines: readonly string[]) {
  lines.forEach((line, i) => {
    page.drawText(line, { x: band.x0, y: PAGE_HEIGHT - band.baselines[i], size: band.fontSize, font });
  });
}

async function drawLessonRow(doc: PDFDocument, page: PDFPage, font: PDFFont, measurer: Measurer, lesson: Lesson, rowTop: number, rowBottom: number, overflowNotes: OverflowNote[]) {
  const sub = subRows(rowTop, rowBottom);
  const col = COLUMNS;

  // Date and lesson no.
  drawSingleLine(page, font, measurer, lesson.lessonDate, { ...sub.half1, x0: col.dateLessonNo.x0, x1: col.dateLessonNo.x1 }, 7);
  drawSingleLine(page, font, measurer, lessonNoLabel(lesson), { ...sub.half2, x0: col.dateLessonNo.x0, x1: col.dateLessonNo.x1 }, lessonNoFontSize(lesson));

  // Time & total hrs — "Total" is THIS lesson's own total, matching the paper form; running totals go in the page footer.
  const totals = lessonTotalsText(lesson);
  drawSingleLine(page, font, measurer, lesson.startTime ?? "", { ...sub.start, x0: col.timeHrs.x0, x1: col.timeHrs.x1 }, 7);
  drawSingleLine(page, font, measurer, lesson.finishTime ?? "", { ...sub.finish, x0: col.timeHrs.x0, x1: col.timeHrs.x1 }, 7);
  drawSingleLine(page, font, measurer, totals.hours, { ...sub.total, x0: col.timeHrs.x0, x1: col.timeHrs.x1 }, 7);

  // Odometer & total kms
  drawSingleLine(page, font, measurer, lesson.startOdometer === null ? "" : String(lesson.startOdometer), { ...sub.start, x0: col.odometerKms.x0, x1: col.odometerKms.x1 }, 7);
  drawSingleLine(page, font, measurer, lesson.finishOdometer === null ? "" : String(lesson.finishOdometer), { ...sub.finish, x0: col.odometerKms.x0, x1: col.odometerKms.x1 }, 7);
  drawSingleLine(page, font, measurer, totals.km, { ...sub.total, x0: col.odometerKms.x0, x1: col.odometerKms.x1 }, 7);

  // Wide free-text columns (full row height, one cell each).
  const fullRow = (x0: number, x1: number): Box => ({ x0, x1, top: rowTop, bottom: rowBottom });
  drawCellText(page, font, measurer, lesson.taught, fullRow(col.taught.x0, col.taught.x1), lesson.lessonNo, "Taught", overflowNotes);
  drawCellText(page, font, measurer, lesson.competenciesAssessed, fullRow(col.assessed.x0, col.assessed.x1), lesson.lessonNo, "Competencies Assessed", overflowNotes);
  drawCellText(page, font, measurer, lesson.achieved, fullRow(col.achieved.x0, col.achieved.x1), lesson.lessonNo, "Achieved", overflowNotes);
  drawCellText(page, font, measurer, lesson.location, fullRow(col.location.x0, col.location.x1), lesson.lessonNo, "Location", overflowNotes);
  drawCellText(page, font, measurer, lesson.comments, fullRow(col.comments.x0, col.comments.x1), lesson.lessonNo, "Comments", overflowNotes);

  // Signatures: top half = ADI, bottom half = Learner.
  const sigTop: Box = { x0: col.signatures.x0, x1: col.signatures.x1, top: rowTop + 9, bottom: rowTop + ROW_SUB_OFFSETS.signatureSplit };
  const sigBottom: Box = { x0: col.signatures.x0, x1: col.signatures.x1, top: rowTop + ROW_SUB_OFFSETS.signatureSplit + 9, bottom: rowBottom };
  const sigText = signatureCellText(lesson);
  if (sigText !== null) {
    drawSingleLine(page, font, measurer, sigText, sigTop, 7);
    drawSingleLine(page, font, measurer, sigText, sigBottom, 7);
  } else if (lesson.signatureStatus === "digital") {
    // `unsigned` intentionally draws nothing (neither text nor image).
    await drawSignature(doc, page, lesson.adiSignature, sigTop);
    await drawSignature(doc, page, lesson.learnerSignature, sigBottom);
  }
}

function drawContinuationPageNumber(page: PDFPage, font: PDFFont, pageNo: number, totalPages: number) {
  const text = `Page ${pageNo} of ${totalPages}`;
  const size = 7;
  page.drawText(text, { x: PAGE_WIDTH - 90, y: PAGE_HEIGHT - 18, size, font });
}

const APPENDIX_MARGIN_X = 40;
const APPENDIX_MARGIN_TOP = 40;
const APPENDIX_MARGIN_BOTTOM = 40;
const APPENDIX_FONT_SIZE = 9;
const APPENDIX_LINE_HEIGHT = 13;

/** Pure layout pass (no PDFPage needed) so the total page count is known before page 1's "Page 1 of N" is drawn. */
function planAppendixPages(measurer: Measurer, notes: OverflowNote[]): string[][] {
  if (!notes.length) return [];
  const usableWidth = PAGE_WIDTH - APPENDIX_MARGIN_X * 2;
  const usableHeight = PAGE_HEIGHT - APPENDIX_MARGIN_TOP - APPENDIX_MARGIN_BOTTOM - APPENDIX_LINE_HEIGHT * 2;
  const maxLinesPerPage = Math.max(5, Math.floor(usableHeight / APPENDIX_LINE_HEIGHT));

  const allLines: string[] = [];
  for (const note of notes) {
    allLines.push(note.heading ?? `Lesson #${note.lessonNo} — ${note.field}:`);
    allLines.push(...wrapText(measurer, note.text, APPENDIX_FONT_SIZE, usableWidth));
    allLines.push("");
  }
  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += maxLinesPerPage) pages.push(allLines.slice(i, i + maxLinesPerPage));
  return pages;
}

function drawAppendixPage(page: PDFPage, font: PDFFont, lines: string[], appendixIndex: number, pageNo: number, totalPages: number) {
  page.drawText(appendixIndex === 0 ? "Additional Notes (text that did not fit its cell above)" : "Additional Notes (continued)", {
    x: APPENDIX_MARGIN_X,
    y: PAGE_HEIGHT - APPENDIX_MARGIN_TOP,
    size: 12,
    font,
  });
  let y = PAGE_HEIGHT - APPENDIX_MARGIN_TOP - APPENDIX_LINE_HEIGHT * 2;
  for (const line of lines) {
    page.drawText(line, { x: APPENDIX_MARGIN_X, y, size: APPENDIX_FONT_SIZE, font });
    y -= APPENDIX_LINE_HEIGHT;
  }
  page.drawText(`Page ${pageNo} of ${totalPages}`, { x: PAGE_WIDTH - APPENDIX_MARGIN_X - 70, y: APPENDIX_MARGIN_BOTTOM / 2, size: 8, font });
}

export async function buildCbtaChecklistPdf(input: PdfExportInput): Promise<PdfExportResult> {
  const { templateBytes, fontBytes, learner } = input;
  // Table rows are lessons #1..N only; prior-instructor records are printed as lines above the table.
  const lessons = input.lessons.filter((lesson) => !isPriorRecord(lesson));
  const priorLessons = input.lessons.filter(isPriorRecord).sort((a, b) => a.lessonNo - b.lessonNo);
  const prior = priorTotals(priorLessons);
  if (lessons.length === 0) throw new Error("No saved lessons to export.");

  const groups: Lesson[][] = [lessons.slice(0, FIRST_PAGE_ROWS)];
  let rest = lessons.slice(FIRST_PAGE_ROWS);
  while (rest.length > 0) {
    groups.push(rest.slice(0, CONTINUATION_PAGE_ROWS));
    rest = rest.slice(CONTINUATION_PAGE_ROWS);
  }

  // Pick the font: the compact one unless the text needs a character only the full font has.
  const text = exportedText(learner, input.lessons);
  let fontData = toUint8Array(fontBytes);
  let fkFont = loadFont(fontData);
  let unsupported = missingChars(fkFont, text);
  if (unsupported.length > 0 && input.fallbackFontBytes) {
    try {
      const fullData = toUint8Array(await input.fallbackFontBytes());
      const fullFont = loadFont(fullData);
      const stillMissing = missingChars(fullFont, text);
      if (stillMissing.length < unsupported.length) {
        fontData = fullData;
        fkFont = fullFont;
        unsupported = stillMissing;
      }
    } catch {
      // Full font unavailable (e.g. offline): keep the compact font; missing characters are reported, never a crash.
    }
  }
  const measurer = measurerFor(fkFont);
  const subsetFont = !fontHasSubroutines(fkFont);

  const templateDoc = await PDFDocument.load(templateBytes);
  const outDoc = await PDFDocument.create();
  outDoc.registerFontkit(fontkit);
  // `locl` (localized forms) must be disabled: this font substitutes digits with alternate glyphs
  // under it that pdf-lib's width table (built from each codepoint's *default* glyph) doesn't cover,
  // making every digit render with a wrong (too-wide) advance — found via this feature's own visual
  // QA, confirmed with two independent PDF renderers (poppler and Chromium's PDFium).
  const font = await outDoc.embedFont(fontData, { subset: subsetFont, features: { locl: false } });
  if (subsetFont) patchCffHeader(font);

  // Dry-run the wide-column wrapping first (pure text measurement, no page needed) so we know how
  // many appendix pages are needed *before* drawing page 1's "Page 1 of N" field.
  const dryRunNotes: OverflowNote[] = [];
  // Page 1's prior lines sit right of its footer, so the band is measured from that footer's text.
  const band = priorBand(measurer, cumulativeFooterText(groups[0][groups[0].length - 1], prior));
  const priorPlan = planPriorLines(measurer, priorLessons.map(priorRecordLine), band.x1 - band.x0);
  if (priorPlan.appendix !== null) dryRunNotes.push({ lessonNo: 0, field: "Prior instructors", text: priorPlan.appendix, heading: "Prior instructors:" });
  for (const group of groups) {
    const rowTops = group === groups[0] ? FIRST_PAGE_ROW_TOPS : CONTINUATION_ROW_TOPS;
    const tableBottom = group === groups[0] ? FIRST_PAGE_TABLE_BOTTOM : CONTINUATION_TABLE_BOTTOM;
    group.forEach((lesson, i) => {
      const top = rowTops[i];
      const bottom = i + 1 < rowTops.length ? rowTops[i + 1] : tableBottom;
      const fields: [string, string | null][] = [
        ["Taught", lesson.taught],
        ["Competencies Assessed", lesson.competenciesAssessed],
        ["Achieved", lesson.achieved],
        ["Location", lesson.location],
        ["Comments", lesson.comments],
      ];
      const widths: Record<string, number> = {
        Taught: COLUMNS.taught.x1 - COLUMNS.taught.x0,
        "Competencies Assessed": COLUMNS.assessed.x1 - COLUMNS.assessed.x0,
        Achieved: COLUMNS.achieved.x1 - COLUMNS.achieved.x0,
        Location: COLUMNS.location.x1 - COLUMNS.location.x0,
        Comments: COLUMNS.comments.x1 - COLUMNS.comments.x0,
      };
      const fontSize = 7;
      const lineHeight = fontSize + 2.5;
      const maxLines = Math.max(1, Math.floor((bottom - top - 4) / lineHeight));
      for (const [field, text] of fields) {
        if (!text) continue;
        const lines = wrapText(measurer, text, fontSize, widths[field] - 4);
        if (lines.length > maxLines) dryRunNotes.push({ lessonNo: lesson.lessonNo, field, text });
      }
    });
  }
  const appendixPages = planAppendixPages(measurer, dryRunNotes);
  const totalPages = groups.length + appendixPages.length;

  let pageNo = 0;
  for (const group of groups) {
    const isFirst = group === groups[0];
    pageNo += 1;
    const [copied] = await outDoc.copyPages(templateDoc, [isFirst ? 0 : 1]);
    outDoc.addPage(copied);
    if (isFirst) {
      drawHeader(copied, font, measurer, learner, pageNo, totalPages);
      drawPriorLines(copied, font, band, priorPlan.drawn);
    } else drawContinuationPageNumber(copied, font, pageNo, totalPages);

    const rowTops = isFirst ? FIRST_PAGE_ROW_TOPS : CONTINUATION_ROW_TOPS;
    const tableBottom = isFirst ? FIRST_PAGE_TABLE_BOTTOM : CONTINUATION_TABLE_BOTTOM;
    for (let i = 0; i < group.length; i++) {
      const top = rowTops[i];
      const bottom = i + 1 < rowTops.length ? rowTops[i + 1] : tableBottom;
      // eslint-disable-next-line no-await-in-loop -- signatures must embed sequentially into the same page.
      await drawLessonRow(outDoc, copied, font, measurer, group[i], top, bottom, []);
    }
    drawCumulativeFooter(copied, font, group[group.length - 1], tableBottom, prior);
  }

  for (let i = 0; i < appendixPages.length; i++) {
    pageNo += 1;
    const page = outDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawAppendixPage(page, font, appendixPages[i], i, pageNo, totalPages);
  }

  const bytes = await outDoc.save();
  return { bytes, pageCount: outDoc.getPageCount(), hadOverflow: dryRunNotes.length > 0, unsupportedChars: unsupported };
}

export function plannedPageCount(lessonCount: number): number {
  if (lessonCount === 0) return 0;
  const remaining = Math.max(0, lessonCount - FIRST_PAGE_ROWS);
  return 1 + Math.ceil(remaining / CONTINUATION_PAGE_ROWS);
}
