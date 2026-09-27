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
};

export type Lesson = {
  id: string;
  learnerId: string;
  instructorId: string;
  lessonNo: number;
  lessonDate: string;
  startTime: string;
  finishTime: string;
  startOdometer: number;
  finishOdometer: number;
  durationMinutes: number;
  distanceKm: number;
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
};
