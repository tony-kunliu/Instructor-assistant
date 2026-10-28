// Pure CSV parser and paper-records import planner (P1b). No DB access:
// lib/repo.ts calls planPaperImport and writes the result atomically.
// Competency rules mirror repo.ts#createLesson exactly.
import { distanceKm, durationMinutes, parseOdometer, parseTime } from "./calc.ts";
import {
  ALL_ASSESSABLE_IDS,
  CORE_COMPETENCY_IDS,
  CompetencyRuleError,
  FINAL_DRIVE_23,
  computeProgress,
  validateLessonCompetencies,
  type AssessmentResult,
  type CompetencyEvent,
  type LearnerProgress,
} from "./competency.ts";
import type { Instructor } from "./types.ts";

export const MAX_IMPORT_ROWS = 1000;

export const PAPER_CSV_COLUMNS = [
  "date", "start_time", "finish_time", "start_odometer", "finish_odometer", "taught", "assessed_achieved", "assessed_not_achieved", "location", "comments", "signature", "instructor",
  // Prior-instructor records (spec §12): always in the header, empty on lesson rows.
  "prior_instructor", "prior_lessons", "prior_hours", "prior_km",
] as const;

type PaperCsvColumn = (typeof PAPER_CSV_COLUMNS)[number];

/** Lesson columns a prior-instructor row must leave empty (it uses date, assessed_achieved and the prior_* columns only). */
const PRIOR_ROW_FORBIDDEN_COLUMNS: readonly PaperCsvColumn[] = ["start_time", "finish_time", "start_odometer", "finish_odometer", "taught", "assessed_not_achieved", "location", "comments", "signature", "instructor"];

const PRIOR_LABEL_MAX = 80;

/** A parsed record with its 1-based spreadsheet row number (blank/empty rows are skipped but still counted). */
export type CsvRecord = { row: number; cells: string[] };

/** RFC 4180 parser: quoted fields, "" escapes, embedded newlines, CRLF/LF, optional BOM. Blank lines and all-empty rows are skipped but still counted in `row`. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let sawContent = false; // anything (even an empty quoted field) on the current line
  let recordNo = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    recordNo++;
    if (sawContent && row.some((c) => c.trim() !== "")) records.push({ row: recordNo, cells: row });
    row = [];
    sawContent = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
      sawContent = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      sawContent = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      sawContent = true;
    }
  }
  if (sawContent || field !== "" || row.length) endRow();
  return records;
}

export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((r) => r.cells);
}

/** Spreadsheets rewrite 09:00 as 9:00 or 09:00:00; accept those (seconds must be 00) and normalise to HH:MM. Anything else is returned unchanged. */
function normaliseTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
}

export type PaperImportRowError = { row: number; message: string }; // row = spreadsheet row number: header = 1, first data row = 2; skipped blank rows still count

export type PlannedPaperLesson = {
  lessonNo: number; lessonDate: string;
  startTime: string | null; finishTime: string | null;
  startOdometer: number | null; finishOdometer: number | null;
  durationMinutes: number | null; distanceKm: number | null;
  cumulativeMinutes: number; cumulativeKm: number;
  taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, AssessmentResult>;
  location: string | null; comments: string | null;
  signatureStatus: "on_paper" | "unsigned"; instructorId: string;
};

/** One previous instructor's totals for a transfer learner (spec §12). lessonNo is negative: -k..-1 oldest first. */
export type PlannedPriorRecord = {
  lessonNo: number; date: string;
  label: string; lessonCount: number;
  minutes: number; km: number | null;
  cumulativeMinutes: number; cumulativeKm: number;
  achievedIds: string[];
};

export type PaperImportPreview = {
  /** Lesson rows only (prior-instructor records are not lessons of this App). */
  lessonCount: number;
  /** Include prior-instructor hours / km. */
  totalMinutes: number; totalKm: number;
  missingDataLessonNos: number[]; unsignedLessonNos: number[];
  progress: LearnerProgress;
  priorRecords: { label: string; lessonCount: number; minutes: number; km: number | null }[];
};

