// Regression tests for the compact-font PDF export: the CBT&A PDF used to embed the whole 16 MB
// Noto Sans SC (10+ MB per export). It now embeds only the glyphs a document uses, taken from a
// static GB2312 subset (public/fonts/NotoSansSC-Subset.otf), and falls back to the full font when a
// character is outside that subset. See scripts/build-pdf-font-subset.py for why the subset is static.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildCbtaChecklistPdf, exportStatusLine, exportWarning, fontHasSubroutines, patchCffHeader, type PdfExportInput } from "../lib/pdf-export.ts";
import type { Learner, Lesson } from "../lib/types.ts";

const templateBytes = readFileSync(new URL("../public/pdf-template/adi-cbta-checklist.pdf", import.meta.url));
const subsetFont = readFileSync(new URL("../public/fonts/NotoSansSC-Subset.otf", import.meta.url));
const fullFont = readFileSync(new URL("../public/fonts/NotoSansSC-Regular.otf", import.meta.url));

const learner: Learner = {
  id: "learner-1", instructorId: "instructor-1", instructorName: "Test Instructor", instructorAdiNumber: "ADI-9", fullName: "Test Learner",
  address: "1 Test St", phone: "0400 000 000", dob: "2008-01-01", licenceNumber: "L1", licenceExpiry: "2030-01-01", eligibility: "Eligible",
  addressSuburb: null,
  addressState: null,
  addressPostcode: null,
  transmission: "manual", schoolWork: null, licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null, archivedAt: null, archiveReason: null, archiveNote: null, transfers: [],
};

function lesson(n: number, overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: `lesson-${n}`, learnerId: "learner-1", instructorId: "instructor-1", lessonNo: n, lessonDate: "2026-01-01", startTime: "09:00", finishTime: "09:30",
    startOdometer: n * 10, finishOdometer: n * 10 + 5, durationMinutes: 30, distanceKm: 5, cumulativeMinutes: n * 30, cumulativeKm: n * 5,
    taught: "1, 2", competenciesAssessed: "3", achieved: "3", location: "Belconnen", comments: "Good", adiSignature: null, learnerSignature: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null, updatedByInstructorId: null, updatedByInstructorName: null, recordSource: "app",
    signatureStatus: "unsigned", priorInstructorLabel: null, priorLessonCount: null, revisionCount: 0, editedBeforeRevisionHistory: false, ...overrides,
  };
}

const compact = (extra: Partial<PdfExportInput> = {}): Pick<PdfExportInput, "templateBytes" | "fontBytes" | "fallbackFontBytes"> => ({ templateBytes, fontBytes: subsetFont, fallbackFontBytes: async () => fullFont, ...extra });

/** Skip message for a missing poppler. Fails instead only when REQUIRE_POPPLER=1, which is set ONLY in .github/workflows/ci.yml (it installs poppler-utils). The generic CI variable must not be used: the Cloudflare Workers Builds builder and Production Release have CI set and no poppler. */
const PDFTOTEXT_MISSING = "pdftotext (poppler-utils) is not installed, so the poppler text/position equivalence check was skipped; install poppler-utils to run it (set REQUIRE_POPPLER=1 to make this a failure)";

function noPoppler(t: TestContext): void {
  if (process.env.REQUIRE_POPPLER === "1") assert.fail(PDFTOTEXT_MISSING);
  t.skip(PDFTOTEXT_MISSING);
}

