// SaaS edition P0 (spec §5): the shared data paths are scope-aware. `{ kind: "all" }` (private mode, Tony/Anna)
// keeps today's behaviour exactly; `{ kind: "instructor" }` only ever sees that instructor's learners and lessons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import {
  createLearner, createLesson, getLessonCompetencySelections, importPaperLessons, learnerSummariesSql, listActiveInstructors, listLearners, listLearnerSummaries,
  PaperImportError, setLearnerArchived,
} from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { readJsonForNewLearner } from "../lib/api.ts";
import { hooksFor } from "../lib/integration/context.ts";
import type { Scope } from "../lib/scope.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";

async function setup() {
  const db = openTestD1(":memory:");
  await db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("qa-coach-a", "QA Coach A").run();
  await db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("qa-coach-b", "QA Coach B").run();
  const make = async (fullName: string, instructorId: string, archived: boolean) => {
    const learner = await createLearner(db, { fullName, instructorId });
    if (archived) await setLearnerArchived(db, learner.id, true);
    return learner.id;
  };
  const ids = {
    aActive: await make("QA Learner A Active", "qa-coach-a", false),
    aArchived: await make("QA Learner A Archived", "qa-coach-a", true),
    bActive: await make("QA Learner B Active", "qa-coach-b", false),
    bArchived: await make("QA Learner B Archived", "qa-coach-b", true),
  };
  const lesson = (learnerId: string, assessed: string[]) =>
    createLesson(db, learnerId, {
      lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: "0", finishOdometer: "10",
      taughtIds: ["2"], assessedIds: assessed, achievedResults: Object.fromEntries(assessed.map((id) => [id, "achieved"])), adiSignature: SIG, learnerSignature: SIG,
    });
  const aLesson = await lesson(ids.aActive, ["1"]);
  const bLesson = await lesson(ids.bActive, ["1", "3"]);
  return { db, ids, aLesson, bLesson };
}

const A: Scope = { kind: "instructor", instructorId: "qa-coach-a" };
const ALL: Scope = { kind: "all" };

test("listLearners: an instructor scope lists only that instructor's learners; no scope lists everyone", async () => {
  const { db, ids } = await setup();
  assert.deepEqual((await listLearners(db, { scope: A })).map((l) => l.id), [ids.aActive]);
  assert.deepEqual((await listLearners(db, { archived: true, scope: A })).map((l) => l.id), [ids.aArchived]);
  assert.deepEqual((await listLearners(db)).map((l) => l.id).sort(), [ids.aActive, ids.bActive].sort());
  assert.deepEqual((await listLearners(db, { archived: true })).map((l) => l.id).sort(), [ids.aArchived, ids.bArchived].sort());
  assert.deepEqual((await listLearners(db, { scope: ALL })).map((l) => l.id).sort(), [ids.aActive, ids.bActive].sort());
});

test("listLearnerSummaries: an instructor scope aggregates only that instructor's learners, bound inside every subquery", async () => {
  const { db, ids } = await setup();
  const active = await listLearnerSummaries(db, { scope: A });
  assert.deepEqual(Object.keys(active), [ids.aActive]);
  assert.equal(active[ids.aActive].lessonCount, 1);
  assert.deepEqual(active[ids.aActive].achievedIds, ["1"], "B's assessed competency 3 never reaches A's summary");
  assert.deepEqual(Object.keys(await listLearnerSummaries(db, { archived: true, scope: A })), [ids.aArchived]);
  const all = await listLearnerSummaries(db);
  assert.deepEqual(Object.keys(all).sort(), [ids.aActive, ids.bActive].sort());
  // The scope is a bound parameter in the lessons subquery, the events subquery and the outer WHERE; the unscoped SQL is unchanged.
  for (const archived of [false, true]) {
    const scoped = learnerSummariesSql(archived, true);
    assert.equal(scoped.match(/instructor_id = \?/g)?.length, 3, scoped);
    assert.equal(scoped.includes("qa-coach"), false, "never interpolated");
    assert.equal(learnerSummariesSql(archived).includes("?"), false, "unscoped SQL has no bound parameters");
  }
});

