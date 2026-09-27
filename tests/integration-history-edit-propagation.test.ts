// History Edit downstream Integration propagation — bug fix regression
// suite. Reproduces the exact blocker ACTGDS (Work) found in cross-repo
// review (tony-kunliu/actgds.com Issue #3): editing an earlier lesson
// recalculates every downstream lesson's cumulative totals in this app's
// own database, but the previous implementation only ever produced a
// fresh lesson.upserted event for the *directly edited* lesson — any
// already-exported downstream lesson's ACTGDS mirror went permanently
// stale, and no cron sweep could ever repair it since no new event
// existed to retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, updateLesson } from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";
import { createFakeReceiver } from "./helpers/fake-actgds-receiver.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const SECRET = "synthetic-test-secret-never-real";
const SIG1 = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";
const SIG3 = "data:image/png;base64,iVBORw0KGgoAAAA3";
const SIG4 = "data:image/png;base64,iVBORw0KGgoAAAA4";

function enabledConfig() {
  return resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: SECRET, ACTGDS_INTEGRATION_ENV: "staging" });
}

function testHooks(fetchImpl: typeof fetch): { hooks: IntegrationHooks; settle: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  const hooks: IntegrationHooks = { config: enabledConfig(), fetchImpl, schedule: (attempt) => pending.push(attempt()) };
  return { hooks, settle: async () => { await Promise.all(pending); } };
}

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Propagation Test Learner", instructorId: tony?.id });
  return { db, learner, tony: tony! };
}

/** Simulates the receiver's own latest-wins-by-lesson_id mirror, built purely from what the fake receiver actually captured. */
function mirrorFromReceived(receiver: ReturnType<typeof createFakeReceiver>): Map<string, LessonUpsertedPayloadV1> {
  const mirror = new Map<string, LessonUpsertedPayloadV1>();
  for (const request of receiver.received) {
    const payload = JSON.parse(request.bodyText) as LessonUpsertedPayloadV1;
    const existing = mirror.get(payload.lesson.lesson_id);
    if (!existing || new Date(payload.lesson.source_updated_at).getTime() >= new Date(existing.lesson.source_updated_at).getTime()) {
      mirror.set(payload.lesson.lesson_id, payload);
    }
  }
  return mirror;
}

function outboxRowsForLesson(rows: Awaited<ReturnType<typeof listOutboxRowsForLearner>>, lessonId: string) {
  return rows.filter((row) => row.lessonId === lessonId);
}

// ── A: Work's exact blocker reproduction ────────────────────────────────

test("A: editing Lesson #1's duration/distance propagates a fresh event to the already-exported Lesson #2, correcting its stale mirror", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202); // Lesson #1 create
  receiver.queueResponse(202); // Lesson #2 create
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  await settle();

  // Confirm the original Lesson #2 event and mirror: 120 min / 20 km cumulative.
  const initialMirror = mirrorFromReceived(receiver);
  assert.equal(initialMirror.get(lesson2.id)?.lesson.cumulative_minutes, 120);
  assert.equal(initialMirror.get(lesson2.id)?.lesson.cumulative_km, 20);
  const rowsBeforeEdit = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  assert.equal(rowsBeforeEdit.length, 1);
  const oldEventId = rowsBeforeEdit[0].eventId;
  const oldSourceUpdatedAt = rowsBeforeEdit[0].sourceUpdatedAt;

  // History Edit Lesson #1: 60min/10km -> 90min/15km.
  receiver.queueResponse(202); // propagated Lesson #2 event
  receiver.queueResponse(202); // Lesson #1's own edit event
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await settle();

  // Instructor Assistant's own DB already recalculated this correctly (pre-existing behavior).
  const lesson2Row = await db.prepare("SELECT cumulative_minutes, cumulative_km FROM lessons WHERE id = ?").bind(lesson2.id).first<{ cumulative_minutes: number; cumulative_km: number }>();
  assert.equal(lesson2Row?.cumulative_minutes, 150);
  assert.equal(lesson2Row?.cumulative_km, 25);

  // The blocker: Lesson #2 must now have a SECOND outbox event.
  const rowsAfterEdit = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  assert.equal(rowsAfterEdit.length, 2, "Lesson #2 must have gained a new propagated event");
  const newRow = rowsAfterEdit.find((row) => row.eventId !== oldEventId)!;
  assert.ok(newRow, "the new event must have a different event_id from the original");
  assert.ok(new Date(newRow.sourceUpdatedAt).getTime() > new Date(oldSourceUpdatedAt).getTime(), "new source_updated_at must be strictly newer");
  const newPayload = JSON.parse(newRow.payloadJson) as LessonUpsertedPayloadV1;
  assert.equal(newPayload.lesson.cumulative_minutes, 150);
  assert.equal(newPayload.lesson.cumulative_km, 25);

  // And once delivered, the simulated receiver mirror for Lesson #2 reflects the correction.
  const finalMirror = mirrorFromReceived(receiver);
  assert.equal(finalMirror.get(lesson2.id)?.lesson.cumulative_minutes, 150);
  assert.equal(finalMirror.get(lesson2.id)?.lesson.cumulative_km, 25);
});

