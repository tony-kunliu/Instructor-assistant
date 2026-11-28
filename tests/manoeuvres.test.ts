import assert from "node:assert/strict";
import test from "node:test";
import { detectLateralShifts, detectReversing, detectStops, detectThreePointTurns } from "../lib/gps/manoeuvres.ts";
import type { Fix, SessionData } from "../lib/gps/types.ts";

const daytime = Date.parse("2026-11-21T01:00:00Z");
const lat = -35.25723;
const lon = 149.054376;

function trace(positions: number[][], speeds: number[], time = daytime, interval = 3000): SessionData {
  const samples: Fix[] = positions.map(([x, y], seq) => ({
    seq, t: time + (seq + 1) * interval, rx: time + (seq + 1) * interval, lat: lat + y / 111_195,
    lon: lon + x / 90_700, acc: 5, speed: speeds[seq] ?? 8, heading: null, vis: "visible",
  }));
  return {
    meta: { id: "manoeuvres", startedAt: time, stoppedAt: samples.at(-1)!.t, env: {
      userAgent: "", standalone: false, wakeLockSupported: false, geolocationSupported: true, startVisibility: "visible",
    } },
    samples,
    events: [],
  };
}

/** Drive east, stop, reverse west, stop, drive west: a textbook three-point turn. */
const threePoint = trace(
  [[0, 0], [24, 0], [48, 0], [48, 0], [43, 0], [38, 0], [38, 0], [14, 0], [-10, 0]],
  [8, 8, 8, 0, 1.67, 1.67, 0, 8, 8],
);

test("reversing is a slow bearing flip after a stop; the three-point pattern follows it", () => {
  const reverses = detectReversing(threePoint);
  assert.equal(reverses.length, 1);
  assert.equal(reverses[0].at, daytime + 12_000);
  assert.equal(reverses[0].distanceM, 10);
  assert.equal(reverses[0].durationMs, 6_000);
  const turns = detectThreePointTurns(threePoint, reverses);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].at, daytime + 12_000);
  assert.equal(turns[0].durationMs, 24_000);
});

test("a slow moving U-turn is not reversing and not a three-point turn", () => {
  const bearings = [90, 45, 0, 315, 270, 270, 270];
  const positions: number[][] = [[0, 0]];
  for (const b of bearings) {
    const [x, y] = positions.at(-1)!;
    positions.push([x + 24 * Math.sin((b * Math.PI) / 180), y + 24 * Math.cos((b * Math.PI) / 180)]);
  }
  const uTurn = trace(positions, positions.map(() => 8));
  assert.deepEqual(detectReversing(uTurn), []);
  assert.deepEqual(detectThreePointTurns(uTurn), []);
});

test("stops carry their duration, moving-off and approach; a GPS jump does not invent one", () => {
  const stops = detectStops(threePoint);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops.map((s) => s.durationMs), [3_000, 3_000]);
  assert.equal(stops[0].endAt, daytime + 15_000);
  assert.equal(stops[0].approachMaxDecelMps2, 2.67);
  assert.equal(stops[1].endAt, daytime + 24_000);
  // A fix that jumps 500 m away mid-stop is skipped: two stops, neither with a moving-off seen.
  const jumped = trace([[0, 0], [0, 0], [500, 0], [0, 0], [0, 0]], [0, 0, 0, 0, 0]);
  const jumpedStops = detectStops(jumped);
  assert.equal(jumpedStops.length, 2);
  assert.deepEqual(jumpedStops.map((s) => s.durationMs), [3_000, 3_000]);
  assert.deepEqual(jumpedStops.map((s) => s.endAt), [null, null]);
  assert.deepEqual(detectStops(trace([[0, 0], [24, 0], [48, 0]], [8, 8, 8])), []);
});

test("a sustained 4 m sideways offset on a straight is a possible lane change; a straight and a 90-degree turn are not", () => {
  const shifted = trace([[0, 0], [24, 0], [48, 0], [72, 2], [96, 4], [120, 4], [144, 4], [168, 4], [192, 4]], [8, 8, 8, 8, 8, 8, 8, 8, 8]);
  const shifts = detectLateralShifts(shifted);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].at, daytime + 15_000);
  assert.equal(shifts[0].offsetM, 4);
  const straight = trace([[0, 0], [24, 0], [48, 0], [72, 0], [96, 0], [120, 0], [144, 0], [168, 0], [192, 0]], [8, 8, 8, 8, 8, 8, 8, 8, 8]);
  assert.deepEqual(detectLateralShifts(straight), []);
  const turned = trace([[0, 0], [24, 0], [48, 0], [48, 24], [48, 48], [48, 72]], [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(detectLateralShifts(turned), []);
  assert.deepEqual(detectReversing(shifted), []);
});
