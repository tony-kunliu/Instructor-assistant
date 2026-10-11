import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getCompletionSummary, getLearnerProgress, updateLesson } from "../lib/repo.ts";
import {
  FINAL_DRIVE_23,
  REVIEW_1_17,
  REVIEW_1_22,
  assessmentChronologyViolations,
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
// Legacy violations (already in the data before an edit) stay tolerated.
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
  assert.match(invalidationNotice(result.invalidated) ?? "", /Review 1-17 is no longer valid because/);
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

test("pure: a clean forward chain is fully achieved, with or without lesson numbers", () => {
  const events = [...evs(1, range(1, 17), 0), ...evs(2, [REVIEW_1_17], 100), ...evs(3, range(18, 22), 200), ...evs(4, [REVIEW_1_22], 300), ...evs(5, [FINAL_DRIVE_23], 400)];
  assert.equal(computeProgress(events).completed, true);
  assert.equal(computeProgress(events.map(({ lessonNo: _n, ...rest }) => rest)).completed, true);
});

// ── 3. Legacy tolerance: violations already in the data stay tolerated ───

test("pure legacy: a milestone backdated by an old edit (recorded AFTER its prerequisites, but in an earlier lesson) stays achieved", () => {
  // Lesson 2 achieved 1-17 at minute 1; an old History Edit (before the chronology rule) later put Review 1-17 into Lesson 1.
  const events = [...evs(2, range(1, 17), 60), ev(1, REVIEW_1_17, 600)];
  assert.equal(assessmentChronologyViolations([{ lessonNo: 1, events: [ev(1, REVIEW_1_17, 600)] }, { lessonNo: 2, events: evs(2, range(1, 17), 60) }]).has(`1:${REVIEW_1_17}`), true, "it is a chronology violation");
  assert.equal(computeProgress(events).review1_17.status, "achieved", "…tolerated, as before");
});

test("pure legacy: a prior-instructor record stamping 1-22, Review 1-17 and Review 1-22 together stays valid", () => {
  const prior = [...range(1, 22), REVIEW_1_17, REVIEW_1_22].map((id) => ({ competencyId: id, action: "assessed" as const, result: "achieved" as const, lessonId: "P1", lessonNo: -1, createdAt: "2026-09-01T00:00:00.000Z" }));
  const progress = computeProgress([...prior, ...evs(1, [FINAL_DRIVE_23], 100)]);
  assert.equal(progress.review1_17.status, "achieved");
  assert.equal(progress.review1_22.status, "achieved");
  assert.equal(progress.completed, true);
});

test("legacy (DB): a learner whose only Review 1-17 was backdated before the rule keeps it achieved, and unrelated edits neither block nor invalidate", async () => {
  const ctx = await setup();
  const l1 = await ctx.create({ taughtIds: ["1"] });
  const l2 = await ctx.assess(range(1, 17));
  await new Promise((resolve) => setTimeout(resolve, 5)); // the old edit happened after Lesson 2 was recorded
  await ctx.db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action, result) VALUES (?, ?, ?, ?, 'assessed', 'achieved')").bind(crypto.randomUUID(), ctx.learner.id, l1.id, REVIEW_1_17).run();
  assert.equal((await ctx.progress()).review1_17.status, "achieved");
  const result = await ctx.editAssess(l2, range(1, 17), { comments: "unrelated typo fix" });
  assert.equal(result.invalidated.review1_17, false);
  assert.equal(result.progress.review1_17.status, "achieved");
  assert.equal((await ctx.progress()).review1_17.status, "achieved");
});

test("an unrelated edit of the Review 1-17 lesson keeps its events' original recording time, so a later prerequisite removal is still derived as invalid", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17)); // 1
  const l2 = await ctx.assess([REVIEW_1_17]); // 2
  await ctx.assess(["17"]); // 3
  const stampOf = async () => (await ctx.db.prepare("SELECT created_at FROM competency_events WHERE lesson_id = ?").bind(l2.id).first<{ created_at: string }>())!.created_at;
  const original = await stampOf();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ctx.editAssess(l2, [REVIEW_1_17], { comments: "typo" });
  assert.equal(await stampOf(), original, "unchanged event keeps its created_at");
  const result = await ctx.editAssess(l1, range(1, 16));
  assert.equal(result.invalidated.review1_17, true);
});

test("safety net: data already re-recorded by an edit before this fix (milestone recorded after the later prerequisite) cannot show the new violation, so that edit is rejected and nothing is written", async () => {
  const ctx = await setup();
  const l1 = await ctx.assess(range(1, 17)); // 1
  const l2 = await ctx.assess([REVIEW_1_17]); // 2
  await ctx.assess(["17"]); // 3
  // What a pre-fix edit of Lesson 2 did: re-insert its events with the edit time.
  await ctx.db.prepare("UPDATE competency_events SET created_at = '2999-01-01T00:00:00.000Z' WHERE lesson_id = ?").bind(l2.id).run();
  await assert.rejects(() => ctx.editAssess(l1, range(1, 16)), /Lesson #2's Review 1-17 relying on prerequisites achieved only in the same or a later lesson/);
  assert.equal((await ctx.progress()).competencies["17"].achievedLessonIds.length, 2, "Lesson 1 still holds 17");
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

test("invalidationNotice: null when nothing was invalidated, one sentence naming every invalidated milestone otherwise", () => {
  assert.equal(invalidationNotice({ review1_17: false, review1_22: false, finalDrive23: false, completed: false }), null);
  assert.match(invalidationNotice({ review1_17: true, review1_22: false, finalDrive23: false, completed: false })!, /^Review 1-17 is no longer valid because this edit changed an assessment it depends on/);
  assert.match(invalidationNotice({ review1_17: false, review1_22: true, finalDrive23: true, completed: true })!, /^Review 1-22, 23 Final Drive and CBT&A Completed are no longer valid because/);
});
