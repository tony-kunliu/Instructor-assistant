// Learner management 3c T1: transfer a learner to another instructor (migration 0011).
// Design: docs/superpowers/specs/2026-10-11-learner-transfer-design.md (D1-D17). Synthetic "QA ..." data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database, D1PreparedStatement } from "../lib/d1-types.ts";
import { patchLearner, postLearnerTransfer, postTransferRecordsChecked } from "../lib/api.ts";
import {
  createLearner,
  createLesson,
  findInstructorByEmail,
  getLearner,
  getLearnerProgress,
  getTotals,
  listLearners,
  listLessons,
  markTransferRecordsChecked,
  NotFoundError,
  setLearnerArchived,
  transferLearner,
  updateLearner,
  updateLesson,
  ValidationError,
} from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import { canberraLongDate, parseTransferNote, pendingRecordsCheck, recordsCheckText, transferLine, withTransferDividers } from "../lib/learner-transfer.ts";
import { filterLearners } from "../lib/learner-filter.ts";
import { viewLearners } from "../lib/learner-picker.ts";
import type { LearnerTransferEvent } from "../lib/types.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const ANNA_EMAIL = "yapingqu.work@gmail.com";
const CAROL = "qa-instructor-carol";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG2 = "data:image/png;base64,iVBORw0KGgoAAAA2";

type Row = Record<string, unknown>;
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);
const rows = async (db: D1Database, sql: string) => (await db.prepare(sql).all<Row>()).results;
const transferRows = (db: D1Database) => rows(db, "SELECT * FROM learner_transfer_events ORDER BY at, rowid");
const at = (iso: string) => new Date(iso);

/** Integration enabled; delivery attempts are collected and never run (we only look at what is enqueued). */
function enabledHooks(): IntegrationHooks {
  return {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
    schedule: () => undefined,
  };
}

const lessonInput = (n: number, actingInstructorId: string, extra: Record<string, unknown> = {}) => ({
  lessonDate: `2026-09-${String(n).padStart(2, "0")}`, startTime: "09:00", finishTime: "10:00", startOdometer: String(n * 100), finishOdometer: String(n * 100 + 12),
  taughtIds: ["1"], adiSignature: SIG, learnerSignature: SIG, actingInstructorId, ...extra,
});

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, TONY_EMAIL))!;
  const anna = (await findInstructorByEmail(db, ANNA_EMAIL))!;
  await db.prepare("INSERT INTO instructors (id, full_name, status) VALUES (?, 'QA Carol', 'active')").bind(CAROL).run();
  const learner = await createLearner(db, { fullName: "QA Transfer Learner", instructorId: tony.id });
  return { db, tony, anna, learner };
}

/** Every table a transfer must never touch, byte-for-byte. */
async function untouched(db: D1Database) {
  const tables = ["lessons", "lesson_revisions", "learner_revisions", "competency_events", "learner_archive_events", "integration_outbox"];
  return Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await rows(db, `SELECT * FROM ${t} ORDER BY rowid`)] as const)));
}

// ── lib/learner-transfer.ts ──

test("note: trimmed, control characters replaced, empty = null, > 200 chars rejected, non-text rejected", () => {
  assert.equal(parseTransferNote("  QA hand-over \n"), "QA hand-over");
  assert.equal(parseTransferNote(" \n "), null);
  assert.equal(parseTransferNote(undefined), null);
  assert.equal(parseTransferNote("a".repeat(200)), "a".repeat(200));
  assert.throws(() => parseTransferNote("a".repeat(201)), /200 characters/);
  assert.throws(() => parseTransferNote(7), /must be text/);
});

