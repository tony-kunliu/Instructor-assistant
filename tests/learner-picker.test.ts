import { test } from "node:test";
import assert from "node:assert/strict";
import { availableViews, defaultView, initialSelection, learnerInView, selectionAfterViewChange, viewLearners, type PickerView } from "../lib/learner-picker.ts";
import { filterLearners } from "../lib/learner-filter.ts";
import type { Learner } from "../lib/types.ts";

const TONY = "tony-id";
const ANNA = "anna-id";

function learner(id: string, fullName: string, instructorId: string, archivedAt: string | null = null): Learner {
  return {
    id,
    instructorId,
    instructorName: instructorId === TONY ? "Tony" : "Anna",
    instructorAdiNumber: null,
    fullName,
    address: null,
    phone: null,
    dob: null,
    licenceNumber: null,
    licenceExpiry: null,
    eligibility: null,
    transmission: null,
    schoolWork: null,
    licenceStage: "learner",
    learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    archivedAt, archiveReason: null, archiveNote: null, transfers: [],
  };
}

const T1 = learner("t1", "Tony Active One", TONY);
const T2 = learner("t2", "Tony Active Two", TONY);
const A1 = learner("a1", "Anna Active One", ANNA);
const A2 = learner("a2", "Anna Active Two", ANNA);
const TA = learner("ta", "Tony Archived", TONY, "2026-09-29T00:00:00.000Z");
const AA = learner("aa", "Anna Archived", ANNA, "2026-09-29T00:00:00.000Z");
const ACTIVE = [A1, A2, T1, T2];
const ARCHIVED = [AA, TA];

// ── Login default ────────────────────────────────────────────────────────

test("login as Tony → default view is My learners, showing only Tony's active learners", () => {
  assert.equal(defaultView(TONY), "mine");
  assert.deepEqual(viewLearners(ACTIVE, ARCHIVED, "mine", TONY).map((l) => l.id), ["t1", "t2"]);
});

test("login as Anna → default view is My learners, showing only Anna's active learners", () => {
  assert.equal(defaultView(ANNA), "mine");
  assert.deepEqual(viewLearners(ACTIVE, ARCHIVED, "mine", ANNA).map((l) => l.id), ["a1", "a2"]);
});

test("no Access identity (local dev) → default All, and My learners is not offered", () => {
  assert.equal(defaultView(null), "all");
  assert.deepEqual(availableViews(null), ["all", "archived"]);
  assert.deepEqual(availableViews(TONY), ["mine", "all", "archived"]);
});

test("stale LAST_LEARNER belonging to a colleague must NOT force All or select that learner", () => {
  const stale = initialSelection({ signedInInstructorId: TONY, activeLearners: ACTIVE, lastLearnerId: "a1" });
  assert.equal(stale.view, "mine");
  assert.equal(stale.learnerId, null);
  const annaStale = initialSelection({ signedInInstructorId: ANNA, activeLearners: ACTIVE, lastLearnerId: "t1" });
  assert.equal(annaStale.view, "mine");
  assert.equal(annaStale.learnerId, null);
});

test("LAST_LEARNER that is the signed-in instructor's own active learner is restored, still in My learners", () => {
  assert.deepEqual(initialSelection({ signedInInstructorId: TONY, activeLearners: ACTIVE, lastLearnerId: "t2" }), { view: "mine", learnerId: "t2" });
});

test("unknown / archived / missing LAST_LEARNER restores nothing; view is still the identity default", () => {
  assert.deepEqual(initialSelection({ signedInInstructorId: TONY, activeLearners: ACTIVE, lastLearnerId: "gone" }), { view: "mine", learnerId: null });
  assert.deepEqual(initialSelection({ signedInInstructorId: TONY, activeLearners: ACTIVE, lastLearnerId: "ta" }), { view: "mine", learnerId: null });
  assert.deepEqual(initialSelection({ signedInInstructorId: TONY, activeLearners: ACTIVE, lastLearnerId: null }), { view: "mine", learnerId: null });
});

