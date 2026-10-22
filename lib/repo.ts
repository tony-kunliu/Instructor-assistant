import { distanceKm, durationMinutes, EMPTY_TOTALS, localNow, parseOdometer, type Totals } from "./calc.ts";
import {
  ALL_ASSESSABLE_IDS,
  CORE_COMPETENCY_IDS,
  CompetencyRuleError,
  POST_REVIEW_1_17_IDS,
  POST_REVIEW_1_17_LOCK_MESSAGE,
  REVIEW_1_17,
  REVIEW_1_22,
  assessmentChronologyViolations,
  assessmentLockReason,
  FINAL_DRIVE_23,
  computeProgress,
  diffInvalidatedMilestones,
  competencyLabel,
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
import { ArchiveInputError, parseArchiveNote, parseArchiveReason } from "./archive-reasons.ts";
import { parseTransferNote, TransferInputError } from "./learner-transfer.ts";
import { validateAddressParts } from "./address-suggest.ts";
import { OTHER_LICENCE_KEYS, validateOtherLicence, type OtherLicenceFields } from "./other-licence.ts";
import { summaryFromProgress, type LearnerListSummary } from "./learner-card.ts";
import type { Scope } from "./scope.ts";
import type { CompletionSummary, Instructor, Learner, LearnerArchiveEvent, LearnerInput, LearnerTransferEvent, Lesson, LessonInput, LessonRevision, LessonRevisionSnapshot, SignatureStatus, UnsignedLessonItem } from "./types.ts";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

type Row = Record<string, unknown>;

// Upper bound for one signature data URL (characters). Both signatures live
// in the same `lessons` row and a D1 row/string may be at most 2 MB, so
// 2 × 700 000 = 1.4 MB leaves room for the rest of the row. lesson_revisions
// never stores the images (only whether each was present). The pad
// (app/signature-pad.tsx) saves a fixed 640×320 PNG, typically 10-130k chars;
// even a pad scribbled over completely stays well below this.
export const MAX_SIGNATURE_LENGTH = 700_000;

function text(value: unknown, max: number): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const check = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // A real calendar date only: 2008-13-45 and 2026-02-30 are rejected.
  return check.getUTCFullYear() === Number(match[1]) && check.getUTCMonth() === Number(match[2]) - 1 && check.getUTCDate() === Number(match[3]) ? trimmed : null;
}

/**
 * A signature the client submitted: null when none was sent (absent/empty);
 * the PNG data URL when usable. A signature that WAS sent but cannot be
 * stored (not a PNG data URL, or too large) is rejected with its own message,
 * never treated as "missing" and never silently replaced by an older one.
 */
function submittedSignature(value: unknown, who: "ADI" | "Learner"): string | null {
  const data = value === null || value === undefined ? "" : String(value);
  if (!data) return null;
  if (data.length > MAX_SIGNATURE_LENGTH) throw new ValidationError(`${who} signature image is too large — clear it and sign again.`);
  if (!data.startsWith("data:image/png;base64,")) throw new ValidationError(`${who} signature is not a valid image — clear it and sign again.`);
  return data;
}

function toLearner(row: Row): Learner {
  return {
    id: String(row.id),
    draftAt: nullableString(row.draft_at),
    draftNotes: nullableString(row.draft_notes),
    instructorId: String(row.instructor_id),
    instructorName: String(row.instructor_name ?? ""),
    instructorAdiNumber: (row.instructor_adi_number as string) ?? null,
    fullName: String(row.full_name),
    address: (row.address as string) ?? null,
    addressSuburb: nullableString(row.address_suburb),
    addressState: nullableString(row.address_state),
    addressPostcode: nullableString(row.address_postcode),
    phone: (row.phone as string) ?? null,
    dob: (row.dob as string) ?? null,
    licenceNumber: (row.licence_number as string) ?? null,
    licenceExpiry: (row.licence_expiry as string) ?? null,
    eligibility: (row.eligibility as string) ?? null,
    transmission: (row.transmission as Learner["transmission"]) ?? null,
    schoolWork: (row.school_work as string) ?? null,
    licenceStage: (row.licence_stage as Learner["licenceStage"]) ?? "learner",
    learnerLicenceIssuedOn: (row.learner_licence_issued_on as string) ?? null,
    learnerLicenceFirstIssuedOn: (row.learner_licence_first_issued_on as string) ?? null,
    hptPassedOn: (row.hpt_passed_on as string) ?? null,
    loggedHours: nullableNumber(row.logged_hours),
    loggedHoursOn: (row.logged_hours_on as string) ?? null,
    otherLicenceKind: nullableString(row.other_licence_kind),
    otherLicencePlace: nullableString(row.other_licence_place),
    otherLicenceNumber: nullableString(row.other_licence_number),
    otherLicenceClass: nullableString(row.other_licence_class),
    otherLicenceIssuedOn: nullableString(row.other_licence_issued_on),
    otherLicenceExpiresOn: nullableString(row.other_licence_expires_on),
    archivedAt: (row.archived_at as string) ?? null,
    archiveReason: nullableString(row.archive_reason),
    archiveNote: nullableString(row.archive_note),
    transfers: transferEvents(row.transfers_json),
  };
}

/**
 * The learner's transfer events from LEARNER_SELECT's transfers_json (one JSON array, any order), oldest first by
 * (at, rowid): the last element is exactly the event SQL picks with ORDER BY at DESC, rowid DESC LIMIT 1.
 */
function transferEvents(json: unknown): LearnerTransferEvent[] {
  if (typeof json !== "string" || !json) return [];
  const rows = (JSON.parse(json) as Row[]).sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : Number(a.seq) - Number(b.seq)));
  return rows
    .map((e) => ({
      id: String(e.id),
      fromInstructorId: String(e.from),
      fromName: String(e.fromName ?? ""),
      toInstructorId: String(e.to),
      toName: String(e.toName ?? ""),
      at: String(e.at),
      byInstructorId: nullableString(e.by),
      note: nullableString(e.note),
      recordsCheckedAt: nullableString(e.checkedAt),
      recordsCheckedBy: nullableString(e.checkedBy),
    }));
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
    durationMinutes: isPrior ? strictPresent(row.duration_minutes, "duration_minutes", Number) : nullableNumber(row.duration_minutes),
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
    revisionCount: Number(row.revision_count ?? 0),
    signedLater: Number(row.all_revision_count ?? 0) > Number(row.revision_count ?? 0),
    editedBeforeRevisionHistory: row.updated_at != null && Number(row.all_revision_count ?? row.revision_count ?? 0) === 0 && !isPrior,
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

/**
 * Active instructors only — for a "who is performing this" attribution selector (Instructor Identity V1).
 * An instructor scope (SaaS) narrows it to that instructor alone; `all` (private) is unchanged.
 */