// ── B: multiple downstream lessons ──────────────────────────────────────

test("B: editing Lesson #1 propagates fresh events to every already-exported downstream lesson (#2 and #3), not just the next one", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson3 = await createLesson(db, learner.id, { lessonDate: "2026-09-03", startTime: "09:00", finishTime: "10:00", startOdometer: "200", finishOdometer: "210", taughtIds: ["3"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  await settle();

  receiver.queueResponse(202); // Lesson #1's own edit
  receiver.queueResponse(202); // propagated #2
  receiver.queueResponse(202); // propagated #3
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await settle();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(outboxRowsForLesson(rows, lesson2.id).length, 2, "Lesson #2 must have a propagated event");
  assert.equal(outboxRowsForLesson(rows, lesson3.id).length, 2, "Lesson #3 must ALSO have a propagated event, not just the next lesson");

  const newestPayloadFor = (lessonId: string) => {
    const payloads = outboxRowsForLesson(rows, lessonId).map((r) => JSON.parse(r.payloadJson) as LessonUpsertedPayloadV1);
    return payloads.sort((a, b) => new Date(a.lesson.source_updated_at).getTime() - new Date(b.lesson.source_updated_at).getTime())[payloads.length - 1];
  };
  const lesson2New = newestPayloadFor(lesson2.id);
  const lesson3New = newestPayloadFor(lesson3.id);
  assert.equal(lesson2New.lesson.cumulative_minutes, 150, "Lesson #2 cumulative = 90 (edited #1) + 60 (#2)");
  assert.equal(lesson2New.lesson.cumulative_km, 25, "Lesson #2 cumulative = 15 (edited #1) + 10 (#2)");
  assert.equal(lesson3New.lesson.cumulative_minutes, 210, "Lesson #3 cumulative = 90 (edited #1) + 60 (#2) + 60 (#3)");
  assert.equal(lesson3New.lesson.cumulative_km, 35, "Lesson #3 cumulative = 15 (edited #1) + 10 (#2) + 10 (#3)");
});

// ── C: no automatic historical backfill ──────────────────────────────────

test("C: editing Lesson #1 while Lesson #2 has never been exported does NOT create a backfill event for Lesson #2", async () => {
  const { db, learner } = await setup();
  // Integration disabled for both creates — neither lesson ever enters the outbox.
  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 });
  await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 });
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);

  // Integration is turned on later, then Lesson #1 is edited.
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await settle();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 1, "only Lesson #1's own new edit event — Lesson #2 must not be backfilled");
  assert.equal(rows[0].lessonId, lesson1.id);
});

// ── D: mixed exported / unexported downstream lessons ────────────────────

