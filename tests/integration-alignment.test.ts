// Sender/Receiver contract alignment + reliability-gap tests for this
// round (see tony-kunliu/actgds.com Issue #3 — "CONTRACT READY FOR
// CLAUDE" handoff). Covers requirements A-Q from that round's brief:
// canonical schema/fixture conformance, event_id immutability across
// retries, atomic outbox durability, and the periodic retry sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail } from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { buildLessonUpsertedPayload } from "../lib/integration/contract.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import { backoffMinutesAfterAttempt, classifyDeliveryOutcome, processDueOutbox } from "../lib/integration/sender.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import type { D1Database } from "../lib/d1-types.ts";
import type { LearnerProgress } from "../lib/competency.ts";
import { createFakeReceiver } from "./helpers/fake-actgds-receiver.ts";
import { matchesReceiverSemantics, matchesSchema } from "./helpers/schema-validate.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const TONY_EMAIL = "Kunliu.work@gmail.com";
const SECRET = "synthetic-test-secret-never-real";
const SCHEMA_PATH = new URL("../docs/integrations/lesson-upserted-v1.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

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
  const learner = await createLearner(db, { fullName: "Alignment Test Learner", instructorId: tony?.id });
  return { db, learner, tony: tony! };
}

const lessonFields = { id: "lesson-1", lessonNo: 1, lessonDate: "2026-09-27", startTime: "09:00", finishTime: "10:30", durationMinutes: 90, distanceKm: 42, cumulativeMinutes: 1950, cumulativeKm: 686, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: null };

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

// ── A-D: canonical schema conformance for every lesson shape ───────────────

test("A: an ordinary lesson payload validates against the canonical schema", () => {
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "l1",
    instructorId: "i1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: ["8", "12"],
    assessedIds: ["4"],
    achievedIds: ["4"],
    progress: fakeProgress(),
  });
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});

test("B: a Review 1-17 payload validates against the canonical schema", () => {
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "l1",
    instructorId: "i1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: ["8", "12"],
    assessedIds: ["review-1-17"],
    achievedIds: ["review-1-17"],
    progress: fakeProgress(),
  });
  assert.deepEqual(payload.lesson.assessed, ["review_1_17"]);
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});

test("C: a Review 1-22 payload validates against the canonical schema", () => {
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "l1",
    instructorId: "i1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: ["8", "12"],
    assessedIds: ["review-1-22"],
    achievedIds: ["review-1-22"],
    progress: fakeProgress(),
  });
  assert.deepEqual(payload.lesson.assessed, ["review_1_22"]);
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});

test("D: a Final Drive 23 payload validates against the canonical schema", () => {
  const payload = buildLessonUpsertedPayload({
    environment: "staging",
    learnerId: "l1",
    instructorId: "i1",
    instructorDisplayName: "Tony",
    lesson: lessonFields,
    taughtIds: ["8", "12"],
    assessedIds: ["final-drive-23"],
    achievedIds: ["final-drive-23"],
    progress: fakeProgress(),
  });
  assert.deepEqual(payload.lesson.assessed, ["final_drive_23"]);
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});

test("A-E (ACTGDS shared fixtures): every valid fixture from tony-kunliu/actgds.com validates against this repo's copy of the schema", () => {
  const fixturesPath = new URL("../docs/integrations/lesson-upserted-v1.fixtures.json", import.meta.url);
  const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as Array<{ id: string; http: number; payload: unknown }>;
  for (const fixture of fixtures.filter((f) => f.http === 200 || f.http === 202)) {
    assert.equal(matchesSchema(fixture.payload, schema), true, `fixture ${fixture.id} must validate against the canonical schema`);
  }
  // F ("achieved outside assessed") and G ("taught/assessed overlap") are schema-shape-valid but violate
  // the cross-array semantic rule; H ("special taught") fails JSON Schema itself, since `taught` only
  // accepts core ids "1"-"22" — matches ACTGDS's own split between schema shape and runtime semantics.
  const invalidSemantics = fixtures.filter((f) => f.id === "F" || f.id === "G");
  assert.equal(invalidSemantics.length, 2);
  for (const fixture of invalidSemantics) {
    assert.equal(matchesSchema(fixture.payload, schema), true, `fixture ${fixture.id} must still be schema-shape-valid`);
    assert.equal(matchesReceiverSemantics(fixture.payload as never), false, `fixture ${fixture.id} must fail semantic validation`);
  }
  const invalidSchema = fixtures.find((f) => f.id === "H")!;
  assert.equal(matchesSchema(invalidSchema.payload, schema), false, "fixture H's taught:[\"review_1_17\"] must fail the JSON Schema itself, not just semantics");
});

// ── E: canonical hash ───────────────────────────────────────────────────

test("E: contract_schema_sha256 matches the canonical hash from tony-kunliu/actgds.com Issue #3", () => {
  const hash = execSync(`jq -cS . ${SCHEMA_PATH.pathname} | sha256sum`).toString().trim().split(/\s+/)[0];
  assert.equal(hash, "c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6");
});

// ── F, G, H: event_id immutability across retries ───────────────────────

test("F: a retry sends the byte-identical raw payload_json — never re-serialized", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500); // first attempt fails -> scheduled for retry
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "pending");

  // Manually drive a second attempt (simulating the periodic sweep) against the same row.
  receiver.queueResponse(500);
  await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date(Date.now() + 2 * 60_000));

  assert.equal(receiver.received.length, 2);
  assert.equal(receiver.received[0].bodyText, receiver.received[1].bodyText, "raw HTTP body must be byte-identical across attempts");
  assert.equal(receiver.received[0].bodyText, row.payloadJson, "and identical to the exact bytes stored in the outbox at enqueue time");
});

