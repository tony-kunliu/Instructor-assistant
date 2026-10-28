// SaaS edition P1 pages (spec 2026-10-21-saas-edition-design §7, §8): the trial banner's day count and texts, and the
// "Export my data" file, which must hold ONLY the signed-in instructor's learners and lessons. Runs on the real SaaS
// schema (openSaasTestD1: every migrations-saas file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSaasTestD1 } from "./helpers/saas-d1.ts";
import { createLearner, createLesson, setLearnerArchived } from "../lib/repo.ts";
import { createSaasInstructor } from "../lib/saas/accounts.ts";
import { trialBanner } from "../lib/saas/trial-banner.ts";
import { buildAccountExport, accountExportFilename } from "../lib/saas/account-export.ts";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-28T02:00:00.000Z");
const endsIn = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

test("trialBanner: 12 days left (12 d 0 h exactly) is active with the plural text", () => {
  assert.deepEqual(trialBanner(endsIn(12 * 24 * HOUR), NOW), { kind: "active", text: "Free trial: 12 days left", daysLeft: 12 });
});

test("trialBanner: 12 days 3 hours left rounds up to 13", () => {
  assert.deepEqual(trialBanner(endsIn(12 * 24 * HOUR + 3 * HOUR), NOW), { kind: "active", text: "Free trial: 13 days left", daysLeft: 13 });
});

test("trialBanner: just over 24 h left is 2 days, active", () => {
  assert.deepEqual(trialBanner(endsIn(24 * HOUR + 60_000), NOW), { kind: "active", text: "Free trial: 2 days left", daysLeft: 2 });
});

test("trialBanner: exactly 24 h left is the last day", () => {
  assert.deepEqual(trialBanner(endsIn(24 * HOUR), NOW), { kind: "last-day", text: "Free trial: last day", daysLeft: 1 });
});

test("trialBanner: 23 h left is the last day", () => {
  assert.deepEqual(trialBanner(endsIn(23 * HOUR), NOW), { kind: "last-day", text: "Free trial: last day", daysLeft: 1 });
});

test("trialBanner: 1 minute left is the last day", () => {
  assert.deepEqual(trialBanner(endsIn(60_000), NOW), { kind: "last-day", text: "Free trial: last day", daysLeft: 1 });
});

const EXPIRED = { kind: "expired", text: "Free trial ended — read-only. Your records and PDFs stay available.", daysLeft: 0 };

test("trialBanner: 0 left (the end is now) is expired", () => {
  assert.deepEqual(trialBanner(endsIn(0), NOW), EXPIRED);
});

test("trialBanner: a past end is expired", () => {
  assert.deepEqual(trialBanner(endsIn(-1), NOW), EXPIRED);
  assert.deepEqual(trialBanner(endsIn(-40 * 24 * HOUR), NOW), EXPIRED);
});

test("trialBanner: a malformed or empty date is treated as expired (fail closed, like the gate)", () => {
  assert.deepEqual(trialBanner("not-a-date", NOW), EXPIRED);
  assert.deepEqual(trialBanner("", NOW), EXPIRED);
});

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";

async function seed() {
  const db = openSaasTestD1();
  const a = await createSaasInstructor(db, { email: "alpha@x.test", fullName: "QA Alpha Coach", adiNumber: "ADI-A1" });
  const b = await createSaasInstructor(db, { email: "bravo@x.test", fullName: "QA Bravo Coach", adiNumber: "ADI-B2" });
  const make = async (instructorId: string, active: string, archived: string) => {
    const learner = await createLearner(db, { fullName: active, instructorId });
    const lesson = await createLesson(db, learner.id, {
      lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110",
      location: `Location of ${active}`, adiSignature: SIG, learnerSignature: SIG, actingInstructorId: instructorId,
    });
    const old = await createLearner(db, { fullName: archived, instructorId });
    const oldLesson = await createLesson(db, old.id, {
      lessonDate: "2026-10-01", startTime: "09:00", finishTime: "10:00", startOdometer: "100", finishOdometer: "110", adiSignature: SIG, learnerSignature: SIG, actingInstructorId: instructorId,
    });
    await setLearnerArchived(db, old.id, true, { actingInstructorId: instructorId });
    return { learner, lesson, old, oldLesson };
  };
  const mineA = await make(a.id, "QA Learner Apple", "QA Learner Apricot");
  const mineB = await make(b.id, "QA Learner Banana", "QA Learner Blueberry");
  return { db, a, b, mineA, mineB };
}

