export type Transmission = "manual" | "auto";
export type LicenceStage = "learner" | "p1" | "p2" | "full";

export type InstructorStatus = "active" | "inactive";

export type Instructor = {
  id: string;
  fullName: string;
  adiNumber: string | null;
  email: string | null;
  status: InstructorStatus;
};

export type Learner = {
  id: string;
  instructorId: string;
  instructorName: string;
  /** The instructor's ADI number, needed on the official CBT&A PDF checklist — often not yet filled in. */
  instructorAdiNumber: string | null;
  fullName: string;
  address: string | null;
  phone: string | null;
  dob: string | null;
  licenceNumber: string | null;
  licenceExpiry: string | null;
  eligibility: string | null;
  transmission: Transmission | null;
  schoolWork: string | null;
  licenceStage: LicenceStage;
  /** Competency 23 eligibility inputs (R2, migration 0009). All optional; null = not recorded. Used only by lib/rules.ts reminders; never sent to ACTGDS. */
  /** Issue date of the CURRENT learner licence. Empty = R2 estimates it from licenceExpiry minus 5 years (D21). */
  learnerLicenceIssuedOn: string | null;
  /** First-ever issue date, only if the licence was renewed. */
  learnerLicenceFirstIssuedOn: string | null;
  /** Hazard perception test pass date. Null = not recorded (never "not passed"). */
  hptPassedOn: string | null;
  /** Logbook total in whole hours as the instructor reads it; never computed from this app's lessons. */
  loggedHours: number | null;
  /** The "as of" date for loggedHours. */
  loggedHoursOn: string | null;
  /** Lifecycle state only (reversible, never a delete): set = hidden from the daily picker. Independent of Final Drive 23 completion. */
  archivedAt: string | null;
  /** Reason preset key (lib/archive-reasons.ts) and note of the CURRENT archive (migration 0010): both null when active, when none was given, or for learners archived before 0010 (never invented). */
  archiveReason: string | null;
  archiveNote: string | null;
};

/** One archive / restore of a learner (learner_archive_events, migration 0010), shown in the archived banner's History. */
export type LearnerArchiveEvent = {
  id: string;
  action: "archived" | "restored";
  reason: string | null;
  note: string | null;
  at: string;
  byInstructorId: string | null;
  byName: string | null;
};

export type RecordSource = "app" | "paper_import" | "prior_instructor";
export type SignatureStatus = "digital" | "on_paper" | "unsigned";

export type Lesson = {
  id: string;
  learnerId: string;
  instructorId: string;
  lessonNo: number;
  lessonDate: string;
  startTime: string | null;
  finishTime: string | null;
  startOdometer: number | null;
  finishOdometer: number | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  cumulativeMinutes: number;
  cumulativeKm: number;
  taught: string | null;
  competenciesAssessed: string | null;
  achieved: string | null;
  location: string | null;
  comments: string | null;
  adiSignature: string | null;
  learnerSignature: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** Instructor who last edited this lesson (Instructor Identity V1) — null if never edited, or edited before attribution existed. */
  updatedByInstructorId: string | null;
  updatedByInstructorName: string | null;
  /** 'paper_import' rows are historical paper-logbook lessons; time/odometer/duration/distance may be null. 'prior_instructor' rows (negative lessonNo) are a previous instructor's totals, never edited, never sent to ACTGDS. */
  recordSource: RecordSource;
  signatureStatus: SignatureStatus;
  /** 'prior_instructor' rows only (spec §12): who the transfer learner trained with before (name and/or ADI number), and how many lessons. Null on every other row. */
  priorInstructorLabel: string | null;
  priorLessonCount: number | null;
  /** How many times this lesson has been edited (rows in lesson_revisions). 0 = never amended. */
  revisionCount: number;
  /** Edited before revision history existed (migration 0007): updated_at is set only by updateLesson, so a set updated_at with no revision rows is a reliable "edited" signal. */
  editedBeforeRevisionHistory: boolean;
};

/** Previous content of an edited lesson (lesson_revisions.snapshot_json). Signature images are never stored, only whether each was present. */
export type LessonRevisionSnapshot = {
  lessonDate: string;
  startTime: string | null;
  finishTime: string | null;
  startOdometer: number | null;
  finishOdometer: number | null;
  taught: string | null;
  competenciesAssessed: string | null;
  achieved: string | null;
  location: string | null;
  comments: string | null;
  signatureStatus: SignatureStatus;
  adiSignaturePresent: boolean;
  learnerSignaturePresent: boolean;
};

export type LessonRevision = {
  id: string;
  lessonId: string;
  revisionNo: number;
  editedAt: string;
  editedByInstructorId: string | null;
  editedByName: string | null;
  reason: string | null;
  /** The lesson's values BEFORE this edit was applied. */
  snapshot: LessonRevisionSnapshot;
};

/** Set once 23 Final Drive is Assessed + Achieved (see lib/competency.ts). */
export type CompletionSummary = {
  completedAt: string;
  completingLessonNo: number;
  instructorName: string;
  totalLessons: number;
  cumulativeHours: number;
  cumulativeKm: number;
};

export type LearnerInput = {
  fullName?: unknown;
  address?: unknown;
  phone?: unknown;
  dob?: unknown;
  licenceNumber?: unknown;
  licenceExpiry?: unknown;
  eligibility?: unknown;
  transmission?: unknown;
  schoolWork?: unknown;
  learnerLicenceIssuedOn?: unknown;
  learnerLicenceFirstIssuedOn?: unknown;
  hptPassedOn?: unknown;
  loggedHours?: unknown;
  loggedHoursOn?: unknown;
  /** Must be an existing, active instructor id — free-text instructor names/auto-creation are no longer accepted (see lib/repo.ts#createLearner). */
  instructorId?: unknown;
};

export type LessonInput = {
  lessonDate?: unknown;
  startTime?: unknown;
  finishTime?: unknown;
  startOdometer?: unknown;
  finishOdometer?: unknown;
  /** Competency ids (from CORE_COMPETENCY_IDS) taught this lesson — see lib/competency.ts. */
  taughtIds?: unknown;
  /** Competency ids (from ALL_ASSESSABLE_IDS) assessed this lesson. */
  assessedIds?: unknown;
  /** Assessment result per assessed id this lesson: "achieved" | "not_achieved". */
  achievedResults?: unknown;
  location?: unknown;
  comments?: unknown;
  adiSignature?: unknown;
  learnerSignature?: unknown;
  /** Which instructor actually performed this create/edit (Instructor Identity V1) — must be an existing, active instructor id. Optional: omitted requests keep prior behavior (create falls back to the learner's own instructor; edit leaves updatedByInstructorId unchanged). */
  actingInstructorId?: unknown;
  /** Paper-imported lessons only (History Edit): "on_paper" | "unsigned". Ignored for app lessons, which are always "digital". */
  signatureStatus?: unknown;
  /** History Edit only: optional free-text reason for the correction, max 200 characters. */
  reason?: unknown;
};
