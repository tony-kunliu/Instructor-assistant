// Durable outbox for ACTGDS Integration V1 events (migrations/
// 0005_integration_outbox.sql). See AGENTS.md §10 and
// docs/integrations/actgds-instructor-assistant-v1.md for why this exists:
// a lesson save must never fail because the website integration is down.

import type { D1Database, D1PreparedStatement } from "../d1-types.ts";
import type { LessonUpsertedPayloadV1, OutboxRow } from "./types.ts";

type Row = Record<string, unknown>;

function toOutboxRow(row: Row): OutboxRow {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    learnerId: String(row.learner_id),
    lessonId: String(row.lesson_id),
    sourceUpdatedAt: String(row.source_updated_at),
    payloadJson: String(row.payload_json),
    status: row.status as OutboxRow["status"],
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: String(row.next_attempt_at),
    lastErrorCode: (row.last_error_code as string) ?? null,
    createdAt: String(row.created_at),
    deliveredAt: (row.delivered_at as string) ?? null,
  };
}

/**
 * Builds the INSERT for a new outbox row. Deliberately a single, independent statement — not run here —
 * so a caller that needs the lesson write and the outbox enqueue to commit together can put both in one
 * `db.batch([...])` call. `event_id` is UNIQUE, so re-running the exact same enqueue (e.g. a retried
 * client request) fails loudly rather than silently double-enqueueing (surfaces as a constraint error, the
 * same "let SQLite's own constraint catch a race" pattern already used elsewhere in lib/repo.ts).
 */
export function insertOutboxRowStatement(db: D1Database, payload: LessonUpsertedPayloadV1): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO integration_outbox (id, event_id, event_type, learner_id, lesson_id, source_updated_at, payload_json, status, attempt_count, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      payload.event_id,
      payload.event_type,
      payload.learner.learner_id,
      payload.lesson.lesson_id,
      payload.lesson.source_updated_at,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
}

/** Enqueues immediately (not batched) — used when the caller can't fold this into an existing db.batch(). */
export async function enqueueOutboxRow(db: D1Database, payload: LessonUpsertedPayloadV1): Promise<void> {
  await insertOutboxRowStatement(db, payload).run();
}

export async function getOutboxRowByEventId(db: D1Database, eventId: string): Promise<OutboxRow | null> {
  const row = await db.prepare("SELECT * FROM integration_outbox WHERE event_id = ?").bind(eventId).first<Row>();
  return row ? toOutboxRow(row) : null;
}

/** Rows due for a delivery attempt right now — used by both the "attempt immediately after enqueue" path and a periodic retry sweep. */
export async function listDueOutboxRows(db: D1Database, nowIso: string, limit = 25): Promise<OutboxRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM integration_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?")
    .bind(nowIso, limit)
    .all<Row>();
  return results.map(toOutboxRow);
}

export async function listOutboxRowsForLearner(db: D1Database, learnerId: string): Promise<OutboxRow[]> {
  const { results } = await db.prepare("SELECT * FROM integration_outbox WHERE learner_id = ? ORDER BY created_at ASC").bind(learnerId).all<Row>();
  return results.map(toOutboxRow);
}

/**
 * For a set of lesson ids, the most recent `source_updated_at` this outbox has ever recorded for each —
 * regardless of that event's current status (pending/delivered/permanent_failure), any prior event at all
 * means the lesson has already entered the Integration domain (see History Edit downstream propagation:
 * lib/repo.ts#updateLesson). A lesson id with no entry in the returned map has never been exported and must
 * never be backfilled just because an earlier lesson was edited.
 */
export async function latestSourceUpdatedAtByLesson(db: D1Database, lessonIds: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (lessonIds.length === 0) return result;
  const placeholders = lessonIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT lesson_id, MAX(source_updated_at) AS latest FROM integration_outbox WHERE lesson_id IN (${placeholders}) GROUP BY lesson_id`)
    .bind(...lessonIds)
    .all<Row>();
  for (const row of results) result.set(String(row.lesson_id), String(row.latest));
  return result;
}

/**
 * The receiver upserts on (lesson_id, source_updated_at) — reusing or undercutting a lesson's existing
 * version is silently ignored as `stale_ignored`, which would look like a successful propagation while
 * actually fixing nothing. Guarantees the returned timestamp is strictly newer than `latestExistingIso`
 * (if any), never assuming `candidateIso` (typically "now") already is.
 */
export function ensureStrictlyNewerSourceUpdatedAt(candidateIso: string, latestExistingIso: string | null): string {
  if (!latestExistingIso) return candidateIso;
  return new Date(candidateIso).getTime() > new Date(latestExistingIso).getTime() ? candidateIso : new Date(new Date(latestExistingIso).getTime() + 1).toISOString();
}

export async function markOutboxDelivered(db: D1Database, id: string, nowIso: string): Promise<void> {
  await db.prepare("UPDATE integration_outbox SET status = 'delivered', delivered_at = ? WHERE id = ?").bind(nowIso, id).run();
}

export async function markOutboxRetry(db: D1Database, id: string, attemptCount: number, nextAttemptAtIso: string, errorCode: string | null): Promise<void> {
  await db
    .prepare("UPDATE integration_outbox SET attempt_count = ?, next_attempt_at = ?, last_error_code = ? WHERE id = ?")
    .bind(attemptCount, nextAttemptAtIso, errorCode, id)
    .run();
}

export async function markOutboxPermanentFailure(db: D1Database, id: string, attemptCount: number, errorCode: string | null): Promise<void> {
  await db.prepare("UPDATE integration_outbox SET status = 'permanent_failure', attempt_count = ?, last_error_code = ? WHERE id = ?").bind(attemptCount, errorCode, id).run();
}
