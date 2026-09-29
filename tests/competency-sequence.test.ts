import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, updateLesson } from "../lib/repo.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, computeProgress, type CompetencyEvent } from "../lib/competency.ts";

// Tony-confirmed CBT&A sequence (permanent regression coverage):
//   Competency 18-22 may be TAUGHT any time, but may only be ASSESSED once
//   Competency 1-17 are all Achieved AND Review 1-17 is Achieved.
//   Review 1-22 needs 1-17 + Review 1-17 + 18-22 all Achieved.
//   Final Drive 23 needs Review 1-22 Achieved.

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_NEW = "data:image/png;base64,iVBORw0KGgoAAAA9";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ACHIEVED_1_17 = range(1, 17);
const GATED = range(18, 22);

type Db = ReturnType<typeof openTestD1>;

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Sequence Learner", instructorId: tony.id });
  let odo = 0;
  const lesson = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  const assess = (ids: string[], result: "achieved" | "not_achieved" = "achieved") =>
    createLesson(db, learner.id, lesson({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, result])) }));
  const teach = (ids: string[]) => createLesson(db, learner.id, lesson({ taughtIds: ids }));
  const progress = () => getLearnerProgress(db, learner.id);
  return { db, learner, assess, teach, progress, lesson };
}

const LOCKED_18_22 = /Competency 18-22 can only be assessed after Competency 1-17 and Review 1-17 are all achieved/;

// ── 18-22: Taught is never restricted ────────────────────────────────────

for (const id of GATED) {
  test(`${id} can be Taught on a brand-new learner, before 1-17 and Review 1-17`, async () => {
    const { teach, progress } = await setup();
    await teach([id]);
    assert.equal((await progress()).competencies[id].taughtCount, 1);
  });

  test(`${id} can still be Taught after 1-17 are achieved but before Review 1-17`, async () => {
    const { assess, teach, progress } = await setup();
    await assess(ACHIEVED_1_17);
    assert.equal((await progress()).review1_17.status, "ready");
    await teach([id]);
    assert.equal((await progress()).competencies[id].taughtCount, 1);
  });

  // ── 18-22: Assessed gate ───────────────────────────────────────────────

  test(`${id} cannot be Assessed before Competency 1-17 are all achieved`, async () => {
    const { assess } = await setup();
    await assert.rejects(() => assess([id]), LOCKED_18_22);
  });

  test(`${id} cannot be Assessed when only some of 1-17 are achieved`, async () => {
    const { assess } = await setup();
    await assess(range(1, 16));
    await assert.rejects(() => assess([id]), LOCKED_18_22);
  });

  test(`${id} cannot be Assessed after 1-17 are all achieved but before Review 1-17 is achieved`, async () => {
    const { assess, progress } = await setup();
    await assess(ACHIEVED_1_17);
    assert.equal((await progress()).review1_17.status, "ready");
    await assert.rejects(() => assess([id]), LOCKED_18_22);
    await assert.rejects(() => assess([id], "not_achieved"), LOCKED_18_22, "the gate applies to Not achieved too — it is about being assessed at all");
  });

  test(`${id} can be Assessed once 1-17 and Review 1-17 are achieved`, async () => {
    const { assess, progress } = await setup();
    await assess(ACHIEVED_1_17);
    await assess([REVIEW_1_17]);
    await assess([id]);
    assert.equal((await progress()).competencies[id].achieved, true);
  });
}

test("Review 1-17 and 18 cannot be Assessed in the same lesson (gates use state before the lesson)", async () => {
  const { assess } = await setup();
  await assess(ACHIEVED_1_17);
  await assert.rejects(() => assess([REVIEW_1_17, "18"]), LOCKED_18_22);
});

test("a rejected illegal 18-22 assessment leaves no lesson or competency events behind", async () => {
  const { assess, progress, db, learner } = await setup();
  await assess(ACHIEVED_1_17);
  await assert.rejects(() => assess(["18", "19"]), LOCKED_18_22);
  const p = await progress();
  assert.equal(p.competencies["18"].achieved, false);
  assert.equal(p.competencies["19"].firstAssessedAt, null);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE learner_id = ?").bind(learner.id).first<{ n: number }>();
  assert.equal(count?.n, 1);
});

