// Learner management Phase 3b: archive reason + restore history (migration 0010).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { patchLearner } from "../lib/api.ts";
import {
  createLearner,
  createLesson,
  findInstructorByEmail,
  getLearner,
  listLearnerArchiveEvents,
  listLearners,
  NotFoundError,
  setLearnerArchived,
  updateLearner,
  ValidationError,
} from "../lib/repo.ts";
import { ARCHIVE_REASONS, archiveReasonLabel, archiveReasonText, parseArchiveNote, parseArchiveReason } from "../lib/archive-reasons.ts";

const TONY_EMAIL = "Kunliu.work@gmail.com";
const ANNA_EMAIL = "yapingqu.work@gmail.com";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, TONY_EMAIL))!;
  const anna = (await findInstructorByEmail(db, ANNA_EMAIL))!;
  const learner = await createLearner(db, { fullName: "QA Archive Reason", instructorId: tony.id });
  return { db, tony, anna, learner };
}

type Row = Record<string, unknown>;
const events = async (db: D1Database) => (await db.prepare("SELECT * FROM learner_archive_events ORDER BY at, rowid").all<Row>()).results;
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);
const at = (iso: string) => new Date(iso);

// ── lib/archive-reasons.ts ──

test("presets: fixed keys and labels; parse accepts only those keys, empty = no reason", () => {
  assert.deepEqual(ARCHIVE_REASONS.map((r) => `${r.value}=${r.label}`), [
    "completed_licence=Completed / licensed",
    "stopped=Stopped learning",
    "moved_away=Moved away",
    "transferred=Went to another instructor",
    "other=Other",
  ]);
  for (const r of ARCHIVE_REASONS) assert.equal(parseArchiveReason(r.value), r.value);
  for (const empty of [undefined, null, ""]) assert.equal(parseArchiveReason(empty), null);
  for (const bad of ["Moved away", "MOVED_AWAY", "deleted", 3, true]) assert.throws(() => parseArchiveReason(bad), /Unknown archive reason/);
});

test("note: trimmed, control characters replaced, empty = null, > 200 chars rejected, non-text rejected", () => {
  assert.equal(parseArchiveNote("  Moved to Sydney  "), "Moved to Sydney");
  assert.equal(parseArchiveNote("line1\nline2\t\u0000x\u007f"), "line1 line2  x");
  assert.equal(parseArchiveNote("   \n "), null);
  assert.equal(parseArchiveNote(undefined), null);
  assert.equal(parseArchiveNote(null), null);
  assert.equal(parseArchiveNote(`  ${"a".repeat(200)}  `), "a".repeat(200));
  assert.throws(() => parseArchiveNote("a".repeat(201)), /200 characters/);
  assert.throws(() => parseArchiveNote(42), /must be text/);
});

test("display text: label[: note], note alone, unknown stored key shown as-is, nothing known = null", () => {
  assert.equal(archiveReasonText("moved_away", "Sydney"), "Moved away: Sydney");
  assert.equal(archiveReasonText("stopped", null), "Stopped learning");
  assert.equal(archiveReasonText(null, "Just a note"), "Just a note");
  assert.equal(archiveReasonText(null, null), null);
  assert.equal(archiveReasonLabel("legacy_key"), "legacy_key");
});

// ── repo: setLearnerArchived + read side ──

test("archive with a reason and note: one 'archived' event with actor; the learner (get + archived list) shows reason and note", async () => {
  const { db, tony, learner } = await setup();
  const archived = await setLearnerArchived(db, learner.id, true, { reason: "moved_away", note: "  Moved to Sydney\n ", actingInstructorId: tony.id, now: at("2026-10-11T01:02:03.004Z") });
  assert.equal(archived.archivedAt, "2026-10-11T01:02:03.004Z", "archived_at equals the event time");
  assert.equal(archived.archiveReason, "moved_away");
  assert.equal(archived.archiveNote, "Moved to Sydney");
  const rows = await events(db);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], id: "x" }, { id: "x", learner_id: learner.id, action: "archived", reason: "moved_away", note: "Moved to Sydney", at: "2026-10-11T01:02:03.004Z", by_instructor_id: tony.id });
  const [listed] = await listLearners(db, { archived: true });
  assert.deepEqual([listed.archiveReason, listed.archiveNote], ["moved_away", "Moved to Sydney"]);
});

test("archive without a reason works as before: event with NULL reason/note; learner shows no reason", async () => {
  const { db, learner } = await setup();
  const archived = await setLearnerArchived(db, learner.id, true);
  assert.ok(archived.archivedAt);
  assert.deepEqual([archived.archiveReason, archived.archiveNote], [null, null]);
  const rows = await events(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].action, rows[0].reason, rows[0].note, rows[0].by_instructor_id], ["archived", null, null, null]);
});

