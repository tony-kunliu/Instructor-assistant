import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLearnerProgress, listLessons } from "../lib/repo.ts";
import { buildLessonUpsertedPayload } from "../lib/integration/contract.ts";
import { computeProgress, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type CompetencyEvent } from "../lib/competency.ts";
import {
  ADI_AUDIT_BOOKING_NOTE,
  ADI_AUDIT_BOOKING_URL,
  canberraInstant,
  finalDriveFormReminders,
  finalDrivePanelReminder,
  formatCanberraMoment,
  learnerLicenceReminder,
  reviewGapReminder,
  type LessonForRules,
} from "../lib/rules.ts";

// Table-driven cases written from the rule text (NI2020-703 / DI2020-294), with a fixed clock:
// `now` is always passed in. Canberra: AEST (+10) until Sun 4 Oct 2026 02:00, AEDT (+11) until
// Sun 4 Apr 2027 03:00 (clocks back to 02:00, so 02:00-02:59 on 4 Apr 2027 happens twice).

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ev = (competencyId: string, lessonId: string, result: "achieved" | "not_achieved" = "achieved"): CompetencyEvent => ({
  competencyId, action: "assessed", result, lessonId, createdAt: "2030-01-01T00:00:00.000Z", // junk insert time: must never be used
});
const lesson = (id: string, lessonNo: number, lessonDate: string, finishTime: string | null): LessonForRules => ({ id, lessonNo, lessonDate, finishTime });
const at = (iso: string) => new Date(iso);

/** Competency 1-17 all achieved in lesson L1, finishing at `finish` on `date`. */
function ready117(date: string, finish: string | null) {
  const events = range(1, 17).map((id) => ev(id, "L1"));
  return { progress: computeProgress(events), lessons: [lesson("L1", 1, date, finish)] };
}

test("canberraInstant: real offsets either side of both daylight-saving changes", () => {
  assert.equal(new Date(canberraInstant("2026-10-03", 12 * 60, "earlier")!).toISOString(), "2026-10-03T02:00:00.000Z"); // AEST +10
  assert.equal(new Date(canberraInstant("2026-10-05", 12 * 60, "earlier")!).toISOString(), "2026-10-05T01:00:00.000Z"); // AEDT +11
  assert.equal(canberraInstant("2026-02-30", 0, "earlier"), null);
  assert.equal(canberraInstant("nope", 0, "earlier"), null);
});

test("canberraInstant: the repeated hour on 4 Apr 2027 has two readings; prefer picks one", () => {
  const early = canberraInstant("2027-04-04", 2 * 60 + 30, "earlier")!;
  const late = canberraInstant("2027-04-04", 2 * 60 + 30, "later")!;
  assert.equal(new Date(early).toISOString(), "2027-04-03T15:30:00.000Z"); // AEDT
  assert.equal(new Date(late).toISOString(), "2027-04-03T16:30:00.000Z"); // AEST
  assert.equal(formatCanberraMoment(late), "Sun 4 Apr, 02:30");
});

// ── R1: Review 1 / Review 2 not less than 36 hours after completion ─────────

// L1 = Wed 30 Sep 2026 15:00 AEST; allowed from Fri 2 Oct 03:00 AEST = 2026-10-01T17:00Z.
const R1_NOW: { name: string; now: string; tone: "amber" | "plain"; includes: string }[] = [
  { name: "36 h minus 1 minute", now: "2026-10-01T16:59:00Z", tone: "amber", includes: "Review 1-17 allowed from Fri 2 Oct, 03:00 (36 h after Lesson #1)." },
  { name: "exactly 36 h", now: "2026-10-01T17:00:00Z", tone: "plain", includes: "Review 1-17: 36 h rule met (1-17 completed in Lesson #1, Wed 30 Sep, 15:00)." },
  { name: "well after", now: "2026-10-09T00:00:00Z", tone: "plain", includes: "36 h rule met" },
  { name: "right after the lesson", now: "2026-09-30T05:01:00Z", tone: "amber", includes: "allowed from Fri 2 Oct, 03:00" },
];
for (const c of R1_NOW) {
  test(`R1 panel, ${c.name}`, () => {
    const { progress, lessons } = ready117("2026-09-30", "15:00");
    const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at(c.now) }, where: "panel" })!;
    assert.equal(r.tone, c.tone);
    assert.ok(r.text.includes(c.includes), r.text);
  });
}

