// FROZEN COPY of lib/competency.ts from origin/staging 87f328b (before the progress-invalidation fix),
// used ONLY by scripts/audit-progress.mjs to compare the old whole-history rule with the current one.
// Never import this from app or lib code.

// CBT&A V2 structured competency tracking: rules for Taught / Assessed /
// Achieved and the Review 1-17 / Review 1-22 / Final Drive 23 unlock chain.
//
// Only official numbering is used (1-22, Review 1-17, Review 1-22, 23 Final
// Drive) — no invented competency names/content (see AGENTS.md).

export const CORE_COMPETENCY_IDS: readonly string[] = Array.from({ length: 22 }, (_, i) => String(i + 1));
export const REVIEW_1_17 = "review-1-17";
export const REVIEW_1_22 = "review-1-22";
export const FINAL_DRIVE_23 = "final-drive-23";
export const SPECIAL_ASSESSMENT_IDS: readonly string[] = [REVIEW_1_17, REVIEW_1_22, FINAL_DRIVE_23];
export const ALL_ASSESSABLE_IDS: readonly string[] = [...CORE_COMPETENCY_IDS, ...SPECIAL_ASSESSMENT_IDS];
/**
 * Competency 18, 20, 21: may be Taught any time, but only Assessed once 1-17 and Review 1-17 are
 * Achieved. Competencies 19 (overtaking) and 22 (vulnerable road users) "may be assessed at any
 * time prior to Review 1 or Review 2" — ACT Assessment Standards 2020 (NI2020-703), Schedule 1
 * preamble (docs/ACT_ASSESSMENT_STANDARDS.md).
 */
export const POST_REVIEW_1_17_IDS: readonly string[] = ["18", "20", "21"];
export const POST_REVIEW_1_17_LOCK_MESSAGE = "Competency 18, 20 and 21 can only be assessed after Competency 1-17 and Review 1-17 are all achieved (19 and 22 may be assessed at any time).";

export type CompetencyAction = "taught" | "assessed";
export type AssessmentResult = "achieved" | "not_achieved";

export type CompetencyEvent = {
  competencyId: string;
  action: CompetencyAction;
  result: AssessmentResult | null;
  lessonId: string;
  createdAt: string;
};

export type CompetencyStatus = {
  id: string;
  taughtCount: number;
  firstTaughtAt: string | null;
  lastTaughtAt: string | null;
  firstAssessedAt: string | null;
  achieved: boolean;
  achievedAt: string | null;
  /**
   * Every lesson holding an Assessed + Achieved event for this id, in event order, no duplicates.
   * Lets the client date "1-17 completed" from the lessons' own date and finish time (lib/rules.ts),
   * never from the event's server insert time. Not part of the ACTGDS payload (mapped field by field).
   */
  achievedLessonIds: string[];
};

export type ReviewState = "locked" | "ready" | "achieved";

export type LearnerProgress = {
  competencies: Record<string, CompetencyStatus>;
  achievedCount: number;
  review1_17: { status: ReviewState; remaining: number };
  review1_22: { status: ReviewState; remaining: number; review1_17Achieved: boolean };
  finalDrive23: { status: ReviewState; remaining: number; review1_17Achieved: boolean; review1_22Achieved: boolean };
  completed: boolean;
};

function emptyStatus(id: string): CompetencyStatus {
  return { id, taughtCount: 0, firstTaughtAt: null, lastTaughtAt: null, firstAssessedAt: null, achieved: false, achievedAt: null, achievedLessonIds: [] };
}

