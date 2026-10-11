import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getCompletionSummary, getLearnerProgress, importPaperLessons, updateLesson } from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import {
  FINAL_DRIVE_23,
  REVIEW_1_17,
  REVIEW_1_22,
  computeProgress,
  invalidationNotice,
  type CompetencyEvent,
} from "../lib/competency.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks, LessonUpsertedPayloadV1 } from "../lib/integration/types.ts";

// Bug report (tony-kunliu/actgds.com Issue #3, comment 6104913100), item 1:
// a History Edit that removes a prerequisite from an earlier lesson, while the
// same prerequisite is only re-achieved in a LATER lesson, must not leave the
// dependent Review / Final Drive valid. A prerequisite achieved only after the
// dependent assessment never retroactively validates it. Policy: the edit is
// allowed, the milestone is derived as not achieved (never deleting the
// original assessment events), and the response reports it as invalidated.
// Validity is judged by lesson order only (no timestamps): data that already
// broke the chronology is derived the same way (Tony's call via the
// coordinator, 2026-10-11: Production holds ~3 learners, mostly test data).
// Item 2: the completion summary follows the derived completed state.

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
let sigCounter = 0;
const freshSig = () => `data:image/png;base64,iVBORw0KGgoAAAA${900 + ++sigCounter}`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ach = (ids: string[], result: "achieved" | "not_achieved" = "achieved") => Object.fromEntries(ids.map((id) => [id, result]));

function enabledHooks(): IntegrationHooks {
  const config = resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" });
  // Never delivers: the outbox rows stay pending so the test can read the enqueued payloads.
  return { config, fetchImpl: (async () => new Response(null, { status: 202 })) as typeof fetch, schedule: () => {} };
}

async function setup(integration?: IntegrationHooks) {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Invalidation Learner", instructorId: tony.id });
  let odo = 0;
  const input = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  const create = (extra: Record<string, unknown>) => createLesson(db, learner.id, input(extra), integration);
  const assess = (ids: string[]) => create({ assessedIds: ids, achievedResults: ach(ids) });
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
    }, integration);
  const editAssess = (lesson: Lesson, ids: string[], extra: Record<string, unknown> = {}) => edit(lesson, { assessedIds: ids, achievedResults: ach(ids), ...extra });
  const progress = () => getLearnerProgress(db, learner.id);
  return { db, learner, create, assess, edit, editAssess, progress };
}

// ── 1. The exact reproduction: Review 1-17 ───────────────────────────────

test("repro: removing 17 from Lesson 1 while 17 is only re-achieved in Lesson 3 invalidates Review 1-17 (Lesson 2), reported and persisted", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  await ctx.assess([REVIEW_1_17]);
  await ctx.assess(["17"]);
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, true, "reported as invalidated");
  assert.notEqual(result.progress.review1_17.status, "achieved");
  assert.equal(result.progress.review1_17.status, "ready", "1-17 are all achieved now, so Review 1-17 can be re-assessed");
  const reread = await ctx.progress();
  assert.notEqual(reread.review1_17.status, "achieved", "the derived state persists on the next read (GET)");
  assert.equal(reread.competencies[REVIEW_1_17].achieved, true, "the original Review 1-17 assessment event is kept for audit");
  assert.equal(reread.competencies[REVIEW_1_17].achievedLessonIds.length, 1);
  assert.equal(invalidationNotice(result.invalidated), "No longer valid: Review 1-17 (prerequisites must be achieved in earlier lessons).");
});

test("repro: the corrected progress is what is enqueued for ACTGDS (direct and downstream events), schema shape unchanged", async () => {
  const hooks = enabledHooks();
  const ctx = await setup(hooks);
  const l1 = await ctx.assess(range(1, 17));
  await ctx.assess([REVIEW_1_17]);
  await ctx.assess(["17"]);
  await ctx.editAssess(l1, range(1, 16));
  const { results } = await ctx.db.prepare("SELECT payload_json FROM integration_outbox ORDER BY rowid DESC LIMIT 3").all<{ payload_json: string }>();
  assert.equal(results.length, 3, "the edit's own event + two propagated events");
  for (const row of results) {
    const payload = JSON.parse(row.payload_json) as LessonUpsertedPayloadV1;
    assert.equal(payload.progress.review_1_17, "ready");
    assert.deepEqual(Object.keys(payload.progress).sort(), ["achieved_count", "cbta_status", "final_drive_23", "review_1_17", "review_1_22", "total_competencies"]);
  }
});

test("same lesson: 17 re-assessed in the Review 1-17 lesson itself does not keep Review 1-17 valid once Lesson 1 loses 17", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  await ctx.assess(["17", REVIEW_1_17]); // allowed at creation: 17 was already achieved in Lesson 1
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, true);
  assert.notEqual((await ctx.progress()).review1_17.status, "achieved");
});

