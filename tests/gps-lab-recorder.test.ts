// P4-A feasibility spike: recorder against fake geolocation / wake lock / visibility / storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLUSH_MS, HEARTBEAT_MS, Recorder, findInterrupted, recoverSession, type DocLike, type GeoErrorLike, type GeoPositionLike, type LifecycleType, type RecorderDeps } from "../lib/gps-lab/recorder.ts";
import { MemoryStore } from "../lib/gps-lab/store.ts";
import type { Visibility } from "../lib/gps-lab/types.ts";

function harness(opts: { wakeLock?: "ok" | "none" | "deny"; geo?: boolean; store?: MemoryStore } = {}) {
  let now = Date.UTC(2026, 9, 1);
  let vis: Visibility = "visible";
  const visCbs = new Set<() => void>();
  const lifeCbs = new Set<(t: LifecycleType) => void>();
  const timers: { id: number; fn: () => void; ms: number; next: number }[] = [];
  let timerId = 0;
  let onPos: ((p: GeoPositionLike) => void) | null = null;
  let onErr: ((e: GeoErrorLike) => void) | null = null;
  let cleared = 0;
  const sentinels: { released: boolean; cb: (() => void) | null }[] = [];
  const store = opts.store ?? new MemoryStore();
  const doc: DocLike = {
    visibility: () => vis,
    onVisibility: (cb) => { visCbs.add(cb); return () => visCbs.delete(cb); },
    onLifecycle: (cb) => { lifeCbs.add(cb); return () => lifeCbs.delete(cb); },
  };
  const deps: RecorderDeps = {
    geo: opts.geo === false ? null : { watchPosition: (ok, err) => { onPos = ok; onErr = err; return 7; }, clearWatch: () => { cleared++; } },
    wakeLock:
      opts.wakeLock === "none" ? null
      : { request: async () => {
          if (opts.wakeLock === "deny") throw new Error("NotAllowedError");
          const s = { released: false, cb: null as (() => void) | null };
          sentinels.push(s);
          return { release: async () => { s.released = true; s.cb?.(); }, onrelease: (cb) => { s.cb = cb; } };
        } },
    doc, store, now: () => now,
    setInterval: (fn, ms) => { timers.push({ id: ++timerId, fn, ms, next: now + ms }); return timerId; },
    clearInterval: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    env: { userAgent: "test", standalone: true, wakeLockSupported: opts.wakeLock !== "none", geolocationSupported: opts.geo !== false },
    newId: () => "s1",
  };
  const rec = new Recorder(deps);
  return {
    rec, store, sentinels,
    cleared: () => cleared,
    fix(lat = -35.28, lon = 149.13, acc = 8) { onPos?.({ timestamp: now, coords: { latitude: lat, longitude: lon, accuracy: acc, speed: 10, heading: 90 } }); },
    fixRaw(p: GeoPositionLike) { onPos?.(p); },
    err(code: number) { onErr?.({ code, message: `err${code}` }); },
    async advance(ms: number) { // step 1s at a time, firing due timers, awaiting async work
      for (let t = 0; t < ms; t += 1000) { now += 1000; for (const tm of [...timers]) if (now >= tm.next) { tm.next += tm.ms; tm.fn(); } await Promise.resolve(); }
      await rec.flushing;
    },
    setNow(n: number) { now = n; },
    get now() { return now; },
    async setVis(v: Visibility) { vis = v; for (const cb of visCbs) cb(); await Promise.resolve(); await Promise.resolve(); },
    life(t: LifecycleType) { for (const cb of lifeCbs) cb(t); },
  };
}

test("start → fixes → stop persists samples, events and a report from the device-local store", async () => {
  const h = harness();
  await h.rec.start();
  for (let i = 0; i < 12; i++) { await h.advance(5000); h.fix(-35.28 + i * 1e-4); }
  const report = await h.rec.stop();
  assert.ok(report);
  assert.equal(report!.samples, 12);
  assert.equal(h.cleared(), 1, "watch cleared");
  assert.equal(report!.wakeLock.acquired, 1);
  const data = await h.store.load("s1");
  assert.ok(data!.meta.stoppedAt);
  assert.ok(data!.events.some((e) => e.type === "start") && data!.events.some((e) => e.type === "stop"));
  assert.ok(data!.events.filter((e) => e.type === "heartbeat").length >= 5, "heartbeats recorded");
  assert.equal(h.rec.snapshot().active, false);
});

test("samples are flushed on the cadence (at most ~FLUSH_MS of data at risk) and by count", async () => {
  const h = harness();
  await h.rec.start();
  h.fix();
  assert.equal((h.store.samples.get("s1") ?? []).length, 0, "not yet flushed");
  await h.advance(FLUSH_MS);
  assert.equal((h.store.samples.get("s1") ?? []).length, 1);
  for (let i = 0; i < 20; i++) h.fix();
  await h.rec.flushing;
  assert.equal((h.store.samples.get("s1") ?? []).length, 21, "count threshold flushes without waiting for the timer");
});

