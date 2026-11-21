import assert from "node:assert/strict";
import test from "node:test";
import { lessonEnvironments, type Junction } from "../lib/gps/lesson-environments.ts";
import { lessonCommentsWithGps } from "../lib/gps/lesson-gps-draft.ts";
import { lessonGpsNotes } from "../lib/gps/lesson-gps-notes.ts";
import type { Fix, SessionData } from "../lib/gps/types.ts";

const daytime = Date.parse("2026-11-21T01:00:00Z");
const lat = -35.25723;
const lon = 149.054376;
const roundabout: Junction = ["roundabout", "r", lat, lon, 18, "Coulter Drive"];
const signal: Junction = ["signal", "s", lat, lon, 15, "Example signal"];
const points = [[-55, 0], [-25, 0], [-12, 13], [11, 14], [30, 0], [56, 0]];

function trace(positions: number[][], time = daytime, interval = 3000): SessionData {
  const samples: Fix[] = positions.map(([x, y], seq) => ({
    seq, t: time + (seq + 1) * interval, rx: time + (seq + 1) * interval, lat: lat + y / 111_195,
    lon: lon + x / 90_700, acc: 5, speed: 8, heading: null, vis: "visible",
  }));
  return {
    meta: { id: "local-recording", startedAt: time, stoppedAt: samples.at(-1)!.t, env: {
      userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible",
    } },
    samples,
    events: [],
  };
}

test("driving through a mapped site records a candidate and repeated visits count after a separate approach", () => {
  const track = trace([...points, [80, 0], [100, 0], [85, 0], [70, 0], [60, 0], ...points.toReversed()]);
  const events = lessonEnvironments(track, [roundabout, signal]).junctions;
  assert.equal(events.filter((event) => event.id === "r").length, 2);
  assert.equal(events.filter((event) => event.id === "s").length, 2);
  assert.equal(events[0].at, track.samples[2].t);
});

test("a parallel road, an incomplete visit and a GPS gap are not counted as passes", () => {
  assert.deepEqual(lessonEnvironments(trace(points.map(([x]) => [x, 35])), [roundabout, signal]).junctions, []);
  assert.deepEqual(lessonEnvironments(trace(points.slice(0, 4)), [roundabout, signal]).junctions, []);
  const track = trace(points, daytime, 12_000);
  assert.deepEqual(lessonEnvironments(track, [roundabout, signal]).junctions, []);
  assert.deepEqual(lessonEnvironments(track, [roundabout]).lightMs, { daylight: 0, twilight: 0, night: 0 });
});

test("stationary and inaccurate fixes do not manufacture driving-environment exposure", () => {
  const stationary = trace(points.map(() => [0, 0]));
  assert.deepEqual(lessonEnvironments(stationary, [signal]), { junctions: [], lightMs: { daylight: 0, twilight: 0, night: 0 } });
  const inaccurate = trace(points);
  inaccurate.samples.forEach((fix) => { fix.acc = 45; });
  assert.deepEqual(lessonEnvironments(inaccurate, [roundabout]).junctions, []);
});

test("Canberra solar time differentiates daylight and night, without extrapolating missing parts", () => {
  assert.equal(lessonEnvironments(trace(points), []).lightMs.daylight, 15_000);
  assert.equal(lessonEnvironments(trace(points, Date.parse("2026-11-20T14:00:00Z")), []).lightMs.night, 15_000);
});

test("the lesson recap uses an actual ACT junction and redacts raw GPS and the device session id", () => {
  const recap = lessonGpsNotes(trace(points), true);
  assert.ok(recap?.incomplete);
  assert.match(recap.line, /GPS estimates \(partial,/);
  assert.match(recap.line, /1 possible roundabout pass/);
  assert.match(recap.details.join(), /Coulter Drive/);
  assert.doesNotMatch(JSON.stringify(recap), /local-recording|-35\.25723|149\.054376/);
  assert.equal(lessonGpsNotes(trace([[0, 0]]), false), null);
});

test("automatic notes preserve the instructor's text, honour a review edit and fit the existing limit", () => {
  const capture = { id: "local", instructorId: "adi", notes: { line: "GPS estimates", details: ["Signal A"], incomplete: false } };
  assert.equal(lessonCommentsWithGps("My teaching notes", capture), "My teaching notes\nGPS estimates");
  assert.equal(lessonCommentsWithGps("Reviewed note", { ...capture, commentsEdited: true }), "Reviewed note");
  assert.equal(lessonCommentsWithGps("Already signed", { ...capture, needsReview: true }), "Already signed");
  assert.equal(lessonCommentsWithGps("Still preparing", { ...capture, notes: undefined }), "Still preparing");
  const almostFull = "a".repeat(2985);
  assert.equal(lessonCommentsWithGps(almostFull, capture), `${almostFull}\nGPS estimates`);
  const full = "a".repeat(3000);
  assert.equal(lessonCommentsWithGps(full, capture), full);
});
