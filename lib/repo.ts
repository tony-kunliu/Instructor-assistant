import { distanceKm, durationMinutes, EMPTY_TOTALS, parseOdometer, type Totals } from "./calc.ts";
import {
  ALL_ASSESSABLE_IDS,
  CORE_COMPETENCY_IDS,
  CompetencyRuleError,
  POST_REVIEW_1_17_IDS,
  POST_REVIEW_1_17_LOCK_MESSAGE,
  assessmentChronologyViolations,
  assessmentLockReason,
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
import { buildLessonUpsertedPayload, sameContractState, type BuildLessonUpsertedInput } from "./integration/contract.ts";
import { jsonInsertStatement } from "./d1-json-insert.ts";
import { ensureStrictlyNewerSourceUpdatedAt, insertOutboxRowsStatement, latestSendablePayloadByLesson, latestSourceUpdatedAtByLesson } from "./integration/outbox.ts";
import { IMMEDIATE_DELIVERY_LIMIT, processDueOutbox } from "./integration/sender.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "./integration/types.ts";
import { planPaperImport, type PaperImportPreview, type PaperImportRowError } from "./paper-import.ts";
import { isPriorRecord } from "./prior-record.ts";
import type { CompletionSummary, Instructor, Learner, LearnerInput, Lesson, LessonInput, SignatureStatus } from "./types.ts";

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
    archivedAt: (row.archived_at as string) ?? null,
  };
}

