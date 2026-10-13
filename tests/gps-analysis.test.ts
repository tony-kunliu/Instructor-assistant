// P4 GPS: feasibility analysis of synthetic traces (pauses excluded from coverage and gaps).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSession, detectGaps, haversineM, hiddenPeriods, suspensionPeriods, CRITERIA } from "../lib/gps/analysis.ts";
import { syntheticSession } from "../lib/gps/synthetic.ts";

const MIN = 60;

test("steady 5s sampling for 30 min: full coverage, no gaps, plausible distance", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN }));
  assert.equal(r.samples, 360);
  assert.equal(r.gaps.count, 0);
  assert.equal(r.coverage.overall, 1);
  assert.equal(r.intervals.medianMs, 5000);
  assert.equal(r.intervals.p95Ms, 5000);
  assert.ok(Math.abs(r.distanceM - 12 * 30 * MIN) / (12 * 30 * MIN) < 0.02, `distance ${r.distanceM}`);
  assert.equal(r.verdict.foreground, "PASS");
  assert.equal(r.verdict.background, "NA");
  assert.equal(r.verdict.overall, "INCONCLUSIVE", "no background period exercised yet");
});

test("a 60s outage in the foreground is one foreground gap and lowers coverage", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, outages: [{ fromS: 600, toS: 660 }] }));
  assert.equal(r.gaps.count, 1);
  assert.equal(r.gaps.foreground, 1);
  assert.ok(r.gaps.maxMs >= 60_000 && r.gaps.maxMs <= 66_000);
  assert.ok(r.coverage.overall < 1 && r.coverage.foreground! < CRITERIA.foregroundCoverage + 0.02);
  assert.equal(r.verdict.foreground, "FAIL");
  assert.equal(r.verdict.overall, "NATIVE_REQUIRED");
});

test("outage while hidden is classified background, with JS suspension evidence", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, hidden: [{ fromS: 600, toS: 900 }], suspended: [{ fromS: 600, toS: 900 }], outages: [{ fromS: 605, toS: 900 }] }));
  assert.equal(r.gaps.background, 1);
  assert.equal(r.gaps.foreground, 0);
  assert.ok(r.gaps.list[0].jsSuspended);
  assert.ok(r.jsSuspension.periods >= 1 && r.jsSuspension.maxMs >= 290_000);
  assert.equal(r.coverage.hiddenMs, 300_000);
  assert.ok(r.coverage.background! < 0.1);
  assert.equal(r.verdict.background, "FAIL");
  assert.equal(r.verdict.overall, "FOREGROUND_ONLY");
  assert.match(r.verdict.reasons.join(" "), /native shell/);
});

test("continuous capture through a 5-minute screen-lock → PWA_VIABLE on a long enough test", () => {
  const r = analyzeSession(syntheticSession({ durationS: 45 * MIN, hidden: [{ fromS: 600, toS: 900 }] }));
  assert.equal(r.coverage.background, 1);
  assert.equal(r.verdict.background, "PASS");
  assert.equal(r.verdict.overall, "PWA_VIABLE");
  assert.equal(r.wakeLock.acquired, 2);
  assert.equal(r.wakeLock.released, 1);
});

test("a short test is INCONCLUSIVE regardless of results", () => {
  const r = analyzeSession(syntheticSession({ durationS: 5 * MIN, hidden: [{ fromS: 60, toS: 200 }] }));
  assert.equal(r.verdict.overall, "INCONCLUSIVE");
  assert.match(r.verdict.reasons.join(" "), /shorter than 20 min/);
});

test("late delivery (OS-buffered fixes after a resume) and ordering problems are measured", () => {
  const data = syntheticSession({ durationS: 10 * MIN });
  data.samples[10].rx += 120_000;
  data.samples[20].t = data.samples[19].t; // duplicate timestamp
  data.samples[30].t = data.samples[29].t - 1000; // out of order
  const r = analyzeSession(data);
  assert.equal(r.dataQuality.lateDelivered, 1);
  assert.ok(r.dataQuality.maxDeliveryLagMs >= 120_000);
  assert.equal(r.dataQuality.duplicates, 1);
  assert.equal(r.dataQuality.outOfOrder, 1);
});

test("GPS jumps are counted and excluded from distance; poor-accuracy legs are excluded too", () => {
  const data = syntheticSession({ durationS: 10 * MIN });
  const clean = analyzeSession(data).distanceM;
  data.samples[50] = { ...data.samples[50], lat: data.samples[50].lat + 1 }; // ~111 km in 5 s
  const r = analyzeSession(data);
  assert.ok(r.dataQuality.jumps >= 1);
  assert.ok(r.distanceM < clean + 1000, "jump must not add 111 km");
  const noisy = syntheticSession({ durationS: 10 * MIN, accuracyM: 120 });
  assert.equal(analyzeSession(noisy).distanceM, 0);
  assert.equal(analyzeSession(noisy).accuracy.over50mPct, 100);
});

test("session that never produced a fix is one leading gap, not a crash", () => {
  const data = syntheticSession({ durationS: 10 * MIN });
  data.samples = [];
  const r = analyzeSession(data);
  assert.equal(r.samples, 0);
  assert.equal(r.gaps.count, 1);
  assert.equal(r.timeToFirstFixMs, null);
  assert.equal(r.coverage.overall, 0);
});

