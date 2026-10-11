import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, updateLesson } from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { buildLessonUpsertedPayload } from "../lib/integration/contract.ts";
import { signWebhookBody, verifyWebhookSignature } from "../lib/integration/hmac.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import { backoffMinutesAfterAttempt, classifyDeliveryOutcome } from "../lib/integration/sender.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";
import type { LearnerProgress } from "../lib/competency.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { createFakeReceiver } from "./helpers/fake-actgds-receiver.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const TONY_EMAIL = "Kunliu.work@gmail.com";
const SECRET = "synthetic-test-secret-never-real";

function enabledConfig() {
  return resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: SECRET, ACTGDS_INTEGRATION_ENV: "staging" });
}

/** Deterministic test hooks: `schedule` captures the delivery-attempt promise so the test can await it instead of racing a fire-and-forget background task. */
function testHooks(fetchImpl: typeof fetch): { hooks: IntegrationHooks; settle: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  const hooks: IntegrationHooks = {
    config: enabledConfig(),
    fetchImpl,
    schedule: (attempt) => {
      pending.push(attempt());
    },
  };
  return { hooks, settle: async () => { await Promise.all(pending); } };
}

async function setup() {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, TONY_EMAIL);
  const learner = await createLearner(db, { fullName: "Integration Test Learner", instructorId: tony?.id });
  return { db, learner, tony: tony! };
}

// ── A ────────────────────────────────────────────────────────────────────

test("A: integration disabled (no hooks passed) — create/edit behave exactly as before, no outbox row", async () => {
  const { db, learner } = await setup();
  const lesson = await createLesson(db, learner.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "09:30",
    startOdometer: "0",
    finishOdometer: "10",
    taughtIds: ["1"],
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
  });
  assert.equal(lesson.instructorId, learner.instructorId);
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);

  await updateLesson(db, learner.id, lesson.id, {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "0",
    finishOdometer: "20",
    taughtIds: ["1"],
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);
});

test("A (config disabled explicitly): passing hooks with config.enabled=false is also a no-op", async () => {
  const { db, learner } = await setup();
  const hooks: IntegrationHooks = { config: resolveIntegrationConfig({}) };
  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);
});

// ── B ────────────────────────────────────────────────────────────────────

test("B: lesson create with integration enabled produces a valid lesson.upserted outbox row", async () => {
  const { db, learner, tony } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson = await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1", "2"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await settle();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payloadJson) as LessonUpsertedPayloadV1;
  assert.equal(payload.contract_version, 1);
  assert.equal(payload.event_type, "lesson.upserted");
  assert.equal(payload.learner.learner_id, learner.id);
  assert.equal(payload.instructor.instructor_id, tony.id);
  assert.equal(payload.instructor.display_name, "Tony");
  assert.equal(payload.lesson.lesson_id, lesson.id);
  assert.deepEqual(payload.lesson.taught.sort(), ["1", "2"]);
});

// ── C ────────────────────────────────────────────────────────────────────

test("C: lesson edit produces a new event with the same lesson_id, a new event_id, and a newer source_updated_at", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const created = await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await updateLesson(
    db,
    learner.id,
    created.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "20", taughtIds: ["1"], adiSignature: SIG_B, learnerSignature: SIG_B },
    hooks,
  );
  await settle();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 2);
  const [createdRow, editedRow] = rows;
  assert.equal(createdRow.lessonId, editedRow.lessonId, "same lesson_id across both events");
  assert.notEqual(createdRow.eventId, editedRow.eventId, "a new event_id per event");

  const createdPayload = JSON.parse(createdRow.payloadJson) as LessonUpsertedPayloadV1;
  const editedPayload = JSON.parse(editedRow.payloadJson) as LessonUpsertedPayloadV1;
  assert.notEqual(editedPayload.lesson.source_updated_at, createdPayload.lesson.source_updated_at);
  assert.ok(
    new Date(editedPayload.lesson.source_updated_at).getTime() >= new Date(createdPayload.lesson.source_updated_at).getTime(),
    "the edit's source_updated_at must not be older than the create's",
  );
});