test("control: 17 re-achieved in an EARLIER lesson than Review 1-17 keeps Review 1-17 valid (nothing invalidated)", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  await ctx.assess(["17"]);
  await ctx.assess([REVIEW_1_17]);
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, false);
  assert.equal(result.progress.review1_17.status, "achieved");
});

// ── 2. Review 1-22 and Final Drive 23 ────────────────────────────────────

test("Review 1-22: removing 22 from the 18-22 lesson while 22 is only re-achieved after Review 1-22 invalidates Review 1-22, Final Drive and Completed", async () => {
  const ctx = await setup();
  await ctx.assess(range(1, 17)); // 1
  await ctx.assess([REVIEW_1_17]); // 2
  const l3 = await ctx.assess(range(18, 22)); // 3
  await ctx.assess([REVIEW_1_22]); // 4
  await ctx.assess(["22"]); // 5: 22 assessed again
  await ctx.assess([FINAL_DRIVE_23]); // 6
  assert.equal((await ctx.progress()).completed, true);
  const result = await ctx.editAssess(l3, range(18, 21));
  assert.deepEqual(result.invalidated, { review1_17: false, review1_22: true, finalDrive23: true, completed: true });
  const reread = await ctx.progress();
  assert.equal(reread.review1_22.status, "ready");
  assert.equal(reread.completed, false);
  assert.equal(result.completion, null, "no completion summary once completion is invalid");
  assert.equal(await getCompletionSummary(ctx.db, ctx.learner.id, reread), null);
});

function ev(lessonNo: number, competencyId: string, n: number, result: "achieved" | "not_achieved" = "achieved"): CompetencyEvent {
  return { competencyId, action: "assessed", result, lessonId: `L${lessonNo}`, lessonNo, createdAt: `2026-09-01T00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z` };
}
const evs = (lessonNo: number, ids: string[], n: number) => ids.map((id, i) => ev(lessonNo, id, n + i));

test("pure: Final Drive whose Review 1-22 prerequisite exists only in a LATER lesson is not valid (completed false)", () => {
  const events = [...evs(1, range(1, 17), 0), ...evs(2, [REVIEW_1_17], 100), ...evs(3, range(18, 22), 200), ...evs(5, [FINAL_DRIVE_23], 300), ...evs(6, [REVIEW_1_22], 400)];
  const progress = computeProgress(events);
  assert.equal(progress.review1_22.status, "achieved", "Review 1-22 itself is valid in Lesson 6");
  assert.equal(progress.finalDrive23.status, "ready");
  assert.equal(progress.completed, false);
});

test("pure: Review 1-22 whose Review 1-17 prerequisite exists only in a later lesson is not valid (and so neither is Final Drive)", () => {
  const events = [...evs(1, range(1, 22).filter((id) => !["18", "20", "21"].includes(id)), 0), ...evs(3, [REVIEW_1_22], 100), ...evs(4, [FINAL_DRIVE_23], 150), ...evs(5, [REVIEW_1_17], 200), ...evs(6, ["18", "20", "21"], 250)];
  const progress = computeProgress(events);
  assert.equal(progress.review1_17.status, "achieved");
  assert.equal(progress.review1_22.status, "ready");
  assert.equal(progress.finalDrive23.status, "locked");
  assert.equal(progress.completed, false);
});

test("pure: a clean forward chain is fully achieved; without lesson numbers no milestone can be validated (conservative)", () => {
  const events = [...evs(1, range(1, 17), 0), ...evs(2, [REVIEW_1_17], 100), ...evs(3, range(18, 22), 200), ...evs(4, [REVIEW_1_22], 300), ...evs(5, [FINAL_DRIVE_23], 400)];
  assert.equal(computeProgress(events).completed, true);
  const unknown = computeProgress(events.map(({ lessonNo: _n, ...rest }) => rest));
  assert.equal(unknown.review1_17.status, "ready");
  assert.equal(unknown.completed, false);
});

test("pure: recording time never matters — a prerequisite in a later lesson recorded earlier does not count, one in an earlier lesson recorded later does", () => {
  // Lesson 2 holds 1-17 recorded at minute 1; Review 1-17 sits in Lesson 1, recorded later (an old backdating edit).
  assert.equal(computeProgress([...evs(2, range(1, 17), 60), ev(1, REVIEW_1_17, 600)]).review1_17.status, "ready");
  // 1-17 in Lesson 1 but recorded after the Review in Lesson 2 (Lesson 1 re-saved by an edit): still valid.
  assert.equal(computeProgress([ev(2, REVIEW_1_17, 0), ...evs(1, range(1, 17), 600)]).review1_17.status, "achieved");
});