test("R1 form wording and boundary on the draft's date + START time (D9)", () => {
  const { progress, lessons } = ready117("2026-09-30", "15:00");
  const run = (startTime: string) => reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "draft", date: "2026-10-02", startTime }, where: "form" })!;
  assert.equal(run("02:59").tone, "amber");
  assert.equal(run("02:59").text, "This Review 1-17 starts within 36 h of Lesson #1 (allowed from Fri 2 Oct, 03:00). You can still save.");
  assert.equal(run("03:00").tone, "plain");
  assert.equal(run("").tone, "grey");
  assert.match(run("").text, /Add the lesson date and start time/);
});

test("R1 across the October daylight-saving start: 36 h is real elapsed time", () => {
  // Sat 3 Oct 2026 15:00 AEST = 05:00Z; +36 h = 17:00Z on 4 Oct = Mon 5 Oct 04:00 AEDT (not 03:00).
  const { progress, lessons } = ready117("2026-10-03", "15:00");
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-04T16:59:00Z") }, where: "panel" })!;
  assert.equal(r.tone, "amber");
  assert.match(r.text, /allowed from Mon 5 Oct, 04:00/);
  const ok = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-04T17:00:00Z") }, where: "panel" })!;
  assert.equal(ok.tone, "plain");
});

test("R1 across the April daylight-saving end: 36 h is real elapsed time", () => {
  // Sat 3 Apr 2027 15:00 AEDT = 04:00Z; +36 h = 16:00Z on 4 Apr = Mon 5 Apr 02:00 AEST.
  const { progress, lessons } = ready117("2027-04-03", "15:00");
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2027-04-04T15:59:00Z") }, where: "panel" })!;
  assert.match(r.text, /allowed from Mon 5 Apr, 02:00/);
  assert.equal(r.tone, "amber");
  assert.equal(reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2027-04-04T16:00:00Z") }, where: "panel" })!.tone, "plain");
});

test("R1: an ambiguous finish time (repeated hour) counts against a pass (later reading)", () => {
  // 02:30 on Sun 4 Apr 2027 is either 15:30Z or 16:30Z (3 Apr); the later reading gives allowed-from 04:30Z on 5 Apr = Mon 5 Apr 14:30 AEST.
  const { progress, lessons } = ready117("2027-04-04", "02:30");
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2027-04-05T04:00:00Z") }, where: "panel" })!;
  assert.equal(r.tone, "amber"); // the earlier reading (allowed 03:30Z) would have passed here
  assert.match(r.text, /allowed from Mon 5 Apr, 14:30/);
});

test("R1: a review that would start in the repeated hour uses the earlier reading (against a pass)", () => {
  const { progress, lessons } = ready117("2027-04-02", "15:00"); // Fri 2 Apr 15:00 AEDT = 04:00Z; allowed from 16:00Z on 3 Apr
  const allowed = canberraInstant("2027-04-02", 15 * 60, "later")! + 36 * 3_600_000;
  assert.equal(new Date(allowed).toISOString(), "2027-04-03T16:00:00.000Z");
  // Draft at 02:30 on 4 Apr: earlier reading = 15:30Z < allowed, so amber (the later reading, 16:30Z, would pass).
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "draft", date: "2027-04-04", startTime: "02:30" }, where: "form" })!;
  assert.equal(r.tone, "amber");
});

test("R1: a missing finish time counts from the end of that day and says so (D8)", () => {
  const { progress, lessons } = ready117("2026-09-30", null);
  // End of 30 Sep = 1 Oct 00:00 AEST; +36 h = Fri 2 Oct 12:00.
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-02T01:59:00Z") }, where: "panel" })!;
  assert.equal(r.tone, "amber");
  assert.ok(r.text.includes("allowed from Fri 2 Oct, 12:00"), r.text);
  assert.ok(r.text.includes("Lesson #1 has no finish time; counted from the end of that day."), r.text);
  const ok = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-02T02:00:00Z") }, where: "panel" })!;
  assert.equal(ok.tone, "plain");
  assert.ok(ok.text.includes("end of Wed 30 Sep") && ok.text.includes("no finish time"), ok.text);
});

