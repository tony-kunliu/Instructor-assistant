import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import {
  createLearner,
  createLesson,
  findInstructorByEmail,
  getCompletionSummary,
  getLearner,
  getLearnerProgress,
  listLearners,
  listLessons,
  listLessonsForExport,
  NotFoundError,
  setLearnerArchived,
  updateLesson,
} from "../lib/repo.ts";
import { CORE_COMPETENCY_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import { filterLearners } from "../lib/learner-filter.ts";
import type { Learner } from "../lib/types.ts";

const SIG_A = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_B = "data:image/png;base64,iVBORw0KGgoAAAA2";
const TONY_EMAIL = "Kunliu.work@gmail.com";
const ANNA_EMAIL = "yapingqu.work@gmail.com";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, TONY_EMAIL))!;
  const anna = (await findInstructorByEmail(db, ANNA_EMAIL))!;
  const tonyLearner = await createLearner(db, { fullName: "Tony Learner", instructorId: tony.id });
  const annaLearner = await createLearner(db, { fullName: "Anna Learner", instructorId: anna.id });
  return { db, tony, anna, tonyLearner, annaLearner };
}

let odo = 0;
function lessonInput(extra: Record<string, unknown> = {}) {
  const start = odo;
  odo += 10;
  return {
    lessonDate: "2026-09-01",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: String(start),
    finishOdometer: String(odo),
    adiSignature: SIG_A,
    learnerSignature: SIG_A,
    ...extra,
  };
}

async function completeFinalDrive(db: ReturnType<typeof openTestD1>, learnerId: string) {
  odo = 0;
  const achieved = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "achieved"]));
  const first17 = CORE_COMPETENCY_IDS.slice(0, 17);
  const last5 = CORE_COMPETENCY_IDS.slice(17);
  await createLesson(db, learnerId, lessonInput({ assessedIds: first17, achievedResults: achieved(first17) }));
  await createLesson(db, learnerId, lessonInput({ assessedIds: [REVIEW_1_17], achievedResults: { [REVIEW_1_17]: "achieved" } }));
  await createLesson(db, learnerId, lessonInput({ assessedIds: last5, achievedResults: achieved(last5) }));
  await createLesson(db, learnerId, lessonInput({ assessedIds: [REVIEW_1_22], achievedResults: { [REVIEW_1_22]: "achieved" } }));
  await createLesson(db, learnerId, lessonInput({ assessedIds: [FINAL_DRIVE_23], achievedResults: { [FINAL_DRIVE_23]: "achieved" } }));
}

// ── Repo: archive / restore ─────────────────────────────────────────────

test("new learners are active (archivedAt null) and listed by default", async () => {
  const { db, tonyLearner } = await setup();
  assert.equal(tonyLearner.archivedAt, null);
  assert.deepEqual((await listLearners(db)).map((l) => l.fullName), ["Anna Learner", "Tony Learner"]);
});

test("archive: learner disappears from the active list and appears in the archived list, identity unchanged", async () => {
  const { db, tonyLearner } = await setup();
  const archived = await setLearnerArchived(db, tonyLearner.id, true);
  assert.ok(archived.archivedAt, "archivedAt is set");
  assert.equal(archived.id, tonyLearner.id);
  assert.equal(archived.instructorId, tonyLearner.instructorId);
  assert.equal(archived.fullName, tonyLearner.fullName);

  assert.deepEqual((await listLearners(db)).map((l) => l.id).includes(tonyLearner.id), false);
  const archivedList = await listLearners(db, { archived: true });
  assert.deepEqual(archivedList.map((l) => l.id), [tonyLearner.id]);
});

test("archive keeps lessons, competency progress, signatures and PDF export data intact", async () => {
  const { db, tonyLearner } = await setup();
  odo = 0;
  await createLesson(db, tonyLearner.id, lessonInput({ taughtIds: ["1"], assessedIds: ["2"], achievedResults: { "2": "achieved" }, adiSignature: SIG_A, learnerSignature: SIG_B }));
  const progressBefore = await getLearnerProgress(db, tonyLearner.id);

  await setLearnerArchived(db, tonyLearner.id, true);

  const lessons = await listLessons(db, tonyLearner.id);
  assert.equal(lessons.length, 1);
  const exported = await listLessonsForExport(db, tonyLearner.id);
  assert.equal(exported[0].adiSignature, SIG_A);
  assert.equal(exported[0].learnerSignature, SIG_B);
  assert.deepEqual(await getLearnerProgress(db, tonyLearner.id), progressBefore);
  assert.equal((await getLearner(db, tonyLearner.id)).id, tonyLearner.id, "archived learner is still directly readable");
});

test("History Edit still works on an archived learner's lesson", async () => {
  const { db, tonyLearner } = await setup();
  odo = 0;
  const lesson = await createLesson(db, tonyLearner.id, lessonInput({ taughtIds: ["1"] }));
  await setLearnerArchived(db, tonyLearner.id, true);
  const result = await updateLesson(db, tonyLearner.id, lesson.id, {
    ...lessonInput(),
    startOdometer: "0",
    finishOdometer: "12",
    taughtIds: ["1"],
    adiSignature: SIG_B,
    learnerSignature: SIG_B,
  });
  assert.equal(result.lesson.distanceKm, 12);
});

