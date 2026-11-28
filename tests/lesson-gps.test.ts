import assert from "node:assert/strict";
import test from "node:test";
import { LessonGpsCapture } from "../lib/gps/lesson-capture.ts";
import { gpsCompetencySuggestions } from "../lib/gps/competency-suggestions.ts";
import { lessonEnvironments, signalWaits, type Junction } from "../lib/gps/lesson-environments.ts";
import { lessonCommentsWithGps, lessonLocationWithGps, ownsGpsSession, type LessonGpsDraft } from "../lib/gps/lesson-gps-draft.ts";
import { lessonGpsNotes, lessonGpsRoute } from "../lib/gps/lesson-gps-notes.ts";
import { MemoryStore } from "../lib/gps/store.ts";
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

test("waiting near a signal is a dwell, not a red-light verdict; parking near lights is not a wait", () => {
  // Drive to the signals, wait 30 s at the stop line (11, 14), then drive on.
  const stoppedAt = daytime + 5 * 3000; // the first stationary fix at the stop line
  const samples: Fix[] = [];
  const at = (x: number, y: number, speed: number) => {
    const seq = samples.length;
    const t = daytime + (seq + 1) * 3000;
    samples.push({ seq, t, rx: t, lat: lat + y / 111_195, lon: lon + x / 90_700, acc: 5, speed, heading: null, vis: "visible" });
  };
  at(-55, 0, 8); at(-25, 0, 8); at(-12, 13, 8); at(11, 14, 8);
  for (let i = 0; i < 10; i++) at(11, 14, 0);
  at(30, 0, 8); at(56, 0, 8); at(80, 0, 8);
  const waiting: SessionData = {
    meta: { id: "waiting", startedAt: daytime, stoppedAt: samples.at(-1)!.t, env: { userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible" } },
    samples,
    events: [],
  };
  const passes = lessonEnvironments(waiting, [signal]).junctions;
  assert.equal(passes.length, 1);
  const waits = signalWaits(waiting, [signal], passes);
  assert.equal(waits.length, 1);
  assert.ok(waits[0].waitMs >= 27_000);
  assert.equal(waits[0].at, stoppedAt);
  // A car parked 100 m from the signals never passes them, so no wait is reported.
  const parked = trace(points.map(([x]) => [x, 100]));
  assert.deepEqual(signalWaits(parked, [signal], lessonEnvironments(parked, [signal]).junctions), []);
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

test("the recap counts turns and speed, and turns inside the roundabout are not double-counted", () => {
  const recap = lessonGpsNotes(trace(points), true);
  assert.match(recap?.line ?? "", /0 left turns · 0 right turns/);
  assert.match(recap?.line ?? "", /max 28\.8 km\/h/);
  assert.match(recap?.line ?? "", /avg 29 km\/h moving/);
});

function traceAt(positions: number[][], speeds: number[], baseLat: number, baseLon: number, time = daytime, interval = 3000): SessionData {
  const samples: Fix[] = positions.map(([x, y], seq) => ({
    seq, t: time + (seq + 1) * interval, rx: time + (seq + 1) * interval, lat: baseLat + y / 111_195,
    lon: baseLon + x / 90_700, acc: 5, speed: speeds[seq] ?? 8, heading: null, vis: "visible",
  }));
  return {
    meta: { id: "trace-at", startedAt: time, stoppedAt: samples.at(-1)!.t, env: {
      userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible",
    } },
    samples,
    events: [],
  };
}

// Sydney base: outside the ACT, so no mapped junction interferes with the manoeuvre numbers.
const sydneyLat = -33.8688;
const sydneyLon = 151.2093;
const threePointTrack = traceAt(
  [[0, 0], [24, 0], [48, 0], [48, 0], [43, 0], [38, 0], [38, 0], [14, 0], [-10, 0]],
  [8, 8, 8, 0, 1.67, 1.67, 0, 8, 8], sydneyLat, sydneyLon,
);

test("the recap lists stops, reversing and three-point turns, each with its time", () => {
  const recap = lessonGpsNotes(threePointTrack, false);
  assert.match(recap?.line ?? "", /2 stops/);
  assert.match(recap?.line ?? "", /1 reverse segment \(10 m\)/);
  assert.match(recap?.line ?? "", /1 three-point turn/);
  assert.match(recap?.details.join("\n") ?? "", /Stopped 3 s · smooth approach · moved off/);
  assert.match(recap?.details.join("\n") ?? "", /Reversed 10 m \(6 s\)/);
  assert.match(recap?.details.join("\n") ?? "", /Three-point turn/);
  assert.equal(recap?.route, null);
});

test("the route summary names the junctions passed, in order; Location takes it only when empty", () => {
  // The real ACT data names that roundabout by its three streets (the test fixtures name it differently).
  assert.equal(lessonGpsRoute(trace(points)), "Coulter Drive / Redfern Street / Springvale Drive");
  assert.equal(lessonGpsRoute(threePointTrack), null);
  const gps: LessonGpsDraft = { id: "local", instructorId: "adi", tabId: "tab-a", startedAt: daytime, status: "collected", notes: { line: "GPS estimates", details: [], route: "Coulter Drive", incomplete: false } };
  assert.equal(lessonLocationWithGps("", gps), "Coulter Drive");
  assert.equal(lessonLocationWithGps("Gungahlin", gps), "Gungahlin");
  assert.equal(lessonLocationWithGps("", { ...gps, locationEdited: true }), "");
  assert.equal(lessonLocationWithGps("", { ...gps, notes: { line: "GPS estimates", details: [], route: null, incomplete: false } }), "");
});

test("the suggestion list only names competencies with a traceable observation, never a verdict", () => {
  const threePoint = gpsCompetencySuggestions(threePointTrack);
  assert.deepEqual(threePoint.map((s) => s.competency), [4, 8, 9, 10, 13, 17]);
  assert.match(threePoint.find((s) => s.competency === 4)?.evidence.join(" ") ?? "", /moved off after a 3 s stop/);
  assert.match(threePoint.find((s) => s.competency === 13)?.evidence.join(" ") ?? "", /reversed 10 m/);
  assert.match(threePoint.find((s) => s.competency === 8)?.evidence.join(" ") ?? "", /Max 28\.8 km\/h/);
  const driveThrough = gpsCompetencySuggestions(trace(points));
  assert.deepEqual(driveThrough.map((s) => s.competency), [8, 20]);
  assert.match(driveThrough.find((s) => s.competency === 20)?.evidence.join(" ") ?? "", /Coulter Drive/);
  assert.deepEqual(gpsCompetencySuggestions(trace([[0, 0]])), []);
});

test("automatic notes preserve the instructor's text, honour a review edit and fit the existing limit", () => {
  const capture: LessonGpsDraft = { id: "local", instructorId: "adi", tabId: "tab-a", startedAt: daytime, status: "collected", notes: { line: "GPS estimates", details: ["Signal A"], route: null, incomplete: false } };
  assert.equal(lessonCommentsWithGps("My teaching notes", capture), "My teaching notes\nGPS estimates");
  assert.equal(lessonCommentsWithGps("Reviewed note", { ...capture, commentsEdited: true }), "Reviewed note");
  assert.equal(lessonCommentsWithGps("Already signed", { ...capture, needsReview: true }), "Already signed");
  assert.equal(lessonCommentsWithGps("Still preparing", { ...capture, notes: undefined }), "Still preparing");
  const almostFull = "a".repeat(2985);
  assert.equal(lessonCommentsWithGps(almostFull, capture), `${almostFull}\nGPS estimates`);
  const full = "a".repeat(3000);
  assert.equal(lessonCommentsWithGps(full, capture), full);
});

test("only the tab that started a GPS session may touch it", () => {
  const owned: LessonGpsDraft = { id: "s1", instructorId: "adi", tabId: "tab-a", startedAt: daytime, status: "recording" };
  assert.equal(ownsGpsSession(owned, "tab-a"), true);
  assert.equal(ownsGpsSession(owned, "tab-b"), false);
  assert.equal(ownsGpsSession(undefined, "tab-a"), false);
  assert.equal(ownsGpsSession({ ...owned, tabId: "" }, "tab-a"), false);
});

test("collect() is idempotent: the same session derives the same notes and is stamped once", async () => {
  const store = new MemoryStore();
  const data = trace(points);
  await store.putMeta(data.meta);
  await store.append(data.meta.id, data.samples, data.events);
  const capture = new LessonGpsCapture(store);
  const endedAt = data.meta.stoppedAt!;
  const first = await capture.collect(data.meta.id, endedAt);
  const second = await capture.collect(data.meta.id, endedAt);
  assert.ok(first);
  assert.deepEqual(second, first);
  const saved = await store.load(data.meta.id);
  assert.ok(saved?.meta.collectedAt !== undefined);
  // A fresh capture instance (another tab, or after a reload) derives the same notes again.
  const again = await new LessonGpsCapture(store).collect(data.meta.id, endedAt);
  assert.deepEqual(again, first);
});
