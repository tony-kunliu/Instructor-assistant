import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, updateLesson } from "../lib/repo.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, assessmentChronologyViolations, type CompetencyEvent } from "../lib/competency.ts";

// Canonical chronology (Tony): a lesson may only Assess
//   Review 1-17     if Competency 1-17 were all Achieved in EARLIER lessons;
//   Competency 18-22 if 1-17 + Review 1-17 were Achieved in EARLIER lessons;
//   Review 1-22     if 1-17 + Review 1-17 + 18-22 were Achieved in EARLIER lessons;
//   Final Drive 23  if Review 1-22 (and its prerequisites) were Achieved in EARLIER lessons.
// "Earlier" = lower lesson number (creation order, never editable). A later
// lesson can never legitimise an earlier one via History Edit. Legacy data that
// already breaks this is tolerated and never rewritten: only NEW violations
// block an edit.

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
let sigCounter = 0;
const freshSig = () => `data:image/png;base64,iVBORw0KGgoAAAA${500 + ++sigCounter}`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ach = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => Object.fromEntries(ids.map((id) => [id, result]));

const R17_LOCK = /Review 1-17 is locked/;
const R22_LOCK = /Review 1-22 is locked/;
const FD_LOCK = /23 Final Drive is locked/;

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Milestone Learner", instructorId: tony.id });
  let odo = 0;
  const input = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  const create = (extra: Record<string, unknown>) => createLesson(db, learner.id, input(extra));
  const assess = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => create({ assessedIds: ids, achievedResults: ach(ids, result) });
  type Lesson = Awaited<ReturnType<typeof createLesson>>;
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
  const editAssess = (lesson: Lesson, ids: string[], extra: Record<string, unknown> = {}) => edit(lesson, { assessedIds: ids, achievedResults: ach(ids), ...extra });
  return { db, learner, create, assess, edit, editAssess };
}

/** Lessons 1-6: taught-only, 1-17, Review 1-17, 18-22, Review 1-22, Final Drive. */
async function fullChain() {
  const ctx = await setup();
  const l1 = await ctx.create({ taughtIds: ["18"] });
  const l2 = await ctx.assess(range(1, 17));
  const l3 = await ctx.assess([REVIEW_1_17]);
  const l4 = await ctx.assess(range(18, 22));
  const l5 = await ctx.assess([REVIEW_1_22]);
  const l6 = await ctx.assess([FINAL_DRIVE_23]);
  return { ...ctx, l1, l2, l3, l4, l5, l6 };
}

// ── Forward progression (creating lessons) ───────────────────────────────

test("forward: each milestone opens only after its prerequisites, in order", async () => {
  const { assess } = await setup();
  await assert.rejects(() => assess([REVIEW_1_17]), R17_LOCK);
  await assess(range(1, 17));
  await assert.rejects(() => assess([REVIEW_1_22]), R22_LOCK);
  await assess([REVIEW_1_17]);
  await assert.rejects(() => assess([REVIEW_1_22]), R22_LOCK);
  await assess(range(18, 22));
  await assert.rejects(() => assess([FINAL_DRIVE_23]), FD_LOCK);
  await assess([REVIEW_1_22]);
  await assess([FINAL_DRIVE_23]);
});

test("forward: a milestone cannot be assessed in the same lesson as its own prerequisite", async () => {
  const { assess } = await setup();
  await assert.rejects(() => assess([...range(1, 17), REVIEW_1_17]), R17_LOCK);
});

// ── History Edit backdating: Review 1-17 ─────────────────────────────────

test("Review 1-17 cannot be backdated to an earlier lesson, even though 1-17 are achieved LATER", async () => {
  const { create, assess, editAssess } = await setup();
  const l1 = await create({ taughtIds: ["1"] }); // 1: nothing achieved yet
  const l2 = await assess(range(2, 17)); // 2
  const l3 = await assess(["1"]); // 3: completes 1-17
  await assess([REVIEW_1_17]); // 4
  await assert.rejects(() => editAssess(l1, [REVIEW_1_17], { taughtIds: [] }), R17_LOCK);
  await assert.rejects(() => editAssess(l2, [...range(2, 17), REVIEW_1_17]), R17_LOCK);
  await assert.rejects(() => editAssess(l3, ["1", REVIEW_1_17]), R17_LOCK, "same lesson as the one completing 1-17");
});

test("Review 1-17 cannot be added to the same lesson that completes 1-17", async () => {
  const { assess, editAssess } = await setup();
  const l1 = await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assert.rejects(() => editAssess(l1, [...range(1, 17), REVIEW_1_17]), R17_LOCK);
});