// ── D ────────────────────────────────────────────────────────────────────

test("D: payload contains no learner PII or other forbidden fields — only the exact allowed keys at every level", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(
    db,
    learner.id,
    {
      lessonDate: "2026-09-01",
      startTime: "09:00",
      finishTime: "09:30",
      startOdometer: "0",
      finishOdometer: "10",
      taughtIds: ["1"],
      location: "Belconnen",
      comments: "This must never be sent to ACTGDS.",
      adiSignature: SIG_A,
      learnerSignature: SIG_A,
    },
    hooks,
  );
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;

  assert.deepEqual(Object.keys(payload).sort(), ["contract_version", "event_id", "event_type", "instructor", "learner", "lesson", "occurred_at", "progress", "source"].sort());
  assert.deepEqual(Object.keys(payload.learner as object), ["learner_id"], "learner object must contain nothing but learner_id — no name/phone/email/address");
  assert.deepEqual(
    Object.keys(payload.lesson as object).sort(),
    ["lesson_id", "lesson_number", "lesson_date", "start_time", "finish_time", "duration_minutes", "distance_km", "cumulative_minutes", "cumulative_km", "taught", "assessed", "achieved", "source_updated_at"].sort(),
  );
  const rawJson = row.payloadJson;
  for (const forbidden of ["comments", "This must never be sent", "signature", "Belconnen", "adi_signature", "learner_signature", "address", "phone", "dob"]) {
    assert.ok(!rawJson.includes(forbidden), `payload must not contain "${forbidden}"`);
  }
});

// ── E & F ────────────────────────────────────────────────────────────────

function fakeProgress(overrides: Partial<LearnerProgress> = {}): LearnerProgress {
  return {
    competencies: {},
    achievedCount: 15,
    review1_17: { status: "achieved", remaining: 0 },
    review1_22: { status: "locked", remaining: 7, review1_17Achieved: true },
    finalDrive23: { status: "locked", remaining: 7, review1_17Achieved: true, review1_22Achieved: false },
    completed: false,
    completedLessonId: null,
    ...overrides,
  };
}

test("E: competency id tokens convert correctly to the underscore wire form; core ids pass through unchanged", () => {
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "learner-1",
    instructorId: "instructor-1",
    instructorDisplayName: "Tony",
    lesson: { id: "lesson-1", lessonNo: 1, lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", durationMinutes: 30, distanceKm: 5, cumulativeMinutes: 30, cumulativeKm: 5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: null },
    taughtIds: ["3", "8"],
    assessedIds: ["4", REVIEW_1_17, REVIEW_1_22, FINAL_DRIVE_23],
    achievedIds: ["4", REVIEW_1_17],
    progress: fakeProgress(),
  });
  assert.deepEqual(payload.lesson.taught.sort(), ["3", "8"]);
  assert.deepEqual(payload.lesson.assessed.sort(), ["4", "review_1_17", "review_1_22", "final_drive_23"].sort());
  assert.deepEqual(payload.lesson.achieved.sort(), ["4", "review_1_17"].sort());
});

test("F: progress snapshot mirrors LearnerProgress accurately, including cbta_status", () => {
  const lessonFields = { id: "lesson-1", lessonNo: 1, lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", durationMinutes: 30, distanceKm: 5, cumulativeMinutes: 30, cumulativeKm: 5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: null };

  const active = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "learner-1",
    instructorId: "instructor-1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: [],
    assessedIds: [],
    achievedIds: [],
    progress: fakeProgress({ achievedCount: 15, review1_17: { status: "achieved", remaining: 0 } }),
  });
  assert.equal(active.progress.achieved_count, 15);
  assert.equal(active.progress.total_competencies, 22);
  assert.equal(active.progress.review_1_17, "achieved");
  assert.equal(active.progress.review_1_22, "locked");
  assert.equal(active.progress.final_drive_23, "locked");
  assert.equal(active.progress.cbta_status, "active");

  const completed = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "learner-1",
    instructorId: "instructor-1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: [],
    assessedIds: [],
    achievedIds: [],
    progress: fakeProgress({
      achievedCount: 22,
      review1_17: { status: "achieved", remaining: 0 },
      review1_22: { status: "achieved", remaining: 0, review1_17Achieved: true },
      finalDrive23: { status: "achieved", remaining: 0, review1_17Achieved: true, review1_22Achieved: true },
      completed: true,
    }),
  });
  assert.equal(completed.progress.cbta_status, "completed");
  assert.equal(completed.progress.final_drive_23, "achieved");
});