// ── 3. Prior-instructor and paper records, events without a lesson ──────

test("pure: prior-instructor records are one unit among themselves and come before every positive lesson", () => {
  const prior = [...range(1, 22), REVIEW_1_17, REVIEW_1_22].map((id) => ({ competencyId: id, action: "assessed" as const, result: "achieved" as const, lessonId: "P1", lessonNo: -1, createdAt: "2026-09-01T00:00:00.000Z" }));
  const progress = computeProgress([...prior, ...evs(1, [FINAL_DRIVE_23], 100)]);
  assert.equal(progress.review1_17.status, "achieved");
  assert.equal(progress.review1_22.status, "achieved");
  assert.equal(progress.completed, true);
  // Split over two prior records (-2: 1-17, -1: the rest) is the same unit.
  const split = [...evs(-2, range(1, 17), 0), ...evs(-1, [...range(18, 22), REVIEW_1_17, REVIEW_1_22], 0)];
  assert.equal(computeProgress(split).review1_22.status, "achieved");
});

test("DB: a transfer learner (one prior record stamping 1-22 + both reviews) completes with an app Final Drive; completion names that lesson", async () => {
  const ctx = await setup();
  const all = [...range(1, 22), REVIEW_1_17, REVIEW_1_22].join(";");
  const csv = [PAPER_CSV_COLUMNS.join(","), PAPER_CSV_COLUMNS.map((c) => ({ date: "2025-12-01", prior_instructor: "QA ADI 1", prior_lessons: "10", prior_hours: "20", prior_km: "100", assessed_achieved: all } as Record<string, string>)[c] ?? "").join(",")].join("\n") + "\n";
  await importPaperLessons(ctx.db, ctx.learner.id, csv, "commit");
  assert.equal((await ctx.progress()).review1_22.status, "achieved");
  const fd = await ctx.assess([FINAL_DRIVE_23]);
  const progress = await ctx.progress();
  assert.equal(progress.completed, true);
  assert.equal((await getCompletionSummary(ctx.db, ctx.learner.id, progress))?.completingLessonNo, fd.lessonNo);
});

test("DB: paper-import lessons are ordinary lessons (forward chain valid; Final Drive in a later app lesson completes)", async () => {
  const ctx = await setup();
  const row = (date: string, ids: string[]) => PAPER_CSV_COLUMNS.map((c) => ({ date, signature: "on_paper", instructor: "Tony", assessed_achieved: ids.join(";") } as Record<string, string>)[c] ?? "").join(",");
  const csv = [PAPER_CSV_COLUMNS.join(","), row("2026-01-01", range(1, 17)), row("2026-01-02", [REVIEW_1_17]), row("2026-01-03", range(18, 22)), row("2026-01-04", [REVIEW_1_22])].join("\n") + "\n";
  await importPaperLessons(ctx.db, ctx.learner.id, csv, "commit");
  assert.equal((await ctx.progress()).finalDrive23.status, "ready");
  await ctx.assess([FINAL_DRIVE_23]);
  assert.equal((await ctx.progress()).completed, true);
});

test("DB: an event whose lesson row is missing is still read (LEFT JOIN) but can never validate a milestone", async () => {
  const ctx = await setup();
  await ctx.assess(range(1, 17));
  await ctx.db.exec("PRAGMA foreign_keys = OFF");
  await ctx.db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, 'no-such-lesson', ?, 'assessed', 'achieved')").bind(crypto.randomUUID(), ctx.learner.id, REVIEW_1_17).run();
  const progress = await ctx.progress();
  assert.equal(progress.competencies[REVIEW_1_17].achieved, true, "the orphan event is not silently dropped");
  assert.equal(progress.review1_17.status, "ready", "…but it does not count");
});

// ── Reviewer's scenario: flipping a result never revives a milestone ─────

test("reviewer S1: Review 1-17 Not achieved in L2, 17 only in L3 after L1 loses 17; flipping L2 to Achieved is saved but derived invalid and reported", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  const l2 = await ctx.create({ assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17], "not_achieved") });
  await ctx.assess(["17"]);
  await ctx.editAssess(l1, range(1, 16));
  const flipped = await ctx.editAssess(l2, [REVIEW_1_17]);
  assert.notEqual(flipped.progress.review1_17.status, "achieved");
  assert.equal(flipped.invalidated.review1_17, true, "reported: the Achieved it records does not count");
  assert.notEqual((await ctx.progress()).review1_17.status, "achieved");
});

test("reviewer S1, other order: flip L2 to Achieved first (valid), then remove 17 from L1 → invalidated", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  const l2 = await ctx.create({ assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17], "not_achieved") });
  await ctx.assess(["17"]);
  assert.equal((await ctx.editAssess(l2, [REVIEW_1_17])).progress.review1_17.status, "achieved");
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, true);
  assert.notEqual((await ctx.progress()).review1_17.status, "achieved");
});