test("R1: finish at midnight (00:00) is the start of that date, not the end", () => {
  const { progress, lessons } = ready117("2026-10-01", "00:00");
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-01T00:00:00Z") }, where: "panel" })!;
  assert.match(r.text, /allowed from Fri 2 Oct, 12:00/); // 1 Oct 00:00 AEST + 36 h
});

test("R1: the set is completed at the LATEST of each competency's EARLIEST achievement (re-achieved later does not move it)", () => {
  const events = [...range(1, 16).map((id) => ev(id, "L1")), ev("17", "L2"), ev("3", "L3"), ev("17", "L3")];
  const progress = computeProgress(events);
  const lessons = [lesson("L1", 1, "2026-09-20", "10:00"), lesson("L2", 2, "2026-09-25", "11:00"), lesson("L3", 3, "2026-09-29", "12:00")];
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "now", now: at("2026-10-20T00:00:00Z") }, where: "panel" })!;
  assert.ok(r.text.includes("Lesson #2, Fri 25 Sep, 11:00"), r.text);
});

test("R1: a History-edited lesson date moves the moment (uses lesson date + finish, never created_at)", () => {
  const { progress } = ready117("2026-09-30", "15:00");
  const moved = [lesson("L1", 1, "2026-10-07", "15:00")];
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons: moved, moment: { kind: "now", now: at("2026-10-08T00:00:00Z") }, where: "panel" })!;
  assert.equal(r.tone, "amber");
  assert.match(r.text, /allowed from Fri 9 Oct, 03:00/);
});

test("R1: only for a ready review; Review 1-22 works the same on 1-22", () => {
  const locked = computeProgress(range(1, 16).map((id) => ev(id, "L1")));
  assert.equal(reviewGapReminder({ review: REVIEW_1_17, progress: locked, lessons: [lesson("L1", 1, "2026-09-30", "15:00")], moment: { kind: "now", now: at("2026-10-09T00:00:00Z") }, where: "panel" }), null);
  // Review 1-17 counts only from a later lesson than 1-17 (lesson order, lib/competency.ts#milestoneAssessmentCounts).
  const events = [...range(1, 22).map((id) => ({ ...ev(id, "L1"), lessonNo: 1 })), { ...ev(REVIEW_1_17, "L2"), lessonNo: 2 }];
  const progress = computeProgress(events);
  assert.equal(progress.review1_22.status, "ready");
  const lessons = [lesson("L1", 1, "2026-09-30", "15:00")];
  const wait = reviewGapReminder({ review: REVIEW_1_22, progress, lessons, moment: { kind: "now", now: at("2026-10-01T16:59:00Z") }, where: "panel" })!;
  assert.equal(wait.tone, "amber");
  assert.match(wait.text, /^Review 1-22 allowed from Fri 2 Oct, 03:00/);
  assert.equal(reviewGapReminder({ review: REVIEW_1_22, progress, lessons, moment: { kind: "now", now: at("2026-10-01T17:00:00Z") }, where: "panel" })!.tone, "plain");
  assert.equal(reviewGapReminder({ review: REVIEW_1_22, progress: locked, lessons, moment: { kind: "now", now: at("2026-10-09T00:00:00Z") }, where: "panel" }), null);
});

test("R1: missing data is grey, never a pass (lesson not in the history)", () => {
  const { progress } = ready117("2026-09-30", "15:00");
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons: [], moment: { kind: "now", now: at("2026-10-20T00:00:00Z") }, where: "panel" })!;
  assert.equal(r.tone, "grey");
});

// ── R3: Competency 23 days and hours ─────────────────────────────────────────

