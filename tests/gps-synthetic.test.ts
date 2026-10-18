// P4 GPS: the accelerated synthetic driver (GeoLike replay) — timing, pause holes, error injection. No real location.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DRIVE, expectedDistanceM, fixAt, syntheticDriver, type TimerLike } from "../lib/gps/synthetic.ts";
import { Recorder, type DocLike, type GeoErrorLike, type GeoPositionLike, type RecorderDeps } from "../lib/gps/recorder.ts";
import { FaultInjectingStore, MemoryStore } from "../lib/gps/store.ts";
import { summarizeTrack } from "../lib/gps/summary.ts";

/** Deterministic wall clock with timers, so a 30-minute replay runs instantly in the test. */
function fakeTimers() {
  let now = 1_000_000;
  let nextId = 1;
  const timeouts = new Map<number, { at: number; fn: () => void }>();
  const intervals = new Map<number, { next: number; ms: number; fn: () => void }>();
  const timers: TimerLike = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; timeouts.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timeouts.delete(id as number); },
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { next: now + ms, ms, fn }); return id; },
    clearInterval: (id) => { intervals.delete(id as number); },
  };
  /** Advance wall time by `ms`, firing due timers in order. */
  const run = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      let best: { at: number; fire: () => void } | null = null;
      for (const [id, t] of timeouts) if (!best || t.at < best.at) best = { at: t.at, fire: () => { timeouts.delete(id); t.fn(); } };
      for (const [, t] of intervals) if (!best || t.next < best.at) best = { at: t.next, fire: () => { t.next += t.ms; t.fn(); } };
      if (!best || best.at > until) break;
      now = Math.max(now, best.at);
      best.fire();
      await Promise.resolve();
    }
    now = until;
  };
  return { timers, run };
}

test("the scripted car: distance = speed × non-stopped seconds; stopped fixes have speed 0 and a frozen position; the jump is ~111 km", () => {
  assert.equal(expectedDistanceM(DEFAULT_DRIVE, 0, 100), 1200);
  assert.equal(expectedDistanceM(DEFAULT_DRIVE, 100, 160), (60 - 20) * 12, "the 120-140 stop is excluded");
  const a = fixAt(DEFAULT_DRIVE, 125, 0);
  const b = fixAt(DEFAULT_DRIVE, 130, 0);
  assert.equal(a.coords.speed, 0);
  assert.deepEqual([a.coords.latitude, a.coords.longitude], [b.coords.latitude, b.coords.longitude]);
  assert.equal(fixAt(DEFAULT_DRIVE, 1230, 0).coords.speed, null, "missing speed window");
  assert.ok(fixAt(DEFAULT_DRIVE, DEFAULT_DRIVE.jumpAtS, 0).coords.latitude > -34.5, "jump");
});

test("replay timing: 30 simulated minutes at 90× take 20 wall seconds, one fix per simulated second", async () => {
  const { timers, run } = fakeTimers();
  const driver = syntheticDriver({ ...DEFAULT_DRIVE, outages: [], stops: [], jumpAtS: null }, { speedup: 90, timers });
  const fixes: GeoPositionLike[] = [];
  const errors: GeoErrorLike[] = [];
  driver.watchPosition((p) => fixes.push(p), (e) => errors.push(e), { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
  await run(10_000);
  assert.equal(fixes.length, 900, "15 simulated minutes after 10 wall seconds");
  assert.equal(fixes[1].timestamp - fixes[0].timestamp, 1000, "fix timestamps are simulated seconds");
  await run(10_000);
  assert.equal(fixes.length, 1800);
  assert.equal(driver.elapsedS(), 1800);
  await run(200);
  assert.equal(errors.length, 1, "end of the script is reported as one timeout error");
  assert.equal(errors[0].code, 3);
});

test("clearWatch stops fixes, watchPosition after a pause continues on the script (a hole, not a restart); dispose kills timers", async () => {
  const { timers, run } = fakeTimers();
  const driver = syntheticDriver({ ...DEFAULT_DRIVE, stops: [], outages: [], jumpAtS: null }, { speedup: 100, timers });
  const fixes: GeoPositionLike[] = [];
  const id = driver.watchPosition((p) => fixes.push(p), () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 1 });
  await run(1000); // 100 simulated seconds
  driver.clearWatch(id);
  assert.equal(driver.watching(), false);
  await run(500); // 50 s pause, nothing delivered
  const before = fixes.length;
  assert.equal(before, 100);
  driver.watchPosition((p) => fixes.push(p), () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 1 });
  await run(1000);
  assert.ok(fixes.length >= 199 && fixes.length <= 201, `fixes ${fixes.length}`);
  assert.ok(fixes[before].timestamp - fixes[before - 1].timestamp >= 50_000, "the pause left a hole in the timeline");
  const intervalId = driver.clock.setInterval(() => {}, 10_000);
  driver.dispose();
  assert.equal(driver.watching(), false);
  driver.clock.clearInterval(intervalId); // already cleared: harmless
});

