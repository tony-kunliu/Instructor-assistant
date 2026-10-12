// Learner list cards (UI redesign 2026-10-12): the pure view-model behind each card. Every value shown on a card is
// derived here from real data (lib/learner-card.ts); nothing is approximated. Gate states come from the same
// LearnerProgress statuses the rest of the app uses (lib/competency.ts#computeProgress).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_COMPETENCY_IDS, computeProgress, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type CompetencyEvent } from "../lib/competency.ts";
import {
  cardMeta,
  cardReminders,
  emptySummary,
  gateChips,
  glance,
  initials,
  lastLessonLine,
  listCollapsed,
  optionLabel,
  summaryFromProgress,
  type LearnerListSummary,
} from "../lib/learner-card.ts";
import type { Learner } from "../lib/types.ts";

const learner = (over: Partial<Learner> = {}): Learner => ({
  id: "l1", instructorId: "tony", instructorName: "Tony", instructorAdiNumber: null, fullName: "Alex Chen", address: null, addressSuburb: null, addressState: null, addressPostcode: null,
  phone: null, dob: null, licenceNumber: null, licenceExpiry: null, eligibility: null, transmission: null, schoolWork: null, licenceStage: "learner",
  learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
  archivedAt: null, archiveReason: null, archiveNote: null, transfers: [], ...over,
});

const assessed = (ids: string[], lessonNo: number, result: "achieved" | "not_achieved" = "achieved"): CompetencyEvent[] =>
  ids.map((id) => ({ competencyId: id, action: "assessed", result, lessonId: `L${lessonNo}`, createdAt: `2026-09-${String(lessonNo).padStart(2, "0")}T00:00:00.000Z`, lessonNo }));
const range = (a: number, b: number) => CORE_COMPETENCY_IDS.slice(a - 1, b);

test("initials: first letters of the first two words, upper-cased; one word gives its first two letters; empty gives ?", () => {
  assert.equal(initials("Alex Chen"), "AC");
  assert.equal(initials("  priya   nair  "), "PN");
  assert.equal(initials("Li"), "LI");
  assert.equal(initials("Mary-Jane Watson Smith"), "MW");
  assert.equal(initials(""), "?");
});

test("emptySummary: no lessons, nothing achieved, every gate locked (same as computeProgress([]))", () => {
  const empty = emptySummary();
  const fromProgress = summaryFromProgress(computeProgress([]), { lessonCount: 0, totalMinutes: 0 }, null);
  assert.deepEqual(empty, fromProgress);
  assert.deepEqual(empty, { lessonCount: 0, totalMinutes: 0, lastLessonDate: null, achievedCount: 0, achievedIds: [], review1_17: "locked", review1_22: "locked", finalDrive23: "locked", completed: false });
});

test("summaryFromProgress carries the exact statuses and the achieved ids in official order", () => {
  const progress = computeProgress([...assessed(range(1, 17), 1), ...assessed([REVIEW_1_17], 2), ...assessed(["20", "22"], 3)]);
  const summary = summaryFromProgress(progress, { lessonCount: 3, totalMinutes: 195 }, "2026-09-03");
  assert.equal(summary.achievedCount, 19);
  assert.deepEqual(summary.achievedIds, [...range(1, 17), "20", "22"]);
  assert.equal(summary.review1_17, "achieved");
  assert.equal(summary.review1_22, "locked");
  assert.equal(summary.finalDrive23, "locked");
  assert.equal(summary.completed, false);
  assert.equal(summary.lessonCount, 3);
  assert.equal(summary.totalMinutes, 195);
  assert.equal(summary.lastLessonDate, "2026-09-03");
});

