import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonWithActor, readJsonWithDefaultInstructor } from "../lib/api.ts";

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://instructor-assistant.example/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("readJsonWithActor overrides a client-submitted actingInstructorId with the trusted x-instructor-id header from middleware", async () => {
  const body = await readJsonWithActor(request({ actingInstructorId: "someone-the-client-claims-to-be" }, { "x-instructor-id": "real-verified-instructor-id" }));
  assert.equal(body.actingInstructorId, "real-verified-instructor-id");
});

test("readJsonWithActor falls back to whatever the body says when there is no Access identity header (local dev, tests, no Access in front)", async () => {
  const body = await readJsonWithActor(request({ actingInstructorId: "body-supplied-id" }));
  assert.equal(body.actingInstructorId, "body-supplied-id");
});

test("readJsonWithActor sets actingInstructorId from the header even when the body didn't include one at all", async () => {
  const body = await readJsonWithActor(request({ lessonDate: "2026-01-01" }, { "x-instructor-id": "real-verified-instructor-id" }));
  assert.equal(body.actingInstructorId, "real-verified-instructor-id");
  assert.equal(body.lessonDate, "2026-01-01");
});

test("readJsonWithDefaultInstructor defaults instructorId from the x-instructor-id header when the body didn't supply one", async () => {
  const body = await readJsonWithDefaultInstructor(request({ fullName: "New Learner" }, { "x-instructor-id": "signed-in-instructor-id" }));
  assert.equal(body.instructorId, "signed-in-instructor-id");
  assert.equal(body.fullName, "New Learner");
});

test("readJsonWithDefaultInstructor never overrides an explicit instructorId the body already supplied", async () => {
  const body = await readJsonWithDefaultInstructor(request({ fullName: "New Learner", instructorId: "explicitly-chosen-id" }, { "x-instructor-id": "signed-in-instructor-id" }));
  assert.equal(body.instructorId, "explicitly-chosen-id");
});

test("readJsonWithDefaultInstructor leaves instructorId untouched when there is no Access identity header (local dev)", async () => {
  const body = await readJsonWithDefaultInstructor(request({ fullName: "New Learner" }));
  assert.equal(body.instructorId, undefined);
});
