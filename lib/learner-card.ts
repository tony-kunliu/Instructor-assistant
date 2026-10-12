// Learner list cards (UI redesign approved by Tony 2026-10-12): the pure view-model behind one card.
//
// Every value on a card is derived from real data, never approximated:
//   - lessons / hours / last lesson date: the same aggregate getTotals() uses (lesson_no > 0 are lessons;
//     prior-instructor hours count; `lastLessonDate` is the latest lesson_date, a Canberra wall-clock date);
//   - competencies and the three gates: lib/competency.ts#computeProgress over the learner's assessed events,
//     so Review 1-17 / Review 1-22 / Final Drive 23 read exactly as on the learner's own progress card;
//   - reminder chips: lib/rules.ts only (R2 "Competency 23 from", R5 learner licence), display only.
// Shared by the server (lib/repo.ts#listLearnerSummaries builds the summary) and the client (the card).
import { decimalHours } from "./calc.ts";
import { CORE_COMPETENCY_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type LearnerProgress, type ReviewState } from "./competency.ts";
import type { PickerView } from "./learner-picker.ts";
import { finalDriveEligibleFrom, formatDate, learnerLicenceReminder, type EligibilityLearner } from "./rules.ts";
import type { Learner } from "./types.ts";

/** Per-learner card data sent with the list (`GET /api/learners` → `summaries[learnerId]`). */
export type LearnerListSummary = {
  lessonCount: number;
  totalMinutes: number;
  /** Latest lesson_date among real lessons (lesson_no > 0), "YYYY-MM-DD" Canberra wall clock; null with no lessons. */
  lastLessonDate: string | null;
  achievedCount: number;
  /** Achieved core competencies (1-22) in official order: the 22-segment bar lights exactly these. */
  achievedIds: string[];
  review1_17: ReviewState;
  review1_22: ReviewState;
  finalDrive23: ReviewState;
  completed: boolean;
};

export function summaryFromProgress(progress: LearnerProgress, totals: { lessonCount: number; totalMinutes: number }, lastLessonDate: string | null): LearnerListSummary {
  return {
    lessonCount: totals.lessonCount,
    totalMinutes: totals.totalMinutes,
    lastLessonDate,
    achievedCount: progress.achievedCount,
    achievedIds: CORE_COMPETENCY_IDS.filter((id) => progress.competencies[id]?.achieved),
    review1_17: progress.review1_17.status,
    review1_22: progress.review1_22.status,
    finalDrive23: progress.finalDrive23.status,
    completed: progress.completed,
  };
}

/** A learner with no lessons at all (e.g. just added on this device, before the list is re-fetched). */
export function emptySummary(): LearnerListSummary {
  return { lessonCount: 0, totalMinutes: 0, lastLessonDate: null, achievedCount: 0, achievedIds: [], review1_17: "locked", review1_22: "locked", finalDrive23: "locked", completed: false };
}

export type GateState = "done" | "next" | "locked";
export type GateChip = { id: string; label: string; state: GateState };

const gateState = (status: ReviewState): GateState => (status === "achieved" ? "done" : status === "ready" ? "next" : "locked");

/** The three gate chips in chain order; "next" = ready to assess (the gate is open), never a verdict. */
export function gateChips(summary: Pick<LearnerListSummary, "review1_17" | "review1_22" | "finalDrive23">): GateChip[] {
  return [
    { id: REVIEW_1_17, label: "Review 1–17", state: gateState(summary.review1_17) },
    { id: REVIEW_1_22, label: "Review 1–22", state: gateState(summary.review1_22) },
    { id: FINAL_DRIVE_23, label: "Final Drive 23", state: gateState(summary.finalDrive23) },
  ];
}

/** Avatar initials: first letters of the first two words ("Alex Chen" → "AC"); one word → its first two letters. */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((word) => word[0]).join("");
  return letters.toUpperCase();
}

const STAGE_LABEL: Record<Learner["licenceStage"], string> = { learner: "L plates", p1: "P1", p2: "P2", full: "Full licence" };

/** "Auto · L plates · 12 lessons · 18.5 h" — only what is recorded. */
export function cardMeta(learner: Pick<Learner, "transmission" | "licenceStage">, summary: Pick<LearnerListSummary, "lessonCount" | "totalMinutes">): string {
  const transmission = learner.transmission === "manual" ? "Manual" : learner.transmission === "auto" ? "Auto" : null;
  const lessons = `${summary.lessonCount} ${summary.lessonCount === 1 ? "lesson" : "lessons"}`;
  return [transmission, STAGE_LABEL[learner.licenceStage] ?? null, lessons, `${decimalHours(summary.totalMinutes)} h`].filter(Boolean).join(" · ");
}

/** "last lesson 7 Oct 2026" (the stored lesson date is already the instructor's Canberra date) or "no lessons yet". */
export function lastLessonLine(summary: Pick<LearnerListSummary, "lastLessonDate">): string {
  return summary.lastLessonDate ? `last lesson ${formatDate(summary.lastLessonDate)}` : "no lessons yet";
}

/** The label a card is identified by (what the former dropdown showed): the name alone in Mine, "name · instructor" elsewhere. */
export function optionLabel(learner: Pick<Learner, "fullName" | "instructorName">, view: PickerView): string {
  return view === "mine" ? learner.fullName : `${learner.fullName} · ${learner.instructorName}`;
}

export type CardReminder = { id: string; tone: "amber" | "plain"; text: string };

/**
 * Reminder chips, display only, from the rules the panel already shows (never a new rule):
 *   - R5 learner licence (lib/rules.ts#learnerLicenceReminder) while it is amber (expired or ≤ 30 days);
 *   - R2 "Competency 23 from" date (lib/rules.ts#finalDriveEligibleFrom) for learner-stage, not-completed learners,
 *     amber until the latest possible date has passed with hours and HPT met (same rule as the panel line), plain after.
 * Grey "add X" lines stay on the learner panel: a card never nags about missing data.
 */
export function cardReminders(learner: EligibilityLearner & Pick<Learner, "licenceStage">, summary: Pick<LearnerListSummary, "completed">, today: string): CardReminder[] {
  const out: CardReminder[] = [];
  const licence = learnerLicenceReminder(learner, today);
  if (licence?.tone === "amber" && learner.licenceExpiry) {
    out.push({ id: licence.id, tone: "amber", text: `Licence ${learner.licenceExpiry < today ? "expired" : "expires"} ${formatDate(learner.licenceExpiry)}` });
  }
  if (learner.licenceStage === "learner" && !summary.completed) {
    const from = finalDriveEligibleFrom(learner, today);
    if (from.ok) {
      const expired = Boolean(learner.licenceExpiry && learner.licenceExpiry < today);
      const met = from.latest <= today && from.plus.length === 0 && !expired;
      out.push({ id: "c23-from", tone: met ? "plain" : "amber", text: `C23 from ${from.estimated ? "≈ " : ""}${formatDate(from.date)}` });
    }
  }
  return out;
}

export type Glance = { learning: number; withReminder: number; readyForFinalDrive: number };

/** The one-line summary above the list: learners shown, amber reminders, Final Drive 23 gates open. */
export function glance(cards: readonly { summary: Pick<LearnerListSummary, "finalDrive23">; reminders: readonly CardReminder[] }[]): Glance {
  return {
    learning: cards.length,
    withReminder: cards.filter((card) => card.reminders.some((r) => r.tone === "amber")).length,
    readyForFinalDrive: cards.filter((card) => card.summary.finalDrive23 === "ready").length,
  };
}