test("History line uses the Canberra date: 'Transferred from Tony to Anna, Sun 11 Oct 2026' (UTC evening = next Canberra day)", () => {
  assert.equal(canberraLongDate("2026-10-11T02:00:00.000Z"), "Sun 11 Oct 2026");
  assert.equal(canberraLongDate("2026-10-10T20:00:00.000Z"), "Sun 11 Oct 2026", "07:00 AEDT on 11 Oct");
  assert.equal(transferLine({ fromName: "Tony", toName: "Anna", at: "2026-10-11T02:00:00.000Z" }), "Transferred from Tony to Anna, Sun 11 Oct 2026");
  assert.equal(recordsCheckText("Tony"), "Check the records from Tony. If any is not filled out correctly, or is false, misleading or incomplete, tell ADI Audit as soon as possible (CoP 9.1 h, 9.2 e).");
});

test("History dividers sit between the last lesson recorded before and the first after each transfer; lesson order never changes", () => {
  const ev = (id: string, iso: string) => ({ id, fromInstructorId: "a", fromName: "Tony", toInstructorId: "b", toName: "Anna", at: iso, byInstructorId: null, note: null, recordsCheckedAt: null, recordsCheckedBy: null }) satisfies LearnerTransferEvent;
  const lessons = [{ id: "L3", createdAt: "2026-10-05T00:00:00.000Z" }, { id: "L2", createdAt: "2026-10-03T00:00:00.000Z" }, { id: "L1", createdAt: "2026-10-01T00:00:00.000Z" }];
  const shape = (items: ReturnType<typeof withTransferDividers<(typeof lessons)[number]>>) => items.map((i) => (i.kind === "lesson" ? i.lesson.id : `T:${i.event.id}`)).join(",");
  assert.equal(shape(withTransferDividers(lessons, [ev("x", "2026-10-02T00:00:00.000Z")])), "L3,L2,T:x,L1");
  assert.equal(shape(withTransferDividers(lessons, [ev("late", "2026-10-09T00:00:00.000Z"), ev("early", "2026-09-01T00:00:00.000Z")])), "T:late,L3,L2,L1,T:early");
  assert.equal(shape(withTransferDividers([], [ev("only", "2026-10-02T00:00:00.000Z")])), "T:only");
  assert.equal(shape(withTransferDividers(lessons, [])), "L3,L2,L1");
});

// ── repo: transferLearner ──

test("owner transfers (D1-D3): only instructor_id + updated_at change; one event row with from, to, verified actor, note, time", async () => {
  const { db, tony, anna, learner } = await setup();
  const before = await db.prepare("SELECT * FROM learners WHERE id = ?").bind(learner.id).first<Row>();
  const moved = await transferLearner(db, learner.id, { toInstructorId: anna.id, note: "  QA hand-over  ", actingInstructorId: tony.id, now: at("2026-10-11T02:00:00.000Z") });
  assert.equal(moved.instructorId, anna.id);
  assert.equal(moved.instructorName, "Anna");
  const after = await db.prepare("SELECT * FROM learners WHERE id = ?").bind(learner.id).first<Row>();
  const changed = Object.keys(before!).filter((k) => before![k] !== after![k]).sort();
  assert.ok(changed.every((k) => k === "instructor_id" || k === "updated_at") && changed.includes("instructor_id"), changed.join(","));
  const events = await transferRows(db);
  assert.equal(events.length, 1);
  assert.deepEqual({ ...events[0], id: "x" }, {
    id: "x", learner_id: learner.id, from_instructor_id: tony.id, to_instructor_id: anna.id, at: "2026-10-11T02:00:00.000Z",
    by_instructor_id: tony.id, note: "QA hand-over", records_checked_at: null, records_checked_by: null,
  });
  assert.deepEqual(moved.transfers.map((t) => [t.fromName, t.toName, t.at, t.byInstructorId, t.note, t.recordsCheckedAt]), [["Tony", "Anna", "2026-10-11T02:00:00.000Z", tony.id, "QA hand-over", null]]);
  // My learners moves (a view filter): Tony's no longer lists the learner, Anna's does; All still does.
  const active = await listLearners(db);
  assert.equal(viewLearners(active, [], "mine", tony.id).some((l) => l.id === learner.id), false);
  assert.equal(viewLearners(active, [], "mine", anna.id).some((l) => l.id === learner.id), true);
  assert.equal(filterLearners(active, { scope: "all", instructorId: tony.id, query: "" }).some((l) => l.id === learner.id), true);
  assert.equal(active.find((l) => l.id === learner.id)!.transfers.length, 1, "the list carries the transfers too (same single query)");
});