test("error injection reaches the active watch only; store faults are injected per write", async () => {
  const { timers } = fakeTimers();
  const driver = syntheticDriver(DEFAULT_DRIVE, { speedup: 100, timers });
  const errors: GeoErrorLike[] = [];
  assert.equal(driver.injectGeoError(1), false, "no watch yet");
  const id = driver.watchPosition(() => {}, (e) => errors.push(e), { enableHighAccuracy: true, maximumAge: 0, timeout: 1 });
  assert.equal(driver.injectGeoError(1), true);
  assert.equal(driver.injectGeoError(2), true);
  assert.equal(driver.injectGeoError(3), true);
  assert.deepEqual(errors.map((e) => e.code), [1, 2, 3]);
  driver.clearWatch(id);
  assert.equal(driver.injectGeoError(2), false);
  const inner = new MemoryStore();
  const store = new FaultInjectingStore(inner);
  store.failNext = 1;
  await assert.rejects(store.append("x", [], []), /injected/);
  await store.append("x", [], []);
  assert.deepEqual(inner.events.get("x"), []);
  await store.clearAll();
  assert.equal(inner.events.size, 0);
});

test("closed loop: recorder on the simulated clock + driver → summary matches the script (distance ±2 %, stops, pause)", async () => {
  const { timers, run } = fakeTimers();
  const driver = syntheticDriver(DEFAULT_DRIVE, { speedup: 90, timers });
  const store = new MemoryStore();
  const doc: DocLike = { visibility: () => "visible", onVisibility: () => () => {}, onLifecycle: () => () => {} };
  const deps: RecorderDeps = {
    geo: driver, wakeLock: null, doc, store,
    now: driver.clock.now, setInterval: driver.clock.setInterval, clearInterval: driver.clock.clearInterval,
    env: { userAgent: "test", standalone: false, wakeLockSupported: false, geolocationSupported: true, source: "synthetic" },
    newId: () => "loop",
  };
  const rec = new Recorder(deps);
  await rec.start();
  await run(5000); // 450 s recorded (incl. stops 120-140 and 400-425)
  await rec.pause();
  await run(1000); // 90 s paused, the car drives on
  await rec.resume();
  await run(5000); // 450 s more: ends at 990 s (incl. the 600-640 outage, the 900-930 stop, the jump at 1000 is NOT reached)
  const report = await rec.stop();
  const summary = summarizeTrack((await store.load("loop"))!);
  assert.equal(report!.pauses, 1);
  assert.ok(summary.pausedMs >= 89_000 && summary.pausedMs <= 91_000, `paused ${summary.pausedMs}`);
  const recordedFrom = 0;
  const pausedFrom = 450;
  const pausedTo = 540;
  const recordedTo = 990;
  const expected = expectedDistanceM(DEFAULT_DRIVE, recordedFrom, pausedFrom) + expectedDistanceM(DEFAULT_DRIVE, pausedTo, recordedTo) - 40 * 12 /* outage leg */;
  assert.ok(Math.abs(summary.distanceM - expected) / expected < 0.02, `distance ${summary.distanceM} expected ≈ ${expected}`);
  assert.equal(summary.stops.count, 3, "120-140, 400-425, 900-930");
  assert.equal(summary.jumps, 0, "the jump at 1000 s was not reached");
  assert.equal(summary.gaps.count, 1, "the 40 s outage; the pause is not a gap");
  assert.ok(report!.coverage.overall > 0.95, `coverage ${report!.coverage.overall}`);
  assert.equal(summary.fixes, rec.snapshot().samples);
  assert.ok(Math.abs(rec.snapshot().distanceM - summary.distanceM) < 30, `live ${rec.snapshot().distanceM} vs summary ${summary.distanceM}`);
});