// ── Review 1-22 ──────────────────────────────────────────────────────────

for (const [name, key, own] of [
  ["a taught-only lesson before everything", "l1", []],
  ["the lesson that achieves 1-17", "l2", range(1, 17)],
  ["the lesson that achieves Review 1-17", "l3", [REVIEW_1_17]],
  ["the lesson that achieves 18-22", "l4", range(18, 22)],
] as const) {
  test(`Review 1-22 cannot be backdated onto ${name}, although Review 1-22 is achieved in a later lesson`, async () => {
    const ctx = await fullChain();
    await assert.rejects(() => ctx.editAssess(ctx[key], [...own, REVIEW_1_22], key === "l1" ? { taughtIds: [] } : {}), R22_LOCK);
  });
}

test("Review 1-22 cannot be assessed before 18-22 are all achieved, even if the 22nd is achieved in a later lesson", async () => {
  const { assess, editAssess } = await setup();
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  const l3 = await assess(range(18, 21)); // 3
  await assess(["22"]); // 4
  await assert.rejects(() => editAssess(l3, [...range(18, 21), REVIEW_1_22]), R22_LOCK);
});

test("Review 1-22 can still be moved to any lesson after its prerequisites (a taught-only lesson after the 18-22 lesson)", async () => {
  const { assess, create, editAssess } = await setup();
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22));
  const l4 = await create({ taughtIds: [] });
  const result = await editAssess(l4, [REVIEW_1_22]);
  assert.equal(result.progress.review1_22.status, "achieved");
});

// ── Final Drive 23 ───────────────────────────────────────────────────────

for (const key of ["l1", "l2", "l3", "l4", "l5"] as const) {
  test(`Final Drive cannot be backdated onto lesson ${key.slice(1)}, although it is achieved in Lesson 6`, async () => {
    const ctx = await fullChain();
    const lesson = ctx[key];
    const own: Record<string, string[]> = { l1: [], l2: range(1, 17), l3: [REVIEW_1_17], l4: range(18, 22), l5: [REVIEW_1_22] };
    await assert.rejects(() => ctx.editAssess(lesson, [...own[key], FINAL_DRIVE_23], key === "l1" ? { taughtIds: [] } : {}), FD_LOCK);
  });
}

test("Final Drive cannot ride on the same lesson as Review 1-22 (its own prerequisite)", async () => {
  const { assess, editAssess } = await setup();
  await assess(range(1, 17));
  await assess([REVIEW_1_17]);
  await assess(range(18, 22));
  const l5 = await assess([REVIEW_1_22]);
  await assert.rejects(() => editAssess(l5, [REVIEW_1_22, FINAL_DRIVE_23]), FD_LOCK);
});

// ── Legitimate History Edit keeps working ────────────────────────────────

test("normal corrections to every lesson of a complete chain still work (comments, times, odometer-neutral)", async () => {
  const ctx = await fullChain();
  await ctx.edit(ctx.l1, { taughtIds: ["18"], comments: "c1" });
  await ctx.editAssess(ctx.l2, range(1, 17), { comments: "c2", finishTime: "10:30" });
  await ctx.editAssess(ctx.l3, [REVIEW_1_17], { comments: "c3" });
  await ctx.editAssess(ctx.l4, range(18, 22), { comments: "c4" });
  await ctx.editAssess(ctx.l5, [REVIEW_1_22], { comments: "c5" });
  const last = await ctx.editAssess(ctx.l6, [FINAL_DRIVE_23], { comments: "c6" });
  assert.equal(last.progress.completed, true);
});

test("a milestone lesson may switch a result to Not achieved (direct edit of its own assessment)", async () => {
  const ctx = await fullChain();
  const result = await ctx.edit(ctx.l6, { assessedIds: [FINAL_DRIVE_23], achievedResults: ach([FINAL_DRIVE_23], "not_achieved") });
  assert.equal(result.progress.completed, false);
  assert.equal(result.invalidated.completed, true);
});

test("existing rollback still works: editing an earlier prerequisite lesson rolls back LATER milestones (derived state, reported)", async () => {
  const ctx = await fullChain();
  // Lesson 4 (18-22) marks 22 not achieved: Review 1-22 (L5) and Final Drive (L6) are no longer valid — reported, not rejected.
  const result = await ctx.edit(ctx.l4, { assessedIds: range(18, 22), achievedResults: { ...ach(range(18, 21)), "22": "not_achieved" } });
  assert.equal(result.invalidated.review1_22, true);
  assert.equal(result.invalidated.finalDrive23, true);
  assert.equal(result.invalidated.completed, true);
  assert.equal(result.progress.review1_22.status, "locked");
});