test("D: with Lesson #2 already exported and Lesson #3 never exported, editing Lesson #1 propagates to #2 only", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202); // Lesson #1 create
  const { hooks: enabledHooks, settle: settleEnabled } = testHooks(receiver.fetchImpl);
  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, enabledHooks);

  receiver.queueResponse(202); // Lesson #2 create
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, enabledHooks);
  await settleEnabled();

  // Lesson #3 created with integration disabled — never exported.
  const lesson3 = await createLesson(db, learner.id, { lessonDate: "2026-09-03", startTime: "09:00", finishTime: "10:00", startOdometer: "200", finishOdometer: "210", taughtIds: ["3"], adiSignature: SIG1, learnerSignature: SIG1 });

  receiver.queueResponse(202); // Lesson #1's own edit
  receiver.queueResponse(202); // propagated #2 only
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, enabledHooks);
  await settleEnabled();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(outboxRowsForLesson(rows, lesson2.id).length, 2, "Lesson #2 (already exported) must get a propagated event");
  assert.equal(outboxRowsForLesson(rows, lesson3.id).length, 0, "Lesson #3 (never exported) must NOT be backfilled");
});

// ── E: strictly newer source_updated_at, even under rapid edits ──────────

test("E: two edits in quick succession still produce strictly increasing source_updated_at for the same downstream lesson", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  await settle();

  receiver.queueResponse(202);
  receiver.queueResponse(202);
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await settle();

  receiver.queueResponse(202);
  receiver.queueResponse(202);
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "11:00", startOdometer: "0", finishOdometer: "20", taughtIds: ["1"], adiSignature: SIG3, learnerSignature: SIG3 }, hooks);
  await settle();

  const lesson2Rows = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  assert.equal(lesson2Rows.length, 3, "original create + two propagated edits");
  const versions = lesson2Rows.map((r) => new Date(r.sourceUpdatedAt).getTime()).sort((a, b) => a - b);
  assert.ok(versions[0] < versions[1] && versions[1] < versions[2], "every version must be strictly newer than the last");
  const eventIds = new Set(lesson2Rows.map((r) => r.eventId));
  assert.equal(eventIds.size, 3, "every propagated event must have its own unique event_id");
});

// ── F: downstream lessons keep their own competency data ─────────────────

test("F: a propagated Lesson #2 event carries Lesson #2's own taught/assessed — never Lesson #1's", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], assessedIds: ["3"], achievedResults: { "3": "achieved" }, adiSignature: SIG1, learnerSignature: SIG1 },
    hooks,
  );
  await settle();

  receiver.queueResponse(202);
  receiver.queueResponse(202);
  await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await settle();

  const lesson2Rows = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  const propagated = lesson2Rows.sort((a, b) => new Date(a.sourceUpdatedAt).getTime() - new Date(b.sourceUpdatedAt).getTime())[1];
  const payload = JSON.parse(propagated.payloadJson) as LessonUpsertedPayloadV1;
  assert.deepEqual(payload.lesson.taught, ["2"], "must be Lesson #2's own taught, never Lesson #1's");
  assert.deepEqual(payload.lesson.assessed, ["3"]);
  assert.deepEqual(payload.lesson.achieved, ["3"]);
});

// ── G: learner-wide progress snapshot stays consistent after a competency edit ──

