import type { Lesson, LessonRevisionSnapshot } from "./types.ts";

export type RevisionFieldChange = { field: string; label: string; before: string; after: string };

const FIELDS: ReadonlyArray<{ field: keyof LessonRevisionSnapshot; label: string }> = [
  { field: "lessonDate", label: "Date" },
  { field: "startTime", label: "Start time" },
  { field: "finishTime", label: "Finish time" },
  { field: "startOdometer", label: "Start odometer" },
  { field: "finishOdometer", label: "Finish odometer" },
  { field: "taught", label: "Taught" },
  { field: "competenciesAssessed", label: "Assessed" },
  { field: "achieved", label: "Achieved" },
  { field: "location", label: "Location" },
  { field: "comments", label: "Comments" },
  { field: "signatureStatus", label: "Signature" },
];

const SIGNATURE_LABELS: Record<string, string> = { digital: "Signed digitally", on_paper: "Signed on paper", unsigned: "Not signed" };

function show(field: keyof LessonRevisionSnapshot, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return field === "signatureStatus" ? (SIGNATURE_LABELS[String(value)] ?? String(value)) : String(value);
}

/** The snapshot-shaped view of a lesson's CURRENT values (the "after" of its newest revision). */
export function snapshotOfLesson(lesson: Lesson): LessonRevisionSnapshot {
  return {
    lessonDate: lesson.lessonDate,
    startTime: lesson.startTime,
    finishTime: lesson.finishTime,
    startOdometer: lesson.startOdometer,
    finishOdometer: lesson.finishOdometer,
    taught: lesson.taught,
    competenciesAssessed: lesson.competenciesAssessed,
    achieved: lesson.achieved,
    location: lesson.location,
    comments: lesson.comments,
    signatureStatus: lesson.signatureStatus,
    adiSignaturePresent: Boolean(lesson.adiSignature),
    learnerSignaturePresent: Boolean(lesson.learnerSignature),
  };
}

/** Fields whose value differs between a previous version and what replaced it — the "struck out" values (digital strike out and initial). */
export function revisionChanges(previous: LessonRevisionSnapshot, replacement: LessonRevisionSnapshot): RevisionFieldChange[] {
  return FIELDS.filter(({ field }) => (previous[field] ?? null) !== (replacement[field] ?? null)).map(({ field, label }) => ({
    field,
    label,
    before: show(field, previous[field]),
    after: show(field, replacement[field]),
  }));
}
