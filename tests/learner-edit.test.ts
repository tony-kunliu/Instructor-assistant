// Learner management Phase 1 (plan 2026-10-08, L1-L6): edit learner details with ownership + revisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearner, listLearners, setLearnerArchived, updateLearner, ValidationError, NotFoundError } from "../lib/repo.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const anna = (await findInstructorByEmail(db, "yapingqu.work@gmail.com"))!;
  const learner = await createLearner(db, {
    fullName: "QA Original Name", address: "1 Test St", phone: "0400 000 001", dob: "2008-05-06", licenceNumber: "QA123",
    licenceExpiry: "2027-01-02", eligibility: "Eligible", transmission: "manual", schoolWork: "QA College", instructorId: tony.id,
  });
  return { db, tony, anna, learner };
}
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);
const rawLearner = (db: D1Database, id: string) => db.prepare("SELECT * FROM learners WHERE id = ?").bind(id).first();

test("owner can edit every editable field; instructor, archive state and id are unchanged", async () => {
  const { db, tony, learner } = await setup();
  const result = await updateLearner(db, learner.id, {
    fullName: "QA Renamed", address: "2 Test Rd", phone: "0400 000 002", dob: "2008-06-07", licenceNumber: "QA999", licenceExpiry: "2028-02-03",
    eligibility: "Other", transmission: "auto", schoolWork: "QA High", licenceStage: "p1", actingInstructorId: tony.id,
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.changedFields.sort(), ["address", "dob", "eligibility", "fullName", "licenceExpiry", "licenceNumber", "licenceStage", "phone", "schoolWork", "transmission"]);
  const fresh = await getLearner(db, learner.id);
  assert.deepEqual(
    { ...fresh },
    { ...learner, fullName: "QA Renamed", address: "2 Test Rd", phone: "0400 000 002", dob: "2008-06-07", licenceNumber: "QA999", licenceExpiry: "2028-02-03", eligibility: "Other", transmission: "auto", schoolWork: "QA High", licenceStage: "p1" },
  );
  assert.deepEqual(result.learner, fresh);
});

test("omitted fields stay unchanged; empty string clears to null (same semantics as create)", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { phone: "", address: "  ", transmission: "", actingInstructorId: tony.id });
  const fresh = await getLearner(db, learner.id);
  assert.equal(fresh.phone, null);
  assert.equal(fresh.address, null);
  assert.equal(fresh.transmission, null);
  assert.equal(fresh.fullName, "QA Original Name");
  assert.equal(fresh.dob, "2008-05-06");
  const created = await createLearner(db, { fullName: "QA Same Rules", phone: "", address: "  ", instructorId: tony.id });
  assert.equal(created.phone, null);
  assert.equal(created.address, null);
});

test("values are trimmed and truncated exactly like create", async () => {
  const { db, tony, learner } = await setup();
  const long = "x".repeat(500);
  await updateLearner(db, learner.id, { fullName: `  ${long}  `, address: long, phone: long, licenceNumber: long, eligibility: long, schoolWork: long, actingInstructorId: tony.id });
  const edited = await getLearner(db, learner.id);
  const created = await createLearner(db, { fullName: long, address: long, phone: long, licenceNumber: long, eligibility: long, schoolWork: long, instructorId: tony.id });
  for (const key of ["fullName", "address", "phone", "licenceNumber", "eligibility", "schoolWork"] as const) assert.equal(edited[key], created[key], key);
  assert.equal(edited.fullName!.length, 120);
});