test("G: editing Lesson #1's competency selections propagates the corrected progress snapshot to an already-exported downstream lesson", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  // Lesson #1 originally teaches competency 1 only (not assessed yet).
  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  await settle();

  const beforeRows = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  const beforePayload = JSON.parse(beforeRows[0].payloadJson) as LessonUpsertedPayloadV1;
  assert.equal(beforePayload.progress.achieved_count, 0);

  // Edit Lesson #1: now assess and achieve competency 1 (same duration/distance, so only competency/progress changes).
  receiver.queueResponse(202); // Lesson #1's own edit
  receiver.queueResponse(202); // propagated #2 with corrected progress
  await updateLesson(
    db,
    learner.id,
    lesson1.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", assessedIds: ["1"], achievedResults: { "1": "achieved" }, adiSignature: SIG2, learnerSignature: SIG2 },
    hooks,
  );
  await settle();

  const afterRows = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
  assert.equal(afterRows.length, 2);
  const afterPayload = JSON.parse(afterRows.sort((a, b) => new Date(a.sourceUpdatedAt).getTime() - new Date(b.sourceUpdatedAt).getTime())[1].payloadJson) as LessonUpsertedPayloadV1;
  assert.equal(afterPayload.progress.achieved_count, 1, "Lesson #2's propagated event must carry the corrected learner-wide progress");
  // Lesson #2's OWN competency content must remain unchanged.
  assert.deepEqual(afterPayload.lesson.taught, ["2"]);
});

// ── H: atomic rollback covers downstream propagation too ─────────────────

test("H: a failed History Edit batch rolls back the edited lesson, its downstream cumulative updates, AND every downstream propagated event together", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
  await settle();

  const beforeLesson2Row = await db.prepare("SELECT cumulative_minutes, cumulative_km FROM lessons WHERE id = ?").bind(lesson2.id).first<{ cumulative_minutes: number; cumulative_km: number }>();
  const beforeOutboxCount = (await listOutboxRowsForLearner(db, learner.id)).length;

  const failingDb = {
    prepare: (query: string) => db.prepare(query),
    exec: (query: string) => db.exec(query),
    batch: async () => {
      throw new Error("simulated D1 batch failure during History Edit");
    },
  };

  await assert.rejects(() =>
    updateLesson(failingDb as never, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks),
  );

  // Checked against the real, unwrapped db: nothing from the failed edit persisted anywhere.
  const afterLesson1 = await db.prepare("SELECT duration_minutes FROM lessons WHERE id = ?").bind(lesson1.id).first<{ duration_minutes: number }>();
  assert.equal(afterLesson1?.duration_minutes, 60, "Lesson #1's edit must not have persisted");
  const afterLesson2Row = await db.prepare("SELECT cumulative_minutes, cumulative_km FROM lessons WHERE id = ?").bind(lesson2.id).first<{ cumulative_minutes: number; cumulative_km: number }>();
  assert.deepEqual(afterLesson2Row, beforeLesson2Row, "Lesson #2's cumulative totals must not have changed");
  const afterOutboxCount = (await listOutboxRowsForLearner(db, learner.id)).length;
  assert.equal(afterOutboxCount, beforeOutboxCount, "no new outbox row — direct or propagated — must have been created by the failed batch");
});

// ── I: direct edit after propagation — source_updated_at monotonicity ────
//
// Reproduces the follow-up blocker ACTGDS (Work) found reviewing the fix
// above (Issue #3, comment 5855527779 then 5856473979): a lesson that was
// previously the *target* of a propagated event (from editing an earlier
// lesson) could later be *directly* edited within the same millisecond as
// that propagated version, producing a colliding (or, with clock skew,
// even older) source_updated_at. The receiver's own upsert rule — same or
// older version is a no-op ("stale_ignored", still HTTP 200) — meant the
// Sender treated the direct edit as delivered while the receiver's mirror
// silently never changed, with zero pending outbox rows left for any retry
// to repair. `updateLesson`'s direct-edit path must therefore look up the
// latest version already recorded for its OWN lesson_id (not just what
// downstream lessons use), exactly like the propagation path already does.
//
// Uses FakeClock (tests/helpers/fake-clock.ts) to force the exact
// millisecond collision deterministically — no dependency on real
// wall-clock timing. The scenario and all numbers mirror Work's own
// reproduction in Issue #3 exactly, so the final assertions can be checked
// against their independently-computed expected values.

