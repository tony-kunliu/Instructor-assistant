// Learner drafts (Tony 2026-10-22): an incomplete learner can be saved as a draft, with notes about what could not be
// read; nothing unusable is stored or guessed; a draft takes no lessons or imports until it is reviewed and confirmed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, DRAFT_NAME_PLACEHOLDER, findInstructorByEmail, getLearner, importPaperLessons, listLearners, transferLearner, updateLearner, ValidationError } from "../lib/repo.ts";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  return { db, tony };
}

test("a draft saves with only the instructor: no name, nothing else, and shows as a draft", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, { draft: true, instructorId: tony.id });
  assert.equal(draft.fullName, DRAFT_NAME_PLACEHOLDER);
  assert.ok(draft.draftAt);
  assert.equal(draft.draftNotes, null);
  assert.ok((await listLearners(db)).some((l) => l.id === draft.id && l.draftAt));
});

test("unusable values are dropped and written to the notes, the rest is kept; the assistant's own notes are kept", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, {
    draft: true, instructorId: tony.id, fullName: "Jane Citizen", phone: "0400 000 000", dob: "3/4/05", transmission: "semi",
    learnerLicenceIssuedOn: "2999-01-01", otherLicenceKind: "mars", licenceNumber: "12345",
    draftNotes: "Licence number: last digit unclear",
  });
  assert.equal(draft.fullName, "Jane Citizen");
  assert.equal(draft.phone, "0400 000 000");
  assert.equal(draft.licenceNumber, "12345");
  assert.equal(draft.dob, null);
  assert.equal(draft.transmission, null);
  assert.equal(draft.learnerLicenceIssuedOn, null);
  assert.equal(draft.otherLicenceKind, null);
  const notes = draft.draftNotes ?? "";
  assert.match(notes, /Licence number: last digit unclear/);
  assert.match(notes, /dob: "3\/4\/05"/);
  assert.match(notes, /transmission: "semi"/);
  assert.match(notes, /learnerLicenceIssuedOn: "2999-01-01"/);
  assert.match(notes, /otherLicenceKind: "mars"/);
});

test("a normal learner is unchanged: still needs a name and rejects bad data", async () => {
  const { db, tony } = await setup();
  await assert.rejects(createLearner(db, { instructorId: tony.id }), /Student name is required/);
  const normal = await createLearner(db, { instructorId: tony.id, fullName: "Normal Learner" });
  assert.equal(normal.draftAt ?? null, null);
  await assert.rejects(updateLearner(db, normal.id, { draft: true, fullName: "x" }), /Only a draft learner/);
});

test("a draft takes no lessons and no paper import", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, fullName: "Draft Learner" });
  await assert.rejects(createLesson(db, draft.id, { lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "2", adiSignature: "data:image/png;base64,AAA", learnerSignature: "data:image/png;base64,AAA" }), /still a draft/);
  await assert.rejects(importPaperLessons(db, draft.id, "date\n2026-10-01\n", "preview"), /still a draft/);
});

test("editing a draft stays lenient and keeps it a draft; confirming applies every rule and clears the mark", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, phone: "0400" });
  const saved = await updateLearner(db, draft.id, { draft: true, fullName: "Jane Citizen", dob: "bad", draftNotes: "check DOB on the photo" });
  assert.equal(saved.learner.fullName, "Jane Citizen");
  assert.equal(saved.learner.phone, "0400");
  assert.ok(saved.learner.draftAt);
  assert.match(saved.learner.draftNotes ?? "", /check DOB on the photo/);
  assert.match(saved.learner.draftNotes ?? "", /dob: "bad"/);

  const unnamed = await createLearner(db, { draft: true, instructorId: tony.id });
  await assert.rejects(updateLearner(db, unnamed.id, { draft: false }), /Enter the student's name/);
  await assert.rejects(updateLearner(db, draft.id, { draft: false, dob: "bad" }), /valid date/);
  const confirmed = await updateLearner(db, draft.id, { draft: false, dob: "2008-01-02" });
  assert.equal(confirmed.learner.draftAt ?? null, null);
  assert.equal(confirmed.learner.draftNotes ?? null, null);
  assert.equal(confirmed.learner.dob, "2008-01-02");
  assert.equal((await getLearner(db, draft.id)).fullName, "Jane Citizen");
  // Now a normal learner: lessons are allowed again.
  await createLesson(db, draft.id, { lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "2", taughtIds: ["1"], signLater: true });
});

test("only the learner's own instructor can edit or confirm their draft", async () => {
  const { db, tony } = await setup();
  const other = (await db.prepare("SELECT id FROM instructors WHERE id <> ? AND status = 'active' LIMIT 1").bind(tony.id).first<{ id: string }>())!;
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, fullName: "Own Draft" });
  await assert.rejects(updateLearner(db, draft.id, { draft: false, actingInstructorId: other.id }), ValidationError);
});

test("editing a draft never blanks stored values: a refused value keeps the previous one and says so", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, fullName: "Keep Me", dob: "2008-01-02", learnerLicenceIssuedOn: "2024-01-01", hptPassedOn: "2024-06-01", loggedHours: 5, loggedHoursOn: "2024-06-02" });
  assert.equal(draft.hptPassedOn, "2024-06-01");
  const a = await updateLearner(db, draft.id, { draft: true, hptPassedOn: "2999-01-01" });
  assert.equal(a.learner.hptPassedOn, "2024-06-01");
  assert.equal(a.learner.learnerLicenceIssuedOn, "2024-01-01");
  assert.match(a.learner.draftNotes ?? "", /hptPassedOn: "2999-01-01".*previous value was kept/);
  const b = await updateLearner(db, draft.id, { draft: true, dob: "garbage" });
  assert.equal(b.learner.dob, "2008-01-02");
  // A new value that clashes with a stored one (licence date before the stored date of birth) is dropped, not a 400.
  const c = await updateLearner(db, draft.id, { draft: true, learnerLicenceIssuedOn: "2001-01-01" });
  assert.equal(c.learner.learnerLicenceIssuedOn, "2024-01-01");
  assert.match(c.learner.draftNotes ?? "", /cannot be before the date of birth/);
  // The same bad save again does not repeat its note, and the app's own lines survive a long note.
  const d = await updateLearner(db, draft.id, { draft: true, dob: "garbage" });
  assert.equal((d.learner.draftNotes ?? "").split("\n").filter((l) => l.includes('dob: "garbage"')).length, 1);
  const long = await updateLearner(db, draft.id, { draft: true, dob: "garbage2", draftNotes: "x".repeat(2500) });
  assert.match(long.learner.draftNotes ?? "", /dob: "garbage2"/);
});

test("a draft cannot be transferred or exported, and a stale Save draft after a confirm is refused", async () => {
  const { db, tony } = await setup();
  const other = (await db.prepare("SELECT id FROM instructors WHERE id <> ? AND status = 'active' LIMIT 1").bind(tony.id).first<{ id: string }>())!;
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, fullName: "Move Me" });
  await assert.rejects(transferLearner(db, draft.id, { toInstructorId: other.id }), /draft learner cannot be transferred/);
  await updateLearner(db, draft.id, { draft: false });
  await assert.rejects(updateLearner(db, draft.id, { draft: true, phone: "1" }), /Only a draft learner/);
});