test("crash recovery: a never-stopped session is found, closed at its last sign of life, and analysed", async () => {
  const h = harness();
  await h.rec.start();
  for (let i = 0; i < 6; i++) { await h.advance(5000); h.fix(); }
  await h.advance(FLUSH_MS); // persisted …then the page is killed (no stop())
  const interrupted = await findInterrupted(h.store);
  assert.equal(interrupted.length, 1);
  const report = await recoverSession(h.store, interrupted[0].id, h.now + 3_600_000);
  assert.ok(report!.recovered);
  assert.equal(report!.samples, 6);
  assert.ok(report!.durationMs < 60_000, "duration ends at last sign of life, not at recovery time");
  assert.equal((await findInterrupted(h.store)).length, 0);
  assert.ok((await h.store.load("s1"))!.events.some((e) => e.type === "recovered"));
});

test("hiding the page logs visibility, flushes immediately, and the wake lock is re-acquired on return", async () => {
  const h = harness();
  await h.rec.start();
  h.fix();
  await h.setVis("hidden");
  assert.equal((h.store.samples.get("s1") ?? []).length, 1, "flushed on hidden");
  h.sentinels[0].released = true; h.sentinels[0].cb?.(); // the browser releases the lock when hidden
  assert.equal(h.rec.snapshot().wakeLock, "released");
  await h.setVis("visible");
  await h.rec.flush();
  assert.equal(h.sentinels.length, 2, "re-acquired");
  assert.equal(h.rec.snapshot().wakeLock, "held");
  const events = (await h.store.load("s1"))!.events;
  assert.deepEqual(events.filter((e) => e.type === "visibility").map((e) => e.detail), ["hidden", "visible"]);
  assert.ok(events.some((e) => e.type === "wakelock" && e.detail === "released"));
});

test("lifecycle events (pagehide/freeze/resume/pageshow) are recorded; pagehide/freeze flush", async () => {
  const h = harness();
  await h.rec.start();
  h.fix();
  h.life("freeze"); await h.rec.flushing;
  assert.equal((h.store.samples.get("s1") ?? []).length, 1);
  h.life("resume"); h.life("pagehide"); h.life("pageshow"); await h.rec.flush();
  assert.deepEqual((await h.store.load("s1"))!.events.filter((e) => ["freeze", "resume", "pagehide", "pageshow"].includes(e.type)).map((e) => e.type), ["freeze", "resume", "pagehide", "pageshow"]);
});

test("wake lock unsupported or denied is recorded and never stops GPS capture", async () => {
  for (const mode of ["none", "deny"] as const) {
    const h = harness({ wakeLock: mode });
    await h.rec.start();
    h.fix(); h.fix();
    assert.equal(h.rec.snapshot().samples, 2);
    assert.equal(h.rec.snapshot().wakeLock, mode === "none" ? "unsupported" : "error");
    const report = await h.rec.stop();
    assert.equal(report!.wakeLock.supported, mode !== "none");
    assert.equal(report!.wakeLock.errors, mode === "deny" ? 1 : 0);
  }
});

test("geolocation errors are logged; permission denied is surfaced; capture continues when fixes return", async () => {
  const h = harness();
  await h.rec.start();
  h.err(1);
  assert.match(h.rec.snapshot().geoError!, /^1:/);
  h.fix();
  assert.equal(h.rec.snapshot().geoError, null, "cleared by the next good fix");
  h.err(2); h.err(3);
  const events = (await (async () => { await h.rec.flush(); return h.store.load("s1"); })())!.events;
  assert.equal(events.filter((e) => e.type === "geo_error").length, 3);
  const noGeo = harness({ geo: false });
  await noGeo.rec.start();
  assert.match(noGeo.rec.snapshot().geoError!, /unsupported/);
});

test("storage failures never throw or lose buffered fixes: they are retried and counted", async () => {
  const store = new MemoryStore();
  const h = harness({ store });
  await h.rec.start();
  h.fix(); h.fix();
  store.failNext = 2;
  await h.rec.flush(); // fails, re-queued
  assert.equal(h.rec.snapshot().storeErrors, 1);
  assert.ok(h.rec.snapshot().unflushed >= 2);
  await h.rec.flush(); // fails again
  await h.rec.flush(); // succeeds
  assert.equal((store.samples.get("s1") ?? []).length, 2, "nothing lost");
  assert.ok((store.events.get("s1") ?? []).some((e) => e.type === "store_error"));
});

test("non-finite speed/heading/accuracy (iOS reports NaN/-1 sometimes) are stored as null, not NaN", async () => {
  const h = harness();
  await h.rec.start();
  h.fixRaw({ timestamp: h.now, coords: { latitude: -35, longitude: 149, accuracy: Number.NaN, speed: Number.NaN, heading: null } });
  await h.rec.flush();
  const s = (await h.store.load("s1"))!.samples[0];
  assert.equal(s.acc, null); assert.equal(s.speed, null); assert.equal(s.heading, null);
});

test("fixes after stop are ignored; start is idempotent; heartbeat cadence matches HEARTBEAT_MS", async () => {
  const h = harness();
  await h.rec.start(); await h.rec.start();
  await h.advance(HEARTBEAT_MS * 3);
  await h.rec.stop();
  h.fix();
  assert.equal(h.rec.snapshot().samples, 0);
  const beats = (await h.store.load("s1"))!.events.filter((e) => e.type === "heartbeat");
  assert.ok(beats.length >= 3 && beats.length <= 5);
});