test("I: a direct edit of a lesson that was previously a downstream propagation target gets a version strictly newer than that propagated version, and the receiver mirror actually updates", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202); // Lesson #1 create
  receiver.queueResponse(202); // Lesson #2 create
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const clock = new FakeClock("2026-09-01T00:00:00.000Z");
  clock.install();
  try {
    const lesson1 = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
    const lesson2 = await createLesson(db, learner.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["2"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
    await settle();

    const initialMirror = mirrorFromReceived(receiver);
    assert.equal(initialMirror.get(lesson2.id)?.lesson.cumulative_minutes, 120);
    assert.equal(initialMirror.get(lesson2.id)?.lesson.cumulative_km, 20);

    // Both direct edits of Lesson #1 below happen at the SAME controlled
    // clock value T — forcing Lesson #2's two propagated versions to land
    // at T and T+1ms respectively (ensureStrictlyNewerSourceUpdatedAt's own
    // collision-avoidance), exactly reproducing Work's boundary scenario.
    clock.set("2026-09-05T10:00:00.000Z");
    const t = clock.nowIso();

    receiver.queueResponse(202); // Lesson #1's own edit (v = T)
    receiver.queueResponse(202); // propagated Lesson #2 (v = T)
    await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
    await settle();

    receiver.queueResponse(202); // Lesson #1's own edit (v = T+1ms, collision-avoided)
    receiver.queueResponse(202); // propagated Lesson #2 (v = T+1ms, collision-avoided)
    await updateLesson(db, learner.id, lesson1.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "11:00", startOdometer: "0", finishOdometer: "20", taughtIds: ["1"], adiSignature: SIG3, learnerSignature: SIG3 }, hooks);
    await settle();

    const lesson2RowsBeforeDirectEdit = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
    assert.equal(lesson2RowsBeforeDirectEdit.length, 3, "create + two propagated events");
    const sortedVersions = lesson2RowsBeforeDirectEdit.map((row) => row.sourceUpdatedAt).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const latestPropagatedVersion = sortedVersions[sortedVersions.length - 1];
    assert.equal(latestPropagatedVersion, new Date(new Date(t).getTime() + 1).toISOString(), "Lesson #2's latest propagated version must be exactly T+1ms");

    // Advance the clock to EXACTLY that same T+1ms value, then directly
    // edit Lesson #2 — this is the exact collision Work reproduced.
    clock.set(latestPropagatedVersion);
    assert.equal(clock.nowIso(), latestPropagatedVersion, "clock must be set to exactly Lesson #2's latest propagated version");

    receiver.queueResponse(202); // Lesson #2's own direct edit
    await updateLesson(db, learner.id, lesson2.id, { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "10:30", startOdometer: "100", finishOdometer: "120", taughtIds: ["2"], adiSignature: SIG4, learnerSignature: SIG4 }, hooks);
    await settle();

    const lesson2RowsAfter = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson2.id);
    assert.equal(lesson2RowsAfter.length, 4);
    const directEditRow = lesson2RowsAfter.reduce((latest, row) => (new Date(row.sourceUpdatedAt).getTime() > new Date(latest.sourceUpdatedAt).getTime() ? row : latest));
    assert.ok(
      new Date(directEditRow.sourceUpdatedAt).getTime() > new Date(latestPropagatedVersion).getTime(),
      `direct edit's source_updated_at (${directEditRow.sourceUpdatedAt}) must be strictly greater than the propagated version it collided with (${latestPropagatedVersion}) — this is the bug`,
    );
    assert.equal(directEditRow.sourceUpdatedAt, new Date(new Date(latestPropagatedVersion).getTime() + 1).toISOString(), "must be exactly T+2ms — the minimal strictly-newer bump, not an arbitrarily larger jump");

    // Persisted Sender state: Lesson #2 is now 90 min / 20 km, on top of
    // Lesson #1's final 120 min / 20 km => cumulative 210 min / 40 km.
    const sourceLesson2Row = await db
      .prepare("SELECT duration_minutes, distance_km, cumulative_minutes, cumulative_km FROM lessons WHERE id = ?")
      .bind(lesson2.id)
      .first<{ duration_minutes: number; distance_km: number; cumulative_minutes: number; cumulative_km: number }>();
    assert.equal(sourceLesson2Row?.duration_minutes, 90);
    assert.equal(sourceLesson2Row?.distance_km, 20);
    assert.equal(sourceLesson2Row?.cumulative_minutes, 210);
    assert.equal(sourceLesson2Row?.cumulative_km, 40);

    // The simulated receiver mirror (highest-source_updated_at-wins, per
    // the contract's own upsert rule) must reflect the SAME values — if the
    // bug were still present, the direct edit's event would have collided
    // with (not exceeded) the propagated version, so this mirror would
    // still show the propagated snapshot (duration 60, cumulative 180/30),
    // not the direct edit's own content, even though the Sender reports it
    // delivered. Receiver code itself is out of scope/another repo — this
    // mirror only re-applies the contract's own documented, version-based
    // upsert rule to what the fake receiver actually captured.
    const finalMirror = mirrorFromReceived(receiver);
    const mirroredLesson2 = finalMirror.get(lesson2.id);
    assert.equal(mirroredLesson2?.lesson.source_updated_at, directEditRow.sourceUpdatedAt, "receiver mirror must have actually advanced to the direct edit's version, not stayed stale");
    assert.equal(mirroredLesson2?.lesson.duration_minutes, 90);
    assert.equal(mirroredLesson2?.lesson.distance_km, 20);
    assert.equal(mirroredLesson2?.lesson.cumulative_minutes, 210);
    assert.equal(mirroredLesson2?.lesson.cumulative_km, 40);

    // Delivered (202/200 are both "delivered" outcomes), so nothing is left pending to retry.
    const allRows = await listOutboxRowsForLearner(db, learner.id);
    assert.equal(
      allRows.filter((row) => row.status === "pending").length,
      0,
      "every event, direct and propagated, must have been delivered — none left pending",
    );
  } finally {
    clock.restore();
  }
});

