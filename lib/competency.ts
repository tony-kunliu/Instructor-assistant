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
};

export type ReviewState = "locked" | "ready" | "achieved";

export type LearnerProgress = {
  competencies: Record<string, CompetencyStatus>;
  achievedCount: number;
  review1_17: { status: ReviewState; remaining: number };
  review1_22: { status: ReviewState; remaining: number; review1_17Achieved: boolean };
  finalDrive23: { status: "ready" | "achieved" };
  completed: boolean;
};

function emptyStatus(id: string): CompetencyStatus {
  return { id, taughtCount: 0, firstTaughtAt: null, lastTaughtAt: null, firstAssessedAt: null, achieved: false, achievedAt: null };
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
      if (event.result === "achieved" && !status.achieved) {
        status.achieved = true;
        status.achievedAt = event.createdAt;
      }
    }
  }

  const first17 = CORE_COMPETENCY_IDS.slice(0, 17);
  const achievedCount = CORE_COMPETENCY_IDS.filter((id) => byId[id].achieved).length;
  const first17Remaining = first17.filter((id) => !byId[id].achieved).length;
  const allRemaining = CORE_COMPETENCY_IDS.filter((id) => !byId[id].achieved).length;
  const review1_17Achieved = byId[REVIEW_1_17].achieved;
  const review1_22Achieved = byId[REVIEW_1_22].achieved;
  const finalDriveAchieved = byId[FINAL_DRIVE_23].achieved;

  const review1_17Status: ReviewState = review1_17Achieved ? "achieved" : first17Remaining === 0 ? "ready" : "locked";
  const review1_22Status: ReviewState =
    review1_22Achieved ? "achieved" : allRemaining === 0 && review1_17Achieved ? "ready" : "locked";

  return {
    competencies: byId,
    achievedCount,
    review1_17: { status: review1_17Status, remaining: first17Remaining },
    review1_22: { status: review1_22Status, remaining: allRemaining, review1_17Achieved },
    finalDrive23: { status: finalDriveAchieved ? "achieved" : "ready" },
    completed: finalDriveAchieved,
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
 * Enforce, server-side, every CBT&A V2 rule for a single lesson's
 * competency selections against the learner's progress *before* this
 * lesson (so a competency achieved in an earlier lesson can't be taught
 * again, and unlock gates use prior state only).
 */
export function validateLessonCompetencies(
  input: { taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, AssessmentResult> },
  progress: LearnerProgress,
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

  if (input.assessedIds.includes(REVIEW_1_17) && progress.review1_17.status === "locked") {
    throw new CompetencyRuleError("Review 1-17 is locked until Competency 1-17 are all achieved.");
  }
  if (input.assessedIds.includes(REVIEW_1_22) && progress.review1_22.status === "locked") {
    throw new CompetencyRuleError("Review 1-22 is locked until Competency 1-22 and Review 1-17 are all achieved.");
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