function nullableString(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function nullableNumber(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Reads a column that must be present and one of `allowed` — never silently defaults (the PDF prints signature text from it). */
function strictEnum<T extends string>(value: unknown, allowed: readonly T[], column: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`lessons.${column} is missing or has an unknown value (${String(value)}).`);
}

/** Exported for unit tests of the strict column reads. */
export function toLesson(row: Row): Lesson {
  const recordSource = strictEnum(row.record_source, ["app", "paper_import", "prior_instructor"], "record_source");
  const isPrior = isPriorRecord({ recordSource });
  return {
    id: String(row.id),
    learnerId: String(row.learner_id),
    instructorId: String(row.instructor_id),
    lessonNo: Number(row.lesson_no),
    lessonDate: String(row.lesson_date),
    startTime: nullableString(row.start_time),
    finishTime: nullableString(row.finish_time),
    startOdometer: nullableNumber(row.start_odometer),
    finishOdometer: nullableNumber(row.finish_odometer),
    durationMinutes: nullableNumber(row.duration_minutes),
    distanceKm: nullableNumber(row.distance_km),
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
    recordSource,
    signatureStatus: strictEnum(row.signature_status, ["digital", "on_paper", "unsigned"], "signature_status"),
    priorInstructorLabel: isPrior ? strictPresent(row.prior_instructor_label, "prior_instructor_label", String) : nullableString(row.prior_instructor_label),
    priorLessonCount: isPrior ? strictPresent(row.prior_lesson_count, "prior_lesson_count", Number) : nullableNumber(row.prior_lesson_count),
  };
}

/** A column a prior-instructor row must carry (the History/PDF line is printed from it) — never silently null. */
function strictPresent<T>(value: unknown, column: string, convert: (value: unknown) => T): T {
  if (value === null || value === undefined || value === "") throw new Error(`lessons.${column} is missing on a prior_instructor row.`);
  return convert(value);
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

export async function listLearners(db: D1Database, options: { archived?: boolean } = {}): Promise<Learner[]> {
  const where = options.archived ? "l.archived_at IS NOT NULL" : "l.archived_at IS NULL";
  const { results } = await db.prepare(`${LEARNER_SELECT} WHERE ${where} ORDER BY l.full_name COLLATE NOCASE`).all<Row>();
  return results.map(toLearner);
}

/**
 * Archive (or restore) a learner. Only toggles `archived_at` — identity,
 * lessons, competency events, signatures and Integration mapping are never
 * touched, and no integration event is emitted. Re-archiving keeps the
 * original timestamp.
 */
export async function setLearnerArchived(db: D1Database, id: string, archived: boolean): Promise<Learner> {
  const result = await db
    .prepare(
      `UPDATE learners SET
         archived_at = CASE WHEN ? THEN COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .bind(archived ? 1 : 0, id)
    .run();
  if (!result.meta.changes) throw new NotFoundError("Learner not found.");
  return getLearner(db, id);
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
      // lessonCount (and so the next lesson number) counts lessons only: prior-instructor
      // records have negative lesson_no. Their hours/km DO count in the totals (spec §12).
      `SELECT COUNT(CASE WHEN lesson_no > 0 THEN 1 END) AS lesson_count,
              COALESCE(SUM(duration_minutes), 0) AS total_minutes,
              COALESCE(SUM(distance_km), 0) AS total_km,
              (SELECT finish_odometer FROM lessons WHERE learner_id = ? AND finish_odometer IS NOT NULL ORDER BY lesson_no DESC LIMIT 1) AS last_finish
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
              lessons.updated_by_instructor_id, lessons.record_source, lessons.signature_status, lessons.prior_instructor_label, lessons.prior_lesson_count,
              ub.full_name AS updated_by_instructor_name
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
 * builds this lesson's lesson.upserted payload for the outbox. The caller
 * turns its payloads into ONE outbox INSERT (insertOutboxRowsStatement) and
 * must push it into the *same* `db.batch([...])` call as the
 * lesson/competency_events write, so the two commit together or not at all.
 * This is what actually closes the durability gap an earlier round of this
 * feature left open and documented as a known trade-off: there is no window
 * where the lesson exists but its integration event silently doesn't.
 *
 * Returns `null` (nothing to enqueue) when `integration` is omitted or
 * disabled — the default for every caller that doesn't pass it, so this never
 * affects existing behavior (see AGENTS.md §10). Instructor display names are
 * read beforehand in one query (integrationInstructorNames) — reads don't
 * need the same transactional guarantee as the write.
 */
function buildIntegrationPayload(
  integration: IntegrationHooks | undefined,
  instructorNames: ReadonlyMap<string, string>,
  params: { learnerId: string; instructorId: string; lesson: BuildLessonUpsertedInput["lesson"]; taughtIds: string[]; assessedIds: string[]; achievedIds: string[]; progress: LearnerProgress },
  /** Payload of the lesson's latest event the receiver has (or will get). When the new payload says exactly the same, no event is enqueued (returns null). */
  redundantIfSameAs?: string,
): LessonUpsertedPayloadV1 | null {
  if (!integration?.config.enabled) return null;
  const payload = buildLessonUpsertedPayload({
    environment: integration.config.environment,
    learnerId: params.learnerId,
    instructorId: params.instructorId,
    instructorDisplayName: instructorNames.get(params.instructorId) ?? "",
    lesson: params.lesson,
    taughtIds: params.taughtIds,
    assessedIds: params.assessedIds,
    achievedIds: params.achievedIds,
    progress: params.progress,
  });
  if (redundantIfSameAs !== undefined && sameContractState(JSON.stringify(payload), redundantIfSameAs)) return null;
  return payload;
}

/** Display names of the given instructors, in one query — only read when integration is enabled (no read otherwise, as before). */
async function integrationInstructorNames(db: D1Database, integration: IntegrationHooks | undefined, instructorIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!integration?.config.enabled || instructorIds.length === 0) return names;
  const { results } = await db
    .prepare("SELECT id, full_name FROM instructors WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...new Set(instructorIds)]))
    .all<Row>();
  for (const row of results) names.set(String(row.id), String(row.full_name ?? ""));
  return names;
}

const COMPETENCY_EVENT_COLUMNS = ["id", "learner_id", "lesson_id", "competency_id", "action", "result"] as const;

/** Rows for one lesson's competency_events: every Taught id, then every Assessed id with its result — the order they have always been inserted in. */
function competencyEventRows(
  learnerId: string,
  lessonId: string,
  taughtIds: readonly string[],
  assessedIds: readonly string[],
  achievedResults: Readonly<Record<string, string>>,
): Record<(typeof COMPETENCY_EVENT_COLUMNS)[number], string | null>[] {
  return [
    ...taughtIds.map((competencyId) => ({ id: crypto.randomUUID(), learner_id: learnerId, lesson_id: lessonId, competency_id: competencyId, action: "taught", result: null })),
    ...assessedIds.map((competencyId) => ({ id: crypto.randomUUID(), learner_id: learnerId, lesson_id: lessonId, competency_id: competencyId, action: "assessed", result: achievedResults[competencyId] ?? null })),
  ];
}

/** One set-based INSERT for any number of competency events (null when there are none). */
function insertCompetencyEventsStatement(db: D1Database, rows: readonly Record<(typeof COMPETENCY_EVENT_COLUMNS)[number], string | null>[]): D1PreparedStatement | null {
  return jsonInsertStatement(db, "competency_events", COMPETENCY_EVENT_COLUMNS, rows);
}

/** Fires a best-effort immediate delivery attempt for whatever is now due in the outbox, once the batch that enqueued it has committed. A no-op when integration is disabled. Never awaited by the caller unless its own `schedule` hook chooses to (see IntegrationHooks — tests do, the real deployed Worker uses ExecutionContext.waitUntil instead). */
function scheduleIntegrationDelivery(db: D1Database, integration: IntegrationHooks | undefined): void {
  if (!integration?.config.enabled) return;
  const fetchImpl = integration.fetchImpl ?? fetch;
  const attempt = () => processDueOutbox(db, integration.config, fetchImpl, new Date(), IMMEDIATE_DELIVERY_LIMIT).then(() => undefined);
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
  // CBT&A Completed is a derived state (Final Drive 23 valid), so a History
  // Edit that invalidates it re-opens lesson creation. Corrections to
  // existing lessons (updateLesson) are never blocked.
  if (progress.completed) throw new ValidationError("CBT&A is already completed for this learner — no further CBT&A lessons can be recorded.");
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
  const instructorNames = await integrationInstructorNames(db, integration, [actingInstructorId]);
  const outboxPayload = buildIntegrationPayload(integration, instructorNames, {
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

  // Set-based: one statement for all of this lesson's events, whatever their
  // number (D1 counts every batch statement against its per-request limit).
  const eventsInsert = insertCompetencyEventsStatement(db, competencyEventRows(learnerId, id, taughtIds, assessedIds, achievedResults));
  const outboxInsert = outboxPayload ? insertOutboxRowsStatement(db, [outboxPayload]) : null;
  // db.batch() runs as a single atomic transaction on both the real D1
  // binding and the local node:sqlite adapter (see lib/d1-sqlite.ts) — the
  // lesson row, its competency events, and (when integration is enabled)
  // its outbox row are committed together or not at all.
  await db.batch([lessonInsert, ...(eventsInsert ? [eventsInsert] : []), ...(outboxInsert ? [outboxInsert] : [])]);

  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  const lesson = toLesson(row as Row);

  scheduleIntegrationDelivery(db, integration);

  return lesson;
}

// ── Paper records import (P1b) ───────────────────────────────────────────

const MAX_IMPORT_CSV_BYTES = 512 * 1024;

const PAPER_LESSON_COLUMNS = [
  "id", "learner_id", "instructor_id", "lesson_no", "lesson_date", "start_time", "finish_time",
  "start_odometer", "finish_odometer", "duration_minutes", "distance_km", "cumulative_minutes", "cumulative_km",
  "taught", "competencies_assessed", "achieved", "location", "comments", "adi_signature", "learner_signature",
  "record_source", "signature_status", "prior_instructor_label", "prior_lesson_count",
] as const;

export type PaperImportResult =
  | { mode: "preview"; preview: PaperImportPreview }
  | { mode: "commit"; preview: PaperImportPreview; lessonCount: number };

export class PaperImportError extends ValidationError {
  errors: PaperImportRowError[];
  constructor(errors: PaperImportRowError[]) {
    super("Import has errors.");
    this.errors = errors;
  }
}

/**
 * Imports a paper-records CSV into a learner with no lessons yet. Preview
 * writes nothing. Commit writes every lesson and competency event in ONE
 * db.batch() (atomic); `UNIQUE (learner_id, lesson_no)` rejects the whole
 * batch if a lesson appeared after the guard read. Paper lessons never
 * enqueue integration_outbox rows.
 *
 * Prior-instructor records (spec §12) are written in the same statements:
 * one lessons row each (record_source 'prior_instructor', negative lesson_no,
 * owned by the learner's own instructor, signed on paper) whose achievements
 * become assessed/achieved competency events. They are never sent to ACTGDS.
 */
export async function importPaperLessons(db: D1Database, learnerId: string, csvText: string, mode: "preview" | "commit"): Promise<PaperImportResult> {
  if (mode !== "preview" && mode !== "commit") throw new ValidationError("Import mode must be preview or commit.");
  if (typeof csvText !== "string" || !csvText.trim()) throw new ValidationError("CSV file is required.");
  if (new TextEncoder().encode(csvText).length > MAX_IMPORT_CSV_BYTES) throw new ValidationError("File is too large.");
  const learner = await getLearner(db, learnerId);
  // No rows at all — getTotals().lessonCount would not see prior-instructor records (negative lesson_no).
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE learner_id = ?").bind(learnerId).first<Row>();
  if (Number(existing?.n ?? 0) !== 0) throw new ValidationError("Paper records can only be imported into a learner with no lessons.");

  const plan = planPaperImport(csvText, await listActiveInstructors(db));
  if (!plan.ok) throw new PaperImportError(plan.errors);
  if (mode === "preview") return { mode, preview: plan.preview };

  // Set-based: one INSERT for all lessons and one for all their competency
  // events, however many rows the file has (D1 counts every batch statement
  // against its per-request query limit). Lessons first, in lesson_no order.
  const lessonRowsToInsert: Record<(typeof PAPER_LESSON_COLUMNS)[number], string | number | null>[] = [];
  const eventRowsToInsert: ReturnType<typeof competencyEventRows> = [];
  for (const prior of plan.priorRecords) {
    const id = crypto.randomUUID();
    const achieved = formatIdList(prior.achievedIds);
    lessonRowsToInsert.push({
      id, learner_id: learnerId, instructor_id: learner.instructorId, lesson_no: prior.lessonNo, lesson_date: prior.date,
      start_time: null, finish_time: null, start_odometer: null, finish_odometer: null,
      duration_minutes: prior.minutes, distance_km: prior.km, cumulative_minutes: prior.cumulativeMinutes, cumulative_km: prior.cumulativeKm,
      taught: null, competencies_assessed: achieved, achieved, location: null, comments: null, adi_signature: null, learner_signature: null,
      record_source: "prior_instructor", signature_status: "on_paper", prior_instructor_label: prior.label, prior_lesson_count: prior.lessonCount,
    });
    eventRowsToInsert.push(...competencyEventRows(learnerId, id, [], prior.achievedIds, Object.fromEntries(prior.achievedIds.map((competencyId) => [competencyId, "achieved"]))));
  }
  for (const lesson of plan.lessons) {
    const id = crypto.randomUUID();
    lessonRowsToInsert.push({
      id, learner_id: learnerId, instructor_id: lesson.instructorId, lesson_no: lesson.lessonNo, lesson_date: lesson.lessonDate,
      start_time: lesson.startTime, finish_time: lesson.finishTime, start_odometer: lesson.startOdometer, finish_odometer: lesson.finishOdometer,
      duration_minutes: lesson.durationMinutes, distance_km: lesson.distanceKm, cumulative_minutes: lesson.cumulativeMinutes, cumulative_km: lesson.cumulativeKm,
      taught: formatIdList(lesson.taughtIds), competencies_assessed: formatIdList(lesson.assessedIds),
      achieved: formatIdList(lesson.assessedIds.filter((competencyId) => lesson.achievedResults[competencyId] === "achieved")),
      location: lesson.location, comments: lesson.comments, adi_signature: null, learner_signature: null,
      record_source: "paper_import", signature_status: lesson.signatureStatus, prior_instructor_label: null, prior_lesson_count: null,
    });
    eventRowsToInsert.push(...competencyEventRows(learnerId, id, lesson.taughtIds, lesson.assessedIds, lesson.achievedResults));
  }
  const statements = [jsonInsertStatement(db, "lessons", PAPER_LESSON_COLUMNS, lessonRowsToInsert), insertCompetencyEventsStatement(db, eventRowsToInsert)].filter(
    (statement): statement is D1PreparedStatement => statement !== null,
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new ValidationError("Paper records can only be imported into a learner with no lessons.");
    throw error;
  }
  return { mode, preview: plan.preview, lessonCount: plan.lessons.length };
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
  // D14: a previous instructor's record is never edited (a mistake is fixed by re-importing a learner with no App lessons).
  if (isPriorRecord(existing)) throw new ValidationError("Prior-instructor records cannot be edited.");

  const lessonDate = isoDate(input.lessonDate);
  if (!lessonDate) throw new ValidationError("Lesson date is required.");
  // Paper-imported lessons (record_source = 'paper_import') may legitimately
  // lack times / odometer readings and carry no digital signatures; app
  // lessons keep every original requirement unchanged.
  const isPaper = existing.recordSource === "paper_import";
  const startTimeRaw = String(input.startTime ?? "").trim();
  const finishTimeRaw = String(input.finishTime ?? "").trim();
  let startTime: string | null = startTimeRaw;
  let finishTime: string | null = finishTimeRaw;
  let duration: number | null;
  let startOdometer: number | null;
  let finishOdometer: number | null;
  let distance: number | null;
  let signatureStatus: SignatureStatus = "digital";

  if (isPaper) {
    if (input.signatureStatus !== "on_paper" && input.signatureStatus !== "unsigned") {
      throw new ValidationError('Signature status must be "on_paper" or "unsigned" for a paper record.');
    }
    signatureStatus = input.signatureStatus;
    if (!startTimeRaw && !finishTimeRaw) {
      startTime = null;
      finishTime = null;
      duration = null;
    } else if (!startTimeRaw || !finishTimeRaw) {
      throw new ValidationError("Enter both start and finish time, or leave both blank.");
    } else {
      duration = durationMinutes(startTimeRaw, finishTimeRaw);
      if (duration === null) throw new ValidationError("Start and finish time are required, and finish must be after start.");
    }
    const startOdoRaw = String(input.startOdometer ?? "").trim();
    const finishOdoRaw = String(input.finishOdometer ?? "").trim();
    if (!startOdoRaw && !finishOdoRaw) {
      startOdometer = null;
      finishOdometer = null;
      distance = null;
    } else if (!startOdoRaw || !finishOdoRaw) {
      throw new ValidationError("Enter both start and finish odometer, or leave both blank.");
    } else {
      startOdometer = parseOdometer(startOdoRaw);
      finishOdometer = parseOdometer(finishOdoRaw);
      if (startOdometer === null) throw new ValidationError("Start odometer is required.");
      if (finishOdometer === null) throw new ValidationError("Finish odometer is required.");
      distance = distanceKm(startOdometer, finishOdometer);
      if (distance === null) throw new ValidationError("Finish odometer must not be less than start odometer.");
    }
  } else {
    duration = durationMinutes(startTimeRaw, finishTimeRaw);
    if (duration === null) throw new ValidationError("Start and finish time are required, and finish must be after start.");
    startOdometer = parseOdometer(input.startOdometer as string);
    finishOdometer = parseOdometer(input.finishOdometer as string);
    if (startOdometer === null) throw new ValidationError("Start odometer is required.");
    if (finishOdometer === null) throw new ValidationError("Finish odometer is required.");
    distance = distanceKm(startOdometer, finishOdometer);
    if (distance === null) throw new ValidationError("Finish odometer must not be less than start odometer.");
  }

  // Carry-forward consistency: the odometer is one physical instrument, so
  // its readings must stay monotonic across the learner's whole lesson
  // sequence, not just within this one lesson. Paper lessons can have NULL
  // readings, so compare against the nearest earlier lesson that has a
  // finish reading and the nearest later lesson that has a start reading
  // (not merely the adjacent lesson number).
  if (startOdometer !== null && finishOdometer !== null) {
    const [prevLesson, nextLesson] = await Promise.all([
      db.prepare("SELECT lesson_no, finish_odometer FROM lessons WHERE learner_id = ? AND lesson_no < ? AND finish_odometer IS NOT NULL ORDER BY lesson_no DESC LIMIT 1").bind(learnerId, existing.lessonNo).first<Row>(),
      db.prepare("SELECT lesson_no, start_odometer FROM lessons WHERE learner_id = ? AND lesson_no > ? AND start_odometer IS NOT NULL ORDER BY lesson_no ASC LIMIT 1").bind(learnerId, existing.lessonNo).first<Row>(),
    ]);
    if (prevLesson && startOdometer < Number(prevLesson.finish_odometer)) {
      throw new ValidationError(`Start odometer cannot be less than Lesson #${prevLesson.lesson_no}'s finish odometer (${prevLesson.finish_odometer}).`);
    }
    if (nextLesson && finishOdometer > Number(nextLesson.start_odometer)) {
      throw new ValidationError(`Finish odometer cannot exceed Lesson #${nextLesson.lesson_no}'s start odometer (${nextLesson.start_odometer}).`);
    }
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

  // History Edit is judged by LESSON CHRONOLOGY (lesson number = creation
  // order, never editable), not by "every other lesson": a later lesson can
  // never legitimise an earlier one. Two consequences:
  //  - Taught: a competency can't be taught in a lesson if it was already
  //    Achieved in an EARLIER lesson (achieved LATER is normal — that's how
  //    it was learned).
  //  - Assessed gates (Review 1-17, 18, 20, 21, Review 1-22, Final Drive 23) are
  //    judged against earlier lessons only, below.
  const { results: lessonRows } = await db.prepare("SELECT id, lesson_no FROM lessons WHERE learner_id = ?").bind(learnerId).all<Row>();
  const lessonNoById = new Map(lessonRows.map((row) => [String(row.id), Number(row.lesson_no)]));
  const progressBeforeThisLesson = computeProgress(allEventsBeforeEdit.filter((event) => (lessonNoById.get(event.lessonId) ?? Infinity) < existing.lessonNo));
  try {
    validateLessonCompetencies({ taughtIds, assessedIds, achievedResults }, progressBeforeThisLesson, { skipAssessmentGates: true });
  } catch (error) {
    if (error instanceof CompetencyRuleError) throw new ValidationError(error.message);
    throw error;
  }
  const achievedIds = assessedIds.filter((id) => achievedResults[id] === "achieved");

  // An edit may not introduce a NEW gated assessment (in this lesson) whose
  // prerequisites weren't Achieved in earlier lessons. Violations already in
  // legacy data are tolerated and never rewritten — only new ones block.
  // Effects on LATER lessons: an Assessed 18, 20, 21 there has no rollback
  // semantics, so an edit that would break its prerequisites is rejected;
  // later Review / Final Drive milestones keep their derived rollback and are
  // reported through `invalidated` instead of blocking the edit.
  {
    const groupByLesson = (events: readonly CompetencyEvent[]) => {
      const groups = new Map<number, CompetencyEvent[]>();
      for (const event of events) {
        const lessonNo = lessonNoById.get(event.lessonId);
        if (lessonNo === undefined) continue;
        groups.set(lessonNo, [...(groups.get(lessonNo) ?? []), event]);
      }
      return [...groups].map(([lessonNo, events]) => ({ lessonNo, events }));
    };
    const stamp = new Date().toISOString();
    const proposedEvents: CompetencyEvent[] = [
      ...otherLessonsEvents,
      ...taughtIds.map((competencyId) => ({ competencyId, action: "taught" as const, result: null, lessonId, createdAt: stamp })),
      ...assessedIds.map((competencyId) => ({ competencyId, action: "assessed" as const, result: achievedResults[competencyId] ?? null, lessonId, createdAt: stamp })),
    ];
    const already = assessmentChronologyViolations(groupByLesson(allEventsBeforeEdit));
    const introduced = [...assessmentChronologyViolations(groupByLesson(proposedEvents))].filter((key) => !already.has(key));
    const idOf = (key: string) => key.slice(key.indexOf(":") + 1);
    const lessonNoOf = (key: string) => Number(key.slice(0, key.indexOf(":")));
    const own = introduced.find((key) => lessonNoOf(key) === existing.lessonNo);
    if (own) throw new ValidationError(assessmentLockReason(idOf(own), progressBeforeThisLesson) ?? POST_REVIEW_1_17_LOCK_MESSAGE);
    const laterCompetencies = introduced.filter((key) => POST_REVIEW_1_17_IDS.includes(idOf(key)));
    if (laterCompetencies.length) {
      const laterLessonNo = Math.min(...laterCompetencies.map(lessonNoOf));
      throw new ValidationError(`This edit would leave Lesson #${laterLessonNo} assessing Competency 18, 20 or 21 before Competency 1-17 and Review 1-17 were achieved in earlier lessons. Correct Lesson #${laterLessonNo} first.`);
    }
  }

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

  let adiSignature: string | null;
  let learnerSignature: string | null;
  if (isPaper) {
    // Paper records carry no digital signatures: whatever is stored stays untouched.
    adiSignature = existing.adiSignature;
    learnerSignature = existing.learnerSignature;
  } else if (contentChanged) {
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
  // Full row shape (not just duration/distance) — a downstream lesson that
  // already has its own Integration event needs its own lesson_date/
  // start_time/finish_time/instructor to build a correct propagated event
  // (see the ACTGDS History Edit downstream-propagation fix below).
  const { results: laterLessons } = await db
    .prepare("SELECT id, lesson_no, lesson_date, start_time, finish_time, duration_minutes, distance_km, instructor_id, created_at FROM lessons WHERE learner_id = ? AND lesson_no > ? ORDER BY lesson_no ASC")
    .bind(learnerId, existing.lessonNo)
    .all<Row>();

  let runningMinutes = Number(priorTotals?.m ?? 0) + (duration ?? 0);
  let runningKm = Number(priorTotals?.k ?? 0) + (distance ?? 0);
  // Captured before the laterLessons loop below mutates runningMinutes/Km further — this lesson's own new cumulative totals, for the integration payload.
  const thisLessonCumulativeMinutes = runningMinutes;
  const thisLessonCumulativeKm = runningKm;

  const updateEditedLesson = db
    .prepare(
      `UPDATE lessons SET lesson_date = ?, start_time = ?, finish_time = ?, start_odometer = ?, finish_odometer = ?,
         duration_minutes = ?, distance_km = ?, cumulative_minutes = ?, cumulative_km = ?,
         taught = ?, competencies_assessed = ?, achieved = ?, location = ?, comments = ?,
         adi_signature = ?, learner_signature = ?, signature_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
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
      signatureStatus,
      actingInstructorId,
      lessonId,
    );

  // Every lesson from this one on gets its cumulative totals recomputed as a
  // running sum in lesson_no order (NULL duration/distance counts as 0), in
  // ONE set-based statement however many lessons follow — D1 counts every
  // batch statement against its per-request query limit. It runs after
  // updateEditedLesson in the same batch, so it sums this lesson's new
  // duration/distance; for this lesson it yields the same value as above.
  const recomputeCumulative = db
    .prepare(
      `UPDATE lessons SET
         cumulative_minutes = (SELECT COALESCE(SUM(COALESCE(l2.duration_minutes, 0)), 0) FROM lessons l2 WHERE l2.learner_id = lessons.learner_id AND l2.lesson_no <= lessons.lesson_no),
         cumulative_km = (SELECT COALESCE(SUM(COALESCE(l2.distance_km, 0)), 0) FROM lessons l2 WHERE l2.learner_id = lessons.learner_id AND l2.lesson_no <= lessons.lesson_no)
       WHERE learner_id = ? AND lesson_no >= ?`,
    )
    .bind(learnerId, existing.lessonNo);

  // Concurrency: these payload values come from the reads above (before the
  // batch); the stored values come from recomputeCumulative at commit time.
  // They can differ only if another write to this learner's lessons lands in
  // between — accepted (single-instructor-at-a-time usage, as elsewhere here).
  //
  // lesson_id -> its own recalculated cumulative totals (the same running
  // sums recomputeCumulative stores), for the ACTGDS downstream-propagation
  // events built below (never the edited lesson's own totals — each
  // downstream lesson gets its own).
  const downstreamNewCumulative = new Map<string, { minutes: number; km: number }>();
  for (const row of laterLessons) {
    runningMinutes += Number(row.duration_minutes ?? 0);
    runningKm += Number(row.distance_km ?? 0);
    downstreamNewCumulative.set(String(row.id), { minutes: runningMinutes, km: runningKm });
  }

  const deleteOldEvents = db.prepare("DELETE FROM competency_events WHERE lesson_id = ?").bind(lessonId);
  const eventsInsert = insertCompetencyEventsStatement(db, competencyEventRows(learnerId, lessonId, taughtIds, assessedIds, achievedResults));

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

  // Version lookup for the directly edited lesson itself, combined with the
  // downstream lookup below into one query: a direct edit's own event must
  // be strictly newer than every prior event recorded for this lesson_id,
  // including a *propagated* event a previous edit already gave it (this
  // lesson can itself be a downstream target of an earlier edit — see
  // tony-kunliu/actgds.com Issue #3, "direct edit after propagation").
  // Using plain `nowIso` unconditionally here was the bug: two events
  // landing in the same millisecond compared equal, so the receiver
  // silently treated the direct edit as `stale_ignored` while the Sender
  // still marked it delivered — a durable mirror divergence with zero
  // pending outbox rows left to retry.
  const downstreamLessonIds = laterLessons.map((row) => String(row.id));
  const latestByLesson = integration?.config.enabled ? await latestSourceUpdatedAtByLesson(db, [lessonId, ...downstreamLessonIds]) : new Map<string, string>();
  const directSourceUpdatedAt = ensureStrictlyNewerSourceUpdatedAt(nowIso, latestByLesson.get(lessonId) ?? null);
  // Only already-exported downstream lessons can get a propagated event (see below).
  const exportedDownstream = laterLessons.filter((row) => latestByLesson.has(String(row.id)));
  // Every display name the payloads below need, in one read.
  const instructorNames = await integrationInstructorNames(db, integration, [...(isPaper ? [] : [existing.instructorId]), ...exportedDownstream.map((row) => String(row.instructor_id))]);

  // The lesson's own instructor_id (never the transient editor) is who this teaching record belongs to.
  // Paper lessons never enter the integration domain: no outbox row of their own.
  // (App lessons always have non-NULL times/odometers/duration/distance — validated above.)
  const outboxPayload = isPaper ? null : buildIntegrationPayload(integration, instructorNames, {
    learnerId,
    instructorId: existing.instructorId,
    lesson: {
      id: lessonId,
      lessonNo: existing.lessonNo,
      lessonDate,
      startTime: startTime as string,
      finishTime: finishTime as string,
      durationMinutes: duration as number,
      distanceKm: distance as number,
      cumulativeMinutes: thisLessonCumulativeMinutes,
      cumulativeKm: thisLessonCumulativeKm,
      createdAt: existing.createdAt,
      updatedAt: directSourceUpdatedAt,
    },
    taughtIds,
    assessedIds,
    achievedIds,
    progress: after,
  });

  // ACTGDS History Edit downstream propagation (bug fix — see
  // docs/integrations/actgds-instructor-assistant-v1.md and
  // tony-kunliu/actgds.com Issue #3): editing this lesson changes every
  // downstream lesson's cumulative_minutes/km (above) and can change the
  // learner-wide progress snapshot every already-exported lesson's payload
  // carries — but only a downstream lesson that has *already* entered the
  // Integration domain (at least one existing integration_outbox row for
  // its lesson_id, in any status: pending, delivered, or
  // permanent_failure) gets a fresh event. A downstream lesson with no
  // prior event is left alone — giving it one now would be silent
  // historical backfill, which this contract explicitly forbids. Each
  // propagated event carries that downstream lesson's *own* content (its
  // own taught/assessed/achieved, its own instructor) — never the edited
  // lesson's — and a source_updated_at guaranteed strictly newer than any
  // version already recorded for that lesson_id, so the receiver never
  // silently treats it as stale.
  //
  // A downstream event is only enqueued when it would actually tell the
  // receiver something new: if its contract-visible content (cumulative
  // totals, learner progress snapshot, own competencies, instructor, ...)
  // is identical to the lesson's latest event the receiver has or will get
  // (e.g. a location/comments-only edit), it is skipped as redundant.
  // Anything that differs — or that can't be compared — is still sent.
  const downstreamPayloads: LessonUpsertedPayloadV1[] = [];
  const downstreamBaseline = integration?.config.enabled && laterLessons.length > 0 ? await latestSendablePayloadByLesson(db, downstreamLessonIds) : new Map<string, string>();
  if (integration?.config.enabled && laterLessons.length > 0) {
    for (const row of laterLessons) {
      const downstreamLessonId = String(row.id);
      const latestExisting = latestByLesson.get(downstreamLessonId);
      if (latestExisting === undefined) continue; // never exported before — never backfilled now

      const ownEvents = otherLessonsEvents.filter((event) => event.lessonId === downstreamLessonId);
      const ownTaughtIds = ownEvents.filter((event) => event.action === "taught").map((event) => event.competencyId);
      const ownAssessedEvents = ownEvents.filter((event) => event.action === "assessed");
      const ownAssessedIds = ownAssessedEvents.map((event) => event.competencyId);
      const ownAchievedIds = ownAssessedEvents.filter((event) => event.result === "achieved").map((event) => event.competencyId);
      const cumulative = downstreamNewCumulative.get(downstreamLessonId)!;

      const downstreamPayload = buildIntegrationPayload(integration, instructorNames, {
        learnerId,
        instructorId: String(row.instructor_id),
        lesson: {
          id: downstreamLessonId,
          lessonNo: Number(row.lesson_no),
          lessonDate: String(row.lesson_date),
          startTime: String(row.start_time),
          finishTime: String(row.finish_time),
          durationMinutes: Number(row.duration_minutes),
          distanceKm: Number(row.distance_km),
          cumulativeMinutes: cumulative.minutes,
          cumulativeKm: cumulative.km,
          createdAt: String(row.created_at),
          updatedAt: ensureStrictlyNewerSourceUpdatedAt(nowIso, latestExisting),
        },
        taughtIds: ownTaughtIds,
        assessedIds: ownAssessedIds,
        achievedIds: ownAchievedIds,
        progress: after,
      }, downstreamBaseline.get(downstreamLessonId));
      if (downstreamPayload) downstreamPayloads.push(downstreamPayload);
    }
  }

  // The direct edit's own event first, then the propagated ones in lesson_no
  // order — one set-based INSERT for all of them.
  const outboxInsert = insertOutboxRowsStatement(db, [...(outboxPayload ? [outboxPayload] : []), ...downstreamPayloads]);

  // One atomic transaction: the edited lesson, every downstream lesson's
  // recomputed cumulative totals, the swapped competency events, the
  // direct edit's own outbox row, and every downstream lesson's propagated
  // outbox row (when integration is enabled) commit together or not at
  // all — a failure anywhere in this list rolls back the whole edit,
  // including every downstream lesson's cumulative totals and events, so
  // there is never a state where some downstream mirrors advanced and
  // others (or their outbox events) silently didn't. A fixed number of
  // statements, however many lessons follow the edited one.
  await db.batch([updateEditedLesson, recomputeCumulative, deleteOldEvents, ...(eventsInsert ? [eventsInsert] : []), ...(outboxInsert ? [outboxInsert] : [])]);

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

/** Progress from EARLIER lessons only (lower lesson number) — what the 18, 20, 21 chronology gate is judged against when editing that lesson. */
export async function getProgressBeforeLesson(db: D1Database, learnerId: string, lessonId: string): Promise<LearnerProgress> {
  const { results } = await db
    .prepare(
      `SELECT e.competency_id, e.action, e.result, e.lesson_id, e.created_at
       FROM competency_events e JOIN lessons l ON l.id = e.lesson_id
       WHERE e.learner_id = ? AND l.lesson_no < (SELECT lesson_no FROM lessons WHERE id = ? AND learner_id = ?)
       ORDER BY e.created_at ASC`,
    )
    .bind(learnerId, lessonId, learnerId)
    .all<Row>();
  return computeProgress(
    results.map((row) => ({
      competencyId: String(row.competency_id),
      action: row.action as CompetencyEvent["action"],
      result: (row.result as CompetencyEvent["result"]) ?? null,
      lessonId: String(row.lesson_id),
      createdAt: String(row.created_at),
    })),
  );
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