test("non-owner is rejected with a clear message and NOTHING is written", async () => {
  const { db, anna, learner } = await setup();
  const before = await rawLearner(db, learner.id);
  await assert.rejects(
    () => updateLearner(db, learner.id, { fullName: "QA Hijack", actingInstructorId: anna.id }),
    (e: unknown) => e instanceof ValidationError && e.message === "This learner belongs to Tony; only they can edit their details.",
  );
  assert.deepEqual(await rawLearner(db, learner.id), before);
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("without an acting instructor (local dev / tests) anyone may edit, revision has no editor", async () => {
  const { db, learner } = await setup();
  await updateLearner(db, learner.id, { fullName: "QA Dev Edit" });
  const rev = await db.prepare("SELECT edited_by_instructor_id FROM learner_revisions").first<Record<string, unknown>>();
  assert.equal(rev!.edited_by_instructor_id, null);
});

test("an unknown acting instructor is rejected and nothing is written", async () => {
  const { db, learner } = await setup();
  await assert.rejects(() => updateLearner(db, learner.id, { fullName: "QA X", actingInstructorId: "nobody" }), /Acting instructor not found/);
  assert.equal((await getLearner(db, learner.id)).fullName, "QA Original Name");
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("snapshot holds the PREVIOUS values of all editable fields; revision_no increments; editor and time recorded", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { fullName: "QA Second", phone: "0400 111 111", actingInstructorId: tony.id });
  await updateLearner(db, learner.id, { fullName: "QA Third", actingInstructorId: tony.id });
  const rows = (await db.prepare("SELECT * FROM learner_revisions WHERE learner_id = ? ORDER BY revision_no").bind(learner.id).all<Record<string, string>>()).results;
  assert.deepEqual(rows.map((r) => r.revision_no), [1, 2]);
  assert.equal(rows[0].edited_by_instructor_id, tony.id);
  assert.match(rows[0].edited_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(rows[0].snapshot_json), {
    fullName: "QA Original Name", address: "1 Test St", phone: "0400 000 001", dob: "2008-05-06", licenceNumber: "QA123",
    licenceExpiry: "2027-01-02", eligibility: "Eligible", transmission: "manual", schoolWork: "QA College", licenceStage: "learner",
    learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    addressSuburb: null, addressState: null, addressPostcode: null,
  });
  assert.equal(JSON.parse(rows[1].snapshot_json).fullName, "QA Second");
  assert.equal(JSON.parse(rows[1].snapshot_json).phone, "0400 111 111");
});

test("a no-op edit writes no revision, does not touch updated_at, and says so", async () => {
  const { db, tony, learner } = await setup();
  const before = await rawLearner(db, learner.id);
  const result = await updateLearner(db, learner.id, { fullName: " QA Original Name ", phone: "0400 000 001", transmission: "manual", actingInstructorId: tony.id });
  assert.equal(result.changed, false);
  assert.deepEqual(result.changedFields, []);
  assert.equal(await count(db, "learner_revisions"), 0);
  assert.deepEqual(await rawLearner(db, learner.id), before);
});

test("a real edit sets learners.updated_at", async () => {
  const { db, tony, learner } = await setup();
  await db.prepare("UPDATE learners SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(learner.id).run();
  await updateLearner(db, learner.id, { fullName: "QA Touch", actingInstructorId: tony.id });
  const row = await db.prepare("SELECT updated_at FROM learners WHERE id = ?").bind(learner.id).first<{ updated_at: string }>();
  assert.ok(row!.updated_at > "2020-01-01");
});

test("the revision and the UPDATE commit in ONE db.batch(): a forced failure leaves neither", async () => {
  const { db, tony, learner } = await setup();
  const before = await rawLearner(db, learner.id);
  let batches = 0;
  const failing: D1Database = { prepare: (q) => db.prepare(q), exec: (q) => db.exec(q), batch: async () => { batches++; throw new Error("simulated D1 batch failure"); } };
  await assert.rejects(() => updateLearner(failing, learner.id, { fullName: "QA Fail", actingInstructorId: tony.id }), /simulated/);
  assert.equal(batches, 1);
  assert.deepEqual(await rawLearner(db, learner.id), before);
  assert.equal(await count(db, "learner_revisions"), 0);
  // A real batch whose LAST statement fails rolls the revision and the update back.
  const sabotage: D1Database = {
    prepare: (q) => db.prepare(q), exec: (q) => db.exec(q),
    batch: (statements) => db.batch([...statements, db.prepare("INSERT INTO learners (id) VALUES ('boom')")]),
  };
  await assert.rejects(() => updateLearner(sabotage, learner.id, { fullName: "QA Fail 2", actingInstructorId: tony.id }));
  assert.deepEqual(await rawLearner(db, learner.id), before);
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("validation errors write nothing", async () => {
  const { db, tony, learner } = await setup();
  const before = await rawLearner(db, learner.id);
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ fullName: "   " }, /Student name is required/],
    [{ fullName: "" }, /Student name is required/],
    [{ dob: "06/05/2008" }, /Date of birth must be a valid date/],
    [{ licenceExpiry: "not a date" }, /Licence expiry must be a valid date/],
    [{ dob: "2008-13-45" }, /Date of birth must be a valid date/],
    [{ licenceExpiry: "2026-02-30" }, /Licence expiry must be a valid date/],
    [{ transmission: "cvt" }, /Transmission must be/],
    [{ licenceStage: "pro" }, /Licence stage must be/],
    [{ instructorId: "someone-else" }, /instructor cannot be changed/i],
    [{}, /Nothing to change/],
  ];
  for (const [patch, message] of bad) {
    await assert.rejects(() => updateLearner(db, learner.id, { ...patch, actingInstructorId: tony.id }), (e: unknown) => e instanceof ValidationError && message.test(e.message), JSON.stringify(patch));
  }
  assert.deepEqual(await rawLearner(db, learner.id), before);
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("a missing learner is NotFound", async () => {
  const { db, tony } = await setup();
  await assert.rejects(() => updateLearner(db, "missing", { fullName: "QA", actingInstructorId: tony.id }), NotFoundError);
});

test("archived learners can still be edited (rule: allowed), and stay archived", async () => {
  const { db, tony, learner } = await setup();
  await setLearnerArchived(db, learner.id, true);
  const result = await updateLearner(db, learner.id, { fullName: "QA Archived Rename", actingInstructorId: tony.id });
  assert.equal(result.learner.fullName, "QA Archived Rename");
  assert.ok(result.learner.archivedAt);
  assert.equal((await listLearners(db)).length, 0);
  assert.equal((await listLearners(db, { archived: true }))[0].fullName, "QA Archived Rename");
});

test("ACTGDS: an edit enqueues nothing in integration_outbox and existing outbox rows are untouched", async () => {
  const { db, tony, learner } = await setup();
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
    schedule: () => {},
  };
  await createLesson(db, learner.id, {
    lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: "0", finishOdometer: "10", taughtIds: ["1"],
    adiSignature: "data:image/png;base64,iVBORw0KGgoAAAA1", learnerSignature: "data:image/png;base64,iVBORw0KGgoAAAA1", actingInstructorId: tony.id,
  }, hooks);
  const outboxBefore = (await db.prepare("SELECT * FROM integration_outbox ORDER BY id").all()).results;
  assert.equal(outboxBefore.length, 1);
  await updateLearner(db, learner.id, { fullName: "QA Renamed After Lesson", actingInstructorId: tony.id });
  assert.deepEqual((await db.prepare("SELECT * FROM integration_outbox ORDER BY id").all()).results, outboxBefore);
  assert.ok(!JSON.stringify(outboxBefore).includes("Renamed"));
});

// ── PATCH /api/learners/[id] body handling (lib/api.ts#patchLearner) ──
import { patchLearner } from "../lib/api.ts";

function patchRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://instructor-assistant.example/api/learners/x", { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("PATCH {archived} keeps its behaviour (archive / restore, no revision)", async () => {
  const { db, learner } = await setup();
  const archived = (await patchLearner(db, learner.id, patchRequest({ archived: true }))) as { learner: { archivedAt: string | null } };
  assert.ok(archived.learner.archivedAt);
  const restored = (await patchLearner(db, learner.id, patchRequest({ archived: false }))) as { learner: { archivedAt: string | null } };
  assert.equal(restored.learner.archivedAt, null);
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("PATCH with learner fields edits; the actor comes from x-instructor-id, never from the body", async () => {
  const { db, tony, anna, learner } = await setup();
  // Signed in as Anna: a body claiming to be Tony is overridden by the header, so the edit is rejected.
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ fullName: "QA Spoof", actingInstructorId: tony.id }, { "x-instructor-id": anna.id })), /only they can edit/);
  assert.equal((await getLearner(db, learner.id)).fullName, "QA Original Name");
  // Signed in as Tony: allowed, even when the body claims to be Anna.
  const ok = (await patchLearner(db, learner.id, patchRequest({ fullName: "QA By Header", actingInstructorId: anna.id }, { "x-instructor-id": tony.id }))) as { learner: { fullName: string }; changed: boolean };
  assert.equal(ok.learner.fullName, "QA By Header");
  assert.equal(ok.changed, true);
  const rev = await db.prepare("SELECT edited_by_instructor_id FROM learner_revisions").first<Record<string, unknown>>();
  assert.equal(rev!.edited_by_instructor_id, tony.id);
});