test("restore: archived learner returns to the active list with archivedAt cleared, lessons intact", async () => {
  const { db, tonyLearner } = await setup();
  odo = 0;
  await createLesson(db, tonyLearner.id, lessonInput({ taughtIds: ["1"] }));
  await setLearnerArchived(db, tonyLearner.id, true);
  const restored = await setLearnerArchived(db, tonyLearner.id, false);
  assert.equal(restored.archivedAt, null);
  assert.ok((await listLearners(db)).some((l) => l.id === tonyLearner.id));
  assert.deepEqual(await listLearners(db, { archived: true }), []);
  assert.equal((await listLessons(db, tonyLearner.id)).length, 1);
});

test("archive is persisted (a fresh read sees it) and re-archiving keeps the original archivedAt", async () => {
  const { db, tonyLearner } = await setup();
  const first = await setLearnerArchived(db, tonyLearner.id, true);
  assert.equal((await getLearner(db, tonyLearner.id)).archivedAt, first.archivedAt);
  const again = await setLearnerArchived(db, tonyLearner.id, true);
  assert.equal(again.archivedAt, first.archivedAt);
});

test("archiving/restoring an unknown learner is a NotFoundError, never a silent create", async () => {
  const { db } = await setup();
  await assert.rejects(() => setLearnerArchived(db, "no-such-learner", true), NotFoundError);
});

test("Integration V1: archive/restore never writes an outbox event (not part of the lesson.upserted contract)", async () => {
  const { db, tonyLearner } = await setup();
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: async () => new Response("{}", { status: 200 }),
    schedule: () => {},
  };
  odo = 0;
  await createLesson(db, tonyLearner.id, lessonInput({ taughtIds: ["1"] }), hooks);
  const before = await listOutboxRowsForLearner(db, tonyLearner.id);
  assert.equal(before.length, 1);
  await setLearnerArchived(db, tonyLearner.id, true);
  await setLearnerArchived(db, tonyLearner.id, false);
  assert.deepEqual(await listOutboxRowsForLearner(db, tonyLearner.id), before);
});

test("Final Drive 23 completion never auto-archives the learner", async () => {
  const { db, tonyLearner } = await setup();
  await completeFinalDrive(db, tonyLearner.id);
  assert.equal((await getLearnerProgress(db, tonyLearner.id)).completed, true);
  assert.ok(await getCompletionSummary(db, tonyLearner.id));
  const learner = await getLearner(db, tonyLearner.id);
  assert.equal(learner.archivedAt, null);
  assert.ok((await listLearners(db)).some((l) => l.id === tonyLearner.id), "completed learner stays active until an instructor archives");
});

// ── filterLearners: scope + search ──────────────────────────────────────

function learner(id: string, fullName: string, instructorId: string): Learner {
  return {
    id,
    instructorId,
    instructorName: instructorId,
    instructorAdiNumber: null,
    fullName,
    address: null,
    addressSuburb: null,
    addressState: null,
    addressPostcode: null,
    phone: null,
    dob: null,
    licenceNumber: null,
    licenceExpiry: null,
    eligibility: null,
    transmission: null,
    schoolWork: null,
    licenceStage: "learner",
    learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    archivedAt: null, archiveReason: null, archiveNote: null, transfers: [],
  };
}

const ROSTER = [learner("1", "Alice Chen", "tony"), learner("2", "Bob Li", "anna"), learner("3", "alex wong", "tony"), learner("4", "Alicia Park", "anna")];

test("filter: My Learners shows only the signed-in instructor's learners", () => {
  assert.deepEqual(filterLearners(ROSTER, { scope: "mine", instructorId: "tony", query: "" }).map((l) => l.id), ["1", "3"]);
  assert.deepEqual(filterLearners(ROSTER, { scope: "mine", instructorId: "anna", query: "" }).map((l) => l.id), ["2", "4"]);
});

test("filter: All Learners shows everyone", () => {
  assert.deepEqual(filterLearners(ROSTER, { scope: "all", instructorId: "tony", query: "" }).map((l) => l.id), ["1", "2", "3", "4"]);
});

test("filter: with no signed-in identity (local dev) 'mine' falls back to everyone rather than an empty list", () => {
  assert.equal(filterLearners(ROSTER, { scope: "mine", instructorId: null, query: "" }).length, 4);
});

test("filter: search is case-insensitive, trims, matches any part of the name, and combines with scope", () => {
  assert.deepEqual(filterLearners(ROSTER, { scope: "all", instructorId: "tony", query: "  ALI " }).map((l) => l.id), ["1", "4"]);
  assert.deepEqual(filterLearners(ROSTER, { scope: "mine", instructorId: "tony", query: "ali" }).map((l) => l.id), ["1"]);
  assert.deepEqual(filterLearners(ROSTER, { scope: "mine", instructorId: "anna", query: "wong" }), []);
  assert.deepEqual(filterLearners(ROSTER, { scope: "all", instructorId: "tony", query: "wong" }).map((l) => l.id), ["3"]);
});
