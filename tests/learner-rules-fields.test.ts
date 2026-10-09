// Migration 0009 fields (T2, D18-D20): storage, validation, revisions, no ACTGDS event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, findInstructorByEmail, getLearner, listLearners, updateLearner, ValidationError } from "../lib/repo.ts";

const NOW = new Date("2026-10-09T02:00:00Z"); // 2026-10-09 in Canberra
const FULL = { learnerLicenceIssuedOn: "2025-11-15", learnerLicenceFirstIssuedOn: "2024-05-01", hptPassedOn: "2026-05-05", loggedHours: 82, loggedHoursOn: "2026-10-03" };

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "QA Rules Learner", dob: "2008-05-06", instructorId: tony.id }, NOW);
  return { db, tony, learner };
}
const rejects = (promise: Promise<unknown>, message: RegExp, label: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof ValidationError && message.test(e.message), label);

test("a new learner has the five fields null; create stores them and get/list return them", async () => {
  const { db, tony, learner } = await setup();
  assert.deepEqual([learner.learnerLicenceIssuedOn, learner.learnerLicenceFirstIssuedOn, learner.hptPassedOn, learner.loggedHours, learner.loggedHoursOn], [null, null, null, null, null]);
  const created = await createLearner(db, { fullName: "QA Full Rules", instructorId: tony.id, ...FULL, loggedHours: "82" }, NOW);
  assert.deepEqual({ ...created, id: "", instructorName: "" }, { ...(await getLearner(db, created.id)), id: "", instructorName: "" });
  assert.equal(created.loggedHours, 82);
  assert.equal(typeof created.loggedHours, "number");
  const listed = (await listLearners(db)).find((l) => l.id === created.id)!;
  assert.deepEqual([listed.learnerLicenceIssuedOn, listed.learnerLicenceFirstIssuedOn, listed.hptPassedOn, listed.loggedHours, listed.loggedHoursOn], ["2025-11-15", "2024-05-01", "2026-05-05", 82, "2026-10-03"]);
});

test("edit sets, changes and clears the fields (\"\" -> null); a snapshot holds the previous values; old snapshots without the keys read as missing", async () => {
  const { db, tony, learner } = await setup();
  const first = await updateLearner(db, learner.id, { ...FULL, actingInstructorId: tony.id }, NOW);
  assert.deepEqual(first.changedFields.sort(), ["hptPassedOn", "learnerLicenceFirstIssuedOn", "learnerLicenceIssuedOn", "loggedHours", "loggedHoursOn"]);
  await updateLearner(db, learner.id, { hptPassedOn: "", loggedHours: "", loggedHoursOn: "", actingInstructorId: tony.id }, NOW);
  const fresh = await getLearner(db, learner.id);
  assert.deepEqual([fresh.hptPassedOn, fresh.loggedHours, fresh.loggedHoursOn, fresh.learnerLicenceIssuedOn], [null, null, null, "2025-11-15"]);
  const rows = (await db.prepare("SELECT snapshot_json FROM learner_revisions WHERE learner_id = ? ORDER BY revision_no").bind(learner.id).all<{ snapshot_json: string }>()).results;
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].snapshot_json), {
    fullName: "QA Rules Learner", address: null, phone: null, dob: "2008-05-06", licenceNumber: null, licenceExpiry: null, eligibility: null, transmission: null, schoolWork: null,
    licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
  });
  assert.deepEqual(JSON.parse(rows[1].snapshot_json), { ...JSON.parse(rows[0].snapshot_json), ...FULL });
  // A learner whose columns are NULL (as every row is right after 0009) gets a real snapshot with explicit nulls for the new keys.
  const snapshot = JSON.parse(rows[0].snapshot_json) as Record<string, unknown>;
  for (const key of ["learnerLicenceIssuedOn", "learnerLicenceFirstIssuedOn", "hptPassedOn", "loggedHours", "loggedHoursOn"]) assert.ok(key in snapshot && snapshot[key] === null, key);
});

test("an unchanged value is a no-op (no revision), including hours given as a numeric string", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { ...FULL, actingInstructorId: tony.id }, NOW);
  const again = await updateLearner(db, learner.id, { loggedHours: "82", loggedHoursOn: "2026-10-03", actingInstructorId: tony.id }, NOW);
  assert.equal(again.changed, false);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM learner_revisions").first<{ n: number }>())?.n), 1);
});