test("listActiveInstructors: an instructor scope returns only that instructor", async () => {
  const { db } = await setup();
  assert.deepEqual((await listActiveInstructors(db, A)).map((i) => i.id), ["qa-coach-a"]);
  const everyone = (await listActiveInstructors(db)).map((i) => i.id);
  assert.ok(everyone.includes("qa-coach-a") && everyone.includes("qa-coach-b"));
  assert.deepEqual((await listActiveInstructors(db, ALL)).map((i) => i.id), everyone);
});

const csvNaming = (instructor: string) =>
  `${PAPER_CSV_COLUMNS.join(",")}\n${PAPER_CSV_COLUMNS.map((c) => ({ date: "2026-01-01", start_time: "09:00", finish_time: "10:00", start_odometer: "100", finish_odometer: "120", signature: "on_paper", instructor } as Record<string, string>)[c] ?? "").join(",")}\n`;

test("importPaperLessons: an instructor scope matches the CSV instructor column against that instructor only", async () => {
  const { db } = await setup();
  const fresh = (await createLearner(db, { fullName: "QA Learner A Paper", instructorId: "qa-coach-a" })).id;
  await assert.rejects(
    importPaperLessons(db, fresh, csvNaming("QA Coach B"), "preview", A),
    (e) => e instanceof PaperImportError && e.errors.some((row) => row.message.includes(`"QA Coach B" is not an active instructor`)),
  );
  const preview = await importPaperLessons(db, fresh, csvNaming("QA Coach B"), "preview", ALL);
  assert.equal(preview.mode, "preview");
  assert.equal(preview.preview.lessonCount, 1);
  assert.equal((await importPaperLessons(db, fresh, csvNaming("QA Coach A"), "preview", A)).preview.lessonCount, 1);
});

test("getLessonCompetencySelections pairs the lesson with its learner: another learner's lesson gives empty selections", async () => {
  const { db, ids, aLesson, bLesson } = await setup();
  assert.deepEqual(await getLessonCompetencySelections(db, ids.aActive, bLesson.id), { taughtIds: [], assessedIds: [], achievedResults: {} });
  assert.deepEqual(await getLessonCompetencySelections(db, ids.aActive, aLesson.id), { taughtIds: ["2"], assessedIds: ["1"], achievedResults: { "1": "achieved" } });
});

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://app.example/api/learners", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("readJsonForNewLearner: an instructor scope forces instructorId; `all` keeps today's defaulting rule", async () => {
  const me: Scope = { kind: "instructor", instructorId: "me" };
  assert.equal((await readJsonForNewLearner(req({ fullName: "QA New", instructorId: "other" }), me)).instructorId, "me");
  assert.equal((await readJsonForNewLearner(req({ fullName: "QA New" }), me)).instructorId, "me");
  assert.equal((await readJsonForNewLearner(req({ fullName: "QA New", instructorId: "other" }), ALL)).instructorId, "other");
  assert.equal((await readJsonForNewLearner(req({ fullName: "QA New" }, { "x-instructor-id": "header-id" }), ALL)).instructorId, "header-id");
  assert.equal((await readJsonForNewLearner(req({ fullName: "QA New", instructorId: "other" }, { "x-instructor-id": "header-id" }), ALL)).instructorId, "other");
  assert.equal("instructorId" in (await readJsonForNewLearner(req({ fullName: "QA New" }), ALL)), false);
});

test("hooksFor: saas never integrates, whatever the vars say; private is unchanged", () => {
  const env = { ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic", ACTGDS_INTEGRATION_ENV: "staging" };
  const schedule = () => {};
  assert.equal(hooksFor("saas", env, schedule), undefined);
  const hooks = hooksFor("private", env, schedule);
  assert.equal(hooks?.config.enabled, true);
  assert.equal(hooks?.schedule, schedule);
  assert.equal(hooksFor("private", { ...env, ACTGDS_INTEGRATION_ENABLED: "false" }, schedule), undefined);
});