test("G: the same event_id (X-IA-Event-ID) is sent on every retry of the same event", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  receiver.queueResponse(202);
  await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date(Date.now() + 2 * 60_000));

  assert.equal(receiver.received.length, 2);
  assert.equal(receiver.received[0].headers["x-ia-event-id"], receiver.received[1].headers["x-ia-event-id"]);
});

test("H: timestamp and signature are fresh on each retry, and each independently verifies", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  await new Promise((resolve) => setTimeout(resolve, 1100)); // ensure the unix-second timestamp actually advances
  receiver.queueResponse(202);
  await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date(Date.now() + 2 * 60_000));

  assert.equal(receiver.received.length, 2);
  assert.notEqual(receiver.received[0].headers["x-ia-timestamp"], receiver.received[1].headers["x-ia-timestamp"], "timestamp must advance on retry");
  assert.notEqual(receiver.received[0].headers["x-ia-signature"], receiver.received[1].headers["x-ia-signature"], "signature must change since it covers the timestamp");
  assert.equal(receiver.received[0].signatureValid, true);
  assert.equal(receiver.received[1].signatureValid, true);
});

// ── I, J: atomic outbox durability ───────────────────────────────────────

function countingBatch(db: D1Database): { db: D1Database; count: () => number } {
  let calls = 0;
  const wrapped: D1Database = {
    prepare: (query: string) => db.prepare(query),
    exec: (query: string) => db.exec(query),
    batch: async (statements) => {
      calls++;
      return db.batch(statements);
    },
  };
  return { db: wrapped, count: () => calls };
}

test("I: the lesson write and its outbox enqueue commit in exactly one db.batch() call — a single atomic transaction, not two sequential ones", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(202);
  const { hooks, settle } = testHooks(receiver.fetchImpl);
  const { db: countedDb, count } = countingBatch(db);

  await createLesson(countedDb, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  assert.equal(count(), 1, "createLesson must call db.batch() exactly once when integration is enabled");
  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.ok(row, "the outbox row must exist, committed in that same single batch");
});

test("J: a failed lesson/outbox batch loses neither — never a lesson that exists with no corresponding event, nor the reverse", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  const { hooks } = testHooks(receiver.fetchImpl);

  const failingDb: D1Database = {
    prepare: (query: string) => db.prepare(query),
    exec: (query: string) => db.exec(query),
    batch: async () => {
      throw new Error("simulated D1 batch failure");
    },
  };

  await assert.rejects(() =>
    createLesson(failingDb, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks),
  );

  // Checked against the real, unwrapped db: neither side of the atomic pair exists.
  const lessons = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE learner_id = ?").bind(learner.id).first<{ n: number }>();
  assert.equal(lessons?.n, 0, "no lesson row from the failed batch");
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), [], "no outbox row from the failed batch either — the exact silent-lost-event window this round closes");
});

// ── K, L, M: periodic retry sweep (worker/scheduled-entry.ts#scheduled calls processDueOutbox exactly like this) ──

test("L: a row scheduled for a future retry is not sent early by a sweep that runs before next_attempt_at", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500); // immediate attempt fails, scheduled ~1 min out
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();
  assert.equal(receiver.received.length, 1);

  // A sweep firing right now (well before the 1-minute backoff elapses) must find nothing due.
  await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date());
  assert.equal(receiver.received.length, 1, "must not have attempted delivery again before next_attempt_at");

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "pending");
  assert.equal(row.attemptCount, 1);
});

test("K/M: a sweep run after next_attempt_at (simulating the Cron Trigger firing) picks up and delivers the due retry", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  receiver.queueResponse(202);
  // A sweep at "now + 2 minutes" (past the 1-minute backoff) — this is exactly what
  // worker/scheduled-entry.ts's `scheduled()` handler calls on its Cron Trigger.
  await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date(Date.now() + 2 * 60_000));

  assert.equal(receiver.received.length, 2, "the sweep must have made a second attempt without any new lesson being saved");
  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "delivered");
});

// ── P, Q: permanent failure paths ────────────────────────────────────────

test("P: a 409 event_id_conflict response is a permanent failure, never retried", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(409);
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "permanent_failure");
  assert.equal(row.lastErrorCode, "http_409");
  assert.equal(classifyDeliveryOutcome(409, false), "permanent");
});

test("Q: repeated 500s exhaust the retry schedule and the row becomes permanent_failure (end to end, not just the pure backoff function)", async () => {
  const { db, learner } = await setup();
  const receiver = createFakeReceiver(SECRET);
  receiver.queueResponse(500); // immediate attempt
  const { hooks, settle } = testHooks(receiver.fetchImpl);

  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG_A, learnerSignature: SIG_A }, hooks);
  await settle();

  let simulatedNow = Date.now();
  // 5 backoff retries after the immediate attempt (1m, 5m, 30m, 2h, 12h) — all fail.
  for (let i = 0; i < 5; i++) {
    receiver.queueResponse(500);
    simulatedNow += 13 * 60 * 60 * 1000; // comfortably past any of the backoff windows
    await processDueOutbox(db, hooks.config, receiver.fetchImpl, new Date(simulatedNow));
  }

  const [row] = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(row.status, "permanent_failure");
  assert.equal(row.attemptCount, 6, "1 immediate + 5 retries");
  assert.equal(backoffMinutesAfterAttempt(6), null);
});
