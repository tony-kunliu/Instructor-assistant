// Display text for prior-instructor records (spec §12, D11): the same line in
// History and on the PDF, so every view says which instructor the prior
// hours/km came from. Pure and isomorphic (used by the client and the PDF).
import { decimalHours } from "./calc.ts";
import type { Lesson } from "./types.ts";

/** The one test for "is this a prior-instructor record" (spec §12), used by the PDF, the UI and the repo. */
export function isPriorRecord(lesson: Pick<Lesson, "recordSource">): boolean {
  return lesson.recordSource === "prior_instructor";
}

/**
 * Collapses runs of 3+ consecutive competency numbers in a stored achieved
 * list ("1, 2, 3, 4, Review 1-17" → "1-4, Review 1-17"). Non-numeric entries
 * (reviews, 23 Final Drive) are kept as they are, in place. Display-only.
 */
export function compactIdText(text: string | null): string | null {
  if (!text) return text;
  const out: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(`${run[0]}-${run[run.length - 1]}`);
    else out.push(...run.map(String));
    run = [];
  };
  for (const part of text.split(", ")) {
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (run.length && n !== run[run.length - 1] + 1) flush();
      run.push(n);
    } else {
      flush();
      out.push(part);
    }
  }
  flush();
  return out.join(", ");
}

type PriorFields = Pick<Lesson, "priorInstructorLabel" | "priorLessonCount" | "durationMinutes" | "distanceKm" | "achieved">;

/** "Prior instructor: ADI 358 · 11 lessons · 20.0 h · 150 km" — the totals part, also used by the import preview. */
export function priorSummaryLine(record: { label: string; lessonCount: number; minutes: number; km: number | null }): string {
  const parts = [
    `Prior instructor: ${record.label}`,
    `${record.lessonCount} ${record.lessonCount === 1 ? "lesson" : "lessons"}`,
    `${decimalHours(record.minutes)} h`,
  ];
  if (record.km !== null) parts.push(`${record.km} km`);
  return parts.join(" · ");
}

/** "Prior instructor: ADI 358 · 11 lessons · 20.0 h · 150 km · achieved 1-22, Review 1-17, Review 1-22" (km and achieved only when present). */
export function priorRecordLine(lesson: PriorFields): string {
  const summary = priorSummaryLine({ label: lesson.priorInstructorLabel ?? "", lessonCount: lesson.priorLessonCount ?? 0, minutes: lesson.durationMinutes ?? 0, km: lesson.distanceKm });
  const achieved = compactIdText(lesson.achieved);
  return achieved ? `${summary} · achieved ${achieved}` : summary;
}

/** Splits a learner's rows for display: prior-instructor records (oldest first) and lessons #1..N (order kept). */
export function splitPriorRecords<T extends Pick<Lesson, "recordSource" | "lessonNo">>(rows: readonly T[]): { prior: T[]; lessons: T[] } {
  return {
    prior: rows.filter(isPriorRecord).sort((a, b) => a.lessonNo - b.lessonNo),
    lessons: rows.filter((row) => !isPriorRecord(row)),
  };
}

/** Sum of the prior-instructor rows' hours/km, or null when the learner has none. */
export function priorTotals(lessons: readonly Pick<Lesson, "recordSource" | "durationMinutes" | "distanceKm">[]): { minutes: number; km: number } | null {
  const prior = lessons.filter(isPriorRecord);
  if (!prior.length) return null;
  return {
    minutes: prior.reduce((sum, lesson) => sum + (lesson.durationMinutes ?? 0), 0),
    km: prior.reduce((sum, lesson) => sum + (lesson.distanceKm ?? 0), 0),
  };
}

/** Import preview: the part of the Hours / Km totals that comes from prior-instructor records, or null when there are none. */
export function priorPreviewNote(records: readonly { label: string; lessonCount: number; minutes: number; km: number | null }[]): string | null {
  if (!records.length) return null;
  const minutes = records.reduce((sum, record) => sum + record.minutes, 0);
  const km = records.reduce((sum, record) => sum + (record.km ?? 0), 0);
  return `incl. ${decimalHours(minutes)} h / ${km} km from previous instructors`;
}
