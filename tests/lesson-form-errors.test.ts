import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, updateLesson } from "../lib/repo.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import {
  FIELD_LABELS,
  currentIssues,
  issueFromServerMessage,
  validateLessonDraftFields,
  type FormFieldId,
  type IssueState,
  type LessonDraftLike,
} from "../lib/lesson-form-errors.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const SIG_NEW = "data:image/png;base64,iVBORw0KGgoAAAA9";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

function goodDraft(overrides: Partial<LessonDraftLike> = {}): LessonDraftLike {
  return {
    lessonDate: "2026-09-29",
    startTime: "09:00",
    finishTime: "10:00",
    startOdometer: "1000",
    finishOdometer: "1010",
    taughtIds: [],
    assessedIds: [],
    achievedResults: {},
    location: "",
    comments: "",
    adiSignature: SIG,
    learnerSignature: SIG,
    ...overrides,
  };
}
const fieldsOf = (issues: { field: FormFieldId | null }[]) => issues.map((i) => i.field);

// ── Client-side validation mirrors the server's rules ────────────────────

test("a complete draft has no issues", () => {
  assert.deepEqual(validateLessonDraftFields(goodDraft(), "new"), []);
  assert.deepEqual(validateLessonDraftFields(goodDraft(), "edit"), []);
});

test("Finish odometer is required — message and target field", () => {
  const issues = validateLessonDraftFields(goodDraft({ finishOdometer: "" }), "new");
  assert.deepEqual(issues.map((i) => i.message), ["Finish odometer is required."]);
  assert.equal(issues[0].field, "finish-odometer");
  assert.equal(FIELD_LABELS["finish-odometer"], "Finish odometer");
});

test("Start odometer required; finish lower than start", () => {
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ startOdometer: "" }), "new")), ["start-odometer"]);
  const lower = validateLessonDraftFields(goodDraft({ startOdometer: "2000", finishOdometer: "1990" }), "new");
  assert.deepEqual(lower.map((i) => i.message), ["Finish odometer must not be less than start odometer."]);
  assert.deepEqual(fieldsOf(lower), ["finish-odometer"]);
});

test("date and times", () => {
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ lessonDate: "" }), "new")), ["date"]);
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ finishTime: "" }), "new")), ["times"]);
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ startTime: "10:00", finishTime: "09:00" }), "new")), ["times"]);
});

test("both signatures are required, reported separately", () => {
  const issues = validateLessonDraftFields(goodDraft({ adiSignature: "", learnerSignature: "" }), "new");
  assert.deepEqual(issues.map((i) => i.message), ["ADI signature is required.", "Learner signature is required."]);
  assert.deepEqual(fieldsOf(issues), ["adi-signature", "learner-signature"]);
});

test("an Assessed competency without Achieved / Not achieved is an issue pointing at the competency section", () => {
  const issues = validateLessonDraftFields(goodDraft({ assessedIds: ["3", "4"], achievedResults: { "3": "achieved" } }), "new");
  assert.deepEqual(fieldsOf(issues), ["competency"]);
  assert.match(issues[0].message, /Achieved \/ Not achieved/);
});

test("several problems are all listed, in page order for each form", () => {
  const draft = goodDraft({ finishOdometer: "", adiSignature: "", learnerSignature: "", assessedIds: ["3"], achievedResults: {} });
  assert.deepEqual(fieldsOf(validateLessonDraftFields(draft, "new")), ["finish-odometer", "competency", "adi-signature", "learner-signature"]);
  const editDraft = goodDraft({ lessonDate: "", finishOdometer: "", adiSignature: "" });
  assert.deepEqual(fieldsOf(validateLessonDraftFields(editDraft, "edit")), ["date", "finish-odometer", "adi-signature"]);
});

// ── Server messages → field, using the REAL server messages ───────────────

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Error Learner", instructorId: tony.id });
  let odo = 0;
  const input = (extra: Record<string, unknown> = {}) => {
    const start = odo;
    odo += 5;
    return { lessonDate: "2026-09-01", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra };
  };
  return { db, learner, input };
}
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the server to reject this");
}