test("invalid reason / too-long note / reason on restore: ValidationError, nothing changes", async () => {
  const { db, learner } = await setup();
  await assert.rejects(() => setLearnerArchived(db, learner.id, true, { reason: "deleted" }), (e: unknown) => e instanceof ValidationError && /Unknown archive reason/.test(e.message));
  await assert.rejects(() => setLearnerArchived(db, learner.id, true, { note: "x".repeat(201) }), ValidationError);
  assert.equal((await getLearner(db, learner.id)).archivedAt, null);
  await setLearnerArchived(db, learner.id, true);
  await assert.rejects(() => setLearnerArchived(db, learner.id, false, { reason: "stopped" }), /only be given when archiving/);
  await assert.rejects(() => setLearnerArchived(db, learner.id, false, { note: "why" }), /only be given when archiving/);
  assert.ok((await getLearner(db, learner.id)).archivedAt);
  assert.equal(await count(db, "learner_archive_events"), 1);
});

test("idempotency: re-archiving an archived learner or restoring an active one writes no event and keeps the original reason/time", async () => {
  const { db, learner } = await setup();
  await setLearnerArchived(db, learner.id, false);
  assert.equal(await count(db, "learner_archive_events"), 0, "restoring an active learner: no event");
  const first = await setLearnerArchived(db, learner.id, true, { reason: "stopped", now: at("2026-10-01T00:00:00.000Z") });
  const again = await setLearnerArchived(db, learner.id, true, { reason: "other", note: "second try", now: at("2026-10-02T00:00:00.000Z") });
  assert.equal(again.archivedAt, first.archivedAt);
  assert.deepEqual([again.archiveReason, again.archiveNote], ["stopped", null]);
  assert.equal(await count(db, "learner_archive_events"), 1);
});

test("restore records a 'restored' event (no reason) and clears the shown reason; a later archive without reason never shows the old one", async () => {
  const { db, tony, anna, learner } = await setup();
  await setLearnerArchived(db, learner.id, true, { reason: "transferred", note: "QA note", actingInstructorId: tony.id, now: at("2026-10-01T00:00:00.000Z") });
  const restored = await setLearnerArchived(db, learner.id, false, { actingInstructorId: anna.id, now: at("2026-10-02T00:00:00.000Z") });
  assert.equal(restored.archivedAt, null);
  assert.deepEqual([restored.archiveReason, restored.archiveNote], [null, null]);
  const rearchived = await setLearnerArchived(db, learner.id, true, { now: at("2026-10-03T00:00:00.000Z") });
  assert.equal(rearchived.archivedAt, "2026-10-03T00:00:00.000Z");
  assert.deepEqual([rearchived.archiveReason, rearchived.archiveNote], [null, null]);
  const history = await listLearnerArchiveEvents(db, learner.id);
  assert.deepEqual(history.map((e) => [e.action, e.reason, e.note, e.at.slice(0, 10), e.byName]), [
    ["archived", null, null, "2026-10-03", null],
    ["restored", null, null, "2026-10-02", anna.fullName],
    ["archived", "transferred", "QA note", "2026-10-01", tony.fullName],
  ]);
  assert.equal(history[1].byInstructorId, anna.id);
  assert.equal(history[2].byInstructorId, tony.id);
});

test("history: newest first (same timestamp broken by insert order); [] when none; unknown learner = NotFoundError", async () => {
  const { db, learner } = await setup();
  assert.deepEqual(await listLearnerArchiveEvents(db, learner.id), []);
  const same = at("2026-10-05T00:00:00.000Z");
  await setLearnerArchived(db, learner.id, true, { reason: "other", now: same });
  await setLearnerArchived(db, learner.id, false, { now: same });
  assert.deepEqual((await listLearnerArchiveEvents(db, learner.id)).map((e) => e.action), ["restored", "archived"]);
  await assert.rejects(() => listLearnerArchiveEvents(db, "no-such-learner"), NotFoundError);
});

test("a learner archived before 0010 (no event) shows no reason, never an invented one; restoring it adds a 'restored' event", async () => {
  const { db, learner } = await setup();
  await db.prepare("UPDATE learners SET archived_at = '2026-09-01T00:00:00.000Z' WHERE id = ?").bind(learner.id).run();
  const legacy = await getLearner(db, learner.id);
  assert.deepEqual([legacy.archivedAt, legacy.archiveReason, legacy.archiveNote], ["2026-09-01T00:00:00.000Z", null, null]);
  assert.deepEqual(await listLearnerArchiveEvents(db, learner.id), []);
  await setLearnerArchived(db, learner.id, false);
  assert.deepEqual((await listLearnerArchiveEvents(db, learner.id)).map((e) => e.action), ["restored"]);
});