// 2026-10-05 Mon = Labour Day; 06 Tue; 09 Fri; 10 Sat; 11 Sun. 2028-03-01 is outside the holiday table.
const R3_FORM: { name: string; date: string; start: string; finish: string; tone: string; includes: string }[] = [
  { name: "Tue 06:59 start", date: "2026-10-06", start: "06:59", finish: "10:00", tone: "amber", includes: "Competency 23 must run 07:00–19:00 Mon–Thu/Sat (Fri to 21:00). This lesson: 06:59–10:00." },
  { name: "Tue 07:00 start", date: "2026-10-06", start: "07:00", finish: "10:00", tone: "plain", includes: "inside 07:00–19:00" },
  { name: "Tue finish 19:00", date: "2026-10-06", start: "17:00", finish: "19:00", tone: "plain", includes: "inside 07:00–19:00" },
  { name: "Tue finish 19:01", date: "2026-10-06", start: "17:00", finish: "19:01", tone: "amber", includes: "This lesson: 17:00–19:01." },
  { name: "Sat 18:10-19:20", date: "2026-10-10", start: "18:10", finish: "19:20", tone: "amber", includes: "This lesson: 18:10–19:20." },
  { name: "Sat inside", date: "2026-10-10", start: "09:00", finish: "10:00", tone: "plain", includes: "(Sat)" },
  { name: "Fri finish 21:00", date: "2026-10-09", start: "19:30", finish: "21:00", tone: "plain", includes: "inside 07:00–21:00" },
  { name: "Fri finish 21:01", date: "2026-10-09", start: "19:30", finish: "21:01", tone: "amber", includes: "Fri to 21:00" },
  { name: "finish before start", date: "2026-10-06", start: "10:00", finish: "09:00", tone: "amber", includes: "This lesson: 10:00–09:00." },
  { name: "missing finish", date: "2026-10-06", start: "10:00", finish: "", tone: "grey", includes: "Add start and finish time to check the Competency 23 hours." },
  { name: "missing start", date: "2026-10-06", start: "", finish: "11:00", tone: "grey", includes: "Add start and finish time" },
];
for (const c of R3_FORM) {
  test(`R3 form, ${c.name}`, () => {
    const out = finalDriveFormReminders({ date: c.date, startTime: c.start, finishTime: c.finish });
    assert.equal(out.length, 1);
    assert.equal(out[0].tone, c.tone);
    assert.ok(out[0].text.includes(c.includes), out[0].text);
  });
}

test("R3 form: Sunday, a listed holiday, and a year outside the table", () => {
  const sunday = finalDriveFormReminders({ date: "2026-10-11", startTime: "09:00", finishTime: "10:00" });
  assert.deepEqual(sunday.map((r) => [r.tone, r.text]), [["amber", "Competency 23 is not allowed on Sundays."]]);
  const holiday = finalDriveFormReminders({ date: "2026-10-05", startTime: "09:00", finishTime: "10:00" });
  assert.deepEqual(holiday.map((r) => [r.tone, r.text]), [["amber", "Competency 23 is not allowed on ACT public holidays (Labour Day)."]]);
  const sundayHoliday = finalDriveFormReminders({ date: "2026-04-05", startTime: "09:00", finishTime: "10:00" }); // Easter Sunday
  assert.equal(sundayHoliday[0].tone, "amber");
  const outside = finalDriveFormReminders({ date: "2028-03-01", startTime: "09:00", finishTime: "10:00" });
  // I2: the hours line is grey too (never green) while the holiday table cannot clear the day.
  assert.deepEqual(outside.map((r) => [r.tone, r.text.startsWith("ACT public holidays for 2028 are not loaded; check manually.") || r.text.includes("inside")]), [["grey", true], ["grey", true]]);
  const outsideBad = finalDriveFormReminders({ date: "2028-03-01", startTime: "05:00", finishTime: "06:00" });
  assert.deepEqual(outsideBad.map((r) => r.tone), ["grey", "amber"]); // a time outside the window is still amber
  const outsideSunday = finalDriveFormReminders({ date: "2028-03-05", startTime: "09:00", finishTime: "10:00" }); // Sunday outside the table
  assert.equal(outsideSunday[0].text, "Competency 23 is not allowed on Sundays.");
  const noDate = finalDriveFormReminders({ date: "", startTime: "09:00", finishTime: "10:00" });
  assert.equal(noDate[0].tone, "grey");
});