test("every server validation message maps to the right field (driven by the real repo errors)", async () => {
  const { db, learner, input } = await setup();
  const create = (extra: Record<string, unknown>) => messageOf(() => createLesson(db, learner.id, input(extra)));
  const expectations: [string, Record<string, unknown>, FormFieldId][] = [
    ["date", { lessonDate: "" }, "date"],
    ["times", { finishTime: "08:00" }, "times"],
    ["start odometer", { startOdometer: "" }, "start-odometer"],
    ["finish odometer", { finishOdometer: "" }, "finish-odometer"],
    ["finish < start", { startOdometer: "100", finishOdometer: "50" }, "finish-odometer"],
    ["ADI signature", { adiSignature: "" }, "adi-signature"],
    ["learner signature", { learnerSignature: "" }, "learner-signature"],
    ["18-22 gate", { assessedIds: ["18"], achievedResults: { "18": "achieved" } }, "competency"],
    ["Review 1-17 locked", { assessedIds: [REVIEW_1_17], achievedResults: { [REVIEW_1_17]: "achieved" } }, "competency"],
    ["Review 1-22 locked", { assessedIds: [REVIEW_1_22], achievedResults: { [REVIEW_1_22]: "achieved" } }, "competency"],
    ["Final Drive locked", { assessedIds: [FINAL_DRIVE_23], achievedResults: { [FINAL_DRIVE_23]: "achieved" } }, "competency"],
    ["missing result", { assessedIds: ["3"], achievedResults: {} }, "competency"],
    ["taught+assessed", { taughtIds: ["3"], assessedIds: ["3"], achievedResults: { "3": "achieved" } }, "competency"],
  ];
  for (const [name, extra, field] of expectations) {
    const message = await create(extra);
    const issue = issueFromServerMessage(message);
    assert.equal(issue.field, field, `${name}: "${message}"`);
    assert.equal(issue.message, message, "the server's own wording is shown unchanged");
  }
});

test("History Edit server messages map to fields (odometer continuity, signatures, later-lesson chronology)", async () => {
  const { db, learner, input } = await setup();
  const l1 = await createLesson(db, learner.id, input({ taughtIds: ["1"] })); // odo 0-5
  const l2 = await createLesson(db, learner.id, input({ taughtIds: ["2"] })); // odo 5-10
  const base = (lesson: typeof l1, extra: Record<string, unknown>) => ({
    lessonDate: lesson.lessonDate, startTime: lesson.startTime, finishTime: lesson.finishTime,
    startOdometer: String(lesson.startOdometer), finishOdometer: String(lesson.finishOdometer),
    taughtIds: lesson.taught ? lesson.taught.split(", ") : [], adiSignature: SIG_NEW, learnerSignature: SIG_NEW, ...extra,
  });
  const startLow = await messageOf(() => updateLesson(db, learner.id, l2.id, base(l2, { startOdometer: "1" })));
  assert.equal(issueFromServerMessage(startLow).field, "start-odometer", startLow);
  const finishHigh = await messageOf(() => updateLesson(db, learner.id, l1.id, base(l1, { finishOdometer: "99" })));
  assert.equal(issueFromServerMessage(finishHigh).field, "finish-odometer", finishHigh);
  const redraw = await messageOf(() => updateLesson(db, learner.id, l1.id, base(l1, { comments: "changed", adiSignature: "", learnerSignature: "" })));
  assert.equal(issueFromServerMessage(redraw).field, "adi-signature", redraw);
  const same = await messageOf(() => updateLesson(db, learner.id, l1.id, { ...base(l1, { comments: "changed again" }), adiSignature: l1.adiSignature, learnerSignature: l1.learnerSignature }));
  assert.equal(issueFromServerMessage(same).field, "adi-signature", same);
});

