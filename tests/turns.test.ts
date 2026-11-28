import assert from "node:assert/strict";
import test from "node:test";
import { detectTurns } from "../lib/gps/turns.ts";
import type { Fix, SessionData } from "../lib/gps/types.ts";

const daytime = Date.parse("2026-11-21T01:00:00Z");
const lat = -35.25723;
const lon = 149.054376;

/** Walk `bearings` (degrees clockwise from north) in 24 m legs, 3 s apart, at 8 m/s. */
function traceFromBearings(bearings: number[], time = daytime): SessionData {
  const samples: Fix[] = [{ seq: 0, t: time, rx: time, lat, lon, acc: 5, speed: 8, heading: null, vis: "visible" }];
  let x = 0;
  let y = 0;
  bearings.forEach((bearing, i) => {
    const rad = (bearing * Math.PI) / 180;
    x += 24 * Math.sin(rad);
    y += 24 * Math.cos(rad);
    const t = time + (i + 1) * 3000;
    samples.push({ seq: i + 1, t, rx: t, lat: lat + y / 111_195, lon: lon + x / 90_700, acc: 5, speed: 8, heading: null, vis: "visible" });
  });
  return {
    meta: { id: "turns-test", startedAt: time, stoppedAt: samples.at(-1)!.t, env: { userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible" } },
    samples,
    events: [],
  };
}

/** Fixes at explicit metre offsets from the base point, 3 s apart, at 8 m/s. */
function traceFromPoints(points: number[][], time = daytime): SessionData {
  const samples: Fix[] = points.map(([x, y], seq) => ({
    seq, t: time + (seq + 1) * 3000, rx: time + (seq + 1) * 3000, lat: lat + y / 111_195,
    lon: lon + x / 90_700, acc: 5, speed: 8, heading: null, vis: "visible",
  }));
  return {
    meta: { id: "turns-test", startedAt: time, stoppedAt: samples.at(-1)!.t, env: { userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible" } },
    samples,
    events: [],
  };
}

test("a straight drive has no turns", () => {
  assert.deepEqual(detectTurns(traceFromBearings([90, 90, 90, 90, 90])), { turns: [], uTurns: 0, uTurnAt: [] });
});

test("a 90 degree left and a 90 degree right are counted once each", () => {
  const left = detectTurns(traceFromBearings([90, 90, 0, 0, 0]));
  assert.equal(left.turns.length, 1);
  assert.equal(left.turns[0].direction, "left");
  assert.equal(left.turns[0].degrees, 90);
  assert.equal(left.uTurns, 0);
  const right = detectTurns(traceFromBearings([90, 90, 180, 180, 180]));
  assert.equal(right.turns.length, 1);
  assert.equal(right.turns[0].direction, "right");
  assert.equal(right.turns[0].degrees, 90);
  assert.equal(right.uTurns, 0);
});

test("a gentle curve under 40 degrees is not a turn", () => {
  assert.deepEqual(detectTurns(traceFromBearings([90, 80, 70, 70, 70])), { turns: [], uTurns: 0, uTurnAt: [] });
});

test("an S-bend is two turns, one each way", () => {
  const result = detectTurns(traceFromBearings([90, 0, 0, 90, 90]));
  assert.deepEqual(result.turns.map((t) => t.direction), ["left", "right"]);
  assert.equal(result.uTurns, 0);
});

test("a moving U-turn is a U-turn, not two turns", () => {
  const result = detectTurns(traceFromBearings([90, 45, 0, 315, 270, 270, 270]));
  assert.deepEqual(result.turns, []);
  assert.equal(result.uTurns, 1);
});

test("stationary jitter and a stopped U-turn manufacture no turns", () => {
  assert.deepEqual(detectTurns(traceFromPoints([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [0, 0]])), { turns: [], uTurns: 0, uTurnAt: [] });
  const stopped = traceFromPoints([[0, 0], [24, 0], [48, 0], [48, 0], [48, 0], [48, 0], [24, 0], [0, 0], [-24, 0]]);
  assert.deepEqual(detectTurns(stopped), { turns: [], uTurns: 0, uTurnAt: [] });
});

test("a turn inside a known roundabout is suppressed, the same turn elsewhere is not", () => {
  const data = traceFromBearings([90, 90, 0, 0, 0]);
  const at = data.samples[4].t; // the straight leg that completes the turn
  assert.deepEqual(detectTurns(data, [at]), { turns: [], uTurns: 0, uTurnAt: [] });
  assert.equal(detectTurns(data, [at + 60_000]).turns.length, 1);
});
