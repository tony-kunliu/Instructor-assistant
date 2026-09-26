export type Transmission = "manual" | "auto";
export type LicenceStage = "learner" | "p1" | "p2" | "full";

export type Instructor = {
  id: string;
  fullName: string;
};

export type Learner = {
  id: string;
  instructorId: string;
  instructorName: string;
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
  instructorName?: unknown;
};

export type LessonInput = {
  lessonDate?: unknown;
  startTime?: unknown;
  finishTime?: unknown;
  startOdometer?: unknown;
  finishOdometer?: unknown;
  taught?: unknown;
  competenciesAssessed?: unknown;
  achieved?: unknown;
  location?: unknown;
  comments?: unknown;
  adiSignature?: unknown;
  learnerSignature?: unknown;
};
