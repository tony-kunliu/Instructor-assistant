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
import { buildLessonUpsertedPayload, type BuildLessonUpsertedInput } from "./integration/contract.ts";
import { insertOutboxRowStatement } from "./integration/outbox.ts";
import { processDueOutbox } from "./integration/sender.ts";
import type { IntegrationHooks } from "./integration/types.ts";
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
    updatedByInstructorId: (row.updated_by_instructor_id as string) ?? null,
    updatedByInstructorName: (row.updated_by_instructor_name as string) ?? null,
  };
}

// ── Instructors ──────────────────────────────────────────────────────────

function toInstructor(row: Row): Instructor {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    adiNumber: (row.adi_number as string) ?? null,
    email: (row.email as string) ?? null,
    status: (row.status as Instructor["status"]) ?? "active",
  };
}

export async function listInstructors(db: D1Database): Promise<Instructor[]> {
  const { results } = await db.prepare("SELECT id, full_name, adi_number, email, status FROM instructors ORDER BY full_name").all<Row>();
  return results.map(toInstructor);
}

/** Active instructors only — for a "who is performing this" attribution selector (Instructor Identity V1). */
export async function listActiveInstructors(db: D1Database): Promise<Instructor[]> {
  return (await listInstructors(db)).filter((instructor) => instructor.status === "active");
}

/**
 * Maps a verified email to its instructor record — the lookup Cloudflare
 * Access identity resolution (Instructor Identity V1, STEP 3/4) will call
 * once wired up, given the authenticated email from Access's own verified
 * JWT (never a client-submitted header). Returns null for an unknown or
 * inactive email — the caller must then refuse app access, never
 * auto-create an instructor for an unrecognized identity.
 */
export async function findInstructorByEmail(db: D1Database, email: string): Promise<Instructor | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const row = await db.prepare("SELECT id, full_name, adi_number, email, status FROM instructors WHERE lower(email) = lower(?)").bind(trimmed).first<Row>();
  if (!row) return null;
  const instructor = toInstructor(row);
  return instructor.status === "active" ? instructor : null;
}

/**
 * Validates that `actingInstructorId` (if supplied) refers to an existing,
 * active instructor — the app never trusts a client-submitted name/email as
 * identity, only a real instructor id already in the database (Instructor
 * Identity V1; Cloudflare Access itself, which will supply this id via a
 * verified email→instructor lookup, is not yet wired up — see STATUS.md).
 * Returns null when omitted, so existing callers that don't pass it are
 * unaffected.
 */