test("no verified identity (local dev/tests): allowed, as for learner edit; by_instructor_id is NULL", async () => {
  const { db, anna, learner } = await setup();
  await transferLearner(db, learner.id, { toInstructorId: anna.id });
  const [event] = await transferRows(db);
  assert.equal(event.by_instructor_id, null);
  assert.equal((await getLearner(db, learner.id)).instructorId, anna.id);
});

test("non-owner (an active colleague) is rejected while the owner is active; nothing is written", async () => {
  const { db, anna, learner } = await setup();
  const before = await db.prepare("SELECT * FROM learners WHERE id = ?").bind(learner.id).first<Row>();
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: anna.id }), (e: unknown) => e instanceof ValidationError && e.message === "This learner belongs to Tony; only they can transfer them.");
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: CAROL, actingInstructorId: anna.id }), /only they can transfer/);
  assert.deepEqual(await db.prepare("SELECT * FROM learners WHERE id = ?").bind(learner.id).first<Row>(), before);
  assert.equal(await count(db, "learner_transfer_events"), 0);
});

test("inactive-owner exception (Q2): when the home instructor is inactive, any active instructor may take the learner over", async () => {
  const { db, tony, anna, learner } = await setup();
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE id = ?").bind(tony.id).run();
  const moved = await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: anna.id });
  assert.equal(moved.instructorId, anna.id);
  const [event] = await transferRows(db);
  assert.equal(event.from_instructor_id, tony.id);
  assert.equal(event.by_instructor_id, anna.id);
  // Carol (active) may also take a learner over from an inactive instructor and hand it to someone else.
  const other = await createLearner(db, { fullName: "QA Transfer Other", instructorId: anna.id });
  await db.prepare("UPDATE learners SET instructor_id = ? WHERE id = ?").bind(tony.id, other.id).run();
  assert.equal((await transferLearner(db, other.id, { toInstructorId: anna.id, actingInstructorId: CAROL })).instructorId, anna.id);
  // An inactive actor can never act.
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: CAROL, actingInstructorId: tony.id }), /Acting instructor is not active/);
});

test("target must be an active instructor different from the current one; unknown target/learner rejected; nothing written", async () => {
  const { db, tony, anna, learner } = await setup();
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: tony.id, actingInstructorId: tony.id }), (e: unknown) => e instanceof ValidationError && e.message === "This learner already belongs to Tony.");
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: "nobody", actingInstructorId: tony.id }), /instructor was not found/);
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: "", actingInstructorId: tony.id }), /Choose the instructor/);
  await assert.rejects(() => transferLearner(db, learner.id, { actingInstructorId: tony.id }), /Choose the instructor/);
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE id = ?").bind(anna.id).run();
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id }), (e: unknown) => e instanceof ValidationError && e.message === "Anna is not an active instructor.");
  await assert.rejects(() => transferLearner(db, "missing", { toInstructorId: CAROL, actingInstructorId: tony.id }), (e: unknown) => e instanceof NotFoundError);
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: CAROL, actingInstructorId: tony.id, note: "a".repeat(201) }), /200 characters/);
  assert.equal(await count(db, "learner_transfer_events"), 0);
  assert.equal((await getLearner(db, learner.id)).instructorId, tony.id);
});

test("archived learner is rejected (Q5): 'Restore the learner first'; after restore the transfer works", async () => {
  const { db, tony, anna, learner } = await setup();
  await setLearnerArchived(db, learner.id, true, { actingInstructorId: tony.id });
  await assert.rejects(() => transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id }), (e: unknown) => e instanceof ValidationError && /Restore the learner first/.test(e.message));
  assert.equal(await count(db, "learner_transfer_events"), 0);
  await setLearnerArchived(db, learner.id, false, { actingInstructorId: tony.id });
  assert.equal((await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id })).instructorId, anna.id);
  assert.equal(await count(db, "learner_archive_events"), 2, "archive history is not touched by the transfer");
});

