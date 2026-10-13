// P4 GPS: pure track summary against synthetic drives (outages, pauses, a jump, missing speed). Numbers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTrack, trimEnds, usableFixes, STOP_MIN_MS, TRIM_RADIUS_M } from "../lib/gps/summary.ts";
import { DEFAULT_DRIVE, expectedDistanceM, syntheticSession } from "../lib/gps/synthetic.ts";

const MIN = 60;
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test("steady 1 Hz drive: distance within 1 % of speed×time, all moving, no stops, full coverage", () => {
  const s = summarizeTrack(syntheticSession({ durationS: 20 * MIN, intervalS: 1 }));
  near(s.distanceM, 12 * 20 * MIN, 12 * 20 * MIN * 0.01, "distance");
  near(s.movingMs, 20 * MIN * 1000, 2000, "moving");
  assert.equal(s.stoppedMs, 0);
  assert.deepEqual(s.stops, { count: 0, totalMs: 0 });
  assert.equal(s.maxSpeedKmh, 43.2);
  assert.equal(s.coveragePct, 100);
  assert.equal(s.gaps.count, 0);
  assert.equal(s.pauses, 0);
  assert.deepEqual(s.specialPoints, []);
});

test("the default page drive: 4 stops, one gap, one jump, missing speed implied — totals are plausible", () => {
  const s = summarizeTrack(syntheticSession({ ...DEFAULT_DRIVE }));
  const expected = expectedDistanceM(DEFAULT_DRIVE, 0, DEFAULT_DRIVE.durationS);
  // The 40 s outage leg is not credited; the jumped fix is skipped (its neighbours still form one leg).
  near(s.distanceM, expected - 40 * 12, expected * 0.02, "distance");
  assert.equal(s.stops.count, 4, "stops");
  near(s.stops.totalMs, (20 + 25 + 30 + 15) * 1000, 4000, "stop total");
  assert.equal(s.jumps, 1);
  assert.equal(s.gaps.count, 1);
  near(s.gaps.maxMs, 41_000, 1500, "gap");
  assert.ok(s.coveragePct > 97 && s.coveragePct < 99, `coverage ${s.coveragePct}`);
  assert.equal(s.maxSpeedKmh, 43.2, "jump legs never set the max speed");
  near(s.movingMs + s.stoppedMs + s.gaps.totalMs, s.activeMs, 5000, "moving + stopped + gaps ≈ active");
  // Missing speed (1200-1260 s) is implied from the geometry, so moving time still covers that minute.
  near(s.movingMs, (DEFAULT_DRIVE.durationS - 90 - 40 - 2) * 1000, 6000, "moving");
});

test("pauses: excluded from active time, moving and stopped time; distance across the pause is not credited", () => {
  const s = summarizeTrack(syntheticSession({ durationS: 20 * MIN, intervalS: 1, pauses: [{ fromS: 300, toS: 600 }] }));
  assert.equal(s.pauses, 1);
  assert.equal(s.pausedMs, 300_000);
  assert.equal(s.activeMs, 15 * MIN * 1000);
  near(s.distanceM, 12 * 15 * MIN, 12 * 15 * MIN * 0.01, "distance");
  near(s.movingMs, 15 * MIN * 1000, 3000, "moving");
  assert.equal(s.gaps.count, 0);
  assert.equal(s.coveragePct, 100);
});

test("a stop shorter than 3 s is not a stop; a stop split by a pause is not merged", () => {
  const short = summarizeTrack(syntheticSession({ durationS: 5 * MIN, intervalS: 1, stops: [{ fromS: 60, toS: 62 }] }));
  assert.equal(short.stops.count, 0);
  assert.ok(STOP_MIN_MS === 3000);
  const split = summarizeTrack(syntheticSession({ durationS: 5 * MIN, intervalS: 1, stops: [{ fromS: 60, toS: 120 }], pauses: [{ fromS: 80, toS: 100 }] }));
  assert.equal(split.stops.count, 2);
  near(split.stops.totalMs, 40_000, 3000, "split stop total");
});

test("missing speed everywhere: moving/stopped/stops/max speed all come from the implied speed", () => {
  const s = summarizeTrack(syntheticSession({ durationS: 10 * MIN, intervalS: 1, speedMissing: [{ fromS: 0, toS: 10 * MIN + 1 }], stops: [{ fromS: 100, toS: 110 }] }));
  near(s.movingMs, (10 * MIN - 10) * 1000, 3000, "moving");
  assert.equal(s.stops.count, 1);
  assert.ok(s.maxSpeedKmh! >= 43 && s.maxSpeedKmh! <= 44, `max ${s.maxSpeedKmh}`);
});

test("start/end trimming: points within 150 m of the first and last fix leave the point list, distance is unchanged", () => {
  const data = syntheticSession({ durationS: 10 * MIN, intervalS: 1 });
  const on = summarizeTrack(data);
  const off = summarizeTrack(data, { trim: false });
  assert.equal(on.distanceM, off.distanceM);
  assert.equal(on.trimming.enabled, true);
  assert.equal(on.trimming.radiusM, TRIM_RADIUS_M);
  // 12 m/s → 150 m ≈ 12-13 points at each end.
  assert.ok(on.trimming.trimmedStart >= 12 && on.trimming.trimmedStart <= 14, `start ${on.trimming.trimmedStart}`);
  assert.ok(on.trimming.trimmedEnd >= 12 && on.trimming.trimmedEnd <= 14, `end ${on.trimming.trimmedEnd}`);
  assert.equal(on.trimming.keptPoints + on.trimming.trimmedStart + on.trimming.trimmedEnd, on.usedFixes);
  assert.deepEqual(off.trimming, { enabled: false, radiusM: TRIM_RADIUS_M, trimmedStart: 0, trimmedEnd: 0, keptPoints: off.usedFixes });
  const t = trimEnds(usableFixes(data.samples), 50);
  assert.ok(t.trimmedStart < on.trimming.trimmedStart && t.kept.length > on.trimming.keptPoints);
  assert.deepEqual(trimEnds([]), { kept: [], trimmedStart: 0, trimmedEnd: 0 });
});

test("poor-accuracy fixes are not used; a recording with no fixes is zeros, not NaN", () => {
  const noisy = summarizeTrack(syntheticSession({ durationS: 5 * MIN, intervalS: 1, accuracyM: 120 }));
  assert.equal(noisy.usedFixes, 0);
  assert.equal(noisy.distanceM, 0);
  assert.equal(noisy.coveragePct, 0);
  assert.equal(noisy.maxSpeedKmh, null);
  const data = syntheticSession({ durationS: 5 * MIN });
  data.samples = [];
  const empty = summarizeTrack(data);
  assert.equal(empty.fixes, 0);
  assert.equal(empty.movingMs, 0);
  assert.equal(Number.isFinite(empty.coveragePct), true);
});

test("the summary JSON carries no coordinates", () => {
  const json = JSON.stringify(summarizeTrack(syntheticSession({ ...DEFAULT_DRIVE })));
  assert.ok(!/"lat"|"lon"|latitude|longitude/.test(json), json.slice(0, 200));
  assert.match(json, /"specialPoints":\[\]/);
});
