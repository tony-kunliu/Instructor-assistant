import assert from "node:assert/strict";
import test from "node:test";
import { workCalendarForInstructor } from "../lib/google-calendar-read.ts";

test("a calendar refresh shares one deadline across OAuth and every events page", async () => {
  const signals: AbortSignal[] = [];
  const request: typeof fetch = async (_input, init) => {
    assert.ok(init?.signal);
    signals.push(init.signal);
    if (signals.length === 1) return Response.json({ access_token: "test-token" });
    if (signals.length === 2) return Response.json({ items: [], nextPageToken: "second-page" });
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  const env = {
    DB: {},
    GOOGLE_LESSONS_INSTRUCTOR_ID: "qa-owner",
    GOOGLE_LESSONS_CALENDAR_ID: "qa-calendar",
    GOOGLE_LESSONS_CLIENT_ID: "qa-id",
    GOOGLE_LESSONS_CLIENT_SECRET: "qa-secret",
    GOOGLE_LESSONS_REFRESH_TOKEN: "qa-refresh",
  };

  const result = await workCalendarForInstructor("private", "qa-owner", env, new Date("2026-11-22T00:00:00Z"), request);

  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal === signals[0]));
  assert.deepEqual(result, { state: "unavailable" });
});
