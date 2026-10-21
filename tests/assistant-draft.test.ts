import { test } from "node:test";
import assert from "node:assert/strict";
import { competencyIdFromText, matchLearnersByName, parseAssistantDraft } from "../lib/assistant-draft.ts";

const lesson = `Here is your record card.
ACTGDS-DRAFT LESSON
Learner: Jane  Citizen
Date: 2026-10-22
Start: 09:00
Finish: 10:30
Start odometer: 12,345
Finish odometer: 12370 km
Taught: 1, 2, 3
Assessed: 4, 5, Review 1-17
Achieved: 4, Review 1-17
Location: Belconnen
Comments: Good mirror checks.
Practise hill starts next time.`;

test("a lesson draft fills every field, maps Review names and splits achieved / not achieved", () => {
  const d = parseAssistantDraft(lesson);
  assert.equal(d.kind, "lesson");
  if (d.kind !== "lesson") return;
  assert.deepEqual(d.problems, []);
  assert.equal(d.fields.learnerName, "Jane  Citizen");
  assert.deepEqual([d.fields.lessonDate, d.fields.startTime, d.fields.finishTime], ["2026-10-22", "09:00", "10:30"]);
  assert.deepEqual([d.fields.startOdometer, d.fields.finishOdometer], ["12345", "12370"]);
  assert.deepEqual(d.fields.taughtIds, ["1", "2", "3"]);
  assert.deepEqual(d.fields.assessedIds, ["4", "5", "review-1-17"]);
  assert.deepEqual(d.fields.achievedResults, { "4": "achieved", "5": "not_achieved", "review-1-17": "achieved" });
  assert.equal(d.fields.location, "Belconnen");
  assert.equal(d.fields.comments, "Good mirror checks.\nPractise hill starts next time.");
});

test("rule breaks are reported, never silently fixed into a record", () => {
  const d = parseAssistantDraft("ACTGDS-DRAFT LESSON\nLearner: Jane\nTaught: 4, Review 1-17\nAssessed: 4, 30\nAchieved: 6\nStart: 9am\nDate: 22/10/2026");
  assert.equal(d.kind, "lesson");
  const p = d.problems.join(" | ");
  assert.match(p, /"30" is not a CBT&A number/);
  assert.match(p, /Achieved 6 is not in Assessed/);
  assert.match(p, /Competency 4 is both Taught and Assessed/);
  assert.match(p, /Taught can only hold 1-22, not review-1-17/);
  assert.match(p, /Start time "9am"/);
  assert.match(p, /Date "22\/10\/2026"/);
  if (d.kind !== "lesson") return;
  assert.equal(d.fields.startTime, "");
  assert.equal(d.fields.lessonDate, "");
  assert.deepEqual(d.fields.taughtIds, ["4"]);
});

test("empty markers mean empty, and nothing is guessed", () => {
  const d = parseAssistantDraft("ACTGDS-DRAFT LESSON\nLearner: Jane\nStart odometer: 未提供\nFinish odometer: not provided\nLocation: —");
  if (d.kind !== "lesson") return assert.fail(d.kind);
  assert.deepEqual([d.fields.startOdometer, d.fields.finishOdometer, d.fields.location], ["", "", ""]);
  assert.deepEqual(d.problems, []);
});

test("a learner draft maps every intake field; Manual / Auto accepts Chinese", () => {
  const d = parseAssistantDraft("ACTGDS-DRAFT LEARNER\nName: Jane Citizen\nInstructor: Anna\nPhone: 0400 000 000\nDOB: 2008-01-02\nLicence number: 12345\nLicence expiry: 2027-01-02\nAddress: 1 Example St, Belconnen\nSchool / Work: Student\nManual / Auto: 自动\nEligibility: 未提供");
  if (d.kind !== "learner") return assert.fail(d.kind);
  assert.deepEqual(d.problems, []);
  assert.equal(d.fields.fullName, "Jane Citizen");
  assert.equal(d.fields.instructorName, "Anna");
  assert.equal(d.fields.transmission, "auto");
  assert.equal(d.fields.eligibility, "");
  assert.equal(d.fields.address, "1 Example St, Belconnen");
});

test("missing marker, wrong kind and missing names are explained", () => {
  assert.match(parseAssistantDraft("Learner: Jane").problems[0], /No ACTGDS-DRAFT block/);
  assert.match(parseAssistantDraft("ACTGDS-DRAFT SOMETHING").problems[0], /must be LESSON or LEARNER/);
  assert.match(parseAssistantDraft("ACTGDS-DRAFT LEARNER\nPhone: 1").problems.join(), /Student name is missing/);
  assert.match(parseAssistantDraft("ACTGDS-DRAFT LESSON\nTaught: 1").problems.join(), /Learner name is missing/);
});

test("competency names map to the canonical ids", () => {
  assert.equal(competencyIdFromText("R1-22"), "review-1-22");
  assert.equal(competencyIdFromText("Final Drive"), "final-drive-23");
  assert.equal(competencyIdFromText("23"), "final-drive-23");
  assert.equal(competencyIdFromText(" 7 "), "7");
  assert.equal(competencyIdFromText("24"), null);
});

test("learner lookup ignores case and extra spaces and returns every match", () => {
  const list = [{ fullName: "Jane Citizen" }, { fullName: "jane  citizen" }, { fullName: "John" }];
  assert.equal(matchLearnersByName(list, " JANE citizen ").length, 2);
  assert.equal(matchLearnersByName(list, "Nobody").length, 0);
});
