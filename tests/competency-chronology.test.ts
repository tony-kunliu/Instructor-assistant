import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, updateLesson } from "../lib/repo.ts";
import { REVIEW_1_17, assessmentChronologyViolations, type CompetencyEvent } from "../lib/competency.ts";

// Canonical rule (Tony): Competency 18-22 may be Taught any time, but a lesson
// may only Assess / Achieve them if, in EARLIER lessons (lesson number order,
// which is creation order and never editable), Competency 1-17 are all
// Achieved AND Review 1-17 is Achieved. History Edit must keep that
// chronology. Legacy data that already breaks it is never rewritten.

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
let sigCounter = 0;
const freshSig = () => `data:image/png;base64,iVBORw0KGgoAAAA${100 + ++sigCounter}`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ach = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => Object.fromEntries(ids.map((id) => [id, result]));

const OWN = /Competency 18, 20 and 21 can only be assessed after Competency 1-17 and Review 1-17 are all achieved/;
const LATER = (n: number) => new RegExp(`would leave Lesson #${n} assessing Competency 18, 20 or 21 before Competency 1-17 and Review 1-17 were achieved in earlier lessons`);

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Chronology Learner", instructorId: tony.id });
  let odo = 0;
  const input = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  const create = (extra: Record<string, unknown>) => createLesson(db, learner.id, input(extra));
  const assess = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => create({ assessedIds: ids, achievedResults: ach(ids, result) });
  type Lesson = Awaited<ReturnType<typeof createLesson>>;
  /** Edit an existing lesson, keeping its times/odometers; `changes` overrides selections/comments. Signatures are re-drawn when content changes. */
  const edit = (lesson: Lesson, changes: Record<string, unknown>) =>
    updateLesson(db, learner.id, lesson.id, {
      lessonDate: lesson.lessonDate,
      startTime: lesson.startTime,
      finishTime: lesson.finishTime,
      startOdometer: String(lesson.startOdometer),
      finishOdometer: String(lesson.finishOdometer),
      adiSignature: freshSig(),
      learnerSignature: freshSig(),
      ...changes,
    });
  const progress = () => getLearnerProgress(db, learner.id);
  return { db, learner, create, assess, edit, progress };
}

// ── The reported loophole: an earlier lesson edited to assess 18-22 ──────

for (const id of ["18", "20", "21"]) {
  test(`History Edit cannot make an EARLIER lesson (before Review 1-17) assess ${id}, even though Review 1-17 is achieved in a later lesson`, async () => {
    const { create, assess, edit } = await setup();
    const lessonA = await create({ taughtIds: [id] }); // Lesson 1: taught only
    await assess(range(1, 17)); // Lesson 2
    await assess([REVIEW_1_17]); // Lesson 3: Review 1-17 achieved
    await assert.rejects(() => edit(lessonA, { taughtIds: [], assessedIds: [id], achievedResults: ach([id]) }), OWN);
  });
}

test("…also rejected for Not achieved (being assessed at all is what the gate is about)", async () => {
  const { create, assess, edit } = await setup();
  const lessonA = await create({ taughtIds: ["18"] });
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assert.rejects(() => edit(lessonA, { taughtIds: [], assessedIds: ["18"], achievedResults: ach(["18"], "not_achieved") }), OWN);
});

test("a lesson AFTER Review 1-17 can still be edited to assess 18-22", async () => {
  const { create, assess, edit } = await setup();
  await assess(range(1, 17)); // 1
  await assess([REVIEW_1_17]); // 2
  const lessonC = await create({ taughtIds: ["18"] }); // 3: taught only, after the gate
  const result = await edit(lessonC, { taughtIds: [], assessedIds: ["18"], achievedResults: ach(["18"]) });
  assert.equal(result.progress.competencies["18"].achieved, true);
});

