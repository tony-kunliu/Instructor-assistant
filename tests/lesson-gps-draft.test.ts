import assert from "node:assert/strict";
import test from "node:test";
import {
  gpsSessionEndedElsewhere,
  withGpsNotes,
  type LessonGpsDraft,
} from "../lib/gps/lesson-gps-draft.ts";
import type { LessonGpsNotes } from "../lib/gps/lesson-gps-notes.ts";

const notes: LessonGpsNotes = {
  line: "GPS estimates (100% coverage) · 12.4 km · 45 min moving",
  details: ["10:24 Left turn (87°)"],
  route: "Coulter Drive",
  incomplete: false,
};

function session(overrides: Partial<LessonGpsDraft> = {}): LessonGpsDraft {
  return {
    id: "session-1",
    instructorId: "instructor-1",
    tabId: "tab-a",
    startedAt: 1000,
    status: "recording",
    ...overrides,
  };
}

// gpsSessionEndedElsewhere: the owning tab must stop and collect when another tab ends its session.

test("ending in another tab is detected only for a session this tab owns", () => {
  const before = session();
  const ended = session({ endedAt: 2000, status: "ended" });
  assert.equal(gpsSessionEndedElsewhere(before, ended, "tab-a"), true);
  // Another tab's session is never touched.
  assert.equal(gpsSessionEndedElsewhere(before, ended, "tab-b"), false);
  // A replaced session (different id) is not an end of this session.
  assert.equal(gpsSessionEndedElsewhere(before, session({ id: "session-2", endedAt: 2000, status: "ended" }), "tab-a"), false);
  // A deleted session is not an end either (the existing stop branch handles it).
  assert.equal(gpsSessionEndedElsewhere(before, undefined, "tab-a"), false);
  // Already ended before the event: nothing new to do.
  assert.equal(gpsSessionEndedElsewhere(session({ endedAt: 1500, status: "ended" }), ended, "tab-a"), false);
  // Same session, still recording: not ended.
  assert.equal(gpsSessionEndedElsewhere(before, session(), "tab-a"), false);
  assert.equal(gpsSessionEndedElsewhere(undefined, ended, "tab-a"), false);
});

// withGpsNotes: the owner's write-back and the ending tab's merge share this helper.

test("notes merge into the same session and mark it collected", () => {
  const draft = { lessonGps: session({ endedAt: 2000, status: "ended" }), adiSignature: "", learnerSignature: "" };
  const merged = withGpsNotes(draft, "session-1", notes);
  assert.ok(merged);
  assert.equal(merged.lessonGps?.notes, notes);
  assert.equal(merged.lessonGps?.status, "collected");
  assert.equal(merged.lessonGps?.needsReview, false);
  // The original draft is untouched.
  assert.equal(draft.lessonGps.notes, undefined);
});

test("notes arriving after a signature require a fresh review, like the same-tab collect", () => {
  const draft = { lessonGps: session({ endedAt: 2000, status: "ended" }), adiSignature: "signed", learnerSignature: "" };
  const merged = withGpsNotes(draft, "session-1", notes);
  assert.ok(merged);
  assert.equal(merged.lessonGps?.needsReview, true);
});

test("a null collect (no usable route) still lands, so the other tab stops waiting", () => {
  const draft = { lessonGps: session({ endedAt: 2000, status: "ended" }), adiSignature: "", learnerSignature: "" };
  const merged = withGpsNotes(draft, "session-1", null);
  assert.ok(merged);
  assert.equal(merged.lessonGps?.notes, null);
  assert.equal(merged.lessonGps?.status, "collected");
});

test("notes never merge into the wrong session or over notes already present", () => {
  const draft = { lessonGps: session({ endedAt: 2000, status: "ended" }), adiSignature: "", learnerSignature: "" };
  assert.equal(withGpsNotes(draft, "session-2", notes), null);
  assert.equal(withGpsNotes({ adiSignature: "", learnerSignature: "" }, "session-1", notes), null);
  const already = { lessonGps: session({ endedAt: 2000, status: "collected", notes }), adiSignature: "", learnerSignature: "" };
  assert.equal(withGpsNotes(already, "session-1", notes), null);
});