test("an unknown actor id is recorded as NULL (never a foreign-key failure); an unknown learner is NotFoundError with no event", async () => {
  const { db, learner } = await setup();
  await setLearnerArchived(db, learner.id, true, { actingInstructorId: "not-an-instructor" });
  assert.equal((await events(db))[0].by_instructor_id, null);
  await assert.rejects(() => setLearnerArchived(db, "no-such-learner", true, { reason: "stopped" }), NotFoundError);
  assert.equal(await count(db, "learner_archive_events"), 1);
});

test("the event INSERT and the UPDATE commit in ONE db.batch(): a forced failure leaves neither", async () => {
  const { db, learner } = await setup();
  let batches = 0;
  const failing: D1Database = { prepare: (q) => db.prepare(q), exec: (q) => db.exec(q), batch: async () => { batches++; throw new Error("simulated D1 batch failure"); } };
  await assert.rejects(() => setLearnerArchived(failing, learner.id, true, { reason: "stopped" }), /simulated/);
  assert.equal(batches, 1);
  const sabotage: D1Database = { prepare: (q) => db.prepare(q), exec: (q) => db.exec(q), batch: (s) => db.batch([...s, db.prepare("INSERT INTO learners (id) VALUES ('boom')")]) };
  await assert.rejects(() => setLearnerArchived(sabotage, learner.id, true, { reason: "stopped" }));
  assert.equal((await getLearner(db, learner.id)).archivedAt, null);
  assert.equal(await count(db, "learner_archive_events"), 0);
});

test("archive/restore leaves learner_revisions, lessons and the outbox untouched; editing an archived learner keeps the reason", async () => {
  const { db, tony, learner } = await setup();
  await createLesson(db, learner.id, { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"], adiSignature: SIG, learnerSignature: SIG });
  const lessonsBefore = (await db.prepare("SELECT * FROM lessons").all<Row>()).results;
  const outboxBefore = await count(db, "integration_outbox");
  await setLearnerArchived(db, learner.id, true, { reason: "completed_licence", actingInstructorId: tony.id });
  assert.equal(await count(db, "learner_revisions"), 0, "archiving is not a learner edit");
  const edited = await updateLearner(db, learner.id, { fullName: "QA Archive Reason Renamed", actingInstructorId: tony.id });
  assert.equal(edited.learner.archiveReason, "completed_licence");
  assert.equal(await count(db, "learner_revisions"), 1);
  await setLearnerArchived(db, learner.id, false);
  assert.deepEqual((await db.prepare("SELECT * FROM lessons").all<Row>()).results, lessonsBefore);
  assert.equal(await count(db, "integration_outbox"), outboxBefore, "nothing enqueued for ACTGDS");
  assert.equal(await count(db, "learner_revisions"), 1);
});

// ── PATCH /api/learners/[id] (lib/api.ts#patchLearner) ──

function patchRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://instructor-assistant.example/api/learners/x", { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("PATCH {archived:true, reason, note}: stored with the verified header actor, never a body-claimed one", async () => {
  const { db, tony, anna, learner } = await setup();
  const result = (await patchLearner(db, learner.id, patchRequest({ archived: true, reason: "moved_away", note: " QA ", actingInstructorId: anna.id }, { "x-instructor-id": tony.id }))) as { learner: { archiveReason: string; archiveNote: string } };
  assert.deepEqual([result.learner.archiveReason, result.learner.archiveNote], ["moved_away", "QA"]);
  assert.equal((await events(db))[0].by_instructor_id, tony.id);
});

test("PATCH: {archived:true} alone still works; bad reason, reason with restore, reason with learner fields are 400s", async () => {
  const { db, learner } = await setup();
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ archived: true, reason: "nope" })), (e: unknown) => e instanceof ValidationError);
  assert.equal(await count(db, "learner_archive_events"), 0);
  const plain = (await patchLearner(db, learner.id, patchRequest({ archived: true }))) as { learner: { archivedAt: string | null; archiveReason: string | null } };
  assert.ok(plain.learner.archivedAt);
  assert.equal(plain.learner.archiveReason, null);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ archived: false, reason: "stopped" })), /only be given when archiving/);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ fullName: "QA X", reason: "stopped" })), /only be given when archiving/);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ reason: "stopped" })), /archived/);
  assert.equal(await count(db, "learner_archive_events"), 1);
});