/** Rebuild a learner's full CBT&A progress from their complete competency event history. */
export function computeProgress(events: readonly CompetencyEvent[]): LearnerProgress {
  const byId: Record<string, CompetencyStatus> = {};
  for (const id of ALL_ASSESSABLE_IDS) byId[id] = emptyStatus(id);

  for (const event of events) {
    const status = byId[event.competencyId];
    if (!status) continue; // defensive: ignore unknown ids rather than crash
    if (event.action === "taught") {
      status.taughtCount += 1;
      status.firstTaughtAt ??= event.createdAt;
      status.lastTaughtAt = event.createdAt;
    } else {
      status.firstAssessedAt ??= event.createdAt;
      if (event.result === "achieved") {
        if (!status.achievedLessonIds.includes(event.lessonId)) status.achievedLessonIds.push(event.lessonId);
        if (!status.achieved) {
          status.achieved = true;
          status.achievedAt = event.createdAt;
        }
      }
    }
  }

  const first17 = CORE_COMPETENCY_IDS.slice(0, 17);
  const achievedCount = CORE_COMPETENCY_IDS.filter((id) => byId[id].achieved).length;
  const first17Remaining = first17.filter((id) => !byId[id].achieved).length;
  const allRemaining = CORE_COMPETENCY_IDS.filter((id) => !byId[id].achieved).length;

  // A Review/Final Drive is only genuinely "achieved" while its prerequisites
  // still hold *now* — an Assessed+Achieved event that happened in the past
  // is a historical fact (kept in `byId` for audit), but if a later edit to
  // an earlier lesson removes one of the underlying competency achievements,
  // the review's achieved status must fall back to whatever the gate
  // currently allows (locked/ready), not stay stuck as "achieved" on stale
  // data. This is what lets an edit automatically roll back an invalidated
  // Review 1-17 / Review 1-22 / 23 Final Drive / CBT&A Completed milestone.
  const review1_17EverAchieved = byId[REVIEW_1_17].achieved;
  const review1_17GateOpen = first17Remaining === 0;
  const review1_17Valid = review1_17EverAchieved && review1_17GateOpen;
  const review1_17Status: ReviewState = review1_17Valid ? "achieved" : review1_17GateOpen ? "ready" : "locked";

  const review1_22EverAchieved = byId[REVIEW_1_22].achieved;
  const review1_22GateOpen = allRemaining === 0 && review1_17Valid;
  const review1_22Valid = review1_22EverAchieved && review1_22GateOpen;
  const review1_22Status: ReviewState = review1_22Valid ? "achieved" : review1_22GateOpen ? "ready" : "locked";

  const finalDrive23EverAchieved = byId[FINAL_DRIVE_23].achieved;
  const finalDrive23GateOpen = allRemaining === 0 && review1_17Valid && review1_22Valid;
  const finalDrive23Valid = finalDrive23EverAchieved && finalDrive23GateOpen;
  const finalDrive23Status: ReviewState = finalDrive23Valid ? "achieved" : finalDrive23GateOpen ? "ready" : "locked";

  return {
    competencies: byId,
    achievedCount,
    review1_17: { status: review1_17Status, remaining: first17Remaining },
    review1_22: { status: review1_22Status, remaining: allRemaining, review1_17Achieved: review1_17Valid },
    finalDrive23: { status: finalDrive23Status, remaining: allRemaining, review1_17Achieved: review1_17Valid, review1_22Achieved: review1_22Valid },
    completed: finalDrive23Valid,
  };
}

/** Only ids present in `allowed`, deduplicated, in the order first seen. */
export function parseIdList(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (allowed.includes(id)) seen.add(id);
  }
  return [...seen];
}

export function parseAchievedResults(value: unknown): Record<string, AssessmentResult> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, AssessmentResult> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === "achieved" || raw === "not_achieved") out[key] = raw;
  }
  return out;
}

export class CompetencyRuleError extends Error {}

/**
 * Chronology check for every gated Assessed selection: Review 1-17, Competency
 * 18, 20, 21, Review 1-22 and Final Drive 23 (Taught is never gated). `lessons` is a
 * learner's lessons with their events, in any order; ordering is by `lessonNo`
 * (creation order, never editable). Returns `"<lessonNo>:<competencyId>"` for
 * every gated assessment whose prerequisites were not Achieved by EARLIER
 * lessons alone — the same lesson, or a later one, never counts.
 */
export function assessmentChronologyViolations(lessons: readonly { lessonNo: number; events: readonly CompetencyEvent[] }[]): Set<string> {
  const violations = new Set<string>();
  const earlier: CompetencyEvent[] = [];
  for (const lesson of [...lessons].sort((a, b) => a.lessonNo - b.lessonNo)) {
    const before = computeProgress(earlier);
    for (const event of lesson.events) {
      if (event.action === "assessed" && assessmentLockReason(event.competencyId, before) !== null) violations.add(`${lesson.lessonNo}:${event.competencyId}`);
    }
    earlier.push(...lesson.events);
  }
  return violations;
}

/**
 * Whether `id` is currently blocked from being Assessed, given progress
 * *before* the lesson being validated. Single source of truth for both the
 * server-side validation below and the UI's locked chips. Taught is never
 * gated here. `review1_17.status === "achieved"` already implies
 * Competency 1-17 are all Achieved (see computeProgress).
 */
export function assessmentLockReason(id: string, progress: LearnerProgress): string | null {
  if (POST_REVIEW_1_17_IDS.includes(id) && progress.review1_17.status !== "achieved") {
    return POST_REVIEW_1_17_LOCK_MESSAGE;
  }
  if (id === REVIEW_1_17 && progress.review1_17.status === "locked") return "Review 1-17 is locked until Competency 1-17 are all achieved.";
  if (id === REVIEW_1_22 && progress.review1_22.status === "locked") return "Review 1-22 is locked until Competency 1-22 and Review 1-17 are all achieved.";
  if (id === FINAL_DRIVE_23 && progress.finalDrive23.status === "locked") return "23 Final Drive is locked until Competency 1-22, Review 1-17 and Review 1-22 are all achieved.";
  return null;
}

/** Milestones that flipped from Achieved/Completed to not, as a side effect of editing an earlier lesson. */
export type MilestoneInvalidation = {
  review1_17: boolean;
  review1_22: boolean;
  finalDrive23: boolean;
  completed: boolean;
};

