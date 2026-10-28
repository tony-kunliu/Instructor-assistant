// Lesson record screen (UI redesign approved by Tony 2026-10-12): the pure view-model behind the redesigned
// lesson card. Presentation only — every figure is derived from the same calc/competency helpers as before,
// nothing here changes a rule, a payload or a validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TOTALS } from "../lib/calc.ts";
import {
  derivedStats,
  gateTag,
  learnerHeaderMeta,
  lessonDateLine,
  lessonPhase,
  odometerCarriedNote,
  showsSaveBar,
} from "../lib/lesson-view.ts";

test("lessonPhase: ready until Start Lesson, running until End Lesson, ended once both times are set", () => {
  assert.equal(lessonPhase(null), "ready");
  assert.equal(lessonPhase({ startTime: "", finishTime: "" }), "ready");
  assert.equal(lessonPhase({ startTime: "09:00", finishTime: "" }), "running");
  assert.equal(lessonPhase({ startTime: "09:00", finishTime: "10:30" }), "ended");
  // A finish time without a start time (hand-edited) is not a started lesson: the Start button must still be offered.
  assert.equal(lessonPhase({ startTime: "", finishTime: "10:30" }), "ready");
});

test("showsSaveBar: the primary Save action exists only after End Lesson (Tony's decision 2: no greyed-out Save before)", () => {
  assert.equal(showsSaveBar("ready"), false);
  assert.equal(showsSaveBar("running"), false);
  assert.equal(showsSaveBar("ended"), true);
});

test("gateTag: the three special assessments read Achieved / Ready to assess / Locked from their derived status", () => {
  assert.deepEqual(gateTag("achieved"), { label: "✓ Achieved", state: "done" });
  assert.deepEqual(gateTag("ready"), { label: "Ready to assess", state: "next" });
  assert.deepEqual(gateTag("locked"), { label: "Locked", state: "locked" });
});

test("derivedStats: duration, km, totals after save and the lesson number are calculated, never typed", () => {
  const totals = { lessonCount: 17, totalMinutes: 26 * 60, totalKm: 412, lastFinishOdometer: 45210 };
  const done = derivedStats({ totals, liveDuration: 90, liveKm: 28 });
  assert.deepEqual(done, {
    lessonNo: 18,
    thisLesson: { duration: "1h 30m", km: "28 km" },
    totalAfter: { duration: "27h 30m", decimalHours: "27.5", km: "440 km" },
    complete: true,
  });
  // Before End Lesson (or without a finish odometer) the lesson's own figures are a dash; the totals stay today's totals.
  const open = derivedStats({ totals, liveDuration: null, liveKm: null });
  assert.deepEqual(open, {
    lessonNo: 18,
    thisLesson: { duration: "—", km: "—" },
    totalAfter: { duration: "26h", decimalHours: "26.0", km: "412 km" },
    complete: false,
  });
  // Half-derived (time known, km not yet): the known half shows, the totals add only what is known.
  const half = derivedStats({ totals, liveDuration: 45, liveKm: null });
  assert.equal(half.thisLesson.duration, "45m");
  assert.equal(half.thisLesson.km, "—");
  assert.equal(half.totalAfter.duration, "26h 45m");
  assert.equal(half.totalAfter.km, "412 km");
  assert.equal(half.complete, false);
  assert.equal(derivedStats({ totals: EMPTY_TOTALS, liveDuration: null, liveKm: null }).lessonNo, 1);
});

test("learnerHeaderMeta: transmission · Licence · exp (Canberra date style) · ADI, only what is recorded", () => {
  assert.equal(
    learnerHeaderMeta({ transmission: "auto", licenceNumber: "1234567", licenceExpiry: "2027-03-14", instructorName: "Tony" }),
    "Auto · Licence 1234567 · exp 14 Mar 2027 · ADI Tony",
  );
  assert.equal(learnerHeaderMeta({ transmission: "manual", licenceNumber: null, licenceExpiry: null, instructorName: "Anna" }), "Manual · ADI Anna");
  assert.equal(learnerHeaderMeta({ transmission: null, licenceNumber: null, licenceExpiry: null, instructorName: "Anna" }), "ADI Anna");
  // An unparseable stored date is shown as stored, never dropped or invented.
  assert.equal(learnerHeaderMeta({ transmission: null, licenceNumber: null, licenceExpiry: "soon", instructorName: "Anna" }), "exp soon · ADI Anna");
});

test("lessonDateLine: weekday + Canberra wall-clock date of the draft ('Sun 12 Oct 2026'); malformed input is echoed", () => {
  assert.equal(lessonDateLine("2026-10-12"), "Mon 12 Oct 2026");
  assert.equal(lessonDateLine("2026-10-11"), "Sun 11 Oct 2026");
  assert.equal(lessonDateLine("2026-02-29"), "2026-02-29");
  assert.equal(lessonDateLine(""), "");
});

test("odometerCarriedNote: only while the start odometer still equals the last lesson's finish reading", () => {
  const totals = { lessonCount: 17, totalMinutes: 0, totalKm: 0, lastFinishOdometer: 45210 };
  assert.equal(odometerCarriedNote(totals, "45210"), "Start carried from Lesson #17");
  assert.equal(odometerCarriedNote(totals, "45211"), null);
  assert.equal(odometerCarriedNote(totals, ""), null);
  assert.equal(odometerCarriedNote(EMPTY_TOTALS, ""), null);
});