// ── G & H ────────────────────────────────────────────────────────────────

test("G: a correctly signed request verifies against the exact raw body", async () => {
  const body = JSON.stringify({ hello: "world" });
  const timestamp = 1_700_000_000;
  const signature = await signWebhookBody(SECRET, timestamp, body);
  assert.ok(signature.startsWith("v1="));
  assert.equal(await verifyWebhookSignature(SECRET, timestamp, body, signature), true);
});

test("H: changing a single byte of the body invalidates the signature", async () => {
  const body = JSON.stringify({ hello: "world" });
  const tamperedBody = JSON.stringify({ hello: "worle" });
  const timestamp = 1_700_000_000;
  const signature = await signWebhookBody(SECRET, timestamp, body);
  assert.equal(await verifyWebhookSignature(SECRET, timestamp, tamperedBody, signature), false);
});

// ── I, J, K ──────────────────────────────────────────────────────────────

test("I: the receiver being unreachable never fails the lesson save — outbox stays pending, scheduled for retry", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueNetworkError();
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  const lesson = await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  assert.ok(lesson.id, "lesson save must succeed regardless of the webhook outcome");
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "pending");
  assert.equal(row.attemptCount, 1);
  assert.ok(new Date(row.nextAttemptAt).getTime() > Date.now(), "must be scheduled for a future retry, not immediately due again");
});

test("J: a 500 from the receiver is retryable — same pending/rescheduled outcome as a network error", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "pending");
  assert.equal(row.attemptCount, 1);
  assert.equal(row.lastErrorCode, "http_500");
});

test("K: a 202 from the receiver marks the event delivered — no retry scheduled", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "delivered");
  assert.ok(row.deliveredAt);
  assert.equal(receiver.received.length, 1, "must not have been retried after a successful delivery");
  assert.equal(receiver.received[0].signatureValid, true, "the fake receiver must see a valid signature over the exact raw body it received");
});

// ── L ────────────────────────────────────────────────────────────────────

test("L: enqueuing the exact same event_id twice is rejected outright, not silently duplicated (UNIQUE constraint)", async () => {
  const { db, learner } = await setup();
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: learner.id,
    instructorId: learner.instructorId,
    instructorDisplayName: "Tony",
    lesson: { id: "lesson-x", lessonNo: 1, lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", durationMinutes: 30, distanceKm: 5, cumulativeMinutes: 30, cumulativeKm: 5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: null },
    taughtIds: ["1"],
    assessedIds: [],
    achievedIds: [],
    progress: fakeProgress(),
    eventId: "fixed-event-id-for-duplicate-test",
  });
  const { enqueueOutboxRow } = await import("../lib/integration/outbox.ts");
  await enqueueOutboxRow(db, payload);
  await assert.rejects(() => enqueueOutboxRow(db, payload));
  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 1, "the failed duplicate insert must not have left a second row");
});

// ── M ────────────────────────────────────────────────────────────────────

test("M: a permanent 4xx (e.g. 403) is never retried — marked permanent_failure immediately", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(403);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "permanent_failure");
  assert.equal(row.lastErrorCode, "http_403");
});