test("the edited lesson may not rely on 1-17 / Review 1-17 achieved in the SAME lesson", async () => {
  const { create, assess, edit } = await setup();
  await assess(range(1, 16)); // 1
  const lessonB = await create({ assessedIds: ["17"], achievedResults: ach(["17"]) }); // 2
  await assess([REVIEW_1_17]); // 3
  await assert.rejects(() => edit(lessonB, { assessedIds: ["17", "18"], achievedResults: ach(["17", "18"]) }), OWN);
});

test("editing a lesson that is the Review 1-17 lesson to also assess 18 is rejected (needs Review 1-17 achieved in an earlier lesson)", async () => {
  const { assess, edit } = await setup();
  await assess(range(1, 17));
  const lessonR17 = await assess([REVIEW_1_17]);
  await assert.rejects(() => edit(lessonR17, { assessedIds: [REVIEW_1_17, "18"], achievedResults: ach([REVIEW_1_17, "18"]) }), OWN);
});

// ── History Edit must not break a LATER lesson's chronology ───────────────

test("an edit that removes Review 1-17 achievement cannot leave a later lesson assessing 18-22", async () => {
  const { assess, edit, progress } = await setup();
  await assess(range(1, 17)); // 1
  const lessonR17 = await assess([REVIEW_1_17]); // 2
  await assess(["18"]); // 3
  await assert.rejects(() => edit(lessonR17, { assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17], "not_achieved") }), LATER(3));
  assert.equal((await progress()).competencies["18"].achieved, true, "nothing was written");
  assert.equal((await progress()).review1_17.status, "achieved");
});

test("an edit that un-achieves a 1-17 competency cannot leave a later lesson assessing 18-22", async () => {
  const { assess, edit } = await setup();
  const lesson1 = await assess(range(1, 17)); // 1
  await assess([REVIEW_1_17]); // 2
  await assess(["18"]); // 3
  await assert.rejects(() => edit(lesson1, { assessedIds: range(1, 17), achievedResults: { ...ach(range(1, 16)), "17": "not_achieved" } }), LATER(3));
});

test("the same edit is fine while no later lesson assesses 18-22 (Review rollback rules are unchanged)", async () => {
  const { assess, edit } = await setup();
  const lesson1 = await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  const result = await edit(lesson1, { assessedIds: range(1, 17), achievedResults: { ...ach(range(1, 16)), "17": "not_achieved" } });
  assert.equal(result.invalidated.review1_17, true);
});

test("harmless edits (comments, times) of the prerequisite lessons and of 18-22 lessons still work", async () => {
  const { assess, edit } = await setup();
  const lesson1 = await assess(range(1, 17));
  const lesson2 = await assess([REVIEW_1_17]);
  const lesson3 = await assess(["18"]);
  await edit(lesson1, { assessedIds: range(1, 17), achievedResults: ach(range(1, 17)), comments: "note 1" });
  await edit(lesson2, { assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17]), comments: "note 2" });
  await edit(lesson3, { assessedIds: ["18"], achievedResults: ach(["18"]), comments: "note 3" });
});

test("a lesson may swap which of 18-22 it assesses while the gate holds", async () => {
  const { assess, edit } = await setup();
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  const lesson3 = await assess(["18"]);
  const result = await edit(lesson3, { assessedIds: ["19", "20"], achievedResults: ach(["19", "20"]) });
  assert.equal(result.progress.competencies["19"].achieved, true);
});

// ── Taught stays unrestricted, including via History Edit ─────────────────

test("18-22 can be Taught in an early lesson and via History Edit at any position", async () => {
  const { create, assess, edit } = await setup();
  const lesson1 = await create({ taughtIds: ["18"] });
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await edit(lesson1, { taughtIds: ["18", "19", "20", "21", "22"] });
});

// ── Legacy data is tolerated, never rewritten, never made un-editable ─────