function pdftotext(bytes: Uint8Array, args: string[]): string | null {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "font-subset-")), "out.pdf");
  writeFileSync(file, bytes);
  try {
    const out = execFileSync("pdftotext", [...args, file, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
    return out.split("\n").filter((line) => !line.startsWith("<meta ")).join("\n"); // -bbox prints the creation timestamp
  } catch { return null; } // null: poppler not installed
}

const SHAPES: Record<string, { learner: Learner; lessons: Lesson[] }> = {
  oneLesson: { learner, lessons: [lesson(1)] },
  chinese: {
    learner: { ...learner, fullName: "张伟 李娜", address: "堪培拉市贝尔康嫩路12号" },
    lessons: [lesson(1, { location: "贝尔康嫩 Belconnen", comments: "学习了坡道起步和平行停车，表现很好。Good job 123." }), lesson(2, { comments: "练习环岛，注意观察后视镜。".repeat(8), revisionCount: 2 })],
  },
  latin: {
    learner: { ...learner, fullName: "O'Brien-Smith, Jr." },
    lessons: [lesson(1, { revisionCount: 1, comments: "Digits 0123456789 punctuation !?.,;:'\"()[]{}<>@#$%^&*-_=+/\\|~`" }), lesson(2, { comments: "naïve café — “quotes” €£ © ® ° ± × ÷ ½" })],
  },
  sixtyLessons: {
    learner,
    lessons: [
      lesson(-1, { recordSource: "prior_instructor", signatureStatus: "on_paper", priorInstructorLabel: "Prior School A", priorLessonCount: 5, durationMinutes: 300, distanceKm: 120, taught: null, competenciesAssessed: null, achieved: "1, 2, 3" }),
      ...Array.from({ length: 60 }, (_, i) => lesson(i + 1, { recordSource: i % 7 === 0 ? "paper_import" : "app", signatureStatus: i % 7 === 0 ? "on_paper" : "unsigned", revisionCount: i % 5 === 0 ? 1 : 0, comments: i === 3 ? "Hill starts 0123456789; ".repeat(40) : "Good 12:30 (ok), 3.5 h/45 km!" })),
    ],
  },
};

test("compact font: a PDF is a small fraction of the old 10+ MB for every typical shape", async () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const { bytes } = await buildCbtaChecklistPdf({ ...compact(), ...shape });
    assert.ok(bytes.length < 400_000, `${name}: ${bytes.length} bytes`);
  }
  const typical = await buildCbtaChecklistPdf({ ...compact(), ...SHAPES.oneLesson });
  assert.ok(typical.bytes.length < 100_000, `one lesson: ${typical.bytes.length} bytes`);
});

test("compact font: pdftotext output and every word's position are identical to embedding the whole font (digit advances, '#2 (amended)', Chinese, prior lines, appendix)", async (t) => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const small = await buildCbtaChecklistPdf({ ...compact(), ...shape });
    const whole = await buildCbtaChecklistPdf({ templateBytes, fontBytes: fullFont, ...shape });
    assert.equal(small.pageCount, whole.pageCount, name);
    assert.equal(small.hadOverflow, whole.hadOverflow, name);
    for (const args of [["-layout"], ["-bbox"]]) {
      const a = pdftotext(small.bytes, args);
      const b = pdftotext(whole.bytes, args);
      if (a === null || b === null) return noPoppler(t);
      assert.equal(a, b, `${name} ${args[0]}`);
    }
  }
  const text = pdftotext((await buildCbtaChecklistPdf({ ...compact(), ...SHAPES.chinese })).bytes, ["-layout"]);
  if (text === null) return noPoppler(t);
  for (const expected of ["张伟 李娜", "堪培拉市贝尔康嫩路12号", "贝尔康嫩 Belconnen", "#2 (amended)", "2026-01-01"]) assert.ok(text.includes(expected), expected);
});

test("compact font: the embedded font file is a valid CFF (header offSize 1-4; fontkit's subsetter writes garbage there, which FreeType/PDFium/MuPDF reject) with no subroutines", async () => {
  const { bytes } = await buildCbtaChecklistPdf({ ...compact(), ...SHAPES.chinese });
  const doc = await PDFDocument.load(bytes);
  const cff = [...doc.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .filter((obj): obj is PDFRawStream => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype"))?.toString() === "/CIDFontType0C");
  assert.equal(cff.length, 1, "exactly one embedded font program");
  const data = decodePDFRawStream(cff[0]).decode();
  assert.deepEqual([data[0], data[1], data[2]], [1, 0, 4], "CFF header major/minor/hdrSize");
  assert.ok(data[3] >= 1 && data[3] <= 4, `offSize ${data[3]}`);
  assert.ok(data.length < 150_000, "only the used glyphs are embedded");
});

test("static subset invariants: no subroutines (what makes per-document subsetting safe); the full font has them; lib refuses to subset fonts that do", () => {
  assert.equal(fontHasSubroutines(fontkit.create(subsetFont as unknown as Buffer)), false);
  assert.equal(fontHasSubroutines(fontkit.create(fullFont as unknown as Buffer)), true);
});

test("static subset covers all fixed text the export draws plus Latin-1, punctuation and common hanzi", () => {
  const f = fontkit.create(subsetFont as unknown as Buffer);
  const needed = "Additional Notes (text that did not fit its cell above) (see Additional Notes page) Prior instructor: · — Page of Cumulative to lesson #: h / km (incl. prior instructors) Paper original (amended) 0123456789 X ‘’“”…€éüñ堪张伟李娜，。、：；！？（）";
  for (const ch of needed) assert.ok(f.hasGlyphForCodePoint(ch.codePointAt(0)!), `U+${ch.codePointAt(0)!.toString(16)} ${ch}`);
});

const RARE_HANZI = "龘"; // U+9F98: not in GB2312 nor the common subset, but in the full font
const SYMBOL = "☂"; // in the full font, not CJK: must NOT trigger the full-font download

test("a rare CJK character outside the compact font loads the full font once and is drawn (output matches the whole-font export)", async (t) => {
  let loads = 0;
  const shape = { learner, lessons: [lesson(1, { comments: `rare ${RARE_HANZI} end` })] };
  const viaFallback = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { loads++; return fullFont; } }), ...shape });
  assert.equal(loads, 1);
  assert.equal(viaFallback.fullFontStatus, "used");
  assert.deepEqual(viaFallback.unsupportedChars, []);
  assert.equal(exportWarning(viaFallback), null);
  const whole = await buildCbtaChecklistPdf({ templateBytes, fontBytes: fullFont, ...shape });
  const a = pdftotext(viaFallback.bytes, ["-layout"]);
  const b = pdftotext(whole.bytes, ["-layout"]);
  if (a === null || b === null) return noPoppler(t);
  assert.equal(a, b);
  assert.ok(a.includes(`rare ${RARE_HANZI} end`));
});