test("no identity: LAST_LEARNER of any instructor is restorable (nothing to be stale against)", () => {
  assert.deepEqual(initialSelection({ signedInInstructorId: null, activeLearners: ACTIVE, lastLearnerId: "a1" }), { view: "all", learnerId: "a1" });
});

// ── View membership ──────────────────────────────────────────────────────

test("Archived view contains only archived learners; My/All never contain archived learners", () => {
  assert.deepEqual(viewLearners(ACTIVE, ARCHIVED, "archived", TONY).map((l) => l.id).sort(), ["aa", "ta"]);
  for (const view of ["mine", "all"] as const) {
    assert.ok(viewLearners(ACTIVE, ARCHIVED, view, TONY).every((l) => !l.archivedAt), view);
  }
  assert.ok(viewLearners(ACTIVE, ARCHIVED, "archived", TONY).every((l) => l.archivedAt));
});

test("learnerInView is the single membership rule", () => {
  assert.equal(learnerInView(T1, "mine", TONY), true);
  assert.equal(learnerInView(A1, "mine", TONY), false);
  assert.equal(learnerInView(A1, "all", TONY), true);
  assert.equal(learnerInView(T1, "archived", TONY), false);
  assert.equal(learnerInView(TA, "archived", TONY), true);
  assert.equal(learnerInView(TA, "all", TONY), false);
  assert.equal(learnerInView(TA, "mine", TONY), false);
});

// ── Selection across view switches ───────────────────────────────────────

const change = (selected: Learner | undefined, next: PickerView, who = TONY) => selectionAfterViewChange(selected, next, who);

test("My → Archived clears an active learner (no stale active learner in the Archived dropdown)", () => {
  assert.equal(change(T1, "archived"), "clear");
});

test("All → Archived clears an active learner (own or colleague's)", () => {
  assert.equal(change(T1, "archived"), "clear");
  assert.equal(change(A1, "archived"), "clear");
});

test("Archived → My / All clears an archived learner", () => {
  assert.equal(change(TA, "mine"), "clear");
  assert.equal(change(TA, "all"), "clear");
  assert.equal(change(AA, "mine"), "clear");
});

test("All → My keeps own learner but clears a colleague's learner", () => {
  assert.equal(change(T1, "mine"), "keep");
  assert.equal(change(A1, "mine"), "clear");
});

test("My → All keeps the selected learner; Archived → Archived keeps an archived learner", () => {
  assert.equal(change(T1, "all"), "keep");
  assert.equal(change(TA, "archived"), "keep");
});

test("nothing selected → nothing to clear", () => {
  assert.equal(change(undefined, "archived"), "keep");
});

test("dropdown options for a view are exactly that view's members — the open learner is never injected", () => {
  const archivedOptions = viewLearners(ACTIVE, ARCHIVED, "archived", TONY);
  assert.ok(!archivedOptions.some((l) => l.id === T1.id));
  assert.equal(archivedOptions.length, 2);
});

// ── Search × scope × archived ────────────────────────────────────────────

test("search is applied within the current view's members only", () => {
  const mine = viewLearners(ACTIVE, ARCHIVED, "mine", TONY);
  assert.deepEqual(filterLearners(mine, { scope: "all", instructorId: TONY, query: "one" }).map((l) => l.id), ["t1"]);
  assert.deepEqual(filterLearners(mine, { scope: "all", instructorId: TONY, query: "anna" }), []);
  const all = viewLearners(ACTIVE, ARCHIVED, "all", TONY);
  assert.deepEqual(filterLearners(all, { scope: "all", instructorId: TONY, query: "archived" }), [], "archived learners never match in active views");
  const archived = viewLearners(ACTIVE, ARCHIVED, "archived", TONY);
  assert.deepEqual(filterLearners(archived, { scope: "all", instructorId: TONY, query: "archived" }).map((l) => l.id).sort(), ["aa", "ta"]);
  assert.deepEqual(filterLearners(archived, { scope: "all", instructorId: TONY, query: "active" }), [], "active learners never match in Archived");
});