async function legacyAssessedEarly() {
  const ctx = await setup();
  const lessonA = await ctx.create({ taughtIds: ["18"] }); // Lesson 1
  const lessonB = await ctx.assess(range(1, 17)); // Lesson 2
  await ctx.assess([REVIEW_1_17]); // Lesson 3
  // Legacy: created before the gate existed — Lesson 1 already assessed 18.
  await ctx.db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, '18', 'assessed', 'achieved')").bind(crypto.randomUUID(), ctx.learner.id, lessonA.id).run();
  await ctx.db.prepare("UPDATE lessons SET competencies_assessed = '18', achieved = '18' WHERE id = ?").bind(lessonA.id).run();
  return { ...ctx, lessonA, lessonB };
}

test("legacy: a lesson that already assessed 18 too early can still be edited for unrelated fields, keeping its 18 assessment", async () => {
  const { edit, lessonA } = await legacyAssessedEarly();
  const result = await edit(lessonA, { taughtIds: [], assessedIds: ["18"], achievedResults: ach(["18"]), comments: "fixing a typo" });
  assert.equal(result.progress.competencies["18"].achieved, true, "legacy assessment is not rewritten");
});

test("legacy: an edit may fix the legacy lesson by removing the early 18 assessment", async () => {
  const { edit, lessonA } = await legacyAssessedEarly();
  const result = await edit(lessonA, { taughtIds: ["18"], assessedIds: [], achievedResults: {} });
  assert.equal(result.progress.competencies["18"].achieved, false);
});

test("legacy: but the same lesson cannot ADD a new early 18-22 assessment", async () => {
  const { edit, lessonA } = await legacyAssessedEarly();
  await assert.rejects(() => edit(lessonA, { taughtIds: [], assessedIds: ["18", "20"], achievedResults: ach(["18", "20"]) }), OWN);
});

test("legacy: other lessons of a learner with legacy data stay editable", async () => {
  const { edit, lessonB } = await legacyAssessedEarly();
  await edit(lessonB, { assessedIds: range(1, 17), achievedResults: ach(range(1, 17)), comments: "unrelated correction" });
});

// ── The chronology function itself ───────────────────────────────────────

function ev(lessonId: string, competencyId: string, action: "taught" | "assessed", result: "achieved" | "not_achieved" | null, n: number): CompetencyEvent {
  return { competencyId, action, result, lessonId, createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z` };
}
const lessonEvents = (lessonNo: number, events: CompetencyEvent[]) => ({ lessonNo, events });

test("assessmentChronologyViolations: flags exactly the 18-22 assessments made before the gate, per lesson number", () => {
  const first17 = range(1, 17).map((id, i) => ev("l2", id, "assessed", "achieved", i));
  const violations = assessmentChronologyViolations([
    lessonEvents(1, [ev("l1", "18", "assessed", "achieved", 0)]),
    lessonEvents(2, first17),
    lessonEvents(3, [ev("l3", REVIEW_1_17, "assessed", "achieved", 30), ev("l3", "21", "assessed", "achieved", 31)]), // same lesson as Review 1-17 → still a violation
    lessonEvents(4, [ev("l4", "20", "assessed", "achieved", 40)]), // after the gate → fine
    lessonEvents(5, [ev("l5", "21", "taught", null, 50)]), // taught → never a violation
  ]);
  assert.deepEqual([...violations].sort(), ["1:18", "3:21"]);
});

test("assessmentChronologyViolations: order of the input array does not matter, only lesson numbers", () => {
  const events = [
    lessonEvents(3, [ev("l3", "18", "assessed", "achieved", 3)]),
    lessonEvents(1, range(1, 17).map((id, i) => ev("l1", id, "assessed", "achieved", i))),
    lessonEvents(2, [ev("l2", REVIEW_1_17, "assessed", "achieved", 20)]),
  ];
  assert.deepEqual([...assessmentChronologyViolations(events)], []);
});

test("History Edit CAN make an earlier lesson (before Review 1-17) assess 19 — any time (NI2020-703)", async () => {
  const { create, assess, edit } = await setup();
  const lessonA = await create({ taughtIds: ["19"] });
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  const result = await edit(lessonA, { taughtIds: [], assessedIds: ["19"], achievedResults: ach(["19"]) });
  assert.equal(result.progress.competencies["19"].achieved, true);
});