test("a non-CJK symbol the full font has (☂) does NOT download the full font: it is reported instead", async () => {
  let loads = 0;
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { loads++; return fullFont; } }), learner, lessons: [lesson(1, { comments: `umbrella ${SYMBOL} end` })] });
  assert.equal(loads, 0);
  assert.equal(result.fullFontStatus, "not-needed");
  assert.deepEqual(result.unsupportedChars, [SYMBOL]);
});

test("a full font that loads but cannot draw the missing character is reported as 'unhelpful' (not 'used'), and the compact font is kept", async () => {
  // The compact font as the 'full' font: loads fine but also lacks the rare character.
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => subsetFont }), learner, lessons: [lesson(1, { comments: `x ${RARE_HANZI}` })] });
  assert.equal(result.fullFontStatus, "unhelpful");
  assert.deepEqual(result.unsupportedChars, [RARE_HANZI]);
});

test("the full font is not loaded when the compact font covers everything (Chinese names, common hanzi)", async () => {
  let loads = 0;
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { loads++; return fullFont; } }), ...SHAPES.chinese });
  assert.equal(loads, 0);
  assert.equal(result.fullFontStatus, "not-needed");
  assert.deepEqual(result.unsupportedChars, []);
});

test("traditional name characters (陳 鄭 張 李) are in the compact font: no full-font download", async () => {
  let loads = 0;
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { loads++; return fullFont; } }), learner: { ...learner, fullName: "陳鄭張李" }, lessons: [lesson(1)] });
  assert.equal(loads, 0);
  assert.deepEqual(result.unsupportedChars, []);
});

test("emoji no font has: no full-font download, reported, export completes and stays small", async () => {
  let loads = 0;
  const shape = { learner, lessons: [lesson(1, { comments: "car 🚗 ok" }), lesson(2, { comments: "Plain after" })] };
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { loads++; return fullFont; } }), ...shape });
  assert.equal(loads, 0);
  assert.deepEqual(result.unsupportedChars, ["🚗"]);
  assert.equal(result.fullFontStatus, "not-needed");
  assert.ok(result.bytes.length < 400_000, "no point embedding the 16 MB font when it lacks the glyph too");
  assert.match(exportWarning(result) ?? "", /🚗/);
});

test("if the full-font download fails (404 / login page / offline), the export is not a crash: status 'failed', CJK characters reported, warning names them", async () => {
  const result = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { throw new Error("HTTP 404"); } }), learner, lessons: [lesson(1, { comments: `x ${RARE_HANZI} y` })] });
  assert.equal(result.fullFontStatus, "failed");
  assert.deepEqual(result.unsupportedChars, [RARE_HANZI]);
  assert.equal(result.pageCount, 1);
  const warning = exportWarning(result) ?? "";
  assert.match(warning, new RegExp(RARE_HANZI));
  assert.match(warning, /could not be downloaded/);
});

test("without a fallback loader a rare CJK character is reported as failed, never a crash", async () => {
  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes: subsetFont, learner, lessons: [lesson(1, { comments: `ꙮ ${RARE_HANZI}` })] });
  assert.equal(result.fullFontStatus, "failed");
  assert.deepEqual(result.unsupportedChars, ["ꙮ", RARE_HANZI]);
});