test("gate chips: achieved → done, ready → next, locked → locked, in chain order with the official labels", () => {
  const locked = emptySummary();
  assert.deepEqual(gateChips(locked), [
    { id: REVIEW_1_17, label: "Review 1–17", state: "locked" },
    { id: REVIEW_1_22, label: "Review 1–22", state: "locked" },
    { id: FINAL_DRIVE_23, label: "Final Drive 23", state: "locked" },
  ]);
  const r17Ready = summaryFromProgress(computeProgress(assessed(range(1, 17), 1)), { lessonCount: 1, totalMinutes: 60 }, "2026-09-01");
  assert.deepEqual(gateChips(r17Ready).map((c) => c.state), ["next", "locked", "locked"]);
  const fdReady = summaryFromProgress(computeProgress([...assessed(range(1, 17), 1), ...assessed([REVIEW_1_17], 2), ...assessed(range(18, 22), 3), ...assessed([REVIEW_1_22], 4)]), { lessonCount: 4, totalMinutes: 240 }, "2026-09-04");
  assert.deepEqual(gateChips(fdReady).map((c) => c.state), ["done", "done", "next"]);
  const done = summaryFromProgress(computeProgress([...assessed(range(1, 17), 1), ...assessed([REVIEW_1_17], 2), ...assessed(range(18, 22), 3), ...assessed([REVIEW_1_22], 4), ...assessed([FINAL_DRIVE_23], 5)]), { lessonCount: 5, totalMinutes: 300 }, "2026-09-05");
  assert.deepEqual(gateChips(done).map((c) => c.state), ["done", "done", "done"]);
  assert.equal(done.completed, true);
});

test("gate chips follow the derived validity: a Review assessed in the same lesson as its prerequisites is not done", () => {
  const sameLesson = summaryFromProgress(computeProgress([...assessed(range(1, 17), 1), ...assessed([REVIEW_1_17], 1)]), { lessonCount: 1, totalMinutes: 60 }, "2026-09-01");
  assert.equal(sameLesson.review1_17, "ready");
  assert.deepEqual(gateChips(sameLesson).map((c) => c.state), ["next", "locked", "locked"]);
});

test("meta line: transmission · licence stage · lessons · decimal hours, skipping what is not recorded", () => {
  const s: LearnerListSummary = { ...emptySummary(), lessonCount: 12, totalMinutes: 1110 };
  assert.equal(cardMeta(learner({ transmission: "auto" }), s), "Auto · L plates · 12 lessons · 18.5 h");
  assert.equal(cardMeta(learner({ transmission: "manual", licenceStage: "p1" }), { ...s, lessonCount: 1, totalMinutes: 60 }), "Manual · P1 · 1 lesson · 1.0 h");
  assert.equal(cardMeta(learner({ licenceStage: "full" }), emptySummary()), "Full licence · 0 lessons · 0.0 h");
  assert.equal(cardMeta(learner({ licenceStage: "p2" }), emptySummary()), "P2 · 0 lessons · 0.0 h");
});

test("last lesson line uses the stored lesson date (Canberra wall-clock date) formatted, or says there are none", () => {
  assert.equal(lastLessonLine({ ...emptySummary(), lastLessonDate: "2026-10-07" }), "last lesson 7 Oct 2026");
  assert.equal(lastLessonLine(emptySummary()), "no lessons yet");
});

test("option label (what tests pick by): the name alone in Mine, name · instructor elsewhere", () => {
  assert.equal(optionLabel(learner(), "mine"), "Alex Chen");
  assert.equal(optionLabel(learner(), "all"), "Alex Chen · Tony");
  assert.equal(optionLabel(learner(), "archived"), "Alex Chen · Tony");
});