/** A D1 whose FIRST batch() first lets `before` run (another request landing between our reads and our write). */
function racingD1(inner: D1Database, before: () => Promise<unknown>): D1Database {
  let fired = false;
  return {
    prepare: (q: string) => inner.prepare(q),
    exec: (q: string) => inner.exec(q),
    batch: async <T = Record<string, unknown>>(statements: D1PreparedStatement[]) => {
      if (!fired) { fired = true; await before(); }
      return inner.batch<T>(statements);
    },
  };
}

test("compare-and-set (D14): two transfers race, one wins; the loser gets 'already transferred to Carol by someone else' and writes nothing", async () => {
  const { db, tony, anna, learner } = await setup();
  const raced = racingD1(db, () => transferLearner(db, learner.id, { toInstructorId: CAROL, actingInstructorId: tony.id }));
  await assert.rejects(
    () => transferLearner(raced, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id }),
    (e: unknown) => e instanceof ValidationError && e.message === "This learner was already transferred to QA Carol by someone else. Nothing was changed.",
  );
  const events = await transferRows(db);
  assert.equal(events.length, 1);
  assert.equal(events[0].to_instructor_id, CAROL);
  assert.equal((await getLearner(db, learner.id)).instructorId, CAROL);
});

test("compare-and-set: a concurrent archive wins → 'archived meanwhile', nothing written; truly concurrent double transfer leaves exactly one event", async () => {
  const { db, tony, anna, learner } = await setup();
  const raced = racingD1(db, () => setLearnerArchived(db, learner.id, true, { actingInstructorId: tony.id }));
  await assert.rejects(() => transferLearner(raced, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id }), /archived meanwhile/);
  assert.equal(await count(db, "learner_transfer_events"), 0);
  assert.equal((await getLearner(db, learner.id)).instructorId, tony.id);

  const second = await createLearner(db, { fullName: "QA Transfer Double", instructorId: tony.id });
  const outcomes = await Promise.allSettled([
    transferLearner(db, second.id, { toInstructorId: anna.id, actingInstructorId: tony.id }),
    transferLearner(db, second.id, { toInstructorId: CAROL, actingInstructorId: tony.id }),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, JSON.stringify(outcomes.map((o) => o.status)));
  const events = await rows(db, `SELECT * FROM learner_transfer_events WHERE learner_id = '${second.id}'`);
  assert.equal(events.length, 1);
  assert.equal((await getLearner(db, second.id)).instructorId, events[0].to_instructor_id);
});

test("atomic: a failing UPDATE in the batch leaves neither the event nor the new owner", async () => {
  const { db, tony, anna, learner } = await setup();
  const failing: D1Database = {
    prepare: (q: string) => (q.startsWith("UPDATE learners SET instructor_id") ? db.prepare("UPDATE no_such_table SET x = ?") : db.prepare(q)),
    exec: (q: string) => db.exec(q),
    batch: (s) => db.batch(s),
  };
  await assert.rejects(() => transferLearner(failing, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id }));
  assert.equal(await count(db, "learner_transfer_events"), 0);
  assert.equal((await getLearner(db, learner.id)).instructorId, tony.id);
});