// ── J: rapid direct edits at the exact same controlled clock value ───────

test("J: two direct edits of the same lesson at the exact same controlled clock timestamp still produce strictly increasing source_updated_at", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202); // create
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const clock = new FakeClock("2026-09-01T00:00:00.000Z");
  clock.install();
  try {
    const lesson = await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG1, learnerSignature: SIG1 }, hooks);
    await settle();

    clock.set("2026-09-05T10:00:00.000Z");
    const t = clock.nowIso();

    receiver.queueResponse(202);
    await updateLesson(db, learner.id, lesson.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:30", startOdometer: "0", finishOdometer: "15", taughtIds: ["1"], adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
    await settle();

    // Deliberately do NOT advance the clock — the second direct edit lands
    // at the exact same millisecond as the first.
    assert.equal(clock.nowIso(), t, "clock must be unchanged for this to be a genuine same-millisecond collision");
    receiver.queueResponse(202);
    await updateLesson(db, learner.id, lesson.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "11:00", startOdometer: "0", finishOdometer: "20", taughtIds: ["1"], adiSignature: SIG3, learnerSignature: SIG3 }, hooks);
    await settle();

    const rows = outboxRowsForLesson(await listOutboxRowsForLearner(db, learner.id), lesson.id);
    assert.equal(rows.length, 3, "create + two direct edits");
    const versions = rows.map((row) => new Date(row.sourceUpdatedAt).getTime()).sort((a, b) => a - b);
    assert.ok(versions[0] < versions[1], "second edit's version must be strictly newer than the create");
    assert.ok(versions[1] < versions[2], "second edit's version must be strictly newer than the first edit, despite the identical clock reading");
    assert.equal(versions[2], versions[1] + 1, "the minimal strictly-newer bump is exactly +1ms, not an arbitrarily larger jump");

    const eventIds = new Set(rows.map((row) => row.eventId));
    assert.equal(eventIds.size, 3, "every edit must have its own unique event_id despite the clock collision");
  } finally {
    clock.restore();
  }
});