test("R3 panel: Friday 21:00 Canberra, Sunday, holiday, DST-edge dates, year outside the table", () => {
  // Fri 9 Oct 2026 21:00 AEST = 11:00Z.
  assert.deepEqual(finalDrivePanelReminder(at("2026-10-09T11:00:00Z")), { id: "r3", tone: "amber", text: "Competency 23 hours today (Fri): 07:00–21:00; it is currently outside the window." }); // 21:00 Fri
  assert.equal(finalDrivePanelReminder(at("2026-10-08T14:30:00Z")).tone, "amber"); // 00:30 Fri in Canberra but still Thu in UTC
  assert.equal(finalDrivePanelReminder(at("2026-10-10T02:00:00Z")).text, "Competency 23 hours today (Sat): 07:00–19:00.");
  assert.equal(finalDrivePanelReminder(at("2026-10-10T14:00:00Z")).text, "Competency 23 is not allowed on Sundays."); // 00:00 Sun in Canberra
  assert.equal(finalDrivePanelReminder(at("2026-10-03T15:00:00Z")).text, "Competency 23 is not allowed on Sundays."); // 01:00 Sun 4 Oct, just before the clocks go forward
});

test("R3 panel: a listed holiday and the not-loaded year", () => {
  // Mon 5 Oct 2026 12:00 AEDT = 01:00Z
  const holiday = finalDrivePanelReminder(at("2026-10-05T01:00:00Z"));
  assert.deepEqual([holiday.tone, holiday.text], ["amber", "Competency 23 is not allowed on ACT public holidays (Labour Day)."]);
  const outside = finalDrivePanelReminder(at("2028-03-01T02:00:00Z"));
  assert.equal(outside.tone, "grey");
  assert.ok(outside.text.includes("ACT public holidays for 2028 are not loaded; check manually."), outside.text);
});

test("booking link constants (D3)", () => {
  assert.equal(ADI_AUDIT_BOOKING_URL, "https://forms.act.gov.au/smartforms/servlet/SmartForm.html?formCode=1503");
  assert.equal(ADI_AUDIT_BOOKING_NOTE, "Book at least 1 clear business day before, in writing (CoP 9.2 n).");
});

// ── R5: learner licence current ──────────────────────────────────────────────

const R5: { name: string; expiry: string | null; stage?: string; tone: string | null; text?: string }[] = [
  { name: "expiry today (still valid)", expiry: "2026-10-09", tone: "amber", text: "Learner licence expires today (9 Oct 2026)." },
  { name: "expiry yesterday", expiry: "2026-10-08", tone: "amber", text: "Learner licence expired 8 Oct 2026: check a current ACT learner licence before training." },
  { name: "expires in 12 days", expiry: "2026-10-21", tone: "amber", text: "Learner licence expires 21 Oct 2026 (12 days)." },
  { name: "expires in 1 day", expiry: "2026-10-10", tone: "amber", text: "Learner licence expires 10 Oct 2026 (1 day)." },
  { name: "expires in 30 days", expiry: "2026-11-08", tone: "amber", text: "Learner licence expires 8 Nov 2026 (30 days)." },
  { name: "expires in 31 days", expiry: "2026-11-09", tone: "plain", text: "Learner licence current: expires 9 Nov 2026." },
  { name: "missing expiry", expiry: null, tone: "grey", text: "Add licence expiry to check the learner licence is current." },
  { name: "invalid expiry", expiry: "2026-13-40", tone: "grey" },
  { name: "not a learner (P1)", expiry: "2020-01-01", stage: "p1", tone: null },
];
for (const c of R5) {
  test(`R5, ${c.name}`, () => {
    const r = learnerLicenceReminder({ licenceStage: c.stage ?? "learner", licenceExpiry: c.expiry }, "2026-10-09");
    if (c.tone === null) return assert.equal(r, null);
    assert.equal(r!.tone, c.tone);
    if (c.text) assert.equal(r!.text, c.text);
  });
}

// ── D1: reminders never block a save ─────────────────────────────────────────