test("PATCH no-op reports changed:false with a message; archived + fields together and bad bodies are rejected", async () => {
  const { db, tony, learner } = await setup();
  const noop = (await patchLearner(db, learner.id, patchRequest({ fullName: "QA Original Name" }, { "x-instructor-id": tony.id }))) as { changed: boolean; message: string };
  assert.equal(noop.changed, false);
  assert.match(noop.message, /No changes/);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ archived: true, fullName: "QA X" })), /either/i);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({})), /archived/);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ archived: "yes" })), /archived/);
  await assert.rejects(() => patchLearner(db, learner.id, patchRequest({ fullName: "QA X", instructorId: "other" })), /instructor cannot be changed/i);
  assert.equal(await count(db, "learner_revisions"), 0);
});

test("a legacy impossible date already stored does not block an unrelated edit, but cannot be newly entered", async () => {
  const { db, tony, learner } = await setup();
  await db.prepare("UPDATE learners SET dob = ? WHERE id = ?").bind("2008-02-30", learner.id).run();
  const result = await updateLearner(db, learner.id, { phone: "0400 111 222", dob: "2008-02-30", actingInstructorId: tony.id });
  assert.equal(result.changed, true);
  assert.deepEqual(result.changedFields, ["phone"]);
  assert.equal((await getLearner(db, learner.id)).dob, "2008-02-30");
  await assert.rejects(updateLearner(db, learner.id, { dob: "2008-02-31", actingInstructorId: tony.id }), /Date of birth must be a valid date/);
});
