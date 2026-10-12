// Learner intake P2 (migration 0012, D7/D23): storage, server validation, revisions, API plumbing, nothing to ACTGDS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearner, listLearners, updateLearner, ValidationError } from "../lib/repo.ts";
import { patchLearner } from "../lib/api.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";

const NOW = new Date("2026-10-12T02:00:00Z");
const PICKED = { address: "44 Appleford Av, Jacka ACT 2914", addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" };
const NONE = { addressSuburb: null, addressState: null, addressPostcode: null };

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "QA Address Learner", address: "1 QA Street", instructorId: tony.id }, NOW);
  return { db, tony, learner };
}
const rejects = (promise: Promise<unknown>, message: RegExp, label: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof ValidationError && message.test(e.message), label);
const parts = (l: { addressSuburb: string | null; addressState: string | null; addressPostcode: string | null }) => ({ addressSuburb: l.addressSuburb, addressState: l.addressState, addressPostcode: l.addressPostcode });
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

test("a new learner has the three parts null; create with a pick stores them; get and list return them", async () => {
  const { db, tony, learner } = await setup();
  assert.deepEqual(parts(learner), NONE);
  const created = await createLearner(db, { fullName: "QA Picked", instructorId: tony.id, ...PICKED }, NOW);
  assert.deepEqual(parts(created), { addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" });
  assert.equal(created.address, PICKED.address);
  assert.deepEqual(parts(await getLearner(db, created.id)), parts(created));
  assert.deepEqual(parts((await listLearners(db)).find((l) => l.id === created.id)!), parts(created));
  const raw = await db.prepare("SELECT address_suburb, address_state, address_postcode FROM learners WHERE id = ?").bind(created.id).first();
  assert.deepEqual({ ...raw }, { address_suburb: "Jacka", address_state: "ACT", address_postcode: "2914" });
});

test("free text without a pick always saves (create and edit), with the parts null; an unmatched address never errors", async () => {
  const { db, tony, learner } = await setup();
  const free = await createLearner(db, { fullName: "QA Free Text", instructorId: tony.id, address: "Lot 7, Unlisted Track, Nowhere" }, NOW);
  assert.equal(free.address, "Lot 7, Unlisted Track, Nowhere");
  assert.deepEqual(parts(free), NONE);
  const edited = await updateLearner(db, learner.id, { address: "99 Not In The Index Rd", addressSuburb: "", addressState: "", addressPostcode: "", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(edited.changedFields, ["address"]);
  assert.deepEqual(parts(edited.learner), NONE);
});

test("edit stores a pick, keeps it while the text still holds the suburb, and clears it (\"\" -> null); snapshots hold the previous values incl. the new keys", async () => {
  const { db, tony, learner } = await setup();
  const picked = await updateLearner(db, learner.id, { ...PICKED, actingInstructorId: tony.id }, NOW);
  assert.deepEqual(picked.changedFields.sort(), ["address", "addressPostcode", "addressState", "addressSuburb"]);
  // Text edited but the suburb is still a whole word: the parts stay.
  const kept = await updateLearner(db, learner.id, { ...PICKED, address: "Unit 2, 44 Appleford Av, Jacka ACT 2914", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(kept.changedFields, ["address"]);
  assert.deepEqual(parts(kept.learner), { addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" });
  // The form clears the parts once the suburb is gone; the server stores the nulls.
  const cleared = await updateLearner(db, learner.id, { address: "44 Appleford Av", addressSuburb: "", addressState: "", addressPostcode: "", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(cleared.changedFields.sort(), ["address", "addressPostcode", "addressState", "addressSuburb"]);
  assert.deepEqual(parts(cleared.learner), NONE);
  const rows = (await db.prepare("SELECT snapshot_json FROM learner_revisions WHERE learner_id = ? ORDER BY revision_no").bind(learner.id).all<{ snapshot_json: string }>()).results;
  assert.equal(rows.length, 3);
  const first = JSON.parse(rows[0].snapshot_json);
  assert.deepEqual(first, {
    fullName: "QA Address Learner", address: "1 QA Street", phone: null, dob: null, licenceNumber: null, licenceExpiry: null, eligibility: null, transmission: null, schoolWork: null,
    licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    addressSuburb: null, addressState: null, addressPostcode: null,
  });
  assert.deepEqual(JSON.parse(rows[1].snapshot_json), { ...first, ...PICKED });
  assert.deepEqual(JSON.parse(rows[2].snapshot_json), { ...first, ...PICKED, address: "Unit 2, 44 Appleford Av, Jacka ACT 2914" });
});

test("D7 validation on edit and create: all three or none, 4-digit postcode, state list, suburb <= 60, suburb must be in the text; a rejected edit writes nothing", async () => {
  const { db, tony, learner } = await setup();
  const edit = (patch: Record<string, unknown>) => updateLearner(db, learner.id, { ...patch, actingInstructorId: tony.id }, NOW);
  await rejects(edit({ address: "44 Appleford Av, Jacka", addressSuburb: "Jacka" }), /go together/, "suburb alone");
  await rejects(edit({ address: "44 Appleford Av, Jacka", addressSuburb: "Jacka", addressState: "ACT" }), /go together/, "no postcode");
  await rejects(edit({ ...PICKED, addressPostcode: "291" }), /4 digits/, "3-digit postcode");
  await rejects(edit({ ...PICKED, addressState: "AC" }), /state must be one of/, "bad state");
  await rejects(edit({ ...PICKED, addressSuburb: "J".repeat(61), address: `1 X St, ${"J".repeat(61)}` }), /1 to 60 characters/, "long suburb");
  await rejects(edit({ ...PICKED, address: "44 Appleford Av" }), /must contain the suburb "Jacka"/, "suburb not in the text");
  await rejects(edit({ ...PICKED, address: "44 Appleford Av, Jackal" }), /must contain the suburb/, "not a whole word");
  assert.equal(await count(db, "learner_revisions"), 0, "rejected edits write nothing");
  assert.equal((await getLearner(db, learner.id)).address, "1 QA Street");
  // Lower-case state and padded values are normalised, and a re-send of the normalised values is a no-op.
  const normalised = await edit({ ...PICKED, addressState: " act ", addressSuburb: " Jacka " });
  assert.deepEqual(parts(normalised.learner), { addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" });
  assert.equal((await edit({ ...PICKED })).changed, false);
  assert.equal((await edit({ ...PICKED, addressState: "act" })).changed, false, "a differently-cased state is the same stored value");
  // Create is strict the same way, through the same code.
  const make = (extra: Record<string, unknown>) => createLearner(db, { fullName: "QA Bad", instructorId: tony.id, ...extra }, NOW);
  await rejects(make({ addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" }), /must contain the suburb/, "create without the text");
  await rejects(make({ address: "x Jacka", addressSuburb: "Jacka" }), /go together/, "create suburb alone");
  await rejects(make({ ...PICKED, addressPostcode: "29x4" }), /4 digits/, "create bad postcode");
  assert.deepEqual(parts(await make({ ...PICKED, addressState: "act" })), { addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" });
});

test("an unrelated edit is never blocked by stored parts (only touched keys are checked); changing the text so the suburb is gone IS checked", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { ...PICKED, actingInstructorId: tony.id }, NOW);
  // Simulate older data that would fail today's rule (stored directly), then an unrelated edit.
  await db.prepare("UPDATE learners SET address = 'moved away' WHERE id = ?").bind(learner.id).run();
  const unrelated = await updateLearner(db, learner.id, { phone: "0400 222 333", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(unrelated.changedFields, ["phone"]);
  // Re-sending the parts unchanged with an unrelated change is fine too (the form re-sends every field).
  const resend = await updateLearner(db, learner.id, { phone: "0400 222 334", address: "moved away", addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(resend.changedFields, ["phone"]);
  // Changing the address text while keeping stale parts is rejected: the client must clear them (D7).
  await rejects(updateLearner(db, learner.id, { address: "somewhere else", addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914", actingInstructorId: tony.id }, NOW), /must contain the suburb/, "stale parts with new text");
});

test("PATCH plumbing: the parts travel through patchLearner with the other fields; GET-shaped results include them", async () => {
  const { db, tony, learner } = await setup();
  const request = (body: unknown) => new Request("https://x.example/api/learners/1", { method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": tony.id }, body: JSON.stringify(body) });
  const result = (await patchLearner(db, learner.id, request(PICKED))) as { learner: { addressSuburb: string | null }; changed: boolean };
  assert.equal(result.changed, true);
  assert.equal(result.learner.addressSuburb, "Jacka");
  await assert.rejects(() => patchLearner(db, learner.id, request({ ...PICKED, addressPostcode: "12" })), (e: unknown) => e instanceof ValidationError && /4 digits/.test(e.message));
});

test("D23 ACTGDS: the parts never reach the outbox; a lesson.upserted payload has exactly the contract's keys and no address key at any level", async () => {
  const { db, tony, learner } = await setup();
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
    schedule: () => {},
  };
  await updateLearner(db, learner.id, { ...PICKED, actingInstructorId: tony.id }, NOW);
  assert.equal(await count(db, "integration_outbox"), 0, "a learner edit enqueues nothing");
  await createLesson(db, learner.id, { lessonDate: "2026-10-12", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["1"], adiSignature: "data:image/png;base64,iVBORw0KGgoAAAA1", learnerSignature: "data:image/png;base64,iVBORw0KGgoAAAA1" }, hooks);
  const rows = (await db.prepare("SELECT payload_json FROM integration_outbox").all<{ payload_json: string }>()).results;
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload_json) as Record<string, unknown>;
  const keyPaths = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [`${prefix}${k}`, ...keyPaths(v, `${prefix}${k}.`)]) : [];
  assert.deepEqual(keyPaths(payload).sort(), [
    "contract_version", "event_id", "event_type", "instructor", "instructor.display_name", "instructor.instructor_id", "learner", "learner.learner_id",
    "lesson", "lesson.achieved", "lesson.assessed", "lesson.cumulative_km", "lesson.cumulative_minutes", "lesson.distance_km", "lesson.duration_minutes", "lesson.finish_time",
    "lesson.lesson_date", "lesson.lesson_id", "lesson.lesson_number", "lesson.source_updated_at", "lesson.start_time", "lesson.taught", "occurred_at",
    "progress", "progress.achieved_count", "progress.cbta_status", "progress.final_drive_23", "progress.review_1_17", "progress.review_1_22", "progress.total_competencies",
    "source", "source.environment", "source.system",
  ]);
  assert.ok(!/address|suburb|postcode|Jacka|2914/i.test(rows[0].payload_json), "no address data in the payload bytes");
});