test("nothing blocks a save: Review 1-17 inside 36 h, Review 1-22 inside 36 h, 23 on a Sunday outside the hours, expired licence", async () => {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "Reminder Learner", instructorId: tony.id, licenceExpiry: "2020-01-01" });
  assert.equal(learnerLicenceReminder({ licenceStage: learner.licenceStage, licenceExpiry: learner.licenceExpiry }, "2026-10-09")!.tone, "amber");
  let odo = 0;
  const save = (extra: Record<string, unknown>) => {
    const start = odo;
    odo += 5;
    return createLesson(db, learner.id, { lessonDate: "2026-09-30", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: "data:image/png;base64,iVBORw0KGgo=", learnerSignature: "data:image/png;base64,iVBORw0KGgo=", ...extra });
  };
  const assess = (ids: string[]) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });
  await save(assess(range(1, 17)));
  // Review 1-17 the very same day (inside 36 h): the reminder is amber, the save succeeds.
  const warn = reviewGapReminder({ review: REVIEW_1_17, progress: await getLearnerProgress(db, learner.id), lessons: await listLessons(db, learner.id), moment: { kind: "draft", date: "2026-09-30", startTime: "11:00" }, where: "form" })!;
  assert.equal(warn.tone, "amber");
  await save({ startTime: "11:00", finishTime: "12:00", ...assess([REVIEW_1_17]) });
  await save({ lessonDate: "2026-09-30", startTime: "13:00", finishTime: "14:00", ...assess(range(18, 22)) });
  const warn22 = reviewGapReminder({ review: REVIEW_1_22, progress: await getLearnerProgress(db, learner.id), lessons: await listLessons(db, learner.id), moment: { kind: "draft", date: "2026-09-30", startTime: "15:00" }, where: "form" })!;
  assert.equal(warn22.tone, "amber");
  await save({ startTime: "15:00", finishTime: "16:00", ...assess([REVIEW_1_22]) });
  // Competency 23 on a Sunday at 05:00-06:00: two amber reminders (day only), still saves.
  assert.equal(finalDriveFormReminders({ date: "2026-10-11", startTime: "05:00", finishTime: "06:00" })[0].tone, "amber");
  await save({ lessonDate: "2026-10-11", startTime: "05:00", finishTime: "06:00", ...assess([FINAL_DRIVE_23]) });
  const progress = await getLearnerProgress(db, learner.id);
  assert.equal(progress.completed, true);
  assert.equal(progress.competencies[REVIEW_1_22].achievedLessonIds.length, 1);
});

// ── D5: achievedLessonIds, and the ACTGDS payload is unchanged ────────────────

test("computeProgress: achievedLessonIds lists every lesson with Assessed + Achieved, once each, in event order; not-achieved and taught do not count", () => {
  const progress = computeProgress([
    ev("5", "L1", "not_achieved"),
    { competencyId: "5", action: "taught", result: null, lessonId: "L0", createdAt: "x" },
    ev("5", "L2"),
    ev("5", "L2"),
    ev("5", "L3"),
  ]);
  assert.deepEqual(progress.competencies["5"].achievedLessonIds, ["L2", "L3"]);
  assert.deepEqual(progress.competencies["6"].achievedLessonIds, []);
});

test("ACTGDS payload never carries achievedLessonIds (contract unchanged)", () => {
  const progress = computeProgress(range(1, 17).map((id) => ev(id, "L1")));
  const payload = buildLessonUpsertedPayload({
    environment: "staging", learnerId: "l1", instructorId: "i1", instructorDisplayName: "Tony",
    lesson: { id: "L1", lessonNo: 1, lessonDate: "2026-09-30", startTime: "09:00", finishTime: "10:00", durationMinutes: 60, distanceKm: 10, cumulativeMinutes: 60, cumulativeKm: 10, createdAt: "2026-09-30T00:00:00Z", updatedAt: null },
    taughtIds: [], assessedIds: ["1"], achievedIds: ["1"], progress,
  });
  assert.equal(JSON.stringify(payload).includes("achievedLessonIds"), false);
  assert.equal(JSON.stringify(payload).includes("L1\"]"), false);
});

// ── I1: the panel line is plain only while the Canberra clock is inside today's window ──