test("Taught and Assessed 18-22 mix: teach 18 early, assess it only after the gate", async () => {
  const { assess, teach, progress } = await setup();
  await teach(["18"]);
  await assess(ACHIEVED_1_17);
  await assert.rejects(() => assess(["18"]), LOCKED_18_22);
  await assess([REVIEW_1_17]);
  await assess(["18"]);
  const p = await progress();
  assert.equal(p.competencies["18"].achieved, true);
  assert.equal(p.competencies["18"].taughtCount, 1);
});

// ── Review 1-22 ──────────────────────────────────────────────────────────

test("Review 1-22 stays LOCKED with 1-17 + Review 1-17 + only 18-21 achieved", async () => {
  const { assess, progress } = await setup();
  await assess(ACHIEVED_1_17);
  await assess([REVIEW_1_17]);
  await assess(range(18, 21));
  const p = await progress();
  assert.equal(p.review1_22.status, "locked");
  assert.equal(p.review1_22.remaining, 1);
  await assert.rejects(() => assess([REVIEW_1_22]), /Review 1-22 is locked/);
});

test("Review 1-22 becomes READY only when 1-17 + Review 1-17 + all of 18-22 are achieved, then can be Achieved", async () => {
  const { assess, progress } = await setup();
  await assess(ACHIEVED_1_17);
  await assess([REVIEW_1_17]);
  await assess(GATED);
  assert.equal((await progress()).review1_22.status, "ready");
  await assess([REVIEW_1_22]);
  assert.equal((await progress()).review1_22.status, "achieved");
});

test("Review 1-22 stays locked when an 18-22 assessment was Not achieved", async () => {
  const { assess, progress } = await setup();
  await assess(ACHIEVED_1_17);
  await assess([REVIEW_1_17]);
  await assess(range(18, 21));
  await assess(["22"], "not_achieved");
  assert.equal((await progress()).review1_22.status, "locked");
  await assess(["22"]);
  assert.equal((await progress()).review1_22.status, "ready");
});

function event(competencyId: string, action: "taught" | "assessed", result: "achieved" | "not_achieved" | null, n: number): CompetencyEvent {
  return { competencyId, action, result, lessonId: `l${n}`, createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z` };
}

test("snapshot: 1-22 all achieved WITHOUT Review 1-17 never makes Review 1-22 ready (legacy/illegal data can't skip the review)", () => {
  const events = [...range(1, 22)].map((id, i) => event(id, "assessed", "achieved", i));
  const p = computeProgress(events);
  assert.equal(p.review1_17.status, "ready");
  assert.equal(p.review1_22.status, "locked");
  assert.equal(p.finalDrive23.status, "locked");
});

// ── Final Drive 23 ───────────────────────────────────────────────────────

test("Final Drive stays locked until Review 1-22 is achieved, then completes the CBT&A", async () => {
  const { assess, progress } = await setup();
  await assess(ACHIEVED_1_17);
  await assess([REVIEW_1_17]);
  await assess(GATED);
  assert.equal((await progress()).finalDrive23.status, "locked");
  await assert.rejects(() => assess([FINAL_DRIVE_23]), /23 Final Drive is locked/);
  await assess([REVIEW_1_22]);
  const ready = await progress();
  assert.equal(ready.finalDrive23.status, "ready");
  assert.equal(ready.completed, false);
  await assess([FINAL_DRIVE_23]);
  const done = await progress();
  assert.equal(done.finalDrive23.status, "achieved");
  assert.equal(done.completed, true);
});

test("Review 1-22 and Final Drive cannot be Assessed in the same lesson", async () => {
  const { assess } = await setup();
  await assess(ACHIEVED_1_17);
  await assess([REVIEW_1_17]);
  await assess(GATED);
  await assert.rejects(() => assess([REVIEW_1_22, FINAL_DRIVE_23]), /23 Final Drive is locked/);
});

// ── History Edit enforces the same gate ──────────────────────────────────

test("History Edit cannot turn a lesson into an early 18-22 assessment", async () => {
  const { db, learner, teach, lesson } = await setup();
  const taughtLesson = await teach(["18"]);
  await assert.rejects(
    () =>
      updateLesson(db, learner.id, taughtLesson.id, {
        ...lesson({}),
        startOdometer: "0",
        finishOdometer: "5",
        assessedIds: ["18"],
        achievedResults: { "18": "achieved" },
        adiSignature: SIG_NEW,
        learnerSignature: SIG_NEW,
      }),
    LOCKED_18_22,
  );
});