test("lessons keep their owner (D3/D4): lessons, revisions, competency events, archive events, learner_revisions and outbox are byte-identical; nothing is enqueued for ACTGDS", async () => {
  const { db, tony, anna, learner } = await setup();
  const hooks = enabledHooks();
  const first = await createLesson(db, learner.id, lessonInput(1, tony.id, { taughtIds: [], assessedIds: ["1"], achievedResults: { "1": "achieved" } }), hooks);
  await updateLesson(db, learner.id, first.id, { ...lessonInput(1, tony.id, { taughtIds: [], assessedIds: ["1"], achievedResults: { "1": "achieved" } }), location: "QA Woden", adiSignature: SIG2, learnerSignature: SIG2 }, hooks);
  await updateLearner(db, learner.id, { phone: "0400 000 111", actingInstructorId: tony.id });
  await setLearnerArchived(db, learner.id, true, { actingInstructorId: tony.id });
  await setLearnerArchived(db, learner.id, false, { actingInstructorId: tony.id });
  const snapshot = await untouched(db);
  assert.ok(snapshot.integration_outbox.length >= 2 && snapshot.lesson_revisions.length === 1 && snapshot.learner_revisions.length === 1);
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  assert.deepEqual(await untouched(db), snapshot);
  const lessons = await listLessons(db, learner.id);
  assert.equal(lessons[0].instructorId, tony.id, "Tony's lesson stays Tony's");
});

test("after transfer: old owner can still correct his own lesson, new owner cannot; numbering and totals continue; new lessons belong to their recorder", async () => {
  const { db, tony, anna, learner } = await setup();
  const first = await createLesson(db, learner.id, lessonInput(1, tony.id));
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  await assert.rejects(() => updateLesson(db, learner.id, first.id, { ...lessonInput(1, anna.id), location: "QA x", adiSignature: SIG2, learnerSignature: SIG2 }), /recorded by Tony; only they can change it/);
  const corrected = await updateLesson(db, learner.id, first.id, { ...lessonInput(1, tony.id), location: "QA corrected", adiSignature: SIG2, learnerSignature: SIG2 });
  assert.equal(corrected.lesson.instructorId, tony.id);
  const second = await createLesson(db, learner.id, lessonInput(2, anna.id, { startOdometer: "112", finishOdometer: "130" }));
  assert.equal(second.lessonNo, 2);
  assert.equal(second.instructorId, anna.id);
  const totals = await getTotals(db, learner.id);
  assert.equal(totals.lessonCount, 2);
  assert.equal(totals.totalMinutes, 120);
  assert.equal((await getLearnerProgress(db, learner.id)).competencies["1"].taughtCount, 2, "progress counts both instructors' lessons");
});

test("learner edit permission moves with the learner (D5); PATCH still rejects instructorId", async () => {
  const { db, tony, anna, learner } = await setup();
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  await assert.rejects(() => updateLearner(db, learner.id, { phone: "0400 000 222", actingInstructorId: tony.id }), /belongs to Anna; only they can edit their details/);
  assert.equal((await updateLearner(db, learner.id, { phone: "0400 000 222", actingInstructorId: anna.id })).changed, true);
  const patch = new Request("http://local/api/learners/x", { method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": anna.id }, body: JSON.stringify({ instructorId: tony.id }) });
  await assert.rejects(() => patchLearner(db, learner.id, patch), /instructor cannot be changed here/);
});

// ── D7: records check ──

test("records check (D7): pending for the receiver only; only the receiver can tap Checked; idempotent; stored with who and when", async () => {
  const { db, tony, anna, learner } = await setup();
  assert.equal(pendingRecordsCheck(await getLearner(db, learner.id)), null, "never transferred: nothing to check");
  await assert.rejects(() => markTransferRecordsChecked(db, learner.id, { actingInstructorId: tony.id }), /no transfer to check/);
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  const pending = pendingRecordsCheck(await getLearner(db, learner.id));
  assert.equal(pending?.fromName, "Tony");
  await assert.rejects(() => markTransferRecordsChecked(db, learner.id, { actingInstructorId: tony.id }), (e: unknown) => e instanceof ValidationError && e.message === "Only Anna can mark the previous records as checked.");
  assert.equal((await transferRows(db))[0].records_checked_at, null);
  const checked = await markTransferRecordsChecked(db, learner.id, { actingInstructorId: anna.id, now: at("2026-10-11T03:00:00.000Z") });
  assert.equal(pendingRecordsCheck(checked), null);
  const [row] = await transferRows(db);
  assert.equal(row.records_checked_at, "2026-10-11T03:00:00.000Z");
  assert.equal(row.records_checked_by, anna.id);
  const again = await markTransferRecordsChecked(db, learner.id, { actingInstructorId: anna.id, now: at("2026-10-12T03:00:00.000Z") });
  assert.equal(again.transfers[0].recordsCheckedAt, "2026-10-11T03:00:00.000Z", "idempotent: the first check is kept");
  // Transfer back (D16): a second event, a new pending check for Tony; both stay in history.
  await transferLearner(db, learner.id, { toInstructorId: tony.id, actingInstructorId: anna.id });
  const back = await getLearner(db, learner.id);
  assert.equal(back.transfers.length, 2);
  assert.equal(pendingRecordsCheck(back)?.fromName, "Anna");
  assert.equal(await count(db, "integration_outbox"), 0, "checking enqueues nothing");
});

// ── route handlers (lib/api.ts) ──

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://local/api/learners/x/transfer", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("POST /transfer: the verified x-instructor-id header is the actor, never a body actingInstructorId; errors are ValidationErrors (400)", async () => {
  const { db, tony, anna, learner } = await setup();
  // Anna is signed in and tries to pass herself off as Tony in the body: rejected as a non-owner.
  await assert.rejects(() => postLearnerTransfer(db, learner.id, post({ toInstructorId: anna.id, actingInstructorId: tony.id }, { "x-instructor-id": anna.id })), /only they can transfer/);
  const result = (await postLearnerTransfer(db, learner.id, post({ toInstructorId: anna.id, note: "QA" }, { "x-instructor-id": tony.id }))) as { learner: { instructorId: string } };
  assert.equal(result.learner.instructorId, anna.id);
  assert.equal((await transferRows(db))[0].by_instructor_id, tony.id);
  await assert.rejects(() => postLearnerTransfer(db, learner.id, new Request("http://local", { method: "POST", body: "{not json" })), /Invalid request body/);
});

