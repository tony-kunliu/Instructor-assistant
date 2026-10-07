// Task 8 (spec §12, D10–D14): prior-instructor records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLesson } from "../lib/repo.ts";

const BASE_ROW = {
  id: "p1", learner_id: "L1", instructor_id: "I1", lesson_no: -1, lesson_date: "2025-12-01",
  start_time: null, finish_time: null, start_odometer: null, finish_odometer: null,
  duration_minutes: 1200, distance_km: 150, cumulative_minutes: 1200, cumulative_km: 150,
  taught: null, competencies_assessed: "1, 2", achieved: "1, 2", location: null, comments: null,
  adi_signature: null, learner_signature: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: null,
  updated_by_instructor_id: null, updated_by_instructor_name: null,
  record_source: "prior_instructor", signature_status: "on_paper", prior_instructor_label: "QA ADI 358", prior_lesson_count: 11,
};

test("toLesson reads prior-instructor rows and their label / lesson count", () => {
  const lesson = toLesson(BASE_ROW);
  assert.equal(lesson.recordSource, "prior_instructor");
  assert.equal(lesson.priorInstructorLabel, "QA ADI 358");
  assert.equal(lesson.priorLessonCount, 11);
  const app = toLesson({ ...BASE_ROW, lesson_no: 1, record_source: "app", signature_status: "digital", prior_instructor_label: null, prior_lesson_count: null });
  assert.equal(app.priorInstructorLabel, null);
  assert.equal(app.priorLessonCount, null);
});

test("toLesson is strict for prior rows: a prior_instructor row without label or lesson count throws naming the column", () => {
  assert.throws(() => toLesson({ ...BASE_ROW, prior_instructor_label: null }), /prior_instructor_label/);
  assert.throws(() => toLesson({ ...BASE_ROW, prior_lesson_count: null }), /prior_lesson_count/);
  const { prior_lesson_count: _c, ...missing } = BASE_ROW;
  assert.throws(() => toLesson(missing), /prior_lesson_count/);
});
