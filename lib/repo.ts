import { distanceKm, durationMinutes, EMPTY_TOTALS, parseOdometer, type Totals } from "./calc.ts";
import type { D1Database } from "./d1-types.ts";
import type { Instructor, Learner, LearnerInput, Lesson, LessonInput } from "./types.ts";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

type Row = Record<string, unknown>;

const MAX_SIGNATURE_LENGTH = 400_000;

function text(value: unknown, max: number): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function signature(value: unknown): string | null {
  const data = String(value ?? "");
  if (!data.startsWith("data:image/png;base64,") || data.length > MAX_SIGNATURE_LENGTH) return null;
  return data;
}

function toLearner(row: Row): Learner {
  return {
    id: String(row.id),
    instructorId: String(row.instructor_id),
    instructorName: String(row.instructor_name ?? ""),
    fullName: String(row.full_name),
    address: (row.address as string) ?? null,
    phone: (row.phone as string) ?? null,
    dob: (row.dob as string) ?? null,
    licenceNumber: (row.licence_number as string) ?? null,
    licenceExpiry: (row.licence_expiry as string) ?? null,
    eligibility: (row.eligibility as string) ?? null,
    transmission: (row.transmission as Learner["transmission"]) ?? null,
    schoolWork: (row.school_work as string) ?? null,
    licenceStage: (row.licence_stage as Learner["licenceStage"]) ?? "learner",
  };
}

function toLesson(row: Row): Lesson {
  return {
    id: String(row.id),
    learnerId: String(row.learner_id),
    instructorId: String(row.instructor_id),
    lessonNo: Number(row.lesson_no),
    lessonDate: String(row.lesson_date),
    startTime: String(row.start_time),
    finishTime: String(row.finish_time),
    startOdometer: Number(row.start_odometer),
    finishOdometer: Number(row.finish_odometer),
    durationMinutes: Number(row.duration_minutes),
    distanceKm: Number(row.distance_km),
    cumulativeMinutes: Number(row.cumulative_minutes),
    cumulativeKm: Number(row.cumulative_km),
    taught: (row.taught as string) ?? null,
    competenciesAssessed: (row.competencies_assessed as string) ?? null,
    achieved: (row.achieved as string) ?? null,
    location: (row.location as string) ?? null,
    comments: (row.comments as string) ?? null,
    adiSignature: (row.adi_signature as string) ?? null,
    learnerSignature: (row.learner_signature as string) ?? null,
    createdAt: String(row.created_at),
  };
}

// ── Instructors ──────────────────────────────────────────────────────────

export async function listInstructors(db: D1Database): Promise<Instructor[]> {
  const { results } = await db.prepare("SELECT id, full_name FROM instructors ORDER BY full_name").all<Row>();
  return results.map((row) => ({ id: String(row.id), fullName: String(row.full_name) }));
}

async function findOrCreateInstructor(db: D1Database, name: string): Promise<string> {
  const existing = await db.prepare("SELECT id FROM instructors WHERE lower(full_name) = lower(?)").bind(name).first<Row>();
  if (existing) return String(existing.id);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind(id, name).run();
  return id;
}

// ── Learners ─────────────────────────────────────────────────────────────

const LEARNER_SELECT = `
  SELECT l.*, i.full_name AS instructor_name
  FROM learners l JOIN instructors i ON i.id = l.instructor_id`;

export async function listLearners(db: D1Database): Promise<Learner[]> {
  const { results } = await db.prepare(`${LEARNER_SELECT} WHERE l.archived_at IS NULL ORDER BY l.full_name COLLATE NOCASE`).all<Row>();
  return results.map(toLearner);
}

export async function getLearner(db: D1Database, id: string): Promise<Learner> {
  const row = await db.prepare(`${LEARNER_SELECT} WHERE l.id = ?`).bind(id).first<Row>();
  if (!row) throw new NotFoundError("Learner not found.");
  return toLearner(row);
}