test("exportWarning: null for a complete PDF; names every missing character (singular/plural wording)", () => {
  assert.equal(exportWarning({ unsupportedChars: [], fullFontStatus: "not-needed" }), null);
  assert.match(exportWarning({ unsupportedChars: ["🚗"], fullFontStatus: "not-needed" }) ?? "", /this character.*"🚗".*empty boxes/);
  assert.match(exportWarning({ unsupportedChars: ["🚗", "☂"], fullFontStatus: "not-needed" }) ?? "", /these characters.*"🚗" "☂"/);
});

test("patchCffHeader throws when pdf-lib no longer exposes serializeFont (never a silent skip), and repairs offSize otherwise", async () => {
  assert.throws(() => patchCffHeader({}), /serializeFont is required/);
  const fake = { embedder: { serializeFont: async () => new Uint8Array([1, 0, 4, 0x1b, 0, 0]) } };
  patchCffHeader(fake);
  const repaired = await fake.embedder.serializeFont();
  assert.deepEqual([...repaired.slice(0, 4)], [1, 0, 4, 4]);
});

test("diagnostic: an English-only export reports the compact font, no triggers, and a compact status line", async () => {
  const result = await buildCbtaChecklistPdf({ ...compact(), ...SHAPES.latin });
  assert.equal(result.embeddedFont, "compact");
  assert.deepEqual(result.fontTriggers, []);
  assert.match(exportStatusLine(result), /^PDF ready: \d+ KB \(compact font\)$/);
});

test("diagnostic: a rare hanzi names the character, its code point and the field(s) it came from; the full font is reported as used", async () => {
  const shape = { learner: { ...learner, fullName: `Test ${RARE_HANZI}` }, lessons: [lesson(1), lesson(3, { comments: `a ${RARE_HANZI} b` })] };
  const result = await buildCbtaChecklistPdf({ ...compact(), ...shape });
  assert.equal(result.embeddedFont, "full");
  assert.equal(result.fullFontStatus, "used");
  assert.deepEqual(result.fontTriggers, [{ char: RARE_HANZI, codePoint: "U+9F98", fields: ["learner name", "lesson #3 comments"] }]);
  const line = exportStatusLine(result);
  assert.match(line, /^PDF ready: \d+\.\d MB \(full font used for: 龘 U\+9F98 in learner name, lesson #3 comments\)$/);
});

test("diagnostic: the status line lists at most 10 characters and counts the rest", () => {
  const triggers = Array.from({ length: 12 }, (_, i) => ({ char: String.fromCodePoint(0x3400 + i), codePoint: `U+${(0x3400 + i).toString(16).toUpperCase()}`, fields: ["lesson #1 comments"] }));
  const line = exportStatusLine({ bytes: new Uint8Array(13_900_000), fullFontStatus: "used", embeddedFont: "full", fontTriggers: triggers });
  assert.match(line, /^PDF ready: 13\.9 MB \(full font used for: /);
  assert.equal((line.match(/U\+34/g) ?? []).length, 10);
  assert.match(line, /\+2 more\)$/);
});

test("diagnostic: failed and unhelpful full fonts are named honestly in the status line", async () => {
  const failed = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => { throw new Error("404"); } }), learner, lessons: [lesson(1, { comments: RARE_HANZI })] });
  assert.equal(failed.embeddedFont, "compact");
  assert.match(exportStatusLine(failed), /full font needed but could not be loaded, for: 龘/);
  const unhelpful = await buildCbtaChecklistPdf({ ...compact({ fallbackFontBytes: async () => subsetFont }), learner, lessons: [lesson(1, { comments: RARE_HANZI })] });
  assert.match(exportStatusLine(unhelpful), /full font did not help for: 龘/);
});

test("diagnostic: the gate's punctuation ranges are fully covered by the compact font, so only ideographs outside the subset can trigger the full font", () => {
  const f = fontkit.create(subsetFont as unknown as Buffer);
  const full = fontkit.create(fullFont as unknown as Buffer);
  for (const [from, to] of [[0x3000, 0x303f], [0xff00, 0xffef]]) {
    for (let cp = from; cp <= to; cp++) if (full.hasGlyphForCodePoint(cp)) assert.ok(f.hasGlyphForCodePoint(cp), `U+${cp.toString(16)} is in the full font and the gate but not the compact font`);
  }
  // Plausible pasted punctuation and spaces.
  for (const ch of "，。：；！？（）、《》【】“”‘’…—·　￥℃№\u2002\u2003") assert.ok(f.hasGlyphForCodePoint(ch.codePointAt(0)!), `U+${ch.codePointAt(0)!.toString(16)}`);
});
