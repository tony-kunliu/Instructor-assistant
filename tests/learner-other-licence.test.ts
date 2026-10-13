// Learner intake P3 (migration 0013, D11-D14, D23): storage, server validation, revisions, API plumbing, nothing to ACTGDS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearner, listLearners, updateLearner, ValidationError } from "../lib/repo.ts";
import { patchLearner } from "../lib/api.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import { COUNTRIES, OTHER_LICENCE_KEYS, validateOtherLicence } from "../lib/other-licence.ts";
import { finalDriveEligibilityReminder } from "../lib/rules.ts";
import { pdfEligibility } from "../lib/c23-eligibility.ts";

const NOW = new Date("2026-10-13T02:00:00Z"); // 2026-10-13 in Canberra
const NSW = { otherLicenceKind: "interstate", otherLicencePlace: "NSW", otherLicenceNumber: "QA NSW 1", otherLicenceClass: "learner", otherLicenceIssuedOn: "2025-10-13", otherLicenceExpiresOn: "2030-10-13" };
const NONE = { otherLicenceKind: null, otherLicencePlace: null, otherLicenceNumber: null, otherLicenceClass: null, otherLicenceIssuedOn: null, otherLicenceExpiresOn: null };

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "QA Other Licence Learner", dob: "2008-05-06", instructorId: tony.id }, NOW);
  return { db, tony, learner };
}
const rejects = (promise: Promise<unknown>, message: RegExp, label: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof ValidationError && message.test(e.message), label);
const other = (l: Record<string, unknown>) => Object.fromEntries(OTHER_LICENCE_KEYS.map((key) => [key, l[key]]));
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