export type PaperImportPlan =
  | { ok: true; lessons: PlannedPaperLesson[]; priorRecords: PlannedPriorRecord[]; preview: PaperImportPreview }
  | { ok: false; errors: PaperImportRowError[] };

const COMPLETED_MESSAGE = "CBT&A is already completed for this learner — no further CBT&A lessons can be recorded.";

function text(value: string, max: number): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Splits a `;`-separated id cell. Pushes errors for unknown / duplicate ids. */
function idCell(value: string, allowed: readonly string[], column: string, errors: string[]): string[] {
  const out: string[] = [];
  if (!value.trim()) return out;
  for (const part of value.split(";")) {
    const id = part.trim();
    if (!id) continue;
    if (!allowed.includes(id)) errors.push(`Unknown competency id in ${column}: ${id}`);
    else if (out.includes(id)) errors.push(`Duplicate competency id in ${column}: ${id}`);
    else out.push(id);
  }
  return out;
}

export function planPaperImport(csvText: string, instructors: readonly Pick<Instructor, "id" | "fullName" | "status">[]): PaperImportPlan {
  const table = parseCsvRecords(csvText);
  if (table.length === 0) return { ok: false, errors: [{ row: 1, message: "No lessons found in the file." }] };

  const headerRow = table[0].row;
  const header = table[0].cells.map((h) => h.trim());
  const headerErrors: PaperImportRowError[] = [];
  for (const column of PAPER_CSV_COLUMNS) {
    if (!header.includes(column)) headerErrors.push({ row: headerRow, message: `Missing column: ${column}` });
  }
  header.forEach((column, i) => {
    if (!(PAPER_CSV_COLUMNS as readonly string[]).includes(column) && column !== "") headerErrors.push({ row: headerRow, message: `Unexpected column: ${column}` });
    else if (column !== "" && header.indexOf(column) !== i) headerErrors.push({ row: headerRow, message: `Duplicate column: ${column}` });
    else if (column === "") headerErrors.push({ row: headerRow, message: "Unexpected column: (blank)" });
  });
  if (headerErrors.length) return { ok: false, errors: headerErrors };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { ok: false, errors: [{ row: headerRow, message: "No lessons found in the file." }] };
  // Keeps one import a bounded, single-learner write (one bound JSON value per table in the commit batch).
  if (dataRows.length > MAX_IMPORT_ROWS) return { ok: false, errors: [{ row: 1, message: `Too many rows (max ${MAX_IMPORT_ROWS}). Split the file per learner.` }] };

  const errors: PaperImportRowError[] = [];
  const lessons: PlannedPaperLesson[] = [];
  const priorRecords: PlannedPriorRecord[] = [];
  const cellOf = (cells: string[], column: PaperCsvColumn) => (cells[header.indexOf(column)] ?? "").trim();
  const isPriorRow = (cells: string[]) => cellOf(cells, "prior_instructor") !== "";
  const priorRowCount = dataRows.filter(({ cells }) => isPriorRow(cells)).length;
  let sawLessonRow = false;
  const events: CompetencyEvent[] = [];
  let totalMinutes = 0;
  let totalKm = 0;
  let previousDate: string | null = null;
  let lastFinish: { odometer: number; row: number } | null = null;

  dataRows.forEach(({ row: rowNo, cells }) => {
    const get = (column: PaperCsvColumn) => cellOf(cells, column);
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const fieldErrors: string[] = [];

    if (cells.length > header.length && cells.slice(header.length).some((c) => c.trim())) fieldErrors.push("Row has more fields than the header.");

    const date = get("date");
    if (!isRealDate(date)) fieldErrors.push("Date must be a valid date in YYYY-MM-DD format.");
    else {
      if (previousDate !== null && date < previousDate) fieldErrors.push(`Date ${date} is earlier than the previous row (${previousDate}); rows must be in chronological order.`);
      previousDate = date;
    }

    // Prior-instructor record (spec §12, D10-D12): the previous instructor's totals and stamps.
    // Its achievements are recorded as stamped — no gate checks — but every lesson row after it
    // is validated against progress that includes them.
    if (isPriorRow(cells)) {
      if (sawLessonRow) fieldErrors.push("Prior-instructor rows must come before lesson rows.");
      if (PRIOR_ROW_FORBIDDEN_COLUMNS.some((column) => get(column) !== "")) fieldErrors.push("Prior-instructor rows only use date, assessed_achieved and the prior_* columns.");
      if (get("prior_instructor").length > PRIOR_LABEL_MAX) fieldErrors.push(`prior_instructor must be at most ${PRIOR_LABEL_MAX} characters.`);
      const lessonCountRaw = get("prior_lessons");
      const lessonCount = /^\d+$/.test(lessonCountRaw) ? Number(lessonCountRaw) : 0;
      if (!(lessonCount > 0 && Number.isSafeInteger(lessonCount))) fieldErrors.push("prior_lessons must be a positive whole number.");
      const hoursRaw = get("prior_hours");
      const minutes = /^\d+(\.\d)?$/.test(hoursRaw) ? Math.round(Number(hoursRaw) * 60) : 0;
      if (!(minutes > 0 && Number.isSafeInteger(minutes))) fieldErrors.push("prior_hours must be a positive number of hours with at most one decimal place (e.g. 20 or 12.5).");
      const kmRaw = get("prior_km");
      const km = kmRaw === "" ? null : parseOdometer(kmRaw);
      if (kmRaw !== "" && km === null) fieldErrors.push("prior_km must be a whole number of km, or blank.");
      const achievedIds = idCell(get("assessed_achieved"), ALL_ASSESSABLE_IDS, "assessed_achieved", fieldErrors);
      // A stamped 23 Final Drive would make the learner CBT&A Completed by a record that is not a lesson.
      if (achievedIds.includes(FINAL_DRIVE_23)) fieldErrors.push("23 Final Drive cannot be imported as a prior-instructor achievement.");
      if (fieldErrors.length) { fieldErrors.forEach(fail); return; }

      const lessonId = `prior-row-${rowNo}`;
      const createdAt = new Date(Date.UTC(2000, 0, 1, 0, 0, rowNo)).toISOString();
      const priorLessonNo = priorRecords.length - priorRowCount; // -k .. -1, oldest first
      for (const competencyId of achievedIds) events.push({ competencyId, action: "assessed", result: "achieved", lessonId, createdAt, lessonNo: priorLessonNo });
      totalMinutes += minutes;
      totalKm += km ?? 0;
      priorRecords.push({
        lessonNo: priorLessonNo,
        date,
        label: get("prior_instructor"),
        lessonCount, minutes, km,
        cumulativeMinutes: totalMinutes, cumulativeKm: totalKm,
        achievedIds,
      });
      return;
    }
    sawLessonRow = true;
    if (get("prior_lessons") || get("prior_hours") || get("prior_km")) fieldErrors.push("Lesson rows must leave prior_lessons, prior_hours and prior_km empty.");

    const startRaw = normaliseTime(get("start_time"));
    const finishRaw = normaliseTime(get("finish_time"));
    let startTime: string | null = null;
    let finishTime: string | null = null;
    let duration: number | null = null;
    if (startRaw || finishRaw) {
      if (!startRaw || !finishRaw) fieldErrors.push("Enter both start and finish time, or leave both blank.");
      else if (parseTime(startRaw) === null || parseTime(finishRaw) === null) fieldErrors.push("Times must be HH:MM (24-hour).");
      else {
        duration = durationMinutes(startRaw, finishRaw);
        if (duration === null) fieldErrors.push("Finish time must be after start time.");
        else { startTime = startRaw; finishTime = finishRaw; }
      }
    }

    const startOdoRaw = get("start_odometer");
    const finishOdoRaw = get("finish_odometer");
    let startOdometer: number | null = null;
    let finishOdometer: number | null = null;
    let distance: number | null = null;
    if (startOdoRaw || finishOdoRaw) {
      if (!startOdoRaw || !finishOdoRaw) fieldErrors.push("Enter both start and finish odometer, or leave both blank.");
      else {
        const start = parseOdometer(startOdoRaw);
        const finish = parseOdometer(finishOdoRaw);
        if (start === null || finish === null) fieldErrors.push("Odometer readings must be whole km.");
        else if (distanceKm(start, finish) === null) fieldErrors.push("Finish odometer must not be less than start odometer.");
        else if (lastFinish && start < lastFinish.odometer) fieldErrors.push(`Start odometer ${start} is lower than the finish odometer ${lastFinish.odometer} of row ${lastFinish.row}.`);
        else {
          startOdometer = start;
          finishOdometer = finish;
          distance = finish - start;
          lastFinish = { odometer: finish, row: rowNo };
        }
      }
    }

    const taughtIds = idCell(get("taught"), CORE_COMPETENCY_IDS, "taught", fieldErrors);
    const achievedList = idCell(get("assessed_achieved"), ALL_ASSESSABLE_IDS, "assessed_achieved", fieldErrors);
    const notAchievedList = idCell(get("assessed_not_achieved"), ALL_ASSESSABLE_IDS, "assessed_not_achieved", fieldErrors);
    for (const id of achievedList) {
      if (notAchievedList.includes(id)) fieldErrors.push(`Competency ${id} is in both assessed_achieved and assessed_not_achieved.`);
    }
    const assessedIds = [...achievedList, ...notAchievedList.filter((id) => !achievedList.includes(id))];
    const achievedResults: Record<string, AssessmentResult> = {};
    for (const id of achievedList) achievedResults[id] = "achieved";
    for (const id of notAchievedList) if (!(id in achievedResults)) achievedResults[id] = "not_achieved";

    const signatureRaw = get("signature");
    if (signatureRaw !== "on_paper" && signatureRaw !== "unsigned") fieldErrors.push(signatureRaw ? `Signature must be on_paper or unsigned, not "${signatureRaw.slice(0, 40)}".` : "Signature is empty: write on_paper (signed on the paper record) or unsigned.");

    const instructorName = get("instructor");
    const instructor = instructors.find((i) => i.fullName === instructorName && i.status === "active");
    if (!instructor) fieldErrors.push(`Instructor "${instructorName}" is not an active instructor.`);

    if (fieldErrors.length) {
      fieldErrors.forEach(fail);
      return; // no competency checks once fields are invalid
    }

    // Mirrors repo.ts#createLesson.
    const progress = computeProgress(events);
    if (progress.completed) { fail(COMPLETED_MESSAGE); return; }
    try {
      validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progress);
    } catch (error) {
      if (error instanceof CompetencyRuleError) { fail(error.message); return; }
      throw error;
    }

    const lessonId = `paper-row-${rowNo}`;
    const createdAt = new Date(Date.UTC(2000, 0, 1, 0, 0, rowNo)).toISOString();
    const lessonNo = lessons.length + 1;
    for (const competencyId of taughtIds) events.push({ competencyId, action: "taught", result: null, lessonId, createdAt, lessonNo });
    for (const competencyId of assessedIds) events.push({ competencyId, action: "assessed", result: achievedResults[competencyId] ?? null, lessonId, createdAt, lessonNo });

    totalMinutes += duration ?? 0;
    totalKm += distance ?? 0;
    lessons.push({
      lessonNo,
      lessonDate: date,
      startTime, finishTime, startOdometer, finishOdometer,
      durationMinutes: duration, distanceKm: distance,
      cumulativeMinutes: totalMinutes, cumulativeKm: totalKm,
      taughtIds, assessedIds, achievedResults,
      location: text(get("location"), 200),
      comments: text(get("comments"), 3000),
      signatureStatus: signatureRaw as "on_paper" | "unsigned",
      instructorId: instructor!.id,
    });
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    lessons,
    priorRecords,
    preview: {
      lessonCount: lessons.length,
      totalMinutes,
      totalKm,
      missingDataLessonNos: lessons.filter((l) => l.durationMinutes === null || l.distanceKm === null).map((l) => l.lessonNo),
      unsignedLessonNos: lessons.filter((l) => l.signatureStatus === "unsigned").map((l) => l.lessonNo),
      progress: computeProgress(events),
      priorRecords: priorRecords.map(({ label, lessonCount, minutes, km }) => ({ label, lessonCount, minutes, km })),
    },
  };
}