test("reminder chips come only from lib/rules.ts: C23-from date for learner-stage, not-completed learners; licence expiry when amber", () => {
  const today = "2026-10-12";
  // Nothing recorded → no chip (the grey "add X" lines stay on the learner panel, not on a card).
  assert.deepEqual(cardReminders(learner(), emptySummary(), today), []);
  // New licence issued 2025-11-15, born 2008-05-06: Competency 23 from 15 Nov 2026 (12 months), hours and HPT still to add → amber.
  const alex = learner({ dob: "2008-05-06", learnerLicenceIssuedOn: "2025-11-15", licenceExpiry: "2030-11-15" });
  assert.deepEqual(cardReminders(alex, emptySummary(), today), [{ id: "c23-from", tone: "amber", text: "C23 from 15 Nov 2026" }]);
  // Estimated issue date (from the expiry only) is marked ≈, like the panel line.
  const est = learner({ dob: "2008-05-06", licenceExpiry: "2030-11-15" });
  assert.deepEqual(cardReminders(est, emptySummary(), today).map((r) => r.text), ["C23 from ≈ 15 Nov 2026"]);
  // Date passed, hours and HPT met → plain (informational, not counted as a reminder).
  const met = learner({ dob: "2007-01-01", learnerLicenceIssuedOn: "2024-01-01", licenceExpiry: "2029-01-01", hptPassedOn: "2025-06-01", loggedHours: 100, loggedHoursOn: "2026-10-01" });
  assert.deepEqual(cardReminders(met, emptySummary(), today), [{ id: "c23-from", tone: "plain", text: "C23 from 1 Jan 2025" }]);
  // Not for P1/P2/full, not once CBT&A is completed.
  assert.deepEqual(cardReminders({ ...alex, licenceStage: "p1" }, emptySummary(), today), []);
  assert.deepEqual(cardReminders(alex, { ...emptySummary(), completed: true }, today), []);
  // Licence expired / expiring within 30 days (R5 amber) → chip first; the C23 line is suppressed by R2 for an expired licence anyway.
  const expired = learner({ licenceExpiry: "2026-10-03" });
  assert.deepEqual(cardReminders(expired, emptySummary(), today), [{ id: "r5", tone: "amber", text: "Licence expired 3 Oct 2026" }]);
  const expiring = learner({ licenceExpiry: "2026-10-20" });
  assert.deepEqual(cardReminders(expiring, emptySummary(), today), [{ id: "r5", tone: "amber", text: "Licence expires 20 Oct 2026" }]);
  // A current licence (plain R5) adds no chip.
  assert.deepEqual(cardReminders(learner({ licenceExpiry: "2029-01-01" }), emptySummary(), today), []);
});

test("listCollapsed: only the open card (or nothing, under the form) until a search / Show all / nothing open", () => {
  const base = { query: "", expanded: false, formOpen: false, openInView: false };
  assert.equal(listCollapsed(base), false, "nothing open: every card");
  assert.equal(listCollapsed({ ...base, openInView: true }), true, "a learner of this view is open: their card only");
  assert.equal(listCollapsed({ ...base, formOpen: true }), true, "the learner form is open: compact list (no empty-state text)");
  assert.equal(listCollapsed({ ...base, openInView: true, formOpen: true }), true);
  assert.equal(listCollapsed({ ...base, openInView: true, query: " al" }), false, "searching always shows the matches");
  assert.equal(listCollapsed({ ...base, formOpen: true, expanded: true }), false, "Show all learners works with the form open");
  assert.equal(listCollapsed({ ...base, openInView: true, expanded: true }), false);
  assert.equal(listCollapsed({ ...base, query: "   " }), false, "blank query is no query");
});

test("glance counts: learners in view, amber reminders only, Final Drive 23 ready", () => {
  const fdReady: LearnerListSummary = { ...emptySummary(), finalDrive23: "ready" };
  const g = glance([
    { summary: emptySummary(), reminders: [{ id: "c23-from", tone: "amber", text: "C23 from 15 Nov 2026" }] },
    { summary: fdReady, reminders: [{ id: "c23-from", tone: "plain", text: "C23 from 1 Jan 2025" }] },
    { summary: emptySummary(), reminders: [] },
  ]);
  assert.deepEqual(g, { learning: 3, withReminder: 1, readyForFinalDrive: 1 });
});