const PANEL_CLOCK: { name: string; now: string; tone: string; text: string }[] = [
  // Tue 6 Oct 2026 (AEDT +11, not a holiday): UTC = Canberra - 11 h.
  { name: "Tue 06:30", now: "2026-10-05T19:30:00Z", tone: "amber", text: "Competency 23 hours today (Tue): 07:00–19:00; it is currently outside the window." },
  { name: "Tue 06:59", now: "2026-10-05T19:59:00Z", tone: "amber", text: "Competency 23 hours today (Tue): 07:00–19:00; it is currently outside the window." },
  { name: "Tue 07:00", now: "2026-10-05T20:00:00Z", tone: "plain", text: "Competency 23 hours today (Tue): 07:00–19:00." },
  { name: "Tue 18:59", now: "2026-10-06T07:59:00Z", tone: "plain", text: "Competency 23 hours today (Tue): 07:00–19:00." },
  { name: "Tue 19:00", now: "2026-10-06T08:00:00Z", tone: "amber", text: "Competency 23 hours today (Tue): 07:00–19:00; it is currently outside the window." },
  // Fri 9 Oct 2026: UTC = Canberra - 11 h.
  { name: "Fri 19:30 (Friday is open to 21:00)", now: "2026-10-09T08:30:00Z", tone: "plain", text: "Competency 23 hours today (Fri): 07:00–21:00." },
  { name: "Fri 20:59", now: "2026-10-09T09:59:00Z", tone: "plain", text: "Competency 23 hours today (Fri): 07:00–21:00." },
  { name: "Fri 21:00", now: "2026-10-09T10:00:00Z", tone: "amber", text: "Competency 23 hours today (Fri): 07:00–21:00; it is currently outside the window." },
  { name: "Sunday 12:00", now: "2026-10-11T01:00:00Z", tone: "amber", text: "Competency 23 is not allowed on Sundays." },
  { name: "holiday 12:00 (Labour Day)", now: "2026-10-05T01:00:00Z", tone: "amber", text: "Competency 23 is not allowed on ACT public holidays (Labour Day)." },
  { name: "2028 not loaded, inside hours", now: "2028-03-01T02:00:00Z", tone: "grey", text: "Competency 23 hours today (Wed): 07:00–19:00. ACT public holidays for 2028 are not loaded; check manually." },
];
for (const c of PANEL_CLOCK) {
  test(`R3 panel clock, ${c.name}`, () => {
    const r = finalDrivePanelReminder(at(c.now));
    assert.deepEqual([r.tone, r.text], [c.tone, c.text]);
  });
}

test("R3 form: a start already outside the window is amber even with no finish yet (keeps the add-finish note)", () => {
  const early = finalDriveFormReminders({ date: "2026-10-06", startTime: "06:30", finishTime: "" });
  assert.deepEqual(early.map((r) => r.tone), ["amber", "grey"]);
  assert.match(early[0].text, /This lesson: 06:30–…\./);
  assert.match(early[1].text, /Add start and finish time/);
  assert.deepEqual(finalDriveFormReminders({ date: "2026-10-06", startTime: "19:00", finishTime: "" }).map((r) => r.tone), ["amber", "grey"]);
  assert.deepEqual(finalDriveFormReminders({ date: "2026-10-06", startTime: "", finishTime: "19:30" }).map((r) => r.tone), ["amber", "grey"]);
  assert.deepEqual(finalDriveFormReminders({ date: "2026-10-06", startTime: "09:00", finishTime: "" }).map((r) => r.tone), ["grey"]);
});

test("M1: a start time skipped at the October change does not exist; the review start is read an hour EARLIER (against a pass)", () => {
  // 02:30 on Sun 4 Oct 2026 never happens (clocks jump 02:00 -> 03:00): readings are 15:30Z and 16:30Z.
  assert.equal(new Date(canberraInstant("2026-10-04", 150, "earlier")!).toISOString(), "2026-10-03T15:30:00.000Z");
  assert.equal(new Date(canberraInstant("2026-10-04", 150, "later")!).toISOString(), "2026-10-03T16:30:00.000Z");
  const { progress, lessons } = ready117("2026-10-02", "14:00"); // 14:00 AEST = 04:00Z; allowed from 16:00Z on 3 Oct
  const r = reviewGapReminder({ review: REVIEW_1_17, progress, lessons, moment: { kind: "draft", date: "2026-10-04", startTime: "02:30" }, where: "form" })!;
  assert.equal(r.tone, "amber"); // the earlier reading (15:30Z) is before 16:00Z; the later one (16:30Z) would have passed
});