test("POST /transfer/checked: header actor; a non-receiver is rejected; the receiver's tap is stored", async () => {
  const { db, tony, anna, learner } = await setup();
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  await assert.rejects(() => postTransferRecordsChecked(db, learner.id, post({ actingInstructorId: anna.id }, { "x-instructor-id": tony.id })), /Only Anna/);
  const result = (await postTransferRecordsChecked(db, learner.id, post({}, { "x-instructor-id": anna.id }))) as { learner: { transfers: LearnerTransferEvent[] } };
  assert.equal(result.learner.transfers[0].recordsCheckedBy, anna.id);
});

test("latest transfer = SQL's tie-break (at DESC, rowid DESC): equal timestamps resolve to the later insert, in the UI and in Checked", async () => {
  const { db, tony, anna, learner } = await setup();
  const same = at("2026-10-11T05:00:00.000Z");
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id, now: same });
  await transferLearner(db, learner.id, { toInstructorId: tony.id, actingInstructorId: anna.id, now: same });
  const now = await getLearner(db, learner.id);
  assert.deepEqual(now.transfers.map((t) => t.toName), ["Anna", "Tony"]);
  assert.equal(pendingRecordsCheck(now)?.fromName, "Anna");
  const checked = await markTransferRecordsChecked(db, learner.id, { actingInstructorId: tony.id });
  assert.equal(checked.transfers[1].recordsCheckedBy, tony.id);
  assert.equal(checked.transfers[0].recordsCheckedAt, null, "the older event is never the one marked");
});

test("Checked when the owner changed outside a transfer: a clear 'reload' message, nothing written", async () => {
  const { db, tony, anna, learner } = await setup();
  await transferLearner(db, learner.id, { toInstructorId: anna.id, actingInstructorId: tony.id });
  await db.prepare("UPDATE learners SET instructor_id = ? WHERE id = ?").bind(CAROL, learner.id).run();
  await assert.rejects(() => markTransferRecordsChecked(db, learner.id, { actingInstructorId: anna.id }), (e: unknown) => e instanceof ValidationError && /instructor has changed since this transfer\. Reload/.test(e.message));
  assert.equal((await transferRows(db))[0].records_checked_at, null);
});
