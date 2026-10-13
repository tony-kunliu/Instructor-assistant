// Learner form (concept screen B, approved by Tony 2026-10-12; Tony's decision 3, 2026-10-13): the pure view-model
// behind the grouped form cards. Presentation only: the server still validates every field with its own messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressPartChips, formSubline, moreSection, nameIssue, saveLabel } from "../lib/learner-form-view.ts";

test("nameIssue: the inline message is the server's own wording, only for an empty or blank name", () => {
  assert.equal(nameIssue(""), "Student name is required.");
  assert.equal(nameIssue("   "), "Student name is required.");
  assert.equal(nameIssue("\t\n"), "Student name is required.");
  assert.equal(nameIssue("A"), null);
  assert.equal(nameIssue("  Alex Chen "), null);
});

test("addressPartChips: Suburb / State / Postcode in that order, a dash for a missing part", () => {
  assert.deepEqual(addressPartChips({ addressSuburb: "Jacka", addressState: "ACT", addressPostcode: "2914" }), [
    { label: "Suburb", value: "Jacka" },
    { label: "State", value: "ACT" },
    { label: "Postcode", value: "2914" },
  ]);
  assert.deepEqual(addressPartChips({ addressSuburb: "", addressState: "", addressPostcode: "" }), [
    { label: "Suburb", value: "—" },
    { label: "State", value: "—" },
    { label: "Postcode", value: "—" },
  ]);
  assert.deepEqual(addressPartChips({ addressSuburb: " Queanbeyan ", addressState: "", addressPostcode: "2620" }).map((c) => c.value), ["Queanbeyan", "—", "2620"]);
});

test("moreSection: only the EDIT form has a More fold, and only while Transfer or Archive is available", () => {
  // New learner form: never.
  assert.deepEqual(moreSection({ editing: false, canTransfer: true, panel: "active" }), { shown: false, transfer: false, archive: false });
  // Edit, active learner, owner: both.
  assert.deepEqual(moreSection({ editing: true, canTransfer: true, panel: "active" }), { shown: true, transfer: true, archive: true });
  // Edit, CBT&A completed: Archive stays on the completed card's suggestion (as today), Transfer is still offered here.
  assert.deepEqual(moreSection({ editing: true, canTransfer: true, panel: "completed" }), { shown: true, transfer: true, archive: false });
  // Edit, archived learner: nothing to do here (Restore stays in the archived banner), so no fold at all.
  assert.deepEqual(moreSection({ editing: true, canTransfer: false, panel: "archived" }), { shown: false, transfer: false, archive: false });
  // Edit, active learner but Transfer not allowed (another instructor's rule): Archive alone.
  assert.deepEqual(moreSection({ editing: true, canTransfer: false, panel: "active" }), { shown: true, transfer: false, archive: true });
});

test("formSubline and saveLabel: New vs Edit wording, Saving… while a save is in flight", () => {
  assert.equal(formSubline(false), "Only the name and instructor are required. Everything else can wait.");
  assert.equal(formSubline(true), "Only the name is required. Transfer and Archive are under More.");
  assert.equal(saveLabel({ editing: false, saving: false }), "Save learner");
  assert.equal(saveLabel({ editing: true, saving: false }), "Save changes");
  assert.equal(saveLabel({ editing: true, saving: true }), "Saving…");
  assert.equal(saveLabel({ editing: false, saving: true }), "Saving…");
});