test("validation D19: real calendar dates, not-in-the-future, not before DOB, first issue not after current, hours 0-999 with an as-of date", async () => {
  const { db, tony, learner } = await setup();
  const edit = (patch: Record<string, unknown>) => updateLearner(db, learner.id, { ...patch, actingInstructorId: tony.id }, NOW);
  await rejects(edit({ learnerLicenceIssuedOn: "2026-02-30" }), /real date/, "Feb 30");
  await rejects(edit({ hptPassedOn: "2026-13-01" }), /real date/, "month 13");
  await rejects(edit({ loggedHoursOn: "03/10/2026" }), /real date/, "wrong format");
  await rejects(edit({ learnerLicenceFirstIssuedOn: "2023-02-29" }), /real date/, "29 Feb in a non-leap year");
  await edit({ learnerLicenceFirstIssuedOn: "2024-02-29" }); // a real leap day
  await rejects(edit({ learnerLicenceIssuedOn: "2026-10-10" }), /future/, "issue date tomorrow");
  await edit({ learnerLicenceIssuedOn: "2026-10-09" }); // today is allowed
  await rejects(edit({ learnerLicenceIssuedOn: "2008-05-05" }), /before the date of birth/, "issue before DOB");
  await edit({ learnerLicenceFirstIssuedOn: "", learnerLicenceIssuedOn: "2008-05-06" }); // on the birthday is allowed
  await edit({ learnerLicenceFirstIssuedOn: "2024-02-29" }).then(() => assert.fail("first after current must be rejected"), (e) => assert.ok(e instanceof ValidationError));
  await edit({ learnerLicenceIssuedOn: "2024-03-01", learnerLicenceFirstIssuedOn: "2024-02-29" });
  await rejects(edit({ learnerLicenceIssuedOn: "2024-01-01" }), /First issue date cannot be after/, "first (2024-02-29) after current (2024-01-01)");
  await edit({ learnerLicenceIssuedOn: "2024-02-29" }); // equal is allowed
  await rejects(edit({ hptPassedOn: "2026-10-10" }), /HPT pass date cannot be in the future/, "HPT tomorrow");
  await edit({ hptPassedOn: "2026-10-09" });
  await rejects(edit({ loggedHours: 50 }), /need an as-of date/, "hours without a date");
  await rejects(edit({ loggedHours: 50, loggedHoursOn: "2026-10-10" }), /as-of date cannot be in the future/, "as-of tomorrow");
  for (const bad of [-1, 1000, "12.5", "abc", 1.5, "1e2"]) await rejects(edit({ loggedHours: bad, loggedHoursOn: "2026-10-09" }), /whole number from 0 to 999/, `hours ${String(bad)}`);
  await edit({ loggedHours: 0, loggedHoursOn: "2026-10-09" });
  await edit({ loggedHours: 999 });
  assert.equal((await getLearner(db, learner.id)).loggedHours, 999);
  // An unrelated edit is never blocked by the rule fields; changing DOB past the issue date is.
  await edit({ phone: "0400 000 000" });
  await rejects(edit({ dob: "2024-03-01" }), /before the date of birth/, "DOB after the stored issue date");
  assert.equal((await getLearner(db, learner.id)).dob, "2008-05-06", "a rejected edit changes nothing");
});

test("create validates the new fields the same way (strict, even though old fields stay lenient)", async () => {
  const { db, tony } = await setup();
  const make = (extra: Record<string, unknown>) => createLearner(db, { fullName: "QA Bad", instructorId: tony.id, ...extra }, NOW);
  await rejects(make({ hptPassedOn: "2026-02-30" }), /real date/, "create Feb 30");
  await rejects(make({ loggedHours: 10 }), /need an as-of date/, "create hours without date");
  await rejects(make({ dob: "2010-01-01", learnerLicenceIssuedOn: "2009-12-31" }), /before the date of birth/, "create issue before DOB");
  assert.equal((await make({ dob: "garbage" })).dob, null, "old lenient dob behaviour unchanged");
});

test("M4: re-sending unchanged stored values never blocks an unrelated edit (only changed keys trigger the cross-field rules)", async () => {
  const { db, tony, learner } = await setup();
  await updateLearner(db, learner.id, { hptPassedOn: "2026-10-09", learnerLicenceIssuedOn: "2025-11-15", actingInstructorId: tony.id }, NOW);
  // Clock earlier than the stored dates (as if the stored data were now "in the future"): the form re-sends them unchanged.
  const early = new Date("2026-10-01T02:00:00Z");
  const result = await updateLearner(db, learner.id, { phone: "0400 111 222", hptPassedOn: "2026-10-09", learnerLicenceIssuedOn: "2025-11-15", actingInstructorId: tony.id }, early);
  assert.deepEqual(result.changedFields, ["phone"]);
  await rejects(updateLearner(db, learner.id, { hptPassedOn: "2026-10-05", actingInstructorId: tony.id }, early), /future/, "a changed value is still checked");
});
