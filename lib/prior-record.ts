// Display text for prior-instructor records (spec §12, D11): the same line in
// History and on the PDF, so every view says which instructor the prior
// hours/km came from. Pure and isomorphic (used by the client and the PDF).
import { decimalHours } from "./calc.ts";
import type { Lesson } from "./types.ts";

/** 1200 → "20", 390 → "6.5" (decimal hours, one place, no trailing ".0"). */
export function shortHours(minutes: number): string {
  return decimalHours(minutes).replace(/\.0$/, "");
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

/** "Prior instructor: ADI 358 · 11 lessons · 20 h · 150 km · achieved 1-22, Review 1-17, Review 1-22" (km and achieved only when present). */
export function priorRecordLine(lesson: PriorFields): string {
  const count = lesson.priorLessonCount ?? 0;
  const parts = [
    `Prior instructor: ${lesson.priorInstructorLabel ?? ""}`,
    `${count} ${count === 1 ? "lesson" : "lessons"}`,
    `${shortHours(lesson.durationMinutes ?? 0)} h`,
  ];
  if (lesson.distanceKm !== null) parts.push(`${lesson.distanceKm} km`);
  const achieved = compactIdText(lesson.achieved);
  if (achieved) parts.push(`achieved ${achieved}`);
  return parts.join(" · ");
}

/** Sum of the prior-instructor rows' hours/km, or null when the learner has none. */
export function priorTotals(lessons: readonly Pick<Lesson, "recordSource" | "durationMinutes" | "distanceKm">[]): { minutes: number; km: number } | null {
  const prior = lessons.filter((lesson) => lesson.recordSource === "prior_instructor");
  if (!prior.length) return null;
  return {
    minutes: prior.reduce((sum, lesson) => sum + (lesson.durationMinutes ?? 0), 0),
    km: prior.reduce((sum, lesson) => sum + (lesson.distanceKm ?? 0), 0),
  };
}