async function resolveActingInstructorId(db: D1Database, actingInstructorId: unknown): Promise<string | null> {
  if (actingInstructorId === undefined || actingInstructorId === null || actingInstructorId === "") return null;
  const id = String(actingInstructorId);
  const row = await db.prepare("SELECT id, status FROM instructors WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new ValidationError("Acting instructor not found.");
  if (row.status !== "active") throw new ValidationError("Acting instructor is not active.");
  return id;
}

/** Fills in (or corrects) an instructor's ADI number — needed on the official CBT&A PDF checklist. */
export async function updateInstructorAdiNumber(db: D1Database, instructorId: string, adiNumber: unknown): Promise<Instructor> {
  const value = text(adiNumber, 40);
  if (!value) throw new ValidationError("ADI number is required.");
  const existing = await db.prepare("SELECT id, full_name, email, status FROM instructors WHERE id = ?").bind(instructorId).first<Row>();
  if (!existing) throw new NotFoundError("Instructor not found.");
  await db.prepare("UPDATE instructors SET adi_number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(value, instructorId).run();
  return { ...toInstructor(existing), adiNumber: value };
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
  // Instructor must already exist and be active — no free-text name, no
  // auto-creation. Reuses the same existing-and-active check as lesson
  // attribution, just made required here (an omitted/unknown/inactive id
  // throws ValidationError -> 400, never silently creates an instructor row).
  const instructorId = await resolveActingInstructorId(db, input.instructorId);
  if (!instructorId) throw new ValidationError("Instructor is required.");
  const transmissionRaw = String(input.transmission ?? "").trim().toLowerCase();
  const transmission = transmissionRaw === "manual" || transmissionRaw === "auto" ? transmissionRaw : null;

  const id = crypto.randomUUID();
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

// LEFT JOIN: updated_by_instructor_id is NULL for never-edited lessons (and
// for lessons edited before Instructor Identity V1 shipped) — the editor's
// display name is then left null too ("Last edited by <name>" UI just omits
// that line), never guessed.
const UPDATED_BY_JOIN = "LEFT JOIN instructors ub ON ub.id = lessons.updated_by_instructor_id";

/** Lessons newest first. Signatures are omitted from the list to keep it light. */
export async function listLessons(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db
    .prepare(
      `SELECT lessons.id, lessons.learner_id, lessons.instructor_id, lessons.lesson_no, lessons.lesson_date, lessons.start_time, lessons.finish_time,
              lessons.start_odometer, lessons.finish_odometer, lessons.duration_minutes, lessons.distance_km, lessons.cumulative_minutes, lessons.cumulative_km,
              lessons.taught, lessons.competencies_assessed, lessons.achieved, lessons.location, lessons.comments,
              NULL AS adi_signature, NULL AS learner_signature, lessons.created_at, lessons.updated_at,
              lessons.updated_by_instructor_id, ub.full_name AS updated_by_instructor_name
       FROM lessons ${UPDATED_BY_JOIN} WHERE lessons.learner_id = ? ORDER BY lessons.lesson_no DESC`,
    )
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

/** All of a learner's saved lessons, oldest first, with real signatures — for the CBT&A PDF export (never partial/draft data). */
export async function listLessonsForExport(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db
    .prepare(`SELECT lessons.*, ub.full_name AS updated_by_instructor_name FROM lessons ${UPDATED_BY_JOIN} WHERE learner_id = ? ORDER BY lesson_no ASC`)
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

export async function getLesson(db: D1Database, learnerId: string, lessonId: string): Promise<Lesson> {
  const row = await db
    .prepare(`SELECT lessons.*, ub.full_name AS updated_by_instructor_name FROM lessons ${UPDATED_BY_JOIN} WHERE lessons.id = ? AND lessons.learner_id = ?`)
    .bind(lessonId, learnerId)
    .first<Row>();
  if (!row) throw new NotFoundError("Lesson not found.");
  return toLesson(row);
}

/**
 * ACTGDS Integration V1 (see docs/integrations/actgds-instructor-assistant-v1.md):
 * builds the outbox INSERT for this lesson's event as a plain
 * `D1PreparedStatement` — not run here. The caller must push it into the
 * *same* `db.batch([...])` call as the lesson/competency_events write, so
 * the two commit together or not at all. This is what actually closes the
 * durability gap an earlier round of this feature left open and
 * documented as a known trade-off: there is no window where the lesson
 * exists but its integration event silently doesn't.
 *
 * Returns `null` (nothing to add to the batch) when `integration` is
 * omitted or disabled — the default for every caller that doesn't pass it,
 * so this never affects existing behavior (see AGENTS.md §10). The one
 * read this performs (the instructor's display name) happens before the
 * batch — reads don't need the same transactional guarantee as the write.
 */
async function prepareIntegrationOutboxInsert(
  db: D1Database,
  integration: IntegrationHooks | undefined,
  params: { learnerId: string; instructorId: string; lesson: BuildLessonUpsertedInput["lesson"]; taughtIds: string[]; assessedIds: string[]; achievedIds: string[]; progress: LearnerProgress },
): Promise<D1PreparedStatement | null> {
  if (!integration?.config.enabled) return null;
  const instructorRow = await db.prepare("SELECT full_name FROM instructors WHERE id = ?").bind(params.instructorId).first<Row>();
  const payload = buildLessonUpsertedPayload({
    environment: integration.config.environment,
    learnerId: params.learnerId,
    instructorId: params.instructorId,
    instructorDisplayName: String(instructorRow?.full_name ?? ""),
    lesson: params.lesson,
    taughtIds: params.taughtIds,
    assessedIds: params.assessedIds,
    achievedIds: params.achievedIds,
    progress: params.progress,
  });
  return insertOutboxRowStatement(db, payload);
}

/** Fires a best-effort immediate delivery attempt for whatever is now due in the outbox, once the batch that enqueued it has committed. A no-op when integration is disabled. Never awaited by the caller unless its own `schedule` hook chooses to (see IntegrationHooks — tests do, the real deployed Worker uses ExecutionContext.waitUntil instead). */
function scheduleIntegrationDelivery(db: D1Database, integration: IntegrationHooks | undefined): void {
  if (!integration?.config.enabled) return;
  const fetchImpl = integration.fetchImpl ?? fetch;
  const attempt = () => processDueOutbox(db, integration.config, fetchImpl).then(() => undefined);
  if (integration.schedule) integration.schedule(attempt);
  else void attempt();
}

export async function createLesson(db: D1Database, learnerId: string, input: LessonInput, integration?: IntegrationHooks): Promise<Lesson> {
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
  // Fetched once as raw events (not via getLearnerProgress) so the same
  // array can also seed the in-memory "after" progress snapshot below,
  // without a second read once the events actually exist in the DB.
  const priorEvents = await getCompetencyEvents(db, learnerId);
  const progress = computeProgress(priorEvents);
  try {
    validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progress);
  } catch (error) {
    if (error instanceof CompetencyRuleError) throw new ValidationError(error.message);
    throw error;
  }
  const achievedIds = assessedIds.filter((id) => achievedResults[id] === "achieved");

  // The instructor who actually taught/created this lesson (Instructor
  // Identity V1) — falls back to the learner's own instructor when not
  // supplied, preserving prior behavior for callers that don't pass it.
  const actingInstructorId = (await resolveActingInstructorId(db, input.actingInstructorId)) ?? learner.instructorId;

  const id = crypto.randomUUID();
  // Lesson number and cumulative totals are derived from the current totals,
  // read just before the insert. Same D1 limitation as above: this is two
  // sequential calls, not one atomic transaction. `UNIQUE (learner_id,
  // lesson_no)` still rejects a colliding lesson_no outright rather than
  // silently corrupting totals, for the same single-instructor-at-a-time
  // usage pattern.
  const totals = await getTotals(db, learnerId);

  // ACTGDS Integration V1: the outbox row's payload needs this lesson's
  // progress *after* its own events are applied. Rather than write first
  // and re-read (which would put the outbox INSERT outside this lesson's
  // atomic batch — the exact durability gap this round closes), build that
  // "after" snapshot purely in memory from priorEvents plus this lesson's
  // own about-to-be-inserted events. createdAt here is this function's own
  // clock reading, a few milliseconds ahead of the DB's own `strftime(...)`
  // default for the same rows — negligible for achieved/locked/ready
  // outcomes, which don't depend on sub-second event ordering.
  const nowIso = new Date().toISOString();
  const newEvents: CompetencyEvent[] = [
    ...taughtIds.map((competencyId) => ({ competencyId, action: "taught" as const, result: null, lessonId: id, createdAt: nowIso })),
    ...assessedIds.map((competencyId) => ({ competencyId, action: "assessed" as const, result: achievedResults[competencyId] ?? null, lessonId: id, createdAt: nowIso })),
  ];
  const progressAfter = computeProgress([...priorEvents, ...newEvents]);
  const outboxInsert = await prepareIntegrationOutboxInsert(db, integration, {
    learnerId,
    instructorId: actingInstructorId,
    lesson: {
      id,
      lessonNo: totals.lessonCount + 1,
      lessonDate,
      startTime,
      finishTime,
      durationMinutes: duration,
      distanceKm: distance,
      cumulativeMinutes: totals.totalMinutes + duration,
      cumulativeKm: totals.totalKm + distance,
      createdAt: nowIso,
      updatedAt: null,
    },
    taughtIds,
    assessedIds,
    achievedIds,
    progress: progressAfter,
  });

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
      actingInstructorId,
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
  // lesson row, its competency events, and (when integration is enabled)
  // its outbox row are committed together or not at all.
  await db.batch([lessonInsert, ...eventStatements, ...(outboxInsert ? [outboxInsert] : [])]);

  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  const lesson = toLesson(row as Row);

  scheduleIntegrationDelivery(db, integration);

  return lesson;
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
export async function updateLesson(db: D1Database, learnerId: string, lessonId: string, input: LessonInput, integration?: IntegrationHooks): Promise<UpdateLessonResult> {
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
  // Fetched once as raw events — reused below both for "before" (all
  // events, including this lesson's own not-yet-replaced ones) and, after
  // filtering this lesson's out, for validation and the in-memory "after"
  // snapshot the integration outbox payload needs. Replaces two separate
  // getLearnerProgress/getProgressExcludingLesson DB round trips.
  const allEventsBeforeEdit = await getCompetencyEvents(db, learnerId);
  const otherLessonsEvents = allEventsBeforeEdit.filter((event) => event.lessonId !== lessonId);
  const progressExcludingThisLesson = computeProgress(otherLessonsEvents);
  try {
    validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progressExcludingThisLesson);
  } catch (error) {
    if (error instanceof CompetencyRuleError) throw new ValidationError(error.message);
    throw error;
  }
  const achievedIds = assessedIds.filter((id) => achievedResults[id] === "achieved");

  // Instructor performing this edit (Instructor Identity V1). Omitted (or
  // not yet resolvable, e.g. before Cloudflare Access is wired up) leaves
  // updated_by_instructor_id exactly as it was — never guessed.
  const actingInstructorId = await resolveActingInstructorId(db, input.actingInstructorId);

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

  const before = computeProgress(allEventsBeforeEdit);

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
  // Captured before the laterLessons loop below mutates runningMinutes/Km further — this lesson's own new cumulative totals, for the integration payload.
  const thisLessonCumulativeMinutes = runningMinutes;
  const thisLessonCumulativeKm = runningKm;

  const updateEditedLesson = db
    .prepare(
      `UPDATE lessons SET lesson_date = ?, start_time = ?, finish_time = ?, start_odometer = ?, finish_odometer = ?,
         duration_minutes = ?, distance_km = ?, cumulative_minutes = ?, cumulative_km = ?,
         taught = ?, competencies_assessed = ?, achieved = ?, location = ?, comments = ?,
         adi_signature = ?, learner_signature = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_by_instructor_id = COALESCE(?, updated_by_instructor_id)
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
      actingInstructorId,
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

  // Same reasoning as createLesson: build the "after" progress snapshot
  // in memory (otherLessonsEvents + this lesson's own new events) so the
  // outbox INSERT can go in the same atomic batch as the edit itself,
  // rather than a separate post-write statement.
  const nowIso = new Date().toISOString();
  const newEventsForThisLesson: CompetencyEvent[] = [
    ...taughtIds.map((competencyId) => ({ competencyId, action: "taught" as const, result: null, lessonId, createdAt: nowIso })),
    ...assessedIds.map((competencyId) => ({ competencyId, action: "assessed" as const, result: achievedResults[competencyId] ?? null, lessonId, createdAt: nowIso })),
  ];
  const after = computeProgress([...otherLessonsEvents, ...newEventsForThisLesson]);
  // The lesson's own instructor_id (never the transient editor) is who this teaching record belongs to.
  const outboxInsert = await prepareIntegrationOutboxInsert(db, integration, {
    learnerId,
    instructorId: existing.instructorId,
    lesson: {
      id: lessonId,
      lessonNo: existing.lessonNo,
      lessonDate,
      startTime,
      finishTime,
      durationMinutes: duration,
      distanceKm: distance,
      cumulativeMinutes: thisLessonCumulativeMinutes,
      cumulativeKm: thisLessonCumulativeKm,
      createdAt: existing.createdAt,
      updatedAt: nowIso,
    },
    taughtIds,
    assessedIds,
    achievedIds,
    progress: after,
  });

  // One atomic transaction: the edited lesson, every downstream lesson's
  // recomputed cumulative totals, the swapped competency events, and (when
  // integration is enabled) its outbox row commit together or not at all.
  await db.batch([updateEditedLesson, deleteOldEvents, ...eventInserts, ...cumulativeUpdates, ...(outboxInsert ? [outboxInsert] : [])]);

  const [updatedLesson, completion] = await Promise.all([getLesson(db, learnerId, lessonId), getCompletionSummary(db, learnerId)]);

  scheduleIntegrationDelivery(db, integration);

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