test("buildAccountExport: A's export has exactly A's active and archived learners with their lessons and signatures", async () => {
  const { db, a, mineA } = await seed();
  const exported = await buildAccountExport(db, { kind: "instructor", instructorId: a.id }, NOW);
  assert.equal(exported.exportedAt, NOW.toISOString());
  assert.deepEqual(exported.instructor, { id: a.id, fullName: "QA Alpha Coach", adiNumber: "ADI-A1" });
  assert.deepEqual(exported.learners.map((l) => l.learner.id).sort(), [mineA.learner.id, mineA.old.id].sort());
  const active = exported.learners.find((l) => l.learner.id === mineA.learner.id)!;
  assert.equal(active.learner.archivedAt, null);
  assert.deepEqual(active.lessons.map((l) => l.id), [mineA.lesson.id]);
  assert.equal(active.lessons[0].adiSignature, SIG, "signatures are exported as stored (the instructor's own records)");
  assert.equal(active.lessons[0].learnerSignature, SIG);
  const archived = exported.learners.find((l) => l.learner.id === mineA.old.id)!;
  assert.notEqual(archived.learner.archivedAt, null);
  assert.deepEqual(archived.lessons.map((l) => l.id), [mineA.oldLesson.id]);
});

test("buildAccountExport: none of B's names or ids appear anywhere in A's export (and vice versa)", async () => {
  const { db, a, b, mineA, mineB } = await seed();
  const jsonA = JSON.stringify(await buildAccountExport(db, { kind: "instructor", instructorId: a.id }, NOW));
  for (const leak of [b.id, b.fullName, "ADI-B2", "bravo@x.test", mineB.learner.id, mineB.learner.fullName, mineB.lesson.id, mineB.old.id, mineB.old.fullName, mineB.oldLesson.id, "Banana", "Blueberry"]) {
    assert.ok(!jsonA.includes(leak), `A's export must not contain ${leak}`);
  }
  const jsonB = JSON.stringify(await buildAccountExport(db, { kind: "instructor", instructorId: b.id }, NOW));
  for (const leak of [a.id, a.fullName, "ADI-A1", mineA.learner.id, mineA.lesson.id, mineA.old.id, mineA.oldLesson.id, "Apple", "Apricot"]) {
    assert.ok(!jsonB.includes(leak), `B's export must not contain ${leak}`);
  }
  assert.ok(jsonB.includes(mineB.learner.id) && jsonB.includes(mineB.old.id));
});

test("buildAccountExport: only the saas instructor scope is accepted (the private 'all' scope is refused, never widened)", async () => {
  const { db } = await seed();
  await assert.rejects(buildAccountExport(db, { kind: "all" }, NOW));
  await assert.rejects(buildAccountExport(db, { kind: "instructor", instructorId: "no-such-instructor" }, NOW));
});

test("accountExportFilename: the date is the Canberra calendar date, not the UTC one", () => {
  // 2026-10-28T14:30Z is 2026-10-29 01:30 in Canberra (AEDT, UTC+11).
  assert.equal(accountExportFilename(new Date("2026-10-28T14:30:00.000Z")), "instructor-assistant-export-2026-10-29.json");
  assert.equal(accountExportFilename(new Date("2026-10-28T02:00:00.000Z")), "instructor-assistant-export-2026-10-28.json");
});
