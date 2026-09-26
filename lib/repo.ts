import { distanceKm, durationMinutes, EMPTY_TOTALS, parseOdometer, type Totals } from "./calc.ts";
import {
  ALL_ASSESSABLE_IDS,
  CORE_COMPETENCY_IDS,
  CompetencyRuleError,
  FINAL_DRIVE_23,
  computeProgress,
  diffInvalidatedMilestones,
  formatIdList,
  parseAchievedResults,
  parseIdList,
  validateLessonCompetencies,
  type CompetencyEvent,
  type LearnerProgress,
  type MilestoneInvalidation,
} from "./competency.ts";
import type { D1Database, D1PreparedStatement } from "./d1-types.ts";
import type { CompletionSummary, Instructor, Learner, LearnerInput, Lesson, LessonInput } from "./types.ts";

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
    instructorAdiNumber: (row.instructor_adi_number as string) ?? null,
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
    updatedAt: (row.updated_at as string) ?? null,
  };
}

// ── Instructors ──────────────────────────────────────────────────────────

export async function listInstructors(db: D1Database): Promise<Instructor[]> {
  const { results } = await db.prepare("SELECT id, full_name, adi_number FROM instructors ORDER BY full_name").all<Row>();
  return results.map((row) => ({ id: String(row.id), fullName: String(row.full_name), adiNumber: (row.adi_number as string) ?? null }));
}

/** Fills in (or corrects) an instructor's ADI number — needed on the official CBT&A PDF checklist. */
export async function updateInstructorAdiNumber(db: D1Database, instructorId: string, adiNumber: unknown): Promise<Instructor> {
  const value = text(adiNumber, 40);
  if (!value) throw new ValidationError("ADI number is required.");
  const existing = await db.prepare("SELECT id, full_name FROM instructors WHERE id = ?").bind(instructorId).first<Row>();
  if (!existing) throw new NotFoundError("Instructor not found.");
  await db.prepare("UPDATE instructors SET adi_number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(value, instructorId).run();
  return { id: instructorId, fullName: String(existing.full_name), adiNumber: value };
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
  SELECT l.*, i.full_name AS instructor_name, i.adi_number AS instructor_adi_number
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
              location, comments, NULL AS adi_signature, NULL AS learner_signature, created_at, updated_at
       FROM lessons WHERE learner_id = ? ORDER BY lesson_no DESC`,
    )
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

/** All of a learner's saved lessons, oldest first, with real signatures — for the CBT&A PDF export (never partial/draft data). */
export async function listLessonsForExport(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db.prepare("SELECT * FROM lessons WHERE learner_id = ? ORDER BY lesson_no ASC").bind(learnerId).all<Row>();
  return results.map(toLesson);
}

export async function getLesson(db: D1Database, learnerId: string, lessonId: string): Promise<Lesson> {
  const row = await db.prepare("SELECT * FROM lessons WHERE id = ? AND learner_id = ?").bind(lessonId, learnerId).first<Row>();
  if (!row) throw new NotFoundError("Lesson not found.");
  return toLesson(row);
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

  const taughtIds = parseIdList(input.taughtIds, CORE_COMPETENCY_IDS);
  const assessedIds = parseIdList(input.assessedIds, ALL_ASSESSABLE_IDS);
  const achievedResults = parseAchievedResults(input.achievedResults);
  const progress = await getLearnerProgress(db, learnerId);
  try {
    validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progress);
  } catch (error) {
    if (error instanceof CompetencyRuleError) throw new ValidationError(error.message);
    throw error;
  }
  const achievedIds = assessedIds.filter((id) => achievedResults[id] === "achieved");

  const id = crypto.randomUUID();
  // Lesson number and cumulative totals are derived from the current totals,
  // read just before the insert. Same D1 limitation as above: this is two
  // sequential calls, not one atomic transaction. `UNIQUE (learner_id,
  // lesson_no)` still rejects a colliding lesson_no outright rather than
  // silently corrupting totals, for the same single-instructor-at-a-time
  // usage pattern.
  const totals = await getTotals(db, learnerId);
  const lessonInsert = db
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
      formatIdList(taughtIds),
      formatIdList(assessedIds),
      formatIdList(achievedIds),
      text(input.location, 200),
      text(input.comments, 3000),
      adiSignature,
      learnerSignature,
    );

  const eventInsert = (competencyId: string, action: "taught" | "assessed", result: string | null): D1PreparedStatement =>
    db
      .prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), learnerId, id, competencyId, action, result);

  const eventStatements = [
    ...taughtIds.map((competencyId) => eventInsert(competencyId, "taught", null)),
    ...assessedIds.map((competencyId) => eventInsert(competencyId, "assessed", achievedResults[competencyId])),
  ];
  // db.batch() runs as a single atomic transaction on both the real D1
  // binding and the local node:sqlite adapter (see lib/d1-sqlite.ts) — the
  // lesson row and its competency events are committed together or not at all.
  await db.batch([lessonInsert, ...eventStatements]);

  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  return toLesson(row as Row);
}