test("helpers: haversine, hidden periods from start-hidden sessions, suspension periods, gap classes", () => {
  assert.ok(Math.abs(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111_195) < 200);
  assert.deepEqual(hiddenPeriods([{ t: 50, type: "visibility", detail: "visible" }], "hidden", 0, 100), [{ from: 0, to: 50 }]);
  assert.deepEqual(hiddenPeriods([{ t: 10, type: "visibility", detail: "hidden" }], "visible", 0, 100), [{ from: 10, to: 100 }]);
  assert.deepEqual(suspensionPeriods([{ t: 10_000, type: "heartbeat" }, { t: 80_000, type: "heartbeat" }], 0, 90_000), [{ from: 10_000, to: 80_000 }]);
  const gaps = detectGaps([0, 5000, 100_000], 0, 100_000, [{ from: 6000, to: 99_000 }], []);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].cls, "background");
});

test("report carries no coordinates (stats only)", () => {
  const json = JSON.stringify(analyzeSession(syntheticSession({ durationS: 10 * MIN })));
  assert.ok(!/"lat"|"lon"/.test(json));
});

test("a stale fix stamped before Start gives time-to-first-fix 0, not a negative number", () => {
  const data = syntheticSession({ durationS: 10 * MIN });
  data.samples[0].t = data.meta.startedAt - 200;
  assert.equal(analyzeSession(data).timeToFirstFixMs, 0);
});

// ── Pauses (P4 recorder) ─────────────────────────────────────────────────────────────────────────────────────────

test("a 5-minute pause is not a gap and is excluded from the coverage denominator", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, pauses: [{ fromS: 600, toS: 900 }] }));
  assert.equal(r.pauses, 1);
  assert.equal(r.pausedMs, 300_000);
  assert.equal(r.recordingMs, 25 * MIN * 1000);
  assert.equal(r.gaps.count, 0, "silence inside the pause is not a gap");
  assert.equal(r.coverage.overall, 1);
  assert.equal(r.intervals.p95Ms, 5000, "the fix interval across the pause is not a sampling interval");
  assert.equal(r.verdict.foreground, "PASS");
});

test("an outage that spans a pause counts only its recording part; one inside the pause is nothing", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, pauses: [{ fromS: 600, toS: 900 }], outages: [{ fromS: 580, toS: 905 }] }));
  assert.equal(r.gaps.count, 1);
  // 580 → 600 before the pause, 900 → 905 after it, net of the 300 s pause, plus the 5 s sampling step at each edge.
  assert.ok(r.gaps.maxMs >= 25_000 && r.gaps.maxMs <= 35_000, `gap ${r.gaps.maxMs}`);
  const inner = analyzeSession(syntheticSession({ durationS: 30 * MIN, pauses: [{ fromS: 600, toS: 900 }], outages: [{ fromS: 650, toS: 850 }] }));
  assert.equal(inner.gaps.count, 0);
});

test("distance across a pause is not credited (the car was not recorded)", () => {
  const plain = analyzeSession(syntheticSession({ durationS: 20 * MIN })).distanceM;
  const paused = analyzeSession(syntheticSession({ durationS: 20 * MIN, pauses: [{ fromS: 300, toS: 600 }] })).distanceM;
  assert.ok(Math.abs(plain - paused - 12 * 300) < 12 * 10, `plain ${plain} paused ${paused}`);
});

test("a recording shorter than 20 min of RECORDING time stays INCONCLUSIVE even if the wall time is longer", () => {
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, pauses: [{ fromS: 120, toS: 1500 }] }));
  assert.equal(r.verdict.overall, "INCONCLUSIVE");
  assert.match(r.verdict.reasons.join(" "), /min recording/);
});

test("a short gap around a screen-locked PAUSE is classified foreground: hidden time that was paused does not count", () => {
  // Locked 600-900 while paused 600-900; fixes stop at 590 and return at 915: a 25 s gap of recording time.
  const r = analyzeSession(syntheticSession({ durationS: 30 * MIN, hidden: [{ fromS: 600, toS: 900 }], pauses: [{ fromS: 600, toS: 900 }], outages: [{ fromS: 590, toS: 915 }] }));
  assert.equal(r.gaps.count, 1);
  assert.equal(r.gaps.list[0].cls, "foreground");
  assert.equal(r.gaps.list[0].hiddenOverlapMs, 0);
  assert.equal(r.gaps.background, 0);
  // Locked 500-900 but paused only 600-900: the 500-600 locked part still counts as hidden.
  const part = analyzeSession(syntheticSession({ durationS: 30 * MIN, hidden: [{ fromS: 500, toS: 900 }], pauses: [{ fromS: 600, toS: 900 }], outages: [{ fromS: 505, toS: 915 }] }));
  assert.equal(part.gaps.count, 1);
  assert.ok(part.gaps.list[0].hiddenOverlapMs >= 90_000 && part.gaps.list[0].hiddenOverlapMs <= 100_000, `hidden ${part.gaps.list[0].hiddenOverlapMs}`);
  assert.equal(part.gaps.list[0].cls, "background");
});