test("chronology message for a later lesson maps to the competency section", async () => {
  const { db, learner, input } = await setup();
  const ach = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "achieved"]));
  await createLesson(db, learner.id, input({ assessedIds: range(1, 17), achievedResults: ach(range(1, 17)) }));
  const r17 = await createLesson(db, learner.id, input({ assessedIds: [REVIEW_1_17], achievedResults: ach([REVIEW_1_17]) }));
  await createLesson(db, learner.id, input({ assessedIds: ["18"], achievedResults: ach(["18"]) }));
  const message = await messageOf(() =>
    updateLesson(db, learner.id, r17.id, {
      lessonDate: r17.lessonDate, startTime: r17.startTime, finishTime: r17.finishTime, startOdometer: String(r17.startOdometer), finishOdometer: String(r17.finishOdometer),
      assessedIds: [REVIEW_1_17], achievedResults: { [REVIEW_1_17]: "not_achieved" }, adiSignature: SIG_NEW, learnerSignature: SIG_NEW,
    }),
  );
  const issue = issueFromServerMessage(message);
  assert.equal(issue.field, "competency");
  assert.match(issue.message, /Lesson #3/);
});

test("completed-learner and unknown messages have no field (shown, but no jump link)", async () => {
  assert.equal(issueFromServerMessage("CBT&A is already completed for this learner — no further CBT&A lessons can be recorded.").field, null);
  assert.equal(issueFromServerMessage("Something went wrong. Please try again.").field, null);
  assert.equal(issueFromServerMessage("Learner not found.").field, null);
  assert.equal(issueFromServerMessage("").message, "Could not save. Please try again.");
});

// ── Persistence: errors stay until the problem is corrected ──────────────

test("client-source issues are live: fixed problems drop off, the rest stay, and the summary empties when all are fixed", () => {
  const bad = goodDraft({ finishOdometer: "", adiSignature: "", learnerSignature: "" });
  const state: IssueState = { source: "client", issues: validateLessonDraftFields(bad, "new"), snapshot: bad };
  assert.deepEqual(fieldsOf(currentIssues(state, bad, "new")), ["finish-odometer", "adi-signature", "learner-signature"]);
  const partly = { ...bad, finishOdometer: "1010" };
  assert.deepEqual(fieldsOf(currentIssues(state, partly, "new")), ["adi-signature", "learner-signature"]);
  assert.deepEqual(currentIssues(state, goodDraft(), "new"), []);
});

test("server-source issue stays visible through unrelated edits and clears only when its own field changes", () => {
  const draft = goodDraft();
  const issue = issueFromServerMessage("Start odometer cannot be less than Lesson #1's finish odometer (10).");
  const state: IssueState = { source: "server", issues: [issue], snapshot: draft };
  assert.equal(currentIssues(state, draft, "new").length, 1);
  assert.equal(currentIssues(state, { ...draft, comments: "typing a comment" }, "new").length, 1, "an unrelated edit does not hide the error");
  assert.equal(currentIssues(state, { ...draft, location: "Belconnen" }, "new").length, 1);
  assert.equal(currentIssues(state, { ...draft, startOdometer: "5" }, "new").length, 0, "correcting the field clears it");
});

test("server-source issue with no field persists until the next save attempt (state is replaced), regardless of edits", () => {
  const draft = goodDraft();
  const state: IssueState = { source: "server", issues: [issueFromServerMessage("Something went wrong. Please try again.")], snapshot: draft };
  assert.equal(currentIssues(state, { ...draft, finishOdometer: "1" }, "new").length, 1);
});

test("no state → no issues", () => {
  assert.deepEqual(currentIssues(null, goodDraft(), "new"), []);
});

// ── Paper record edit ("paper" mode) ─────────────────────────────────────

test("paper mode: blank times/odometer and no signatures is valid", () => {
  const draft = goodDraft({ startTime: "", finishTime: "", startOdometer: "", finishOdometer: "", adiSignature: "", learnerSignature: "" });
  assert.deepEqual(validateLessonDraftFields(draft, "paper"), []);
});

test("paper mode: half-filled times or odometer is rejected, both-filled is checked", () => {
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ finishTime: "", adiSignature: "" }), "paper")), ["times"]);
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ startOdometer: "", adiSignature: "" }), "paper")), ["start-odometer"]);
  assert.deepEqual(fieldsOf(validateLessonDraftFields(goodDraft({ startOdometer: "50", finishOdometer: "40" }), "paper")), ["finish-odometer"]);
});

test("paper mode still requires a result for every assessed competency", () => {
  const draft = goodDraft({ assessedIds: ["5"], achievedResults: {} });
  assert.deepEqual(fieldsOf(validateLessonDraftFields(draft, "paper")), ["competency"]);
});