test("an invalidated Review / Final Drive cannot be revived by Achieved → Not achieved → Achieved edits", async () => {
  const ctx = await setup();
  await ctx.assess(range(1, 17)); // 1
  await ctx.assess([REVIEW_1_17]); // 2
  const l3 = await ctx.assess(range(18, 22)); // 3
  const l4 = await ctx.assess([REVIEW_1_22]); // 4
  await ctx.assess(["22"]); // 5
  const l6 = await ctx.assess([FINAL_DRIVE_23]); // 6
  await ctx.editAssess(l3, range(18, 21)); // 22 only in Lesson 5 now
  for (const [lesson, id] of [[l4, REVIEW_1_22], [l6, FINAL_DRIVE_23]] as const) {
    await ctx.edit(lesson, { assessedIds: [id], achievedResults: ach([id], "not_achieved") });
    const revived = await ctx.editAssess(lesson, [id]);
    assert.equal(revived.progress.review1_22.status, "ready", `${id}: Review 1-22 stays not achieved`);
    assert.equal(revived.progress.completed, false);
  }
  const progress = await ctx.progress();
  assert.equal(progress.completed, false);
  assert.equal(await getCompletionSummary(ctx.db, ctx.learner.id, progress), null);
});

test("an unrelated edit never blocks: correcting the Review 1-17 lesson, then removing 17 from Lesson 1, is allowed and derived invalid", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17));
  const l2 = await ctx.assess([REVIEW_1_17]);
  await ctx.assess(["17"]);
  await ctx.editAssess(l2, [REVIEW_1_17], { comments: "typo" });
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, true);
});

// ── 4. Completion summary follows derived completion (bug 2) ─────────────

test("bug 2: valid full chain, then 22 revoked in an earlier lesson → completed false and the completion summary is null", async () => {
  const ctx = await setup();
  await ctx.assess(range(1, 17));
  await ctx.assess([REVIEW_1_17]);
  const l3 = await ctx.assess(range(18, 22));
  await ctx.assess([REVIEW_1_22]);
  const fd = await ctx.assess([FINAL_DRIVE_23]);
  const before = await ctx.progress();
  assert.equal((await getCompletionSummary(ctx.db, ctx.learner.id, before))?.completingLessonNo, fd.lessonNo);
  const result = await ctx.edit(l3, { assessedIds: range(18, 22), achievedResults: { ...ach(range(18, 21)), "22": "not_achieved" } });
  assert.equal(result.progress.completed, false);
  assert.equal(result.invalidated.completed, true);
  assert.equal(result.completion, null);
  const after = await ctx.progress();
  assert.equal(after.completed, false);
  assert.equal(await getCompletionSummary(ctx.db, ctx.learner.id, after), null);
  assert.equal(await getCompletionSummary(ctx.db, ctx.learner.id), null, "without a progress argument it derives the same answer");
  assert.equal(after.competencies[FINAL_DRIVE_23].achieved, true, "the raw Final Drive event stays for audit");
});

test("bug 2: completion summary names the Final Drive that is actually valid when an earlier Final Drive no longer counts", () => {
  const events = [...evs(1, range(1, 17), 0), ...evs(2, [REVIEW_1_17], 100), ...evs(3, range(18, 22), 200), ...evs(5, [FINAL_DRIVE_23], 300), ...evs(6, [REVIEW_1_22], 400), ...evs(7, [FINAL_DRIVE_23], 500)];
  const progress = computeProgress(events);
  assert.equal(progress.completed, true);
  assert.equal(progress.completedLessonId, "L7");
});

test("bug 2: with two valid Final Drives the completion names the earlier LESSON, whatever the recording order", () => {
  const chain = [...evs(1, range(1, 17), 0), ...evs(2, [REVIEW_1_17], 100), ...evs(3, range(18, 22), 200), ...evs(4, [REVIEW_1_22], 300)];
  const progress = computeProgress([...chain, ev(6, FINAL_DRIVE_23, 400), ev(5, FINAL_DRIVE_23, 500)]);
  assert.equal(progress.completedLessonId, "L5");
});

test("invalidationNotice: null when nothing was invalidated, one short line naming every invalidated milestone otherwise", () => {
  assert.equal(invalidationNotice({ review1_17: false, review1_22: false, finalDrive23: false, completed: false }), null);
  assert.equal(invalidationNotice({ review1_17: false, review1_22: true, finalDrive23: true, completed: true }), "No longer valid: Review 1-22, 23 Final Drive, CBT&A Completed (prerequisites must be achieved in earlier lessons).");
});