/** Fields that, if changed, invalidate both existing signatures (CBT&A V3 rule 5). */
const SIGNATURE_PROTECTED_FIELDS = ["lessonDate", "startTime", "finishTime", "startOdometer", "finishOdometer", "taught", "assessed", "achieved", "location", "comments"] as const;

export type UpdateLessonResult = {
  lesson: Lesson;
  progress: LearnerProgress;
  completion: CompletionSummary | null;
  invalidated: MilestoneInvalidation;
};

/**
 * Edit a history lesson. Lesson number is never editable (it reflects
 * creation order); duration/distance/cumulative totals are always
 * recalculated, never taken from the input. Editing this lesson's
 * competency events also recomputes the learner's whole progress, which —
 * by construction, since progress is always derived fresh from the full
 * event history rather than cached — automatically rolls back any
 * Review 1-17 / Review 1-22 / Final Drive 23 / Completed milestone whose
 * prerequisites the edit invalidated (see lib/competency.ts#computeProgress).
 * The before/after diff is returned so the caller can surface a clear
 * warning when that happens.
 */
export async function updateLesson(db: D1Database, learnerId: string, lessonId: string, input: LessonInput): Promise<UpdateLessonResult> {
  const existing = await getLesson(db, learnerId, lessonId);

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

  // Carry-forward consistency: the odometer is one physical instrument, so
  // its readings must stay monotonic across the learner's whole lesson
  // sequence, not just within this one lesson.
  const [prevLesson, nextLesson] = await Promise.all([
    db.prepare("SELECT finish_odometer FROM lessons WHERE learner_id = ? AND lesson_no = ?").bind(learnerId, existing.lessonNo - 1).first<Row>(),
    db.prepare("SELECT start_odometer FROM lessons WHERE learner_id = ? AND lesson_no = ?").bind(learnerId, existing.lessonNo + 1).first<Row>(),
  ]);
  if (prevLesson && startOdometer < Number(prevLesson.finish_odometer)) {
    throw new ValidationError(`Start odometer cannot be less than Lesson #${existing.lessonNo - 1}'s finish odometer (${prevLesson.finish_odometer}).`);
  }
  if (nextLesson && finishOdometer > Number(nextLesson.start_odometer)) {
    throw new ValidationError(`Finish odometer cannot exceed Lesson #${existing.lessonNo + 1}'s start odometer (${nextLesson.start_odometer}).`);
  }

  const taughtIds = parseIdList(input.taughtIds, CORE_COMPETENCY_IDS);
  const assessedIds = parseIdList(input.assessedIds, ALL_ASSESSABLE_IDS);
  const achievedResults = parseAchievedResults(input.achievedResults);
  // Validate against progress with this lesson's own prior events excluded
  // (they're about to be replaced), so editing a lesson never self-blocks
  // on a competency it only achieved through its own, now-superseded, entry.
  const progressExcludingThisLesson = await getProgressExcludingLesson(db, learnerId, lessonId);
  try {
    validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progressExcludingThisLesson);
  } catch (error) {
    if (error instanceof CompetencyRuleError) throw new ValidationError(error.message);
    throw error;
  }
  const achievedIds = assessedIds.filter((id) => achievedResults[id] === "achieved");

  const location = text(input.location, 200);
  const comments = text(input.comments, 3000);
  const taughtDisplay = formatIdList(taughtIds);
  const assessedDisplay = formatIdList(assessedIds);
  const achievedDisplay = formatIdList(achievedIds);

  const contentChanged =
    lessonDate !== existing.lessonDate ||
    startTime !== existing.startTime ||
    finishTime !== existing.finishTime ||
    startOdometer !== existing.startOdometer ||
    finishOdometer !== existing.finishOdometer ||
    taughtDisplay !== existing.taught ||
    assessedDisplay !== existing.competenciesAssessed ||
    achievedDisplay !== existing.achieved ||
    location !== existing.location ||
    comments !== existing.comments;

  let adiSignature: string;
  let learnerSignature: string;
  if (contentChanged) {
    const newAdi = signature(input.adiSignature);
    const newLearner = signature(input.learnerSignature);
    if (!newAdi || !newLearner) {
      throw new ValidationError(`Content changed (${SIGNATURE_PROTECTED_FIELDS.join(", ")}) — both signatures must be redrawn before saving.`);
    }
    if (newAdi === existing.adiSignature || newLearner === existing.learnerSignature) {
      throw new ValidationError("Content changed — the previous signatures are no longer valid. Please redraw both before saving.");
    }
    adiSignature = newAdi;
    learnerSignature = newLearner;
  } else {
    adiSignature = signature(input.adiSignature) ?? existing.adiSignature ?? "";
    learnerSignature = signature(input.learnerSignature) ?? existing.learnerSignature ?? "";
    if (!adiSignature) throw new ValidationError("ADI signature is required.");
    if (!learnerSignature) throw new ValidationError("Learner signature is required.");
  }

  const before = await getLearnerProgress(db, learnerId);

  // Duration/distance changed for this lesson means every lesson's
  // cumulative total from here on (this one included) must be recomputed
  // as a running sum, in lesson_no order.
  const priorTotals = await db
    .prepare("SELECT COALESCE(SUM(duration_minutes), 0) AS m, COALESCE(SUM(distance_km), 0) AS k FROM lessons WHERE learner_id = ? AND lesson_no < ?")
    .bind(learnerId, existing.lessonNo)
    .first<Row>();
  const { results: laterLessons } = await db
    .prepare("SELECT id, duration_minutes, distance_km FROM lessons WHERE learner_id = ? AND lesson_no > ? ORDER BY lesson_no ASC")
    .bind(learnerId, existing.lessonNo)
    .all<Row>();

  let runningMinutes = Number(priorTotals?.m ?? 0) + duration;
  let runningKm = Number(priorTotals?.k ?? 0) + distance;

  const updateEditedLesson = db
    .prepare(
      `UPDATE lessons SET lesson_date = ?, start_time = ?, finish_time = ?, start_odometer = ?, finish_odometer = ?,
         duration_minutes = ?, distance_km = ?, cumulative_minutes = ?, cumulative_km = ?,
         taught = ?, competencies_assessed = ?, achieved = ?, location = ?, comments = ?,
         adi_signature = ?, learner_signature = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .bind(
      lessonDate,
      startTime,
      finishTime,
      startOdometer,
      finishOdometer,
      duration,
      distance,
      runningMinutes,
      runningKm,
      taughtDisplay,
      assessedDisplay,
      achievedDisplay,
      location,
      comments,
      adiSignature,
      learnerSignature,
      lessonId,
    );

  const cumulativeUpdates: D1PreparedStatement[] = [];
  for (const row of laterLessons) {
    runningMinutes += Number(row.duration_minutes);
    runningKm += Number(row.distance_km);
    cumulativeUpdates.push(db.prepare("UPDATE lessons SET cumulative_minutes = ?, cumulative_km = ? WHERE id = ?").bind(runningMinutes, runningKm, row.id));
  }

  const deleteOldEvents = db.prepare("DELETE FROM competency_events WHERE lesson_id = ?").bind(lessonId);
  const eventInsert = (competencyId: string, action: "taught" | "assessed", result: string | null): D1PreparedStatement =>
    db
      .prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), learnerId, lessonId, competencyId, action, result);
  const eventInserts = [
    ...taughtIds.map((competencyId) => eventInsert(competencyId, "taught", null)),
    ...assessedIds.map((competencyId) => eventInsert(competencyId, "assessed", achievedResults[competencyId])),
  ];

  // One atomic transaction: the edited lesson, every downstream lesson's
  // recomputed cumulative totals, and the swapped competency events commit
  // together or not at all.
  await db.batch([updateEditedLesson, deleteOldEvents, ...eventInserts, ...cumulativeUpdates]);

  const [updatedLesson, after, completion] = await Promise.all([getLesson(db, learnerId, lessonId), getLearnerProgress(db, learnerId), getCompletionSummary(db, learnerId)]);

  return { lesson: updatedLesson, progress: after, completion, invalidated: diffInvalidatedMilestones(before, after) };
}

// ── CBT&A V2 competency progress ────────────────────────────────────────

export async function getCompetencyEvents(db: D1Database, learnerId: string): Promise<CompetencyEvent[]> {
  const { results } = await db
    .prepare("SELECT competency_id, action, result, lesson_id, created_at FROM competency_events WHERE learner_id = ? ORDER BY created_at ASC")
    .bind(learnerId)
    .all<Row>();
  return results.map((row) => ({
    competencyId: String(row.competency_id),
    action: row.action as CompetencyEvent["action"],
    result: (row.result as CompetencyEvent["result"]) ?? null,
    lessonId: String(row.lesson_id),
    createdAt: String(row.created_at),
  }));
}

export async function getLearnerProgress(db: D1Database, learnerId: string): Promise<LearnerProgress> {
  return computeProgress(await getCompetencyEvents(db, learnerId));
}

/** Progress as if `lessonId`'s own competency events had never happened — used to validate/preview an edit to that lesson. */
export async function getProgressExcludingLesson(db: D1Database, learnerId: string, lessonId: string): Promise<LearnerProgress> {
  return computeProgress((await getCompetencyEvents(db, learnerId)).filter((event) => event.lessonId !== lessonId));
}

/** A lesson's current Taught/Assessed/Achieved selections, reconstructed from its competency events (for the edit form). */
export async function getLessonCompetencySelections(db: D1Database, lessonId: string): Promise<{ taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, NonNullable<CompetencyEvent["result"]>> }> {
  const { results } = await db.prepare("SELECT competency_id, action, result FROM competency_events WHERE lesson_id = ?").bind(lessonId).all<Row>();
  const taughtIds: string[] = [];
  const assessedIds: string[] = [];
  const achievedResults: Record<string, NonNullable<CompetencyEvent["result"]>> = {};
  for (const row of results) {
    const competencyId = String(row.competency_id);
    if (row.action === "taught") {
      taughtIds.push(competencyId);
    } else {
      assessedIds.push(competencyId);
      if (row.result) achievedResults[competencyId] = row.result as NonNullable<CompetencyEvent["result"]>;
    }
  }
  return { taughtIds, assessedIds, achievedResults };
}

/** Set once 23 Final Drive has been Assessed + Achieved for this learner, else null. */
export async function getCompletionSummary(db: D1Database, learnerId: string): Promise<CompletionSummary | null> {
  const row = await db
    .prepare(
      `SELECT e.created_at AS completed_at, l.lesson_no, l.cumulative_minutes, l.cumulative_km, i.full_name AS instructor_name
       FROM competency_events e
       JOIN lessons l ON l.id = e.lesson_id
       JOIN instructors i ON i.id = l.instructor_id
       WHERE e.learner_id = ? AND e.competency_id = ? AND e.action = 'assessed' AND e.result = 'achieved'
       ORDER BY e.created_at ASC LIMIT 1`,
    )
    .bind(learnerId, FINAL_DRIVE_23)
    .first<Row>();
  if (!row) return null;
  return {
    completedAt: String(row.completed_at),
    completingLessonNo: Number(row.lesson_no),
    instructorName: String(row.instructor_name),
    totalLessons: Number(row.lesson_no),
    cumulativeHours: Math.round((Number(row.cumulative_minutes) / 60) * 10) / 10,
    cumulativeKm: Number(row.cumulative_km),
  };
}
