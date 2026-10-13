// Lesson record screen (UI redesign approved by Tony 2026-10-12): the pure view-model behind the lesson card.
//
// Presentation only. Every figure comes from the same helpers the app already used (lib/calc.ts durations, km,
// totals and lesson numbers; lib/competency.ts gate statuses); nothing here is typed by the instructor, and
// nothing here changes a rule, a validation or a payload (AGENTS.md "Project rules": derived values are
// calculated, never typed).
import { decimalHours, formatMinutes, nextLessonNo, type Totals } from "./calc.ts";
import type { ReviewState } from "./competency.ts";
import { formatDate } from "./rules.ts";
import type { Learner } from "./types.ts";

export type LessonPhase = "ready" | "running" | "ended";

/** Ready until Start Lesson stamps the start time, running until End Lesson stamps the finish time, ended after that. */
export function lessonPhase(draft: { startTime: string; finishTime: string } | null): LessonPhase {
  if (!draft || !draft.startTime) return "ready";
  return draft.finishTime ? "ended" : "running";
}

/** Tony's decision (2): the primary "Save Lesson #N" action appears only after End Lesson — never a greyed-out Save before. */
export function showsSaveBar(phase: LessonPhase): boolean {
  return phase === "ended";
}

export type GateTag = { label: string; state: "done" | "next" | "locked" };

/** The status tag on the Review 1-17 / Review 1-22 / 23 Final Drive buttons, from the derived progress status. */
export function gateTag(status: ReviewState): GateTag {
  if (status === "achieved") return { label: "✓ Achieved", state: "done" };
  if (status === "ready") return { label: "Ready to assess", state: "next" };
  return { label: "Locked", state: "locked" };
}

export type DerivedStats = {
  /** Always totals.lessonCount + 1 (lib/calc.ts#nextLessonNo). */
  lessonNo: number;
  /** This lesson's own duration / km ("—" until End Lesson and the finish odometer give them). */
  thisLesson: { duration: string; km: string };
  /** Today's totals plus whatever of this lesson is already known. */
  totalAfter: { duration: string; decimalHours: string; km: string };
  /** Both of this lesson's figures are known. */
  complete: boolean;
};

export function derivedStats(args: { totals: Totals; liveDuration: number | null; liveKm: number | null }): DerivedStats {
  const { totals, liveDuration, liveKm } = args;
  const minutes = totals.totalMinutes + (liveDuration ?? 0);
  return {
    lessonNo: nextLessonNo(totals),
    thisLesson: { duration: liveDuration === null ? "—" : formatMinutes(liveDuration), km: liveKm === null ? "—" : `${liveKm} km` },
    totalAfter: { duration: formatMinutes(minutes), decimalHours: decimalHours(minutes), km: `${totals.totalKm + (liveKm ?? 0)} km` },
    complete: liveDuration !== null && liveKm !== null,
  };
}

/** "Auto · Licence 1234567 · exp 14 Mar 2027 · ADI Tony" — only what is recorded (the same facts the panel showed before). */
export function learnerHeaderMeta(learner: Pick<Learner, "transmission" | "licenceNumber" | "licenceExpiry" | "instructorName">): string {
  return [
    learner.transmission === "manual" ? "Manual" : learner.transmission === "auto" ? "Auto" : null,
    learner.licenceNumber ? `Licence ${learner.licenceNumber}` : null,
    learner.licenceExpiry ? `exp ${formatDate(learner.licenceExpiry)}` : null,
    `ADI ${learner.instructorName}`,
  ].filter(Boolean).join(" · ");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 12 Oct 2026" for a stored lesson date (already the instructor's Canberra wall-clock date); anything else is echoed. */
export function lessonDateLine(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return date;
  return `${WEEKDAYS[utc.getUTCDay()]} ${formatDate(date)}`;
}

/** The odometer card's note while the start reading is still the previous lesson's finish reading (as before). */
export function odometerCarriedNote(totals: Totals, startOdometer: string): string | null {
  if (totals.lastFinishOdometer === null || startOdometer !== String(totals.lastFinishOdometer)) return null;
  return `Start carried from Lesson #${totals.lessonCount}`;
}