test("M (backoff schedule exhaustion): after the 6th attempt fails, the row becomes permanent_failure instead of scheduling a 7th", () => {
  assert.equal(backoffMinutesAfterAttempt(1), 1);
  assert.equal(backoffMinutesAfterAttempt(2), 5);
  assert.equal(backoffMinutesAfterAttempt(3), 30);
  assert.equal(backoffMinutesAfterAttempt(4), 120);
  assert.equal(backoffMinutesAfterAttempt(5), 720);
  assert.equal(backoffMinutesAfterAttempt(6), null, "the schedule is exhausted after 5 backoff retries (6 attempts total)");
});

test("classifyDeliveryOutcome: 200/202 delivered, 429/5xx retryable, 400/401/403/other-4xx permanent, network error retryable", () => {
  assert.equal(classifyDeliveryOutcome(200, false), "delivered");
  assert.equal(classifyDeliveryOutcome(202, false), "delivered");
  assert.equal(classifyDeliveryOutcome(429, false), "retryable");
  assert.equal(classifyDeliveryOutcome(500, false), "retryable");
  assert.equal(classifyDeliveryOutcome(503, false), "retryable");
  assert.equal(classifyDeliveryOutcome(400, false), "permanent");
  assert.equal(classifyDeliveryOutcome(401, false), "permanent");
  assert.equal(classifyDeliveryOutcome(403, false), "permanent");
  assert.equal(classifyDeliveryOutcome(422, false), "permanent", "an unsupported contract_version or any other 4xx is treated as permanent");
  assert.equal(classifyDeliveryOutcome(null, true), "retryable");
});

// ── N ────────────────────────────────────────────────────────────────────

test("N: renaming the learner never changes learner_id in later events", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );

  // No app-level "rename a learner" API exists yet — simulate the future case directly against the row,
  // which is the only way full_name could ever change, to prove learner_id (the only thing the wire
  // contract ever carries) is never derived from it.
  await db.prepare("UPDATE learners SET full_name = ? WHERE id = ?").bind("A Completely Different Name", learner.id).run();

  await createLesson(
    db,
    learner.id,
    { lessonDate: "2026-09-02", startTime: "09:00", finishTime: "09:30", startOdometer: "10", finishOdometer: "20", taughtIds: ["2"], adiSignature: SIG_A, learnerSignature: SIG_A },
    hooks,
  );
  await settle();

  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 2);
  const payloads = rows.map((r) => JSON.parse(r.payloadJson) as LessonUpsertedPayloadV1);
  assert.equal(payloads[0].learner.learner_id, learner.id);
  assert.equal(payloads[1].learner.learner_id, learner.id);
  for (const payload of payloads) {
    assert.ok(!JSON.stringify(payload).includes("Different Name"), "the renamed full_name must never leak into the payload");
  }
});

test("sameContractState: ignores only event_id / occurred_at / source_updated_at, fails closed otherwise", async () => {
  const { sameContractState } = await import("../lib/integration/contract.ts");
  const base = { contract_version: 1, event_id: "a", occurred_at: "t1", learner: { learner_id: "L" }, lesson: { lesson_id: "x", cumulative_km: 10, source_updated_at: "s1" }, progress: { achieved_count: 1 } };
  const bookkeepingOnly = { ...base, event_id: "b", occurred_at: "t2", lesson: { ...base.lesson, source_updated_at: "s2" } };
  assert.equal(sameContractState(JSON.stringify(base), JSON.stringify(bookkeepingOnly)), true);
  assert.equal(sameContractState(JSON.stringify(base), JSON.stringify({ ...base, lesson: { ...base.lesson, cumulative_km: 11 } })), false);
  assert.equal(sameContractState(JSON.stringify(base), JSON.stringify({ ...base, progress: { achieved_count: 2 } })), false);
  assert.equal(sameContractState(JSON.stringify(base), JSON.stringify({ ...base, learner: { learner_id: "M" } })), false);
  assert.equal(sameContractState(JSON.stringify(base), "not json"), false);
  assert.equal(sameContractState(JSON.stringify(base), JSON.stringify({ x: 1 })), false);
});