export async function listActiveInstructors(db: D1Database, scope: Scope = { kind: "all" }): Promise<Instructor[]> {
  return (await listInstructors(db)).filter((instructor) => instructor.status === "active" && (scope.kind === "all" || instructor.id === scope.instructorId));
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

/**
 * Fills in (or corrects) an instructor's ADI number — needed on the official CBT&A PDF checklist. When a verified
 * actor is given (the trusted `x-instructor-id`, via lib/api.ts#patchInstructor), only that instructor may change
 * THEIR OWN number; the number of an inactive instructor can be set by any active one. No actor (local dev/tests)
 * is allowed, as for learner edit and transfer.
 */
export async function updateInstructorAdiNumber(
  db: D1Database,
  instructorId: string,
  adiNumber: unknown,
  options: { actingInstructorId?: unknown } = {},
): Promise<Instructor> {
  const value = text(adiNumber, 40);
  if (!value) throw new ValidationError("ADI number is required.");
  const actor = await resolveActingInstructorId(db, options.actingInstructorId);
  const existing = await db.prepare("SELECT id, full_name, email, status FROM instructors WHERE id = ?").bind(instructorId).first<Row>();
  if (!existing) throw new NotFoundError("Instructor not found.");
  if (actor !== null && actor !== instructorId && existing.status === "active") {
    throw new ValidationError(`Only ${String(existing.full_name)} can change their own ADI number.`);
  }
  await db.prepare("UPDATE instructors SET adi_number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(value, instructorId).run();
  return { ...toInstructor(existing), adiNumber: value };
}

/**
 * The signed-in instructor's own saved ADI signature (migration 0014): a PNG data URL, or null when none is saved.
 * Only ever for the instructor named by the trusted `x-instructor-id`; nobody else's is readable through this.
 */
export async function getOwnAdiSignature(db: D1Database, instructorId: string): Promise<string | null> {
  const row = await db.prepare("SELECT adi_signature FROM instructors WHERE id = ? AND status = 'active'").bind(instructorId).first<Row>();
  if (!row) throw new NotFoundError("Instructor not found.");
  return (row.adi_signature as string | null) || null;
}

/** Saves (or, with an empty value, removes) the signed-in instructor's own ADI signature; same validation as a lesson's. */
export async function setOwnAdiSignature(db: D1Database, instructorId: string, signature: unknown): Promise<string | null> {
  const value = submittedSignature(signature, "ADI");
  const update = await db
    .prepare("UPDATE instructors SET adi_signature = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'active'")
    .bind(value, instructorId)
    .run();
  if (!update.meta.changes) throw new NotFoundError("Instructor not found.");
  return value;
}

// ── Learners ─────────────────────────────────────────────────────────────

// The current archive reason/note (migration 0010) comes from the learner's LATEST archive event, only while
// archived and only if that event is an 'archived' one: a correlated lookup on (learner_id, at), so the list
// endpoint stays ONE query. Learners archived before 0010 have no event and get NULLs.
// Transfers (migration 0011) come from one correlated json_group_array over (learner_id, at): still ONE query;
// a learner never transferred gets "[]".
const LEARNER_SELECT = `
  SELECT l.*, i.full_name AS instructor_name, i.adi_number AS instructor_adi_number,
    ae.reason AS archive_reason, ae.note AS archive_note,
    (SELECT json_group_array(json_object('id', t.id, 'seq', t.rowid, 'from', t.from_instructor_id, 'fromName', fi.full_name, 'to', t.to_instructor_id,
        'toName', ti.full_name, 'at', t.at, 'by', t.by_instructor_id, 'note', t.note, 'checkedAt', t.records_checked_at, 'checkedBy', t.records_checked_by))
      FROM learner_transfer_events t LEFT JOIN instructors fi ON fi.id = t.from_instructor_id LEFT JOIN instructors ti ON ti.id = t.to_instructor_id
      WHERE t.learner_id = l.id) AS transfers_json
  FROM learners l JOIN instructors i ON i.id = l.instructor_id
  LEFT JOIN learner_archive_events ae ON l.archived_at IS NOT NULL AND ae.action = 'archived'
    AND ae.rowid = (SELECT e.rowid FROM learner_archive_events e WHERE e.learner_id = l.id ORDER BY e.at DESC, e.rowid DESC LIMIT 1)`;

/** An instructor scope (SaaS) lists only that instructor's learners (bound parameter); `all` (private) is the unchanged, unbound statement. */
export async function listLearners(db: D1Database, options: { archived?: boolean; scope?: Scope } = {}): Promise<Learner[]> {
  const scope = options.scope ?? { kind: "all" };
  const where = options.archived ? "l.archived_at IS NOT NULL" : "l.archived_at IS NULL";
  if (scope.kind === "instructor") {
    const { results } = await db.prepare(`${LEARNER_SELECT} WHERE ${where} AND l.instructor_id = ? ORDER BY l.full_name COLLATE NOCASE`).bind(scope.instructorId).all<Row>();
    return results.map(toLearner);
  }
  const { results } = await db.prepare(`${LEARNER_SELECT} WHERE ${where} ORDER BY l.full_name COLLATE NOCASE`).all<Row>();
  return results.map(toLearner);
}

/**
 * The one statement behind listLearnerSummaries (exported so tests can EXPLAIN it). `scoped` (SaaS instructor scope)
 * adds `instructor_id = ?` to the learner set of BOTH grouped subqueries and the outer WHERE (3 bound parameters, all
 * the same instructor id), so no other instructor's lessons or events are ever aggregated. Unscoped, the SQL is unchanged.
 */
export function learnerSummariesSql(archived: boolean, scoped = false): string {
  const where = (archived ? "archived_at IS NOT NULL" : "archived_at IS NULL") + (scoped ? " AND instructor_id = ?" : "");
  // Both grouped subqueries are bounded to the requested learners (IN on the learners index, then the learner_id
  // indexes of lessons / competency_events), so D1 rows read scale with that set, not with every learner ever.
  return `SELECT l.id AS learner_id,
              COALESCE(ls.lesson_count, 0) AS lesson_count, COALESCE(ls.total_minutes, 0) AS total_minutes, ls.last_lesson_date,
              ev.events_json
       FROM learners l
       LEFT JOIN (SELECT learner_id,
                         COUNT(CASE WHEN lesson_no > 0 THEN 1 END) AS lesson_count,
                         COALESCE(SUM(duration_minutes), 0) AS total_minutes,
                         MAX(CASE WHEN lesson_no > 0 THEN lesson_date END) AS last_lesson_date
                  FROM lessons WHERE learner_id IN (SELECT id FROM learners WHERE ${where}) GROUP BY learner_id) ls ON ls.learner_id = l.id
       LEFT JOIN (SELECT e.learner_id,
                         json_group_array(json_array(e.competency_id, e.result, e.lesson_id, e.created_at, le.lesson_no)) AS events_json
                  FROM competency_events e LEFT JOIN lessons le ON le.id = e.lesson_id
                  WHERE e.action = 'assessed' AND e.learner_id IN (SELECT id FROM learners WHERE ${where}) GROUP BY e.learner_id) ev ON ev.learner_id = l.id
       WHERE l.${where}`;
}

/**
 * Per-learner card data for the learner list (UI redesign 2026-10-12), in ONE set-based statement with no bound
 * parameters (an instructor scope binds only its id): a grouped aggregate over `lessons` (lesson count, total minutes, latest lesson date — the same
 * figures as getTotals) and one json_group_array of each learner's ASSESSED competency events, which
 * lib/competency.ts#computeProgress turns into the exact Review 1-17 / Review 1-22 / Final Drive 23 statuses
 * of the learner's own progress card. Taught events are left out on purpose: in computeProgress they only
 * feed taughtCount/firstTaughtAt/lastTaughtAt, never a status or achievedCount (pinned by
 * tests/learner-list-summaries.test.ts against getLearnerProgress). Never a per-learner query.
 */
export async function listLearnerSummaries(db: D1Database, options: { archived?: boolean; scope?: Scope } = {}): Promise<Record<string, LearnerListSummary>> {
  const scope = options.scope ?? { kind: "all" };
  const statement = scope.kind === "instructor"
    ? db.prepare(learnerSummariesSql(Boolean(options.archived), true)).bind(scope.instructorId, scope.instructorId, scope.instructorId)
    : db.prepare(learnerSummariesSql(Boolean(options.archived)));
  const { results } = await statement.all<Row>();
  const summaries: Record<string, LearnerListSummary> = {};
  for (const row of results) {
    const packed = row.events_json ? (JSON.parse(String(row.events_json)) as [string, string | null, string, string, number | null][]) : [];
    const events: CompetencyEvent[] = packed.map(([competencyId, result, lessonId, createdAt, lessonNo]) => ({
      competencyId: String(competencyId),
      action: "assessed",
      result: (result as CompetencyEvent["result"]) ?? null,
      lessonId: String(lessonId),
      createdAt: String(createdAt),
      lessonNo: lessonNo === null || lessonNo === undefined ? undefined : Number(lessonNo),
    }));
    summaries[String(row.learner_id)] = summaryFromProgress(
      computeProgress(events),
      { lessonCount: Number(row.lesson_count), totalMinutes: Number(row.total_minutes) },
      row.last_lesson_date === null || row.last_lesson_date === undefined ? null : String(row.last_lesson_date),
    );
  }
  return summaries;
}

export type ArchiveOptions = {
  /** Optional preset key (lib/archive-reasons.ts); only when archiving. Unknown = ValidationError. */
  reason?: unknown;
  /** Optional free text, <= 200 chars after cleaning; only when archiving. */
  note?: unknown;
  /** The verified actor (x-instructor-id); recorded on the event when it is a known instructor, else NULL. */
  actingInstructorId?: unknown;
  now?: Date;
};

/**
 * Archive (or restore) a learner. Only toggles `archived_at` — identity,
 * lessons, competency events, signatures and Integration mapping are never
 * touched, and no integration event is emitted. Re-archiving keeps the
 * original timestamp. A REAL state change also records one learner_archive_events
 * row (archived + optional reason/note, or restored) in the same atomic
 * db.batch() as the UPDATE; a repeat (archive an archived / restore an active
 * learner) writes no event. D1 cost: 3 statements (batch of event INSERT +
 * UPDATE, re-read), the same with or without a reason.
 */
export async function setLearnerArchived(db: D1Database, id: string, archived: boolean, options: ArchiveOptions = {}): Promise<Learner> {
  let reason: string | null;
  let note: string | null;
  try {
    reason = parseArchiveReason(options.reason);
    note = parseArchiveNote(options.note);
  } catch (error) {
    if (error instanceof ArchiveInputError) throw new ValidationError(error.message);
    throw error;
  }
  if (!archived && (reason !== null || note !== null)) throw new ValidationError("A reason or note can only be given when archiving.");
  const actor = options.actingInstructorId === undefined || options.actingInstructorId === null || options.actingInstructorId === "" ? null : String(options.actingInstructorId);
  const at = (options.now ?? new Date()).toISOString();
  const [, update] = await db.batch([
    // Runs first, so it sees the state BEFORE the UPDATE: inserts only when the state really changes.
    db
      .prepare(
        `INSERT INTO learner_archive_events (id, learner_id, action, reason, note, at, by_instructor_id)
         SELECT ?, learners.id, ?, ?, ?, ?, (SELECT instructors.id FROM instructors WHERE instructors.id = ?)
         FROM learners WHERE learners.id = ? AND (learners.archived_at IS NULL) = ?`,
      )
      .bind(crypto.randomUUID(), archived ? "archived" : "restored", reason, note, at, actor, id, archived ? 1 : 0),
    db
      .prepare(
        `UPDATE learners SET
           archived_at = CASE WHEN ? THEN COALESCE(archived_at, ?) ELSE NULL END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .bind(archived ? 1 : 0, at, id),
  ]);
  if (!update.meta.changes) throw new NotFoundError("Learner not found.");
  return getLearner(db, id);
}

/**
 * A learner's archive / restore events, newest first, with the actor's name: ONE query (learners LEFT JOIN
 * events, so an unknown learner is a NotFoundError and a learner with no events is []). Loaded only when the
 * archived banner's History is opened.
 */
export async function listLearnerArchiveEvents(db: D1Database, learnerId: string): Promise<LearnerArchiveEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.action, e.reason, e.note, e.at, e.by_instructor_id, i.full_name AS by_name
       FROM learners l
       LEFT JOIN learner_archive_events e ON e.learner_id = l.id
       LEFT JOIN instructors i ON i.id = e.by_instructor_id
       WHERE l.id = ? ORDER BY e.at DESC, e.rowid DESC`,
    )
    .bind(learnerId)
    .all<Row>();
  if (!results.length) throw new NotFoundError("Learner not found.");
  return results
    .filter((row) => row.id !== null && row.id !== undefined)
    .map((row) => ({
      id: String(row.id),
      action: row.action === "restored" ? "restored" : "archived",
      reason: nullableString(row.reason),
      note: nullableString(row.note),
      at: String(row.at),
      byInstructorId: nullableString(row.by_instructor_id),
      byName: nullableString(row.by_name),
    }));
}

export type TransferOptions = {
  /** The receiving instructor: must exist, be active and differ from the current one. */
  toInstructorId?: unknown;
  /** Optional free text, <= 200 chars after cleaning (no personal details). */
  note?: unknown;
  /** The verified actor (x-instructor-id via readJsonWithActor). Null/undefined = no identity (local dev/tests): allowed, as for learner edit. */
  actingInstructorId?: unknown;
  now?: Date;
};

/**
 * Transfer a learner to another instructor (3c T1, design D1-D3, D10, D14). Only the learner's own instructor may
 * hand over; when that instructor is inactive, any active instructor may take the learner over. An archived learner
 * must be restored first. Changes ONLY learners.instructor_id + updated_at and writes one learner_transfer_events
 * row in ONE atomic db.batch() (event INSERT first). Both statements are compare-and-set on the instructor read
 * here, archived_at IS NULL and the target still active, so a concurrent transfer / archive writes nothing and
 * gets a clear message. Lessons (and their instructor_id), revisions, competency events, signatures, archive
 * events and the outbox are never touched; nothing is enqueued for ACTGDS. D1 cost: 6 statements (actor, target,
 * learner, batch of 2, re-read); 5 without a verified actor.
 */
export async function transferLearner(db: D1Database, id: string, options: TransferOptions = {}): Promise<Learner> {
  let note: string | null;
  try {
    note = parseTransferNote(options.note);
  } catch (error) {
    if (error instanceof TransferInputError) throw new ValidationError(error.message);
    throw error;
  }
  const toId = String(options.toInstructorId ?? "").trim();
  if (!toId) throw new ValidationError("Choose the instructor to transfer this learner to.");
  const actor = await resolveActingInstructorId(db, options.actingInstructorId);
  const target = await db.prepare("SELECT id, full_name, status FROM instructors WHERE id = ?").bind(toId).first<Row>();
  if (!target) throw new ValidationError("That instructor was not found.");
  if (target.status !== "active") throw new ValidationError(`${String(target.full_name)} is not an active instructor.`);
  const current = await db
    .prepare("SELECT l.instructor_id, l.archived_at, l.draft_at, i.full_name, i.status FROM learners l JOIN instructors i ON i.id = l.instructor_id WHERE l.id = ?")
    .bind(id)
    .first<Row>();
  if (!current) throw new NotFoundError("Learner not found.");
  const fromId = String(current.instructor_id);
  const fromName = String(current.full_name ?? "") || "another instructor";
  if (current.archived_at !== null && current.archived_at !== undefined) throw new ValidationError("This learner is archived. Restore the learner first, then transfer.");
  if (current.draft_at !== null && current.draft_at !== undefined) throw new ValidationError("A draft learner cannot be transferred. Confirm the learner first.");
  if (fromId === toId) throw new ValidationError(`This learner already belongs to ${fromName}.`);
  if (actor !== null && actor !== fromId && current.status === "active") {
    throw new ValidationError(`This learner belongs to ${fromName}; only they can transfer them.`);
  }
  const at = (options.now ?? new Date()).toISOString();
  const guard = "learners.id = ? AND learners.instructor_id = ? AND learners.archived_at IS NULL AND EXISTS (SELECT 1 FROM instructors WHERE instructors.id = ? AND instructors.status = 'active')";
  const [, update] = await db.batch([
    // Runs first, so it sees the state BEFORE the UPDATE; the same guard on both = both or neither.
    db
      .prepare(
        `INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at, by_instructor_id, note)
         SELECT ?, learners.id, learners.instructor_id, ?, ?, ?, ? FROM learners WHERE ${guard}`,
      )
      .bind(crypto.randomUUID(), toId, at, actor, note, id, fromId, toId),
    db
      .prepare(`UPDATE learners SET instructor_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${guard}`)
      .bind(toId, id, fromId, toId),
  ]);
  const learner = await getLearner(db, id);
  if (update.meta.changes) return learner;
  // Someone else got there first (compare-and-set lost): nothing was written. Say what happened.
  if (learner.archivedAt !== null) throw new ValidationError("This learner was archived meanwhile. Restore the learner first, then transfer.");
  if (learner.instructorId !== fromId) throw new ValidationError(`This learner was already transferred to ${learner.instructorName || "another instructor"} by someone else. Nothing was changed.`);
  throw new ValidationError(`${String(target.full_name)} is no longer an active instructor. Nothing was changed.`);
}

/**
 * D7: the receiving instructor's one tap "Checked" on the CoP 9.1 h / 9.2 e reminder. Marks the learner's LATEST
 * transfer event, only while unchecked and only if its receiver is still the learner's instructor (and, with a
 * verified actor, is the actor). Idempotent: an already checked event is returned unchanged. Never blocks anything
 * and contacts no one. D1 cost: 3 statements (actor, UPDATE, re-read); 2 without a verified actor.
 */
export async function markTransferRecordsChecked(db: D1Database, id: string, options: { actingInstructorId?: unknown; now?: Date } = {}): Promise<Learner> {
  const actor = await resolveActingInstructorId(db, options.actingInstructorId);
  const at = (options.now ?? new Date()).toISOString();
  const update = await db
    .prepare(
      `UPDATE learner_transfer_events SET records_checked_at = ?, records_checked_by = ?
       WHERE id = (SELECT e.id FROM learner_transfer_events e WHERE e.learner_id = ? ORDER BY e.at DESC, e.rowid DESC LIMIT 1)
         AND records_checked_at IS NULL
         AND to_instructor_id = (SELECT learners.instructor_id FROM learners WHERE learners.id = ?)
         AND (? IS NULL OR to_instructor_id = ?)`,
    )
    .bind(at, actor, id, id, actor, actor)
    .run();
  const learner = await getLearner(db, id);
  if (update.meta.changes) return learner;
  const latest = learner.transfers.at(-1);
  if (!latest) throw new ValidationError("This learner has no transfer to check.");
  if (latest.recordsCheckedAt !== null) return learner;
  if (latest.toInstructorId !== learner.instructorId) throw new ValidationError("This learner's instructor has changed since this transfer. Reload the learner and try again.");
  throw new ValidationError(`Only ${latest.toName || "the receiving instructor"} can mark the previous records as checked.`);
}

export async function getLearner(db: D1Database, id: string): Promise<Learner> {
  const row = await db.prepare(`${LEARNER_SELECT} WHERE l.id = ?`).bind(id).first<Row>();
  if (!row) throw new NotFoundError("Learner not found.");
  return toLearner(row);
}

export type LearnerEditInput = LearnerInput & {
  licenceStage?: unknown;
  /** Set by the route from the verified Access identity (never from the client body when signed in). */
  actingInstructorId?: unknown;
};
type LearnerFields = {
  fullName: string | null;
  address: string | null;
  addressSuburb: string | null;
  addressState: string | null;
  addressPostcode: string | null;
  phone: string | null;
  dob: string | null;
  licenceNumber: string | null;
  licenceExpiry: string | null;
  eligibility: string | null;
  transmission: Learner["transmission"];
  schoolWork: string | null;
  licenceStage: Learner["licenceStage"];
  learnerLicenceIssuedOn: string | null;
  learnerLicenceFirstIssuedOn: string | null;
  hptPassedOn: string | null;
  loggedHours: number | null;
  loggedHoursOn: string | null;
} & OtherLicenceFields;
const LEARNER_EDIT_KEYS = [
  "fullName", "address", "phone", "dob", "licenceNumber", "licenceExpiry", "eligibility", "transmission", "schoolWork", "licenceStage",
  "learnerLicenceIssuedOn", "learnerLicenceFirstIssuedOn", "hptPassedOn", "loggedHours", "loggedHoursOn",
  "addressSuburb", "addressState", "addressPostcode",
  ...OTHER_LICENCE_KEYS,
] as const satisfies readonly (keyof LearnerFields)[];
const ADDRESS_PART_KEYS = ["address", "addressSuburb", "addressState", "addressPostcode"] as const;
const LICENCE_STAGES = ["learner", "p1", "p2", "full"] as const;
const LEARNER_COLUMN: Record<(typeof LEARNER_EDIT_KEYS)[number], string> = {
  fullName: "full_name", address: "address", phone: "phone", dob: "dob", licenceNumber: "licence_number", licenceExpiry: "licence_expiry",
  eligibility: "eligibility", transmission: "transmission", schoolWork: "school_work", licenceStage: "licence_stage",
  learnerLicenceIssuedOn: "learner_licence_issued_on", learnerLicenceFirstIssuedOn: "learner_licence_first_issued_on", hptPassedOn: "hpt_passed_on",
  loggedHours: "logged_hours", loggedHoursOn: "logged_hours_on",
  addressSuburb: "address_suburb", addressState: "address_state", addressPostcode: "address_postcode",
  otherLicenceKind: "other_licence_kind", otherLicencePlace: "other_licence_place", otherLicenceNumber: "other_licence_number",
  otherLicenceClass: "other_licence_class", otherLicenceIssuedOn: "other_licence_issued_on", otherLicenceExpiresOn: "other_licence_expires_on",
};

/** A real calendar date that throws a labelled error (the Competency 23 fields); `isoDate` is the non-throwing twin. */
function realDate(value: unknown, label: string): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const check = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !check || check.getUTCFullYear() !== Number(match[1]) || check.getUTCMonth() !== Number(match[2]) - 1 || check.getUTCDate() !== Number(match[3])) {
    throw new ValidationError(`${label} must be a real date (YYYY-MM-DD).`);
  }
  return trimmed;
}

/** Whole hours 0-999 (a number or a numeric string); "" / null clear it. */
function wholeHours(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^\d{1,3}$/.test(raw)) throw new ValidationError("Logged hours must be a whole number from 0 to 999.");
  return Number(raw);
}

const RULES_DATE_LABELS = [
  ["learnerLicenceIssuedOn", "Learner licence issue date"],
  ["learnerLicenceFirstIssuedOn", "First learner licence issue date"],
  ["hptPassedOn", "HPT pass date"],
  ["loggedHoursOn", "Logged hours as-of date"],
  ["otherLicenceIssuedOn", "Other licence issue date"],
  ["otherLicenceExpiresOn", "Other licence expiry"],
] as const;

/**
 * Intake P3 (D12): the overseas / interstate licence fields, checked on the merged values only when one of them (or
 * the DOB) is being changed, so an unrelated edit is never blocked by older data. Returns the normalised fields to store.
 */
function checkOtherLicence(merged: OtherLicenceFields & { dob: string | null }, touched: ReadonlySet<string>, today: string): OtherLicenceFields | null {
  const result = validateOtherLicence(merged, touched, today);
  if (result === null) return null;
  if (!result.ok) throw new ValidationError(result.error);
  return result.fields;
}

/**
 * Cross-field rules for the Competency 23 fields (D19), checked on the merged values (the stored learner plus the
 * keys being changed) and only when a key involved in a rule is being changed, so an unrelated edit is never
 * blocked by older data. `today` is the Canberra date.
 */
function checkRulesFields(merged: Pick<Learner, "dob" | "learnerLicenceIssuedOn" | "learnerLicenceFirstIssuedOn" | "hptPassedOn" | "loggedHours" | "loggedHoursOn">, touched: ReadonlySet<string>, today: string) {
  const touches = (...keys: string[]) => keys.some((key) => touched.has(key));
  const { dob, learnerLicenceIssuedOn: issued, learnerLicenceFirstIssuedOn: first, hptPassedOn: hpt, loggedHours: hours, loggedHoursOn: hoursOn } = merged;
  if (issued && touches("learnerLicenceIssuedOn") && issued > today) throw new ValidationError("Learner licence issue date cannot be in the future.");
  if (issued && dob && touches("learnerLicenceIssuedOn", "dob") && issued < dob) throw new ValidationError("Learner licence issue date cannot be before the date of birth.");
  if (first && issued && touches("learnerLicenceFirstIssuedOn", "learnerLicenceIssuedOn") && first > issued) throw new ValidationError("First issue date cannot be after the current learner licence issue date.");
  if (first && touches("learnerLicenceFirstIssuedOn") && first > today) throw new ValidationError("First learner licence issue date cannot be in the future.");
  if (hpt && touches("hptPassedOn") && hpt > today) throw new ValidationError("HPT pass date cannot be in the future.");
  if (hoursOn && touches("loggedHoursOn") && hoursOn > today) throw new ValidationError("Logged hours as-of date cannot be in the future.");
  if (hours !== null && !hoursOn && touches("loggedHours", "loggedHoursOn")) throw new ValidationError("Logged hours need an as-of date.");
}

/**
 * D7: the picked suburb/state/postcode are all set or all null, well-formed, and the suburb is a whole word of the
 * address text. Checked on the merged values, only when the address or one of the parts is being changed, so an
 * unrelated edit is never blocked by older data. Returns the normalised parts to store (when touched).
 */
function checkAddressParts(merged: Pick<Learner, "address" | "addressSuburb" | "addressState" | "addressPostcode">, touched: ReadonlySet<string>): Pick<LearnerFields, "addressSuburb" | "addressState" | "addressPostcode"> | null {
  if (!ADDRESS_PART_KEYS.some((key) => touched.has(key))) return null;
  const result = validateAddressParts(merged.address, merged.addressSuburb, merged.addressState, merged.addressPostcode);
  if (!result.ok) throw new ValidationError(result.error);
  return { addressSuburb: result.parts?.suburb ?? null, addressState: result.parts?.state ?? null, addressPostcode: result.parts?.postcode ?? null };
}

/**
 * The ONE place learner field rules live (create and edit share it): trim, "" -> null, per-field max length,
 * ISO dates, transmission manual|auto. Only keys present on `input` are returned (create fills the rest with
 * null; edit leaves them unchanged). `strict` (edit only) refuses an unparseable date / transmission / stage
 * instead of silently turning it into null, so a typo can never wipe stored data; create keeps its lenient
 * historical behaviour.
 */
function parseLearnerFields(input: LearnerEditInput, strict: boolean, existing?: Learner): Partial<LearnerFields> {
  const has = (key: keyof LearnerEditInput) => input[key] !== undefined;
  const out: Partial<LearnerFields> = {};
  if (has("fullName")) {
    out.fullName = text(input.fullName, 120);
    if (!out.fullName) throw new ValidationError("Student name is required.");
  }
  if (has("address")) out.address = text(input.address, 300);
  // Address parts (D7): shape and the whole-word suburb rule are checked together in checkAddressParts on the merged values.
  if (has("addressSuburb")) out.addressSuburb = text(input.addressSuburb, 300);
  if (has("addressState")) out.addressState = text(input.addressState, 300);
  if (has("addressPostcode")) out.addressPostcode = text(input.addressPostcode, 300);
  if (has("phone")) out.phone = text(input.phone, 40);
  if (has("licenceNumber")) out.licenceNumber = text(input.licenceNumber, 40);
  if (has("eligibility")) out.eligibility = text(input.eligibility, 120);
  if (has("schoolWork")) out.schoolWork = text(input.schoolWork, 160);
  for (const [key, label] of [["dob", "Date of birth"], ["licenceExpiry", "Licence expiry"]] as const) {
    if (!has(key)) continue;
    out[key] = isoDate(input[key]);
    const raw = String(input[key] ?? "").trim();
    // Older data may hold an impossible date (stored before the calendar check): re-sending it unchanged must not block an unrelated edit.
    if (out[key] === null && raw && existing && existing[key] === raw) out[key] = raw;
    if (strict && out[key] === null && raw) throw new ValidationError(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  for (const [key, label] of RULES_DATE_LABELS) if (has(key)) out[key] = realDate(input[key], label);
  if (has("loggedHours")) out.loggedHours = wholeHours(input.loggedHours);
  // Other licence (0013): "" -> null here; enum, place, length and date rules run together in checkOtherLicence on the merged values.
  if (has("otherLicenceKind")) out.otherLicenceKind = text(input.otherLicenceKind, 40)?.toLowerCase() ?? null;
  if (has("otherLicenceClass")) out.otherLicenceClass = text(input.otherLicenceClass, 40)?.toLowerCase() ?? null;
  if (has("otherLicencePlace")) out.otherLicencePlace = text(input.otherLicencePlace, 300);
  if (has("otherLicenceNumber")) out.otherLicenceNumber = text(input.otherLicenceNumber, 300);
  if (has("transmission")) {
    const raw = String(input.transmission ?? "").trim().toLowerCase();
    out.transmission = raw === "manual" || raw === "auto" ? raw : null;
    if (strict && out.transmission === null && raw) throw new ValidationError('Transmission must be "manual" or "auto".');
  }
  if (strict && has("licenceStage")) {
    const raw = String(input.licenceStage ?? "").trim().toLowerCase();
    if (!(LICENCE_STAGES as readonly string[]).includes(raw)) throw new ValidationError("Licence stage must be learner, p1, p2 or full.");
    out.licenceStage = raw as Learner["licenceStage"];
  }
  return out;
}

/** The learner fields of a new learner, validated (name, dates, Competency 23 rules, address parts, other licence). Throws ValidationError. */
function prepareNewLearnerFields(input: LearnerInput, now: Date): Partial<LearnerFields> {
  const fields = parseLearnerFields({ ...input, fullName: input.fullName ?? "" }, false);
  checkRulesFields(
    { dob: fields.dob ?? null, learnerLicenceIssuedOn: fields.learnerLicenceIssuedOn ?? null, learnerLicenceFirstIssuedOn: fields.learnerLicenceFirstIssuedOn ?? null, hptPassedOn: fields.hptPassedOn ?? null, loggedHours: fields.loggedHours ?? null, loggedHoursOn: fields.loggedHoursOn ?? null },
    new Set(Object.keys(fields)),
    localNow(now).date,
  );
  const parts = checkAddressParts({ address: fields.address ?? null, addressSuburb: fields.addressSuburb ?? null, addressState: fields.addressState ?? null, addressPostcode: fields.addressPostcode ?? null }, new Set(Object.keys(fields)));
  if (parts) Object.assign(fields, parts);
  const other = checkOtherLicence(
    { dob: fields.dob ?? null, otherLicenceKind: fields.otherLicenceKind ?? null, otherLicencePlace: fields.otherLicencePlace ?? null, otherLicenceNumber: fields.otherLicenceNumber ?? null, otherLicenceClass: fields.otherLicenceClass ?? null, otherLicenceIssuedOn: fields.otherLicenceIssuedOn ?? null, otherLicenceExpiresOn: fields.otherLicenceExpiresOn ?? null },
    new Set(Object.keys(fields)),
    localNow(now).date,
  );
  if (other) Object.assign(fields, other);
  return fields;
}

export async function createLearner(db: D1Database, input: LearnerInput, now: Date = new Date()): Promise<Learner> {
  if (input.draft === true) return createDraftLearner(db, input, now);
  return insertLearner(db, input, now);
}

async function insertLearner(db: D1Database, input: LearnerInput, now: Date, draftNotes?: string | null): Promise<Learner> {
  const fields = prepareNewLearnerFields(input, now);
  // Instructor must already exist and be active — no free-text name, no
  // auto-creation. Reuses the same existing-and-active check as lesson
  // attribution, just made required here (an omitted/unknown/inactive id
  // throws ValidationError -> 400, never silently creates an instructor row).
  const instructorId = await resolveActingInstructorId(db, input.instructorId);
  if (!instructorId) throw new ValidationError("Instructor is required.");

  const id = crypto.randomUUID();
  const insert = db
    .prepare(
      `INSERT INTO learners (id, instructor_id, full_name, address, phone, dob, licence_number, licence_expiry, eligibility, transmission, school_work,
         learner_licence_issued_on, learner_licence_first_issued_on, hpt_passed_on, logged_hours, logged_hours_on,
         address_suburb, address_state, address_postcode,
         other_licence_kind, other_licence_place, other_licence_number, other_licence_class, other_licence_issued_on, other_licence_expires_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      instructorId,
      fields.fullName,
      fields.address ?? null,
      fields.phone ?? null,
      fields.dob ?? null,
      fields.licenceNumber ?? null,
      fields.licenceExpiry ?? null,
      fields.eligibility ?? null,
      fields.transmission ?? null,
      fields.schoolWork ?? null,
      fields.learnerLicenceIssuedOn ?? null,
      fields.learnerLicenceFirstIssuedOn ?? null,
      fields.hptPassedOn ?? null,
      fields.loggedHours ?? null,
      fields.loggedHoursOn ?? null,
      fields.addressSuburb ?? null,
      fields.addressState ?? null,
      fields.addressPostcode ?? null,
      fields.otherLicenceKind ?? null,
      fields.otherLicencePlace ?? null,
      fields.otherLicenceNumber ?? null,
      fields.otherLicenceClass ?? null,
      fields.otherLicenceIssuedOn ?? null,
      fields.otherLicenceExpiresOn ?? null,
    );
  // A draft is inserted and marked in ONE atomic batch, so it is never visible as a normal learner.
  if (draftNotes === undefined) await insert.run();
  else await db.batch([insert, db.prepare("UPDATE learners SET draft_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), draft_notes = ? WHERE id = ?").bind(draftNotes, id)]);
  return getLearner(db, id);
}

// ── Learner drafts (migration 0015) ──────────────────────────────────────

export const DRAFT_NAME_PLACEHOLDER = "Unnamed draft";
const MAX_DRAFT_NOTES = 2000;
const DRAFT_GROUPS: readonly (readonly (keyof LearnerInput)[])[] = [
  ["learnerLicenceIssuedOn", "learnerLicenceFirstIssuedOn", "hptPassedOn", "loggedHours", "loggedHoursOn"],
  ["address", "addressSuburb", "addressState", "addressPostcode"],
  [...OTHER_LICENCE_KEYS],
];

/**
 * Makes a draft's input safe to store: each group of fields that the normal rules would refuse (a Competency 23 date
 * in the future, a street suggestion that does not match, an unknown other-licence kind, a date that is not a date) is
 * DROPPED and written to the review notes with what was sent. Nothing is guessed or "fixed"; the rest is kept.
 */
function sanitiseDraftInput(input: LearnerInput, now: Date, existing?: Learner): { clean: LearnerInput; notes: string[] } {
  const clean: LearnerInput = { ...input };
  const notes: string[] = [];
  const kept = existing ? " The previous value was kept." : "";
  const sentKeys = (keys: readonly (keyof LearnerInput)[]) => keys.filter((k) => clean[k] !== undefined && String(clean[k] ?? "").trim() !== "");
  const shown = (keys: readonly (keyof LearnerInput)[]) => sentKeys(keys).map((k) => `${String(k)}: "${String(clean[k]).trim().slice(0, 80)}"`).join(", ");
  // A dropped value never blanks what is stored: on create it is simply absent, on edit the previous value stays.
  const drop = (keys: readonly (keyof LearnerInput)[]) => { for (const key of keys) delete clean[key]; };
  const effective = (key: keyof LearnerInput): unknown => (clean[key] !== undefined ? clean[key] : existing ? existing[key as keyof Learner] : undefined);
  for (const key of ["dob", "licenceExpiry"] as const) {
    const raw = String(clean[key] ?? "").trim();
    if (raw && isoDate(raw) === null) { notes.push(`Not saved (not a date YYYY-MM-DD): ${key}: "${raw.slice(0, 80)}".${kept}`); drop([key]); }
  }
  const tx = String(clean.transmission ?? "").trim().toLowerCase();
  if (tx && tx !== "manual" && tx !== "auto") { notes.push(`Not saved (must be manual or auto): transmission: "${tx.slice(0, 80)}".${kept}`); drop(["transmission"]); }
  for (const group of DRAFT_GROUPS) {
    if (!shown(group) && !(existing && clean.dob !== undefined)) continue;
    const trial: LearnerInput = { fullName: "x", dob: effective("dob") };
    for (const key of group) trial[key] = effective(key);
    try {
      prepareNewLearnerFields(trial, now);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      if (!shown(group)) continue; // only a changed date of birth is involved: handled by the caller's final check
      notes.push(`Not saved (${error.message.replace(/\.$/, "")}): ${shown(group)}.${kept}`);
      drop(group);
    }
  }
  return { clean, notes };
}

/** Review notes as stored: the app's own "Not saved ..." lines first (they are the ones that must never be cut), then the given text; repeated lines once; at most 2000 characters. */
function draftNotesText(given: unknown, generated: string[]): string | null {
  const own = typeof given === "string" ? given.split("\n") : [];
  const lines = [...generated, ...own].map((line) => line.trim()).filter(Boolean);
  const all = [...new Set(lines)].join("\n");
  return all ? all.slice(0, MAX_DRAFT_NOTES) : null;
}

/** Saves an incomplete learner as a DRAFT: only the instructor is required; the name may be missing ("Unnamed draft"). */
async function createDraftLearner(db: D1Database, input: LearnerInput, now: Date): Promise<Learner> {
  const { clean, notes } = sanitiseDraftInput(input, now);
  const name = text(input.fullName, 120);
  return insertLearner(db, { ...clean, fullName: name ?? DRAFT_NAME_PLACEHOLDER }, now, draftNotesText(input.draftNotes, notes));
}

/**
 * Edits a DRAFT learner. Without `draft: false` it stays a draft (lenient, like create); with `draft: false` it is
 * CONFIRMED: every rule of a normal learner applies (a real name, valid dates, the Competency 23 rules) and the draft
 * mark and notes are cleared. Only then can the learner take lessons.
 */
async function updateDraftLearner(db: D1Database, existing: Learner, input: LearnerEditInput, now: Date): Promise<UpdateLearnerResult> {
  const confirm = input.draft === false;
  const sent = { ...input } as LearnerInput;
  const { clean, notes } = confirm ? { clean: sent, notes: [] as string[] } : sanitiseDraftInput(sent, now, existing);
  const mergeInput = (): LearnerInput => {
    const merged: LearnerInput = {};
    for (const key of LEARNER_EDIT_KEYS) (merged as Record<string, unknown>)[key] = clean[key as keyof LearnerInput] !== undefined ? clean[key as keyof LearnerInput] : existing[key];
    if (!confirm && text(clean.fullName, 120) === null) merged.fullName = existing.fullName;
    delete (merged as Record<string, unknown>).licenceStage;
    return merged;
  };
  let merged = mergeInput();
  if (confirm) {
    const name = text(merged.fullName, 120);
    if (!name || name === DRAFT_NAME_PLACEHOLDER) throw new ValidationError("Enter the student's name before confirming the draft.");
    parseLearnerFields(merged as LearnerEditInput, true, existing);
  }
  let fields: Partial<LearnerFields>;
  try {
    fields = prepareNewLearnerFields(merged, now);
  } catch (error) {
    if (confirm || !(error instanceof ValidationError)) throw error;
    // The new values clash with ones already stored (e.g. a licence date before the stored date of birth): keep the stored ones.
    const sensitive = ["dob", ...DRAFT_GROUPS.flat()] as (keyof LearnerInput)[];
    const lost = sensitive.filter((k) => clean[k] !== undefined && String(clean[k] ?? "").trim() !== "").map((k) => `${String(k)}: "${String(clean[k]).trim().slice(0, 80)}"`);
    notes.push(`Not saved (${error.message.replace(/\.$/, "")}): ${lost.join(", ")}. The previous values were kept.`);
    for (const key of sensitive) delete clean[key];
    merged = mergeInput();
    fields = prepareNewLearnerFields(merged, now);
  }
  const changedFields = LEARNER_EDIT_KEYS.filter((key) => key !== "licenceStage" && (fields[key] ?? null) !== (existing[key] ?? null));
  const notesValue = confirm ? null : draftNotesText(input.draftNotes !== undefined ? input.draftNotes : existing.draftNotes, notes);
  const sets = [...changedFields.map((key) => `${LEARNER_COLUMN[key]} = ?`), "draft_notes = ?", ...(confirm ? ["draft_at = NULL"] : [])];
  const update = await db
    .prepare(`UPDATE learners SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND draft_at IS NOT NULL`)
    .bind(...changedFields.map((key) => fields[key] ?? null), notesValue, existing.id)
    .run();
  if (!update.meta.changes) throw new ValidationError("This learner is no longer a draft. Reload it.");
  return { learner: await getLearner(db, existing.id), changed: true, changedFields: [...changedFields] };
}

export type UpdateLearnerResult = { learner: Learner; changed: boolean; changedFields: string[] };

/**
 * Previous values of every editable learner field as ONE INSERT ... SELECT that reads the learner's current
 * row inside the same atomic batch (must be the batch's first statement, before the UPDATE). 4 bound parameters.
 */
function learnerRevisionInsertStatement(db: D1Database, learnerId: string, editedByInstructorId: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, edited_by_instructor_id, snapshot_json)
       SELECT ?, learners.id, (SELECT COALESCE(MAX(r.revision_no), 0) + 1 FROM learner_revisions r WHERE r.learner_id = learners.id), ?, ?,
         json_object(${LEARNER_EDIT_KEYS.map((key) => `'${key}', learners.${LEARNER_COLUMN[key]}`).join(", ")})
       FROM learners WHERE learners.id = ?`,
    )
    .bind(crypto.randomUUID(), new Date().toISOString(), editedByInstructorId, learnerId);
}

/**
 * Edit a learner's details (learner management Phase 1). Only keys present in `input` change; "" clears to null.
 * Only the learner's own instructor may edit when a verified actor is supplied (no actor = local dev/tests: as
 * before). `instructorId` is never editable. A real change writes the previous values to learner_revisions and
 * updates the learner in ONE db.batch(); a no-op writes nothing. Archived learners may be edited. No ACTGDS
 * event: the contract carries only learner_id. D1 cost: 5 statements (learner, actor, batch of 2, re-read).
 */
export async function updateLearner(db: D1Database, id: string, input: LearnerEditInput, now: Date = new Date()): Promise<UpdateLearnerResult> {
  const existing = await getLearner(db, id);
  const actingInstructorId = await resolveActingInstructorId(db, input.actingInstructorId);
  if (actingInstructorId !== null && actingInstructorId !== existing.instructorId) {
    throw new ValidationError(`This learner belongs to ${existing.instructorName || "another instructor"}; only they can edit their details.`);
  }
  if (input.instructorId !== undefined) throw new ValidationError("A learner's instructor cannot be changed here.");
  if (existing.draftAt) return updateDraftLearner(db, existing, input, now);
  if (input.draft !== undefined || input.draftNotes !== undefined) throw new ValidationError("Only a draft learner can be saved as a draft or confirmed.");
  const fields = parseLearnerFields(input, true, existing);
  const keys = LEARNER_EDIT_KEYS.filter((key) => fields[key] !== undefined);
  if (!keys.length) throw new ValidationError("Nothing to change: send at least one learner field.");
  let changedFields = keys.filter((key) => fields[key] !== existing[key]);
  if (!changedFields.length) return { learner: existing, changed: false, changedFields: [] };
  // Only CHANGED keys trigger the cross-field rules: the form re-sends every field, and unchanged older data must never block an unrelated edit.
  checkRulesFields({ ...existing, ...fields } as Learner, new Set(changedFields), localNow(now).date);
  const parts = checkAddressParts({ ...existing, ...fields } as Learner, new Set(changedFields));
  const other = checkOtherLicence({ ...existing, ...fields } as Learner, new Set(changedFields), localNow(now).date);
  if (parts || other) {
    // Normalised values (trimmed, upper-case state / licence number) may differ from what was sent: store them as validated.
    Object.assign(fields, parts ?? {}, other ?? {});
    changedFields = keys.filter((key) => fields[key] !== existing[key]);
    if (!changedFields.length) return { learner: existing, changed: false, changedFields: [] };
  }

  await db.batch([
    learnerRevisionInsertStatement(db, id, actingInstructorId),
    db
      .prepare(`UPDATE learners SET ${changedFields.map((key) => `${LEARNER_COLUMN[key]} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .bind(...changedFields.map((key) => fields[key] ?? null), id),
  ]);
  return { learner: await getLearner(db, id), changed: true, changedFields: [...changedFields] };
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
// "Edited N times" — computed inside the same lesson query (no extra round trip, no N+1).
// Signing a lesson saved to sign later keeps its unsigned version as a revision with this reserved reason. It is not
// a correction: revision_count (History "Edited n times", PDF "(amended)") leaves it out; all_revision_count does not.
export const SIGNED_LATER_REASON = "Signed later";
const REVISION_COUNT_SELECT = `(SELECT COUNT(*) FROM lesson_revisions lr WHERE lr.lesson_id = lessons.id AND COALESCE(lr.reason, '') <> '${SIGNED_LATER_REASON}') AS revision_count,
  (SELECT COUNT(*) FROM lesson_revisions lr WHERE lr.lesson_id = lessons.id) AS all_revision_count`;

/** Lessons newest first. Signatures are omitted from the list to keep it light. */
export async function listLessons(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db
    .prepare(
      `SELECT lessons.id, lessons.learner_id, lessons.instructor_id, lessons.lesson_no, lessons.lesson_date, lessons.start_time, lessons.finish_time,
              lessons.start_odometer, lessons.finish_odometer, lessons.duration_minutes, lessons.distance_km, lessons.cumulative_minutes, lessons.cumulative_km,
              lessons.taught, lessons.competencies_assessed, lessons.achieved, lessons.location, lessons.comments,
              NULL AS adi_signature, NULL AS learner_signature, lessons.created_at, lessons.updated_at,
              lessons.updated_by_instructor_id, lessons.record_source, lessons.signature_status, lessons.prior_instructor_label, lessons.prior_lesson_count,
              ub.full_name AS updated_by_instructor_name, ${REVISION_COUNT_SELECT}
       FROM lessons ${UPDATED_BY_JOIN} WHERE lessons.learner_id = ? ORDER BY lessons.lesson_no DESC`,
    )
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

/** All of a learner's saved lessons, oldest first, with real signatures — for the CBT&A PDF export (never partial/draft data). */
export async function listLessonsForExport(db: D1Database, learnerId: string): Promise<Lesson[]> {
  const { results } = await db
    .prepare(`SELECT lessons.*, ub.full_name AS updated_by_instructor_name, ${REVISION_COUNT_SELECT} FROM lessons ${UPDATED_BY_JOIN} WHERE learner_id = ? ORDER BY lesson_no ASC`)
    .bind(learnerId)
    .all<Row>();
  return results.map(toLesson);
}

/** Lesson numbers of this learner's app lessons saved to sign later. */
async function unsignedAppLessonNos(db: D1Database, learnerId: string): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT lesson_no FROM lessons WHERE learner_id = ? AND record_source = 'app' AND signature_status = 'unsigned' ORDER BY lesson_no ASC")
    .bind(learnerId)
    .all<Row>();
  return results.map((row) => Number(row.lesson_no));
}

/** The To sign queue: app lessons saved to sign later, for active learners, oldest lesson first; only the signed-in instructor's own lessons when there is one (Code of Practice 9.2). */
export async function listUnsignedLessons(db: D1Database, instructorId: string | null = null): Promise<UnsignedLessonItem[]> {
  const { results } = await db
    .prepare(
      `SELECT lessons.learner_id, learners.full_name, lessons.instructor_id, lessons.id, lessons.lesson_no, lessons.lesson_date, lessons.start_time, lessons.finish_time
       FROM lessons JOIN learners ON learners.id = lessons.learner_id
       WHERE lessons.record_source = 'app' AND lessons.signature_status = 'unsigned' AND learners.archived_at IS NULL AND (? IS NULL OR lessons.instructor_id = ?)
       ORDER BY lessons.lesson_date ASC, lessons.start_time ASC, lessons.lesson_no ASC`,
    )
    .bind(instructorId, instructorId)
    .all<Row>();
  return results.map((row) => ({
    learnerId: String(row.learner_id), learnerName: String(row.full_name), instructorId: String(row.instructor_id), lessonId: String(row.id),
    lessonNo: Number(row.lesson_no), lessonDate: String(row.lesson_date), startTime: (row.start_time as string) ?? null, finishTime: (row.finish_time as string) ?? null,
  }));
}

/**
 * Adds both signatures to an app lesson saved to sign later. Only the two signatures and the status change: the
 * content the learner signs is exactly what was saved, and exactly what they were shown (`expectedUpdatedAt` is the
 * lesson's updatedAt when the To sign screen loaded it; an edit in between refuses the signing). Like History Edit,
 * only the instructor who recorded the lesson may sign it, and the previous (unsigned) version is kept as a revision.
 */
export async function signLesson(
  db: D1Database,
  learnerId: string,
  lessonId: string,
  input: { adiSignature?: unknown; learnerSignature?: unknown; expectedUpdatedAt?: unknown; actingInstructorId?: unknown },
): Promise<Lesson> {
  const existing = await getLesson(db, learnerId, lessonId);
  if (existing.recordSource !== "app") throw new ValidationError("Only lessons recorded in the app can be signed here.");
  if (existing.signatureStatus !== "unsigned") throw new ValidationError(`Lesson #${existing.lessonNo} is already signed.`);
  const actingInstructorId = await resolveActingInstructorId(db, input.actingInstructorId);
  if (actingInstructorId !== null && actingInstructorId !== existing.instructorId) {
    const owner = await db.prepare("SELECT full_name FROM instructors WHERE id = ?").bind(existing.instructorId).first<Row>();
    throw new ValidationError(`This lesson was recorded by ${owner ? String(owner.full_name) : "another instructor"}; only they can sign it (Code of Practice 9.2).`);
  }
  const expected = input.expectedUpdatedAt === null ? null : typeof input.expectedUpdatedAt === "string" ? input.expectedUpdatedAt : undefined;
  if (expected === undefined || expected !== existing.updatedAt) throw new ValidationError(`Lesson #${existing.lessonNo} was changed after it was opened. Reload it and go through it with the learner again.`);
  const adiSignature = submittedSignature(input.adiSignature, "ADI");
  const learnerSignature = submittedSignature(input.learnerSignature, "Learner");
  if (!adiSignature) throw new ValidationError("ADI signature is required.");
  if (!learnerSignature) throw new ValidationError("Learner signature is required.");
  const [, update] = await db.batch([
    revisionInsertStatement(db, lessonId, actingInstructorId, SIGNED_LATER_REASON, { updatedAt: expected }),
    db
      .prepare(
        `UPDATE lessons SET adi_signature = ?, learner_signature = ?, signature_status = 'digital', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_by_instructor_id = COALESCE(?, updated_by_instructor_id)
         WHERE id = ? AND learner_id = ? AND signature_status = 'unsigned' AND updated_at IS ?`,
      )
      .bind(adiSignature, learnerSignature, actingInstructorId, lessonId, learnerId, expected),
  ]);
  if (!update.meta.changes) throw new ValidationError(`Lesson #${existing.lessonNo} was signed or changed in the meantime. Reload it.`);
  return getLesson(db, learnerId, lessonId);
}

export async function getLesson(db: D1Database, learnerId: string, lessonId: string): Promise<Lesson> {
  const row = await db
    .prepare(`SELECT lessons.*, ub.full_name AS updated_by_instructor_name, ${REVISION_COUNT_SELECT} FROM lessons ${UPDATED_BY_JOIN} WHERE lessons.id = ? AND lessons.learner_id = ?`)
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
  if (learner.draftAt) throw new ValidationError("This learner is still a draft. Review the details and confirm the learner before recording lessons.");

  const lessonDate = isoDate(input.lessonDate);
  if (!lessonDate) throw new ValidationError(String(input.lessonDate ?? "").trim() ? "Lesson date must be a valid date (YYYY-MM-DD)." : "Lesson date is required.");
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

  const adiSignature = submittedSignature(input.adiSignature, "ADI");
  const learnerSignature = submittedSignature(input.learnerSignature, "Learner");
  // Save now, sign later (Tony 2026-10-22): with signLater the lesson may be saved with neither signature ("unsigned")
  // and signed later in the To sign queue (signLesson). Never with only one of them.
  const signLater = input.signLater === true;
  if (signLater && Boolean(adiSignature) !== Boolean(learnerSignature)) throw new ValidationError("Save with both signatures, or neither (sign later).");
  if (!signLater && !adiSignature) throw new ValidationError("ADI signature is required.");
  if (!signLater && !learnerSignature) throw new ValidationError("Learner signature is required.");
  const signatureStatus: SignatureStatus = adiSignature && learnerSignature ? "digital" : "unsigned";

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
  if (assessedIds.includes(FINAL_DRIVE_23)) {
    // The final assessment closes the record: it is signed on the day, and only once every earlier app lesson is signed.
    if (signatureStatus === "unsigned") throw new ValidationError("Final Drive 23 must be signed when it is saved.");
    const unsigned = await unsignedAppLessonNos(db, learnerId);
    if (unsigned.length) throw new ValidationError(`Sign ${unsigned.map((n) => `Lesson #${n}`).join(", ")} first: Final Drive 23 waits until every earlier lesson is signed.`);
  }

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
    ...taughtIds.map((competencyId) => ({ competencyId, action: "taught" as const, result: null, lessonId: id, createdAt: nowIso, lessonNo: totals.lessonCount + 1 })),
    ...assessedIds.map((competencyId) => ({ competencyId, action: "assessed" as const, result: achievedResults[competencyId] ?? null, lessonId: id, createdAt: nowIso, lessonNo: totals.lessonCount + 1 })),
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
         taught, competencies_assessed, achieved, location, comments, adi_signature, learner_signature, signature_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      signatureStatus,
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
export async function importPaperLessons(db: D1Database, learnerId: string, csvText: string, mode: "preview" | "commit", scope: Scope = { kind: "all" }): Promise<PaperImportResult> {
  if (mode !== "preview" && mode !== "commit") throw new ValidationError("Import mode must be preview or commit.");
  if (typeof csvText !== "string" || !csvText.trim()) throw new ValidationError("CSV file is required.");
  if (new TextEncoder().encode(csvText).length > MAX_IMPORT_CSV_BYTES) throw new ValidationError("File is too large.");
  const learner = await getLearner(db, learnerId);
  if (learner.draftAt) throw new ValidationError("This learner is still a draft. Review the details and confirm the learner before importing records.");
  // No rows at all — getTotals().lessonCount would not see prior-instructor records (negative lesson_no).
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE learner_id = ?").bind(learnerId).first<Row>();
  if (Number(existing?.n ?? 0) !== 0) throw new ValidationError("Paper records can only be imported into a learner with no lessons.");

  // The CSV instructor column only matches instructors in scope (SaaS: never another tenant's name).
  const plan = planPaperImport(csvText, await listActiveInstructors(db, scope));
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
  // The saved CSV draft (migration 0016) has done its job: removed in the same atomic batch as the import.
  const statements = [jsonInsertStatement(db, "lessons", PAPER_LESSON_COLUMNS, lessonRowsToInsert), insertCompetencyEventsStatement(db, eventRowsToInsert), db.prepare("DELETE FROM paper_import_drafts WHERE learner_id = ?").bind(learnerId)].filter(
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

// ── Saved CSV drafts for the paper import (migration 0016) ───────────────

export type PaperImportDraft = { csv: string; savedAt: string };

/** The CSV saved for this learner, or null. */
export async function getPaperImportDraft(db: D1Database, learnerId: string, scope: Scope = { kind: "all" }): Promise<PaperImportDraft | null> {
  await learnerInScope(db, learnerId, scope);
  // Only while the learner can still import: a draft left behind by an import that did not clean up is never served.
  const row = await db
    .prepare("SELECT csv_text, saved_at FROM paper_import_drafts WHERE learner_id = ? AND NOT EXISTS (SELECT 1 FROM lessons WHERE lessons.learner_id = paper_import_drafts.learner_id)")
    .bind(learnerId)
    .first<Row>();
  return row ? { csv: String(row.csv_text), savedAt: String(row.saved_at) } : null;
}

/** The learner, or NotFound when an instructor scope (SaaS) does not own them: the CSV holds the learner's records, so it is never served across tenants. Private mode (scope all) sees every learner, like the import. */
async function learnerInScope(db: D1Database, learnerId: string, scope: Scope): Promise<Learner> {
  const learner = await getLearner(db, learnerId);
  if (scope.kind === "instructor" && learner.instructorId !== scope.instructorId) throw new NotFoundError("Learner not found.");
  return learner;
}

/** Saves (replaces) the learner's CSV draft: any text is kept, however wrong; only an empty or oversized one is refused. Who may save follows the import itself (every instructor in private mode, own learners in SaaS). */
export async function savePaperImportDraft(db: D1Database, learnerId: string, csv: unknown, actingInstructorId?: unknown, scope: Scope = { kind: "all" }): Promise<PaperImportDraft> {
  if (typeof csv !== "string" || !csv.trim()) throw new ValidationError("There is no CSV text to save.");
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_CSV_BYTES) throw new ValidationError("File is too large.");
  await learnerInScope(db, learnerId, scope);
  const actor = await resolveActingInstructorId(db, actingInstructorId);
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE learner_id = ?").bind(learnerId).first<Row>();
  if (Number(existing?.n ?? 0) !== 0) throw new ValidationError("This learner already has lessons, so paper records can no longer be imported.");
  await db
    .prepare(
      `INSERT INTO paper_import_drafts (learner_id, csv_text, saved_at, saved_by_instructor_id) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
       ON CONFLICT (learner_id) DO UPDATE SET csv_text = excluded.csv_text, saved_at = excluded.saved_at, saved_by_instructor_id = excluded.saved_by_instructor_id`,
    )
    .bind(learnerId, csv, actor)
    .run();
  return (await getPaperImportDraft(db, learnerId, scope))!;
}

/** Removes the learner's CSV draft (nothing to remove is fine). */
export async function deletePaperImportDraft(db: D1Database, learnerId: string, scope: Scope = { kind: "all" }): Promise<void> {
  await learnerInScope(db, learnerId, scope);
  await db.prepare("DELETE FROM paper_import_drafts WHERE learner_id = ?").bind(learnerId).run();
}

/** Fields that, if changed, invalidate both existing signatures (CBT&A V3 rule 5). */
const SIGNATURE_PROTECTED_FIELDS = ["lessonDate", "startTime", "finishTime", "startOdometer", "finishOdometer", "taught", "assessed", "achieved", "location", "comments"] as const;

export const MAX_REVISION_REASON_LENGTH = 200;

/**
 * Revision of the lesson BEFORE the edit, as ONE set-based INSERT ... SELECT that reads the lesson's
 * current row in the same atomic batch (must be the batch's first statement, before the UPDATE).
 * 5 bound parameters; revision_no is the next number for this lesson. Signature images are never copied,
 * only whether each was present.
 */
function revisionInsertStatement(db: D1Database, lessonId: string, editedByInstructorId: string | null, reason: string | null, onlyIfUnsignedAt?: { updatedAt: string | null }): D1PreparedStatement {
  // onlyIfUnsignedAt (signLesson): the same guard as its UPDATE, so a signing that loses a race writes no revision either.
  const guard = onlyIfUnsignedAt ? " AND lessons.signature_status = 'unsigned' AND lessons.updated_at IS ?" : "";
  const statement = db
    .prepare(
      `INSERT INTO lesson_revisions (id, lesson_id, revision_no, edited_at, edited_by_instructor_id, reason, snapshot_json)
       SELECT ?, lessons.id, (SELECT COALESCE(MAX(r.revision_no), 0) + 1 FROM lesson_revisions r WHERE r.lesson_id = lessons.id), ?, ?, ?,
         json_object(
           'lessonDate', lessons.lesson_date, 'startTime', lessons.start_time, 'finishTime', lessons.finish_time,
           'startOdometer', lessons.start_odometer, 'finishOdometer', lessons.finish_odometer,
           'taught', lessons.taught, 'competenciesAssessed', lessons.competencies_assessed, 'achieved', lessons.achieved,
           'location', lessons.location, 'comments', lessons.comments, 'signatureStatus', lessons.signature_status,
           'adiSignaturePresent', json(CASE WHEN COALESCE(lessons.adi_signature, '') <> '' THEN 'true' ELSE 'false' END),
           'learnerSignaturePresent', json(CASE WHEN COALESCE(lessons.learner_signature, '') <> '' THEN 'true' ELSE 'false' END)
         )
       FROM lessons WHERE lessons.id = ?${guard}`,
    );
  const binds: (string | null)[] = [crypto.randomUUID(), new Date().toISOString(), editedByInstructorId, reason, lessonId];
  return onlyIfUnsignedAt ? statement.bind(...binds, onlyIfUnsignedAt.updatedAt) : statement.bind(...binds);
}

/** A lesson's previous versions, oldest first — one query (joined to the lesson to scope it to the learner, and to instructors for the editor's name). */
export async function listLessonRevisions(db: D1Database, learnerId: string, lessonId: string): Promise<LessonRevision[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.lesson_id, r.revision_no, r.edited_at, r.edited_by_instructor_id, r.reason, r.snapshot_json, i.full_name AS edited_by_name
       FROM lesson_revisions r
       JOIN lessons ON lessons.id = r.lesson_id AND lessons.learner_id = ?
       LEFT JOIN instructors i ON i.id = r.edited_by_instructor_id
       WHERE r.lesson_id = ? ORDER BY r.revision_no ASC`,
    )
    .bind(learnerId, lessonId)
    .all<Row>();
  return results.map((row) => ({
    id: String(row.id),
    lessonId: String(row.lesson_id),
    revisionNo: Number(row.revision_no),
    editedAt: String(row.edited_at),
    editedByInstructorId: nullableString(row.edited_by_instructor_id),
    editedByName: nullableString(row.edited_by_name),
    reason: nullableString(row.reason),
    snapshot: JSON.parse(String(row.snapshot_json)) as LessonRevisionSnapshot,
  }));
}

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

  // Instructor performing this edit (Instructor Identity V1). Omitted (local dev / tests) leaves
  // updated_by_instructor_id exactly as it was and skips the ownership rule — never guessed.
  const actingInstructorId = await resolveActingInstructorId(db, input.actingInstructorId);
  // Code of Practice 9.2: an instructor must not change entries made by another instructor (design E1-E3).
  if (actingInstructorId !== null && actingInstructorId !== existing.instructorId) {
    const owner = await db.prepare("SELECT full_name FROM instructors WHERE id = ?").bind(existing.instructorId).first<Row>();
    throw new ValidationError(`This lesson was recorded by ${owner ? String(owner.full_name) : "another instructor"}; only they can change it (Code of Practice 9.2).`);
  }
  const reasonRaw = String(input.reason ?? "").trim();
  if (reasonRaw.length > MAX_REVISION_REASON_LENGTH) throw new ValidationError(`Reason must be ${MAX_REVISION_REASON_LENGTH} characters or fewer.`);
  if (reasonRaw.toLowerCase() === SIGNED_LATER_REASON.toLowerCase()) throw new ValidationError(`"${SIGNED_LATER_REASON}" is kept for signing a lesson; describe the correction instead.`);
  const reason = reasonRaw || null;

  const lessonDate = isoDate(input.lessonDate);
  if (!lessonDate) throw new ValidationError(String(input.lessonDate ?? "").trim() ? "Lesson date must be a valid date (YYYY-MM-DD)." : "Lesson date is required.");
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

  // This lesson's events after the edit (in memory: validation below and the "after" snapshot).
  const nowIso = new Date().toISOString();
  const newEventsForThisLesson: CompetencyEvent[] = [
    ...taughtIds.map((competencyId) => ({ competencyId, action: "taught" as const, result: null, lessonId, createdAt: nowIso, lessonNo: existing.lessonNo })),
    ...assessedIds.map((competencyId) => ({ competencyId, action: "assessed" as const, result: achievedResults[competencyId] ?? null, lessonId, createdAt: nowIso, lessonNo: existing.lessonNo })),
  ];

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
    const proposedEvents: CompetencyEvent[] = [...otherLessonsEvents, ...newEventsForThisLesson];
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
    // Review / Final Drive assessments are never blocked here beyond the
    // own-lesson gate above: one whose prerequisites are not achieved in
    // earlier lessons (removed by this edit, or a result flipped to Achieved
    // under an existing violation) is simply derived as not achieved
    // (computeProgress) and reported through `invalidated`; its events stay.
  }

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
  } else if (existing.signatureStatus === "unsigned") {
    // Saved to sign later: nothing signed yet, so a correction invalidates nothing. Both signatures make it signed.
    const newAdi = submittedSignature(input.adiSignature, "ADI");
    const newLearner = submittedSignature(input.learnerSignature, "Learner");
    if (Boolean(newAdi) !== Boolean(newLearner)) throw new ValidationError("Sign with both signatures, or leave both blank to keep it unsigned.");
    adiSignature = newAdi;
    learnerSignature = newLearner;
    signatureStatus = newAdi ? "digital" : "unsigned";
  } else if (contentChanged) {
    const newAdi = submittedSignature(input.adiSignature, "ADI");
    const newLearner = submittedSignature(input.learnerSignature, "Learner");
    // A correction to a signed app lesson may leave it unsigned (Tony 2026-10-22): the old signatures are dropped, the
    // previous version stays as a revision, and it joins the To sign queue. Final Drive 23 is the exception: it is
    // signed when saved, so an edit that touches it needs both signatures redrawn as before.
    const touchesFinalDrive = assessedIds.includes(FINAL_DRIVE_23) || (existing.competenciesAssessed ?? "").includes(competencyLabel(FINAL_DRIVE_23));
    if (!newAdi && !newLearner && !touchesFinalDrive) {
      // Not while a later lesson already holds a signed Final Drive 23: it is only valid after every earlier lesson is signed.
      const laterFinal = await db
        .prepare("SELECT lesson_no FROM lessons WHERE learner_id = ? AND lesson_no > ? AND record_source = 'app' AND competencies_assessed LIKE ? ORDER BY lesson_no LIMIT 1")
        .bind(learnerId, existing.lessonNo, `%${competencyLabel(FINAL_DRIVE_23)}%`)
        .first<Row>();
      if (laterFinal) throw new ValidationError(`Lesson #${Number(laterFinal.lesson_no)} (Final Drive 23) is signed after this lesson, so this one has to stay signed: sign both again now.`);
      adiSignature = null;
      learnerSignature = null;
      signatureStatus = "unsigned";
    } else {
      if (!newAdi || !newLearner) {
        throw new ValidationError(`Content changed (${SIGNATURE_PROTECTED_FIELDS.join(", ")}) — ${touchesFinalDrive ? "Final Drive 23 is signed when it is saved: " : ""}both signatures must be redrawn before saving.`);
      }
      // The learner signs the changed record again. The ADI signature may be the instructor's saved one, which can
      // equal the previous ADI signature byte for byte, so only the learner's has to be new.
      if (newLearner === existing.learnerSignature) {
        throw new ValidationError("Content changed — the previous learner signature is no longer valid. The learner must sign again.");
      }
      adiSignature = newAdi;
      learnerSignature = newLearner;
    }
  } else {
    // Not sent → keep the stored one; sent but unusable → rejected above (never a silent fallback).
    adiSignature = submittedSignature(input.adiSignature, "ADI") ?? existing.adiSignature ?? "";
    learnerSignature = submittedSignature(input.learnerSignature, "Learner") ?? existing.learnerSignature ?? "";
    if (!adiSignature) throw new ValidationError("ADI signature is required.");
    if (!learnerSignature) throw new ValidationError("Learner signature is required.");
  }

  if (!isPaper && assessedIds.includes(FINAL_DRIVE_23)) {
    // Same rule as createLesson: Final Drive 23 is signed, and every other app lesson of this learner is signed first.
    if (signatureStatus === "unsigned") throw new ValidationError("Final Drive 23 must be signed when it is saved.");
    const unsigned = (await unsignedAppLessonNos(db, learnerId)).filter((n) => n < existing.lessonNo);
    if (unsigned.length) throw new ValidationError(`Sign ${unsigned.map((n) => `Lesson #${n}`).join(", ")} first: Final Drive 23 waits until every earlier lesson is signed.`);
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
  await db.batch([revisionInsertStatement(db, lessonId, actingInstructorId, reason), updateEditedLesson, recomputeCumulative, deleteOldEvents, ...(eventsInsert ? [eventsInsert] : []), ...(outboxInsert ? [outboxInsert] : [])]);

  const [updatedLesson, completion] = await Promise.all([getLesson(db, learnerId, lessonId), getCompletionSummary(db, learnerId, after)]);

  scheduleIntegrationDelivery(db, integration);

  // Reported: milestones that were valid and no longer are, plus any milestone this lesson now
  // records as Achieved that does not count (its prerequisites are not in earlier lessons).
  const invalidated = diffInvalidatedMilestones(before, after);
  const recordedHere = (id: string) => newEventsForThisLesson.some((event) => event.competencyId === id && event.action === "assessed" && event.result === "achieved");
  if (recordedHere(REVIEW_1_17) && after.review1_17.status !== "achieved") invalidated.review1_17 = true;
  if (recordedHere(REVIEW_1_22) && after.review1_22.status !== "achieved") invalidated.review1_22 = true;
  if (recordedHere(FINAL_DRIVE_23) && after.finalDrive23.status !== "achieved") invalidated.finalDrive23 = true;

  return { lesson: updatedLesson, progress: after, completion, invalidated };
}

// ── CBT&A V2 competency progress ────────────────────────────────────────

export async function getCompetencyEvents(db: D1Database, learnerId: string): Promise<CompetencyEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.competency_id, e.action, e.result, e.lesson_id, e.created_at, l.lesson_no
       FROM competency_events e LEFT JOIN lessons l ON l.id = e.lesson_id
       WHERE e.learner_id = ? ORDER BY e.created_at ASC`,
    )
    .bind(learnerId)
    .all<Row>();
  return results.map(competencyEventFromRow);
}

/** lesson_no travels with every event: Review / Final Drive validity is judged by lesson order (lib/competency.ts#milestoneAssessmentCounts). No lesson row (never expected) = unknown lesson number, which can never validate a milestone. */
function competencyEventFromRow(row: Row): CompetencyEvent {
  return {
    competencyId: String(row.competency_id),
    action: row.action as CompetencyEvent["action"],
    result: (row.result as CompetencyEvent["result"]) ?? null,
    lessonId: String(row.lesson_id),
    createdAt: String(row.created_at),
    lessonNo: row.lesson_no === null || row.lesson_no === undefined ? undefined : Number(row.lesson_no),
  };
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
      `SELECT e.competency_id, e.action, e.result, e.lesson_id, e.created_at, l.lesson_no
       FROM competency_events e JOIN lessons l ON l.id = e.lesson_id
       WHERE e.learner_id = ? AND l.lesson_no < (SELECT lesson_no FROM lessons WHERE id = ? AND learner_id = ?)
       ORDER BY e.created_at ASC`,
    )
    .bind(learnerId, lessonId, learnerId)
    .all<Row>();
  return computeProgress(results.map(competencyEventFromRow));
}

/**
 * A lesson's current Taught/Assessed/Achieved selections, reconstructed from its competency events (for the edit form).
 * Paired with its learner, like getLesson: another learner's lesson id gives empty selections.
 */
export async function getLessonCompetencySelections(db: D1Database, learnerId: string, lessonId: string): Promise<{ taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, NonNullable<CompetencyEvent["result"]>> }> {
  const { results } = await db.prepare("SELECT competency_id, action, result FROM competency_events WHERE lesson_id = ? AND learner_id = ?").bind(lessonId, learnerId).all<Row>();
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

/**
 * The CBT&A Completed summary, consistent with the derived progress: set only while
 * `progress.completed` (a valid 23 Final Drive, see computeProgress), naming that Final Drive's
 * lesson; null otherwise, even if a raw Final Drive Achieved event exists (kept for audit). Pass the
 * progress the caller already has; without it the progress is read first (one extra statement).
 * No D1 statement at all when not completed.
 */
export async function getCompletionSummary(db: D1Database, learnerId: string, progress?: LearnerProgress): Promise<CompletionSummary | null> {
  const derived = progress ?? (await getLearnerProgress(db, learnerId));
  if (!derived.completed || derived.completedLessonId === null) return null;
  const row = await db
    .prepare(
      `SELECT e.created_at AS completed_at, l.lesson_no, l.cumulative_minutes, l.cumulative_km, i.full_name AS instructor_name
       FROM competency_events e
       JOIN lessons l ON l.id = e.lesson_id
       JOIN instructors i ON i.id = l.instructor_id
       WHERE e.learner_id = ? AND e.lesson_id = ? AND e.competency_id = ? AND e.action = 'assessed' AND e.result = 'achieved'
       ORDER BY e.created_at ASC LIMIT 1`,
    )
    .bind(learnerId, derived.completedLessonId, FINAL_DRIVE_23)
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