export async function createLearner(db: D1Database, input: LearnerInput): Promise<Learner> {
  const fullName = text(input.fullName, 120);
  if (!fullName) throw new ValidationError("Student name is required.");
  const instructorName = text(input.instructorName, 120);
  if (!instructorName) throw new ValidationError("Instructor is required.");
  const transmissionRaw = String(input.transmission ?? "").trim().toLowerCase();
  const transmission = transmissionRaw === "manual" || transmissionRaw === "auto" ? transmissionRaw : null;

  const id = crypto.randomUUID();
  // Note: D1 has no read-then-write transaction across separate calls (only
  // db.batch() for pre-built, independent statements), so find-or-create is
  // two sequential round trips rather than one atomic unit. The unique index
  // on instructors(lower(full_name)) still prevents duplicate rows outright
  // (a concurrent race would surface as a constraint error, not silent
  // duplication) — acceptable for this single-instructor-at-a-time app.
  const instructorId = await findOrCreateInstructor(db, instructorName);
  await db
    .prepare(
      `INSERT INTO learners (id, instructor_id, full_name, address, phone, dob, licence_number, licence_expiry, eligibility, transmission, school_work)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      instructorId,
      fullName,
      text(input.address, 300),
      text(input.phone, 40),
      isoDate(input.dob),
      text(input.licenceNumber, 40),
      isoDate(input.licenceExpiry),
      text(input.eligibility, 120),
      transmission,
      text(input.schoolWork, 160),
    )
    .run();
  return getLearner(db, id);
}

// ── Lessons ──────────────────────────────────────────────────────────────

export async function getTotals(db: D1Database, learnerId: string): Promise<Totals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS lesson_count,
              COALESCE(SUM(duration_minutes), 0) AS total_minutes,
              COALESCE(SUM(distance_km), 0) AS total_km,
              (SELECT finish_odometer FROM lessons WHERE learner_id = ? ORDER BY lesson_no DESC LIMIT 1) AS last_finish
       FROM lessons WHERE learner_id = ?`,
    )
    .bind(learnerId, learnerId)
    .first<Row>();
  if (!row) return EMPTY_TOTALS;
  return {
    lessonCount: Number(row.lesson_count),
    totalMinutes: Number(row.total_minutes),
    totalKm: Number(row.total_km),
    lastFinishOdometer: row.last_finish === null || row.last_finish === undefined ? null : Number(row.last_finish),
  };
}

/** Lessons newest first. Signatures are omitted from the list to keep it light. */
export async function listLessons(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db
    .prepare(
      `SELECT id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time, start_odometer, finish_odometer,
              duration_minutes, distance_km, cumulative_minutes, cumulative_km, taught, competencies_assessed, achieved,
              location, comments, NULL AS adi_signature, NULL AS learner_signature, created_at
       FROM lessons WHERE learner_id = ? ORDER BY lesson_no DESC`,
    )
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

export async function createLesson(db: D1Database, learnerId: string, input: LessonInput): Promise<Lesson> {
  const learner = await getLearner(db, learnerId);

  const lessonDate = isoDate(input.lessonDate);
  if (!lessonDate) throw new ValidationError("Lesson date is required.");
  const startTime = String(input.startTime ?? "").trim();
  const finishTime = String(input.finishTime ?? "").trim();
  const duration = durationMinutes(startTime, finishTime);
  if (duration === null) throw new ValidationError("Start and finish time are required, and finish must be after start.");

  const startOdometer = parseOdometer(input.startOdometer as string);
  const finishOdometer = parseOdometer(input.finishOdometer as string);
  if (startOdometer === null) throw new ValidationError("Start odometer is required.");
  if (finishOdometer === null) throw new ValidationError("Finish odometer is required.");
  const distance = distanceKm(startOdometer, finishOdometer);
  if (distance === null) throw new ValidationError("Finish odometer must not be less than start odometer.");

  const adiSignature = signature(input.adiSignature);
  const learnerSignature = signature(input.learnerSignature);
  if (!adiSignature) throw new ValidationError("ADI signature is required.");
  if (!learnerSignature) throw new ValidationError("Learner signature is required.");

  const id = crypto.randomUUID();
  // Lesson number and cumulative totals are derived from the current totals,
  // read just before the insert. Same D1 limitation as above: this is two
  // sequential calls, not one atomic transaction. `UNIQUE (learner_id,
  // lesson_no)` still rejects a colliding lesson_no outright rather than
  // silently corrupting totals, for the same single-instructor-at-a-time
  // usage pattern.
  const totals = await getTotals(db, learnerId);
  await db
    .prepare(
      `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time,
         start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km,
         taught, competencies_assessed, achieved, location, comments, adi_signature, learner_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      learnerId,
      learner.instructorId,
      totals.lessonCount + 1,
      lessonDate,
      startTime,
      finishTime,
      startOdometer,
      finishOdometer,
      duration,
      distance,
      totals.totalMinutes + duration,
      totals.totalKm + distance,
      text(input.taught, 2000),
      text(input.competenciesAssessed, 2000),
      text(input.achieved, 2000),
      text(input.location, 200),
      text(input.comments, 3000),
      adiSignature,
      learnerSignature,
    )
    .run();

  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  return toLesson(row as Row);
}
