import { test } from "node:test";
import assert from "node:assert/strict";
import { revisionChanges } from "../lib/revision-diff.ts";
import type { LessonRevisionSnapshot } from "../lib/types.ts";

const base: LessonRevisionSnapshot = {
  lessonDate: "2026-09-01", startTime: "09:00", finishTime: "09:30", startOdometer: 0, finishOdometer: 10, taught: "1", competenciesAssessed: null,
  achieved: null, location: "Belconnen", comments: null, signatureStatus: "digital", adiSignaturePresent: true, learnerSignaturePresent: true,
};

test("revisionChanges lists only changed fields with struck-out old value and new value; blank shows as an em dash", () => {
  const changes = revisionChanges(base, { ...base, finishOdometer: 20, comments: "corrected", location: null });
  assert.deepEqual(changes.map((c) => [c.label, c.before, c.after]), [
    ["Finish odometer", "10", "20"],
    ["Location", "Belconnen", "—"],
    ["Comments", "—", "corrected"],
  ]);
});

test("revisionChanges: identical versions (reason-only or signature-only edit) have no changes; signature status is labelled", () => {
  assert.deepEqual(revisionChanges(base, { ...base, adiSignaturePresent: false }), []);
  assert.deepEqual(revisionChanges(base, { ...base, signatureStatus: "on_paper" }).map((c) => [c.label, c.before, c.after]), [["Signature", "Signed digitally", "Signed on paper"]]);
});