test("a new learner has the six fields null; create stores them; get and list return them; the number is upper-cased", async () => {
  const { db, tony, learner } = await setup();
  assert.deepEqual(other(learner), NONE);
  const created = await createLearner(db, { fullName: "QA NSW Learner", dob: "2008-05-06", instructorId: tony.id, ...NSW, otherLicenceNumber: "qa nsw 1" }, NOW);
  assert.deepEqual(other(created), NSW);
  assert.deepEqual(other(await getLearner(db, created.id)), NSW);
  assert.deepEqual(other((await listLearners(db)).find((l) => l.id === created.id)!), NSW);
  const raw = await db.prepare("SELECT other_licence_kind, other_licence_place, other_licence_number, other_licence_class, other_licence_issued_on, other_licence_expires_on FROM learners WHERE id = ?").bind(created.id).first();
  assert.deepEqual({ ...raw }, { other_licence_kind: "interstate", other_licence_place: "NSW", other_licence_number: "QA NSW 1", other_licence_class: "learner", other_licence_issued_on: "2025-10-13", other_licence_expires_on: "2030-10-13" });
  // The rule reads the stored learner directly: 12 months counted from the NSW licence.
  assert.match(finalDriveEligibilityReminder({ ...created, hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01", learnerLicenceIssuedOn: "2026-03-01" }, "2026-10-12").text, /licence held 12 months on 13 Oct 2026 \(counted from the NSW learner licence, school rule\)/);
});

test("edit sets, changes and clears the fields; 'No' with cleared details stores none; snapshots hold the previous values incl. the new keys; old snapshots read as null", async () => {
  const { db, tony, learner } = await setup();
  const first = await updateLearner(db, learner.id, { ...NSW, actingInstructorId: tony.id }, NOW);
  assert.deepEqual(first.changedFields.sort(), [...OTHER_LICENCE_KEYS].sort());
  const changed = await updateLearner(db, learner.id, { otherLicenceClass: "full", otherLicenceExpiresOn: "", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(changed.changedFields.sort(), ["otherLicenceClass", "otherLicenceExpiresOn"]);
  assert.deepEqual(other(changed.learner), { ...NSW, otherLicenceClass: "full", otherLicenceExpiresOn: null });
  // The form's "No": kind none + every detail "" -> stored as none + nulls; the old values stay in the revision history (D12).
  const no = await updateLearner(db, learner.id, { otherLicenceKind: "none", otherLicencePlace: "", otherLicenceNumber: "", otherLicenceClass: "", otherLicenceIssuedOn: "", otherLicenceExpiresOn: "", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(other(no.learner), { ...NONE, otherLicenceKind: "none" });
  const rows = (await db.prepare("SELECT snapshot_json FROM learner_revisions WHERE learner_id = ? ORDER BY revision_no").bind(learner.id).all<{ snapshot_json: string }>()).results;
  assert.equal(rows.length, 3);
  const base = JSON.parse(rows[0].snapshot_json);
  assert.deepEqual(base, {
    fullName: "QA Other Licence Learner", address: null, phone: null, dob: "2008-05-06", licenceNumber: null, licenceExpiry: null, eligibility: null, transmission: null, schoolWork: null,
    licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    addressSuburb: null, addressState: null, addressPostcode: null,
    ...NONE,
  });
  assert.deepEqual(JSON.parse(rows[1].snapshot_json), { ...base, ...NSW });
  assert.deepEqual(JSON.parse(rows[2].snapshot_json), { ...base, ...NSW, otherLicenceClass: "full", otherLicenceExpiresOn: null });
  // Back to "not recorded": "" on the kind.
  const cleared = await updateLearner(db, learner.id, { otherLicenceKind: "", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(other(cleared.learner), NONE);
});

test("an unchanged re-send is a no-op (no revision), including a lower-case state / number that normalise to the stored values", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { ...NSW, actingInstructorId: tony.id }, NOW);
  const again = await updateLearner(db, learner.id, { ...NSW, otherLicencePlace: "nsw", otherLicenceNumber: " qa nsw 1 ", otherLicenceKind: "Interstate", actingInstructorId: tony.id }, NOW);
  assert.equal(again.changed, false);
  assert.equal(await count(db, "learner_revisions"), 1);
});

test("validation D12 on edit: enums, place by kind (no ACT), lengths, real dates, not in the future, not before DOB, expiry not before issue; details need Yes; a rejected edit writes nothing", async () => {
  const { db, tony, learner } = await setup();
  const edit = (patch: Record<string, unknown>) => updateLearner(db, learner.id, { ...patch, actingInstructorId: tony.id }, NOW);
  await rejects(edit({ otherLicenceKind: "maybe" }), /must be No, Interstate or Overseas/, "bad kind");
  await rejects(edit({ ...NSW, otherLicenceClass: "provisional" }), /must be Learner, Full or Other/, "bad class");
  await rejects(edit({ ...NSW, otherLicencePlace: "ACT" }), /must be one of NSW, VIC, QLD, SA, WA, TAS, NT/, "ACT is not interstate");
  await rejects(edit({ ...NSW, otherLicencePlace: "Germany" }), /Interstate licence state must be one of/, "country for interstate");
  await rejects(edit({ ...NSW, otherLicenceKind: "overseas", otherLicencePlace: "G".repeat(61) }), /country must be 1 to 60 characters/, "long country");
  await rejects(edit({ ...NSW, otherLicenceNumber: "N".repeat(41) }), /number must be at most 40 characters/, "long number");
  await rejects(edit({ ...NSW, otherLicenceIssuedOn: "2026-02-30" }), /Other licence issue date must be a real date/, "Feb 30");
  await rejects(edit({ ...NSW, otherLicenceExpiresOn: "13/10/2030" }), /Other licence expiry must be a real date/, "wrong format");
  await rejects(edit({ ...NSW, otherLicenceIssuedOn: "2026-10-14" }), /Other licence issue date cannot be in the future/, "issued tomorrow");
  await rejects(edit({ ...NSW, otherLicenceIssuedOn: "2008-05-05" }), /cannot be before the date of birth/, "issued before DOB");
  await rejects(edit({ ...NSW, otherLicenceExpiresOn: "2025-10-12" }), /expiry cannot be before its issue date/, "expiry before issue");
  await rejects(edit({ otherLicenceKind: "none", otherLicencePlace: "NSW" }), /sent with "No"/, "details with No");
  await rejects(edit({ otherLicenceClass: "full" }), /Choose Interstate or Overseas before adding/, "details without a kind");
  assert.equal(await count(db, "learner_revisions"), 0, "rejected edits write nothing");
  assert.deepEqual(other(await getLearner(db, learner.id)), NONE);
  // Allowed edges: issued today, on the birthday, expiry equal to issue, no expiry at all (Q4), no number, a free-text country.
  await edit({ ...NSW, otherLicenceIssuedOn: "2026-10-13", otherLicenceExpiresOn: "2026-10-13" });
  await edit({ ...NSW, otherLicenceIssuedOn: "2008-05-06", otherLicenceExpiresOn: "" });
  const overseas = await edit({ otherLicenceKind: "overseas", otherLicencePlace: " Republic of Somewhere ", otherLicenceNumber: "", otherLicenceClass: "full", otherLicenceIssuedOn: "2024-01-01", otherLicenceExpiresOn: "" });
  assert.deepEqual(other(overseas.learner), { otherLicenceKind: "overseas", otherLicencePlace: "Republic of Somewhere", otherLicenceNumber: null, otherLicenceClass: "full", otherLicenceIssuedOn: "2024-01-01", otherLicenceExpiresOn: null });
  // Interstate state is normalised upper-case.
  assert.equal((await edit({ otherLicenceKind: "interstate", otherLicencePlace: "vic" })).learner.otherLicencePlace, "VIC");
});

test("validation on create goes through the same rules, with the same distinct messages", async () => {
  const { db, tony } = await setup();
  const make = (extra: Record<string, unknown>) => createLearner(db, { fullName: "QA Bad", dob: "2008-05-06", instructorId: tony.id, ...extra }, NOW);
  await rejects(make({ otherLicenceKind: "yes" }), /must be No, Interstate or Overseas/, "create bad kind");
  await rejects(make({ ...NSW, otherLicencePlace: "ACT" }), /must be one of NSW/, "create ACT");
  await rejects(make({ ...NSW, otherLicenceIssuedOn: "2027-01-01" }), /cannot be in the future/, "create future");
  await rejects(make({ ...NSW, otherLicenceIssuedOn: "2000-01-01" }), /before the date of birth/, "create before DOB");
  await rejects(make({ ...NSW, otherLicenceExpiresOn: "2020-01-01" }), /expiry cannot be before/, "create expiry before issue");
  await rejects(make({ otherLicenceClass: "learner" }), /Choose Interstate or Overseas/, "create details without kind");
  assert.equal((await listLearners(db)).filter((l) => l.fullName === "QA Bad").length, 0, "nothing created");
  const ok = await make({ ...NSW, otherLicenceKind: "overseas", otherLicencePlace: "Germany", otherLicenceClass: "full" });
  assert.deepEqual(other(ok), { ...NSW, otherLicenceKind: "overseas", otherLicencePlace: "Germany", otherLicenceClass: "full" });
});

test("cross-field rules only when a touched key is involved: older data never blocks an unrelated edit; changing the DOB past the issue date IS checked", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { ...NSW, actingInstructorId: tony.id }, NOW);
  // Simulate older data that fails today's rules (stored directly), then unrelated edits.
  await db.prepare("UPDATE learners SET other_licence_issued_on = '2040-01-01', other_licence_place = 'ACT' WHERE id = ?").bind(learner.id).run();
  const unrelated = await updateLearner(db, learner.id, { phone: "0400 222 333", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(unrelated.changedFields, ["phone"]);
  // The form re-sends every field unchanged with an unrelated change: still fine.
  const resend = await updateLearner(db, learner.id, { ...NSW, otherLicenceIssuedOn: "2040-01-01", otherLicencePlace: "ACT", phone: "0400 222 334", actingInstructorId: tony.id }, NOW);
  assert.deepEqual(resend.changedFields, ["phone"]);
  // Touching a sibling key (the number) re-validates the merged place and date.
  await rejects(updateLearner(db, learner.id, { ...NSW, otherLicenceIssuedOn: "2040-01-01", otherLicencePlace: "ACT", otherLicenceNumber: "NEW", actingInstructorId: tony.id }, NOW), /must be one of NSW/, "sibling key touched");
  // Fix the stored data, then move the DOB after the issue date: rejected because `dob` is a touched key of that rule.
  await updateLearner(db, learner.id, { ...NSW, actingInstructorId: tony.id }, NOW);
  await rejects(updateLearner(db, learner.id, { dob: "2026-01-01", actingInstructorId: tony.id }, NOW), /before the date of birth/, "DOB moved past the other issue date");
  assert.equal((await getLearner(db, learner.id)).dob, "2008-05-06");
});

test("validateOtherLicence is pure and null when nothing relevant is touched; COUNTRIES is a sorted, unique, <= 60-char English list", () => {
  assert.equal(validateOtherLicence({ ...NONE, dob: null }, new Set(["phone"]), "2026-10-13"), null);
  assert.deepEqual(validateOtherLicence({ ...NONE, dob: null }, new Set(["otherLicenceKind"]), "2026-10-13"), { ok: true, fields: NONE });
  assert.ok(COUNTRIES.length > 150);
  assert.deepEqual([...COUNTRIES].sort((a, b) => a.localeCompare(b, "en")), [...COUNTRIES]);
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  assert.ok(COUNTRIES.every((c) => c.length >= 1 && c.length <= 60));
  assert.ok(COUNTRIES.includes("New Zealand") && COUNTRIES.includes("United Kingdom") && COUNTRIES.includes("China") && COUNTRIES.includes("India"));
  assert.ok(!COUNTRIES.includes("Australia"), "an Australian licence is interstate, not overseas");
});

test("PATCH plumbing: the fields travel through patchLearner; a bad value is a 400-shaped ValidationError; the PDF Eligibility value follows the school rule", async () => {
  const { db, tony, learner } = await setup();
  const request = (body: unknown) => new Request("https://x.example/api/learners/1", { method: "PATCH", headers: { "content-type": "application/json", "x-instructor-id": tony.id }, body: JSON.stringify(body) });
  const result = (await patchLearner(db, learner.id, request({ ...NSW, learnerLicenceIssuedOn: "2026-03-01" }))) as { learner: Record<string, unknown>; changed: boolean };
  assert.equal(result.changed, true);
  assert.deepEqual(other(result.learner), NSW);
  await assert.rejects(() => patchLearner(db, learner.id, request({ ...NSW, otherLicencePlace: "ACT" })), (e: unknown) => e instanceof ValidationError && /must be one of NSW/.test(e.message));
  // D15/D18: no new PDF field; the existing Eligibility auto-fill reflects the school rule (12 months from the NSW licence, not March 2027).
  const stored = await getLearner(db, learner.id);
  assert.equal(pdfEligibility(stored), "C23 from 2026-10-13");
  await updateLearner(db, learner.id, { eligibility: "Tony's own words", actingInstructorId: tony.id }, NOW);
  assert.equal(pdfEligibility(await getLearner(db, learner.id)), "Tony's own words", "the instructor's own text is never overwritten");
});

test("D23 ACTGDS: the fields never reach the outbox; a lesson.upserted payload has exactly the contract's keys and no licence key at any level", async () => {
  const { db, tony, learner } = await setup();
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
    schedule: () => {},
  };
  await updateLearner(db, learner.id, { ...NSW, actingInstructorId: tony.id }, NOW);
  assert.equal(await count(db, "integration_outbox"), 0, "a learner edit enqueues nothing");
  await createLesson(db, learner.id, { lessonDate: "2026-10-13", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", taughtIds: ["1"], adiSignature: "data:image/png;base64,iVBORw0KGgoAAAA1", learnerSignature: "data:image/png;base64,iVBORw0KGgoAAAA1" }, hooks);
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
  assert.ok(!/licence|interstate|overseas|NSW|QA NSW/i.test(rows[0].payload_json), "no licence data in the payload bytes");
});
