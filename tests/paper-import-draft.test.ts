// Saved CSV drafts for the paper import (Tony 2026-10-22): a CSV with problems is kept per learner, edited later, and
// imported once clean. The import rules themselves are unchanged (all-or-nothing, only into a learner with no lessons).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, deletePaperImportDraft, findInstructorByEmail, getPaperImportDraft, importPaperLessons, PaperImportError, savePaperImportDraft } from "../lib/repo.ts";

const BAD_CSV = "date,start_time,finish_time,start_odometer,finish_odometer,taught,assessed_achieved,assessed_not_achieved,location,comments,signature,instructor,prior_instructor,prior_lessons,prior_hours,prior_km\n2026-10-01,09:00,10:00,100,130,1,,,,,on_paper,Tony,,,,\n2026-13-99,09:00,10:00,130,160,2,,,,,on_paper,Tony,,,,\n";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, "Kunliu.work@gmail.com"))!;
  const learner = await createLearner(db, { fullName: "CSV Draft Learner", instructorId: tony.id });
  return { db, tony, learner };
}

test("a CSV with errors can be kept, read back, replaced and removed", async () => {
  const { db, learner } = await setup();
  assert.equal(await getPaperImportDraft(db, learner.id), null);
  await assert.rejects(importPaperLessons(db, learner.id, BAD_CSV, "preview"), PaperImportError);
  const saved = await savePaperImportDraft(db, learner.id, BAD_CSV);
  assert.equal(saved.csv, BAD_CSV);
  assert.ok(saved.savedAt);
  const fixed = BAD_CSV.replace("2026-13-99", "2026-10-02");
  assert.equal((await savePaperImportDraft(db, learner.id, fixed)).csv, fixed);
  assert.equal((await getPaperImportDraft(db, learner.id))?.csv, fixed);
  const result = await importPaperLessons(db, learner.id, fixed, "commit");
  assert.equal(result.mode, "commit");
  await deletePaperImportDraft(db, learner.id);
  assert.equal(await getPaperImportDraft(db, learner.id), null);
  await deletePaperImportDraft(db, learner.id); // nothing to remove is fine
});

test("an empty or oversized CSV is not saved, and a learner with lessons keeps no draft", async () => {
  const { db, learner } = await setup();
  await assert.rejects(savePaperImportDraft(db, learner.id, "   "), /no CSV text/);
  await assert.rejects(savePaperImportDraft(db, learner.id, "x".repeat(600 * 1024)), /too large/);
  await createLesson(db, learner.id, { lessonDate: "2026-10-20", startTime: "09:00", finishTime: "10:00", startOdometer: "1", finishOdometer: "2", taughtIds: ["1"], signLater: true });
  await assert.rejects(savePaperImportDraft(db, learner.id, BAD_CSV), /already has lessons/);
});

test("a draft learner can hold a CSV draft, but cannot import it", async () => {
  const { db, tony } = await setup();
  const draft = await createLearner(db, { draft: true, instructorId: tony.id, fullName: "Draft With CSV" });
  await savePaperImportDraft(db, draft.id, BAD_CSV);
  await assert.rejects(importPaperLessons(db, draft.id, BAD_CSV, "preview"), /still a draft/);
});

test("only the learner's own instructor can save or remove their CSV draft", async () => {
  const { db, tony, learner } = await setup();
  const other = (await db.prepare("SELECT id FROM instructors WHERE id <> ? AND status = 'active' LIMIT 1").bind(tony.id).first<{ id: string }>())!;
  await assert.rejects(savePaperImportDraft(db, learner.id, BAD_CSV, other.id), /only they can save/);
  await savePaperImportDraft(db, learner.id, BAD_CSV, tony.id);
  await assert.rejects(deletePaperImportDraft(db, learner.id, other.id), /only they can remove/);
});