export function diffInvalidatedMilestones(before: LearnerProgress, after: LearnerProgress): MilestoneInvalidation {
  return {
    review1_17: before.review1_17.status === "achieved" && after.review1_17.status !== "achieved",
    review1_22: before.review1_22.status === "achieved" && after.review1_22.status !== "achieved",
    finalDrive23: before.finalDrive23.status === "achieved" && after.finalDrive23.status !== "achieved",
    completed: before.completed && !after.completed,
  };
}

export function hasInvalidatedMilestone(invalidation: MilestoneInvalidation): boolean {
  return invalidation.review1_17 || invalidation.review1_22 || invalidation.finalDrive23 || invalidation.completed;
}

/**
 * Enforce, server-side, every CBT&A V2 rule for a single lesson's
 * competency selections against the learner's progress *before* this
 * lesson (so a competency achieved in an earlier lesson can't be taught
 * again, and unlock gates use prior state only).
 */
export function validateLessonCompetencies(
  input: { taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, AssessmentResult> },
  progress: LearnerProgress,
  // History Edit judges every Assessed gate by lesson chronology instead (see assessmentChronologyViolations).
  options: { skipAssessmentGates?: boolean } = {},
): void {
  const assessedSet = new Set(input.assessedIds);

  for (const id of input.taughtIds) {
    if (progress.competencies[id]?.achieved) {
      throw new CompetencyRuleError(`Competency ${id} is already achieved and can no longer be taught.`);
    }
    if (assessedSet.has(id)) {
      throw new CompetencyRuleError(`Competency ${id} cannot be both taught and assessed in the same lesson.`);
    }
  }

  if (!options.skipAssessmentGates) {
    for (const id of input.assessedIds) {
      const reason = assessmentLockReason(id, progress);
      if (reason) throw new CompetencyRuleError(reason);
    }
  }

  for (const id of input.assessedIds) {
    if (!(id in input.achievedResults)) {
      throw new CompetencyRuleError(`Assessment result (Achieved / Not achieved) is required for ${competencyLabel(id)}.`);
    }
  }
  for (const id of Object.keys(input.achievedResults)) {
    if (!assessedSet.has(id)) {
      throw new CompetencyRuleError(`Cannot record an assessment result for ${competencyLabel(id)} without assessing it in this lesson.`);
    }
  }
}

export function competencyLabel(id: string): string {
  if (id === REVIEW_1_17) return "Review 1-17";
  if (id === REVIEW_1_22) return "Review 1-22";
  if (id === FINAL_DRIVE_23) return "23 Final Drive";
  return id;
}

/**
 * Official competency titles from the ACT government's own CBT&A
 * Assessment Standards (Road Transport (Driver Licensing) Issue of a
 * Provisional Car Licence by an Accredited Driving Instructor Assessment
 * Standards 2020, Notifiable Instrument NI2020-703, Schedule 1) — provided
 * directly by Tony. Display-only: never stored, never used in any
 * comparison/validation logic, so it cannot affect persisted `taught`/
 * `competencies_assessed`/`achieved` text or existing history.
 */
const COMPETENCY_FULL_NAMES: Readonly<Record<string, string>> = {
  "1": "Vehicle Controls",
  "2": "Cabin Drill",
  "3": "Starting Up Procedure",
  "4": "Moving Off Procedure",
  "5": "Gear Changing / Clutch Operation",
  "6": "Steering Control & Vehicle Positioning",
  "7": "Turns, Left and Right",
  "8": "Speed Control",
  "9": "Slowing Procedure",
  "10": "Stopping Procedure",
  "11": "Hill Starts",
  "12": "Give Way Rules",
  "13": "Reversing",
  "14": "Right Angle Parking (Front In)",
  "15": "Reverse Parallel Parking",
  "16": "U-Turns",
  "17": "Turning Around on the Road (e.g. Three Point Turn)",
  "18": "Lane Changing, Merging, & Form One Lane",
  "19": "Overtaking",
  "20": "Observation Skills, Visual Searching and Scanning, Hazard Recognition",
  "21": "Compliance with the System of Vehicle Control",
  "22": "Vulnerable Road Users; Observation Skills, Recognition and Risk Management",
  [FINAL_DRIVE_23]: "Driving on Busy Roads and Unfamiliar Roads",
  [REVIEW_1_17]: "The student demonstrates Competencies 1 to 17",
  [REVIEW_1_22]: "The student demonstrates Competencies 1 to 22",
};

/** The full official title for a competency/review id, or null if unrecognized. Display-only (see above). */
export function competencyFullName(id: string): string | null {
  return COMPETENCY_FULL_NAMES[id] ?? null;
}

function sortKey(id: string): number {
  const n = Number(id);
  if (!Number.isNaN(n)) return n;
  if (id === REVIEW_1_17) return 100;
  if (id === REVIEW_1_22) return 101;
  if (id === FINAL_DRIVE_23) return 102;
  return 999;
}

export function sortCompetencyIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => sortKey(a) - sortKey(b));
}

/** e.g. ["3","8","12"] -> "3, 8, 12", or null when empty (for a nullable display column). */
export function formatIdList(ids: readonly string[]): string | null {
  if (!ids.length) return null;
  return sortCompetencyIds(ids).map(competencyLabel).join(", ");
}