test("18-22 in a later lesson still blocks an edit that would break their prerequisites (no rollback exists for competencies)", async () => {
  const ctx = await fullChain();
  await assert.rejects(() => ctx.edit(ctx.l3, { assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17], "not_achieved") }), /would leave Lesson #4 assessing Competency 18, 20 or 21/);
});

// ── Legacy data ──────────────────────────────────────────────────────────

test("legacy: a lesson that already assessed Review 1-22 too early stays editable (unrelated fields), can drop it, but cannot add a NEW early milestone", async () => {
  const ctx = await fullChain();
  // Legacy row: Lesson 1 was recorded as assessing Review 1-22 before the chronology rule existed.
  await ctx.db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, 'assessed', 'achieved')").bind(crypto.randomUUID(), ctx.learner.id, ctx.l1.id, REVIEW_1_22).run();
  const kept = await ctx.editAssess(ctx.l1, [REVIEW_1_22], { taughtIds: [], comments: "typo fix" });
  assert.equal(kept.lesson.comments, "typo fix");
  await assert.rejects(() => ctx.editAssess(ctx.l1, [REVIEW_1_22, FINAL_DRIVE_23], { taughtIds: [] }), FD_LOCK);
  await ctx.edit(ctx.l1, { taughtIds: ["18"], assessedIds: [], achievedResults: {} });
});

test("legacy: other lessons of a learner with legacy milestone data stay editable", async () => {
  const ctx = await fullChain();
  await ctx.db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, 'assessed', 'achieved')").bind(crypto.randomUUID(), ctx.learner.id, ctx.l1.id, REVIEW_1_17).run();
  await ctx.editAssess(ctx.l4, range(18, 22), { comments: "unrelated correction" });
});

// ── Taught: "already achieved" is judged by chronology too ────────────────

test("a lesson may keep teaching a competency that was only achieved LATER, but not one achieved in an EARLIER lesson", async () => {
  const { create, assess, edit } = await setup();
  const l1 = await assess(["5"]); // 5 achieved in lesson 1
  const l2 = await create({ taughtIds: ["6"] }); // lesson 2 teaches 6
  await assess(["6"]); // 6 achieved in lesson 3
  await edit(l2, { taughtIds: ["6"], comments: "6 is achieved later — still fine to have been taught here" });
  await assert.rejects(() => edit(l2, { taughtIds: ["5"] }), /already achieved and can no longer be taught/);
  void l1;
});

// ── The chronology function ──────────────────────────────────────────────

function ev(lessonId: string, competencyId: string, action: "taught" | "assessed", result: "achieved" | "not_achieved" | null, n: number): CompetencyEvent {
  return { competencyId, action, result, lessonId, createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z` };
}
const achieved = (lessonId: string, ids: string[], n: number) => ids.map((id, i) => ev(lessonId, id, "assessed", "achieved", n + i));

test("assessmentChronologyViolations: flags every gated assessment made before its prerequisites, in any order of input", () => {
  const violations = assessmentChronologyViolations([
    { lessonNo: 4, events: achieved("l4", [FINAL_DRIVE_23], 40) },
    { lessonNo: 1, events: [...achieved("l1", [REVIEW_1_17, REVIEW_1_22, "18"], 10), ev("l1", "19", "taught", null, 20)] },
    { lessonNo: 2, events: achieved("l2", range(1, 17), 30) },
    { lessonNo: 3, events: achieved("l3", [REVIEW_1_17], 35) },
  ]);
  assert.deepEqual([...violations].sort(), ["1:18", "1:review-1-17", "1:review-1-22", "4:final-drive-23"].sort());
});

test("assessmentChronologyViolations: a clean chain has none", () => {
  const events = [
    { lessonNo: 1, events: achieved("l1", range(1, 17), 0) },
    { lessonNo: 2, events: achieved("l2", [REVIEW_1_17], 30) },
    { lessonNo: 3, events: achieved("l3", range(18, 22), 40) },
    { lessonNo: 4, events: achieved("l4", [REVIEW_1_22], 60) },
    { lessonNo: 5, events: achieved("l5", [FINAL_DRIVE_23], 70) },
  ];
  assert.equal(assessmentChronologyViolations(events).size, 0);
});

test("progress snapshot is unchanged by this feature (a full valid chain still completes)", async () => {
  const ctx = await fullChain();
  assert.equal((await getLearnerProgress(ctx.db, ctx.learner.id)).completed, true);
});
