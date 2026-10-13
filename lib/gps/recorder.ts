// Orchestrates one recording session: watchPosition + Screen Wake Lock + visibility/lifecycle
// tracking + heartbeat + batched device-local persistence + crash recovery, with Pause / Resume.
// All browser APIs are injected, so the same code runs against fakes in unit tests, against the
// synthetic driver on the page (no location API touched) and against real APIs on the phone.
import { analyzeSession, GAP_MS, GOOD_ACCURACY_M, haversineM, MAX_PLAUSIBLE_MS, type Report } from "./analysis.ts";
import type { SampleStore } from "./store.ts";
import type { EventType, Fix, Pause, SessionEnv, SessionMeta, TrackEvent, Visibility } from "./types.ts";

export type GeoPositionLike = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; speed: number | null; heading: number | null } };
export type GeoErrorLike = { code: number; message: string };
export type GeoLike = {
  watchPosition(ok: (p: GeoPositionLike) => void, err: (e: GeoErrorLike) => void, options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number }): number;
  clearWatch(id: number): void;
};
export type WakeLockSentinelLike = { release(): Promise<void>; onrelease(cb: () => void): void };
export type WakeLockLike = { request(): Promise<WakeLockSentinelLike> };
export type LifecycleType = "pagehide" | "pageshow" | "freeze" | "lifecycle_resume";
export type DocLike = {
  visibility(): Visibility;
  onVisibility(cb: () => void): () => void;
  onLifecycle(cb: (type: LifecycleType) => void): () => void;
};
export type RecorderDeps = {
  geo: GeoLike | null;
  wakeLock: WakeLockLike | null;
  doc: DocLike;
  store: SampleStore;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  env: Omit<SessionEnv, "startVisibility">;
  newId: () => string;
};

export const FLUSH_MS = 2_000;
export const FLUSH_COUNT = 20;
export const HEARTBEAT_MS = 10_000;
const MAX_PENDING = 5_000; // never grow without bound if storage keeps failing
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 } as const;

export type WakeLockState = "unsupported" | "idle" | "held" | "released" | "error";
export type RecorderState = "idle" | "recording" | "paused" | "stopped";
export type Snapshot = {
  state: RecorderState;
  /** Session open (recording or paused). */
  active: boolean;
  sessionId: string | null;
  startedAt: number | null;
  /** Sum of all pauses so far (an open pause counts up to now). */
  pausedMs: number;
  samples: number;
  /** Running diagnostic distance (same rule as the analysis: accuracy ≤ 50 m, jumps skipped). */
  distanceM: number;
  lastFixAt: number | null;
  lastAcc: number | null;
  lastSpeed: number | null;
  visibility: Visibility;
  wakeLock: WakeLockState;
  geoError: GeoErrorLike | null;
  storeErrors: number;
  unflushed: number;
};

const finite = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Total paused time of a session's pauses; an open pause is counted up to `now`. */
export function pausedMs(pauses: Pause[] | undefined, now: number): number {
  return (pauses ?? []).reduce((sum, p) => sum + Math.max(0, (p.to ?? now) - p.from), 0);
}

export class Recorder {
  deps: RecorderDeps;
  meta: SessionMeta | null = null;
  state: RecorderState = "idle";
  seq = 0;
  sampleCount = 0;
  distanceM = 0;
  pendingSamples: Fix[] = [];
  pendingEvents: TrackEvent[] = [];
  lastFix: Fix | null = null;
  watchId: number | null = null;
  sentinel: WakeLockSentinelLike | null = null;
  wakeLockState: WakeLockState;
  geoError: GeoErrorLike | null = null;
  storeErrors = 0;
  timers: unknown[] = [];
  offs: (() => void)[] = [];
  listeners = new Set<() => void>();
  flushing: Promise<void> = Promise.resolve();
  /** Last few events, for the on-screen log (the durable copy is in the store). */
  recent: TrackEvent[] = [];

  constructor(deps: RecorderDeps) {
    this.deps = deps;
    this.wakeLockState = deps.wakeLock ? "idle" : "unsupported";
  }

  /** Session open: recording or paused. */
  get active(): boolean {
    return this.state === "recording" || this.state === "paused";
  }

  snapshot(): Snapshot {
    return {
      state: this.state,
      active: this.active,
      sessionId: this.meta?.id ?? null,
      startedAt: this.meta?.startedAt ?? null,
      pausedMs: pausedMs(this.meta?.pauses, this.deps.now()),
      samples: this.sampleCount,
      distanceM: Math.round(this.distanceM),
      lastFixAt: this.lastFix?.t ?? null,
      lastAcc: this.lastFix?.acc ?? null,
      lastSpeed: this.lastFix?.speed ?? null,
      visibility: this.deps.doc.visibility(),
      wakeLock: this.wakeLockState,
      geoError: this.geoError,
      storeErrors: this.storeErrors,
      unflushed: this.pendingSamples.length + this.pendingEvents.length,
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  #notify() {
    for (const cb of this.listeners) cb();
  }

  event(type: EventType, detail?: string) {
    const e: TrackEvent = { t: this.deps.now(), type, ...(detail !== undefined ? { detail } : {}) };
    this.pendingEvents.push(e);
    if (type !== "heartbeat") this.recent = [...this.recent, e].slice(-30);
    this.#notify();
  }

  async start(): Promise<void> {
    if (this.active) return;
    const { deps } = this;
    this.meta = { id: deps.newId(), startedAt: deps.now(), pauses: [], env: { ...deps.env, startVisibility: deps.doc.visibility() } };
    this.state = "recording";
    this.seq = 0;
    this.sampleCount = 0;
    this.distanceM = 0;
    this.lastFix = null;
    this.geoError = null;
    this.pendingSamples = [];
    this.pendingEvents = [];
    await this.#putMeta();
    this.event("start");

    this.offs.push(deps.doc.onVisibility(() => this.#onVisibility()));
    this.offs.push(deps.doc.onLifecycle((type) => this.#onLifecycle(type)));
    this.#watch();
    this.timers.push(deps.setInterval(() => void this.flush(), FLUSH_MS));
    this.timers.push(deps.setInterval(() => this.#heartbeat(), HEARTBEAT_MS));
    this.#heartbeat();
    await this.#acquireWakeLock();
    this.#notify();
  }

  /** Pause: no location reads, screen may sleep; the session stays open and heartbeats keep proving the page is alive. */
  async pause(): Promise<void> {
    if (this.state !== "recording" || !this.meta) return;
    this.state = "paused";
    this.#unwatch();
    await this.#releaseWakeLock();
    this.meta = { ...this.meta, pauses: [...(this.meta.pauses ?? []), { from: this.deps.now() }] };
    this.event("pause");
    await this.#putMeta();
    void this.flush();
    this.#notify();
  }

  /** Resume after Pause (the lifecycle "resume" event is "lifecycle_resume"; this is the instructor's button). */
  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.meta) return;
    this.state = "recording";
    this.meta = { ...this.meta, pauses: this.#closePauses(this.meta.pauses) };
    // The first leg after a pause must not be measured as one long fix-to-fix move.
    this.lastFix = null;
    this.event("resume_recording");
    this.#watch();
    await this.#putMeta();
    await this.#acquireWakeLock();
    this.#notify();
  }

  #closePauses(pauses: Pause[] | undefined): Pause[] {
    const now = this.deps.now();
    return (pauses ?? []).map((p) => (p.to === undefined ? { ...p, to: Math.max(p.from, now) } : p));
  }

  #watch() {
    const { geo } = this.deps;
    if (this.watchId !== null) return;
    if (geo) this.watchId = geo.watchPosition((p) => this.#onPosition(p), (e) => this.#onGeoError(e), { ...WATCH_OPTIONS });
    else this.#onGeoError({ code: 0, message: "geolocation unsupported" });
  }

  #unwatch() {
    if (this.watchId !== null) this.deps.geo?.clearWatch(this.watchId);
    this.watchId = null;
  }

  async #putMeta() {
    if (!this.meta) return;
    try {
      await this.deps.store.putMeta(this.meta);
    } catch {
      this.storeErrors++;
    }
  }

  #heartbeat() {
    if (this.active) this.event("heartbeat", `${this.deps.doc.visibility()}${this.state === "paused" ? " paused" : ""}`);
  }

  #onPosition(p: GeoPositionLike) {
    if (this.state !== "recording") return;
    const sample: Fix = {
      seq: this.seq++,
      t: p.timestamp,
      rx: this.deps.now(),
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      acc: finite(p.coords.accuracy),
      speed: finite(p.coords.speed),
      heading: finite(p.coords.heading),
      vis: this.deps.doc.visibility(),
    };
    const prev = this.lastFix;
    // Same rules as summarizeTrack: good accuracy both ends, no GPS jump, and a silence longer than a gap is unknown
    // movement (no distance). A jumped fix does not become the reference point for the next leg.
    let jump = false;
    if (prev && sample.t > prev.t) {
      const d = haversineM(prev, sample);
      const dtMs = sample.t - prev.t;
      jump = d / (dtMs / 1000) > MAX_PLAUSIBLE_MS;
      if (!jump && dtMs <= GAP_MS && (prev.acc ?? 0) <= GOOD_ACCURACY_M && (sample.acc ?? 0) <= GOOD_ACCURACY_M) this.distanceM += d;
    }
    if (!jump) this.lastFix = sample;
    this.sampleCount++;
    this.geoError = null;
    this.pendingSamples.push(sample);
    if (this.pendingSamples.length >= FLUSH_COUNT) void this.flush();
    this.#notify();
  }

  #onGeoError(e: GeoErrorLike) {
    if (!this.active) return;
    this.geoError = { code: e.code, message: e.message };
    this.event("geo_error", `${e.code}: ${e.message}`);
  }

  #onVisibility() {
    if (!this.active) return;
    const state = this.deps.doc.visibility();
    this.event("visibility", state);
    if (state === "hidden") void this.flush(); // best effort before a possible suspension
    else if (this.state === "recording") void this.#acquireWakeLock(); // wake locks are released automatically when the page is hidden
  }

  #onLifecycle(type: LifecycleType) {
    if (!this.active) return;
    this.event(type);
    if (type === "pagehide" || type === "freeze") void this.flush();
  }

  async #acquireWakeLock() {
    const { wakeLock } = this.deps;
    if (!wakeLock || this.state !== "recording" || this.sentinel) return;
    try {
      const sentinel = await wakeLock.request();
      this.sentinel = sentinel;
      this.wakeLockState = "held";
      this.event("wakelock", "acquired");
      sentinel.onrelease(() => {
        if (this.sentinel === sentinel) this.sentinel = null;
        if (this.wakeLockState === "held") this.wakeLockState = "released";
        this.event("wakelock", "released");
      });
    } catch (error) {
      this.wakeLockState = "error";
      this.event("wakelock_error", (error as Error).message);
    }
  }

  async #releaseWakeLock() {
    if (!this.sentinel) return;
    const sentinel = this.sentinel;
    this.sentinel = null;
    try { await sentinel.release(); } catch { /* already released */ }
  }

  /** Persist everything buffered so far. Failures re-queue (bounded) and are counted — never thrown. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!this.meta || (!this.pendingSamples.length && !this.pendingEvents.length)) return;
      const samples = this.pendingSamples;
      const events = this.pendingEvents;
      this.pendingSamples = [];
      this.pendingEvents = [];
      try {
        await this.deps.store.append(this.meta.id, samples, events);
      } catch (error) {
        this.storeErrors++;
        this.pendingSamples = [...samples, ...this.pendingSamples].slice(-MAX_PENDING);
        this.pendingEvents = [...events, { t: this.deps.now(), type: "store_error", detail: (error as Error).message } as TrackEvent, ...this.pendingEvents].slice(-MAX_PENDING);
      }
      this.#notify();
    });
    return this.flushing;
  }

  /** Stop from recording or paused; closes an open pause and returns the feasibility report. */
  async stop(): Promise<Report | null> {
    if (!this.active || !this.meta) return null;
    const { deps } = this;
    this.#unwatch();
    for (const id of this.timers) deps.clearInterval(id);
    this.timers = [];
    for (const off of this.offs) off();
    this.offs = [];
    await this.#releaseWakeLock();
    this.event("stop");
    this.meta = { ...this.meta, pauses: this.#closePauses(this.meta.pauses), stoppedAt: deps.now() };
    this.state = "stopped";
    await this.flush();
    await this.#putMeta();
    this.#notify();
    return this.report();
  }

  /** Report from what is actually persisted on the device (not from in-memory state). */
  async report(): Promise<Report | null> {
    if (!this.meta) return null;
    await this.flush();
    const data = await this.deps.store.load(this.meta.id);
    return data ? analyzeSession(data) : null;
  }
}

/** Sessions that were never stopped (page killed / reloaded / crashed mid-drive). */
export async function findInterrupted(store: SampleStore): Promise<SessionMeta[]> {
  return (await store.listSessions()).filter((m) => m.stoppedAt === undefined);
}

/** Closes an interrupted session at its last sign of life (an open pause closes there too) and returns its report. */
export async function recoverSession(store: SampleStore, id: string, now: number): Promise<Report | null> {
  const data = await store.load(id);
  if (!data) return null;
  const lastLife = Math.max(data.meta.startedAt, ...data.samples.map((s) => s.t), ...data.events.map((e) => e.t));
  const pauses = (data.meta.pauses ?? []).map((p) => (p.to === undefined ? { ...p, to: Math.max(p.from, lastLife) } : p));
  const meta: SessionMeta = { ...data.meta, pauses, stoppedAt: lastLife, recoveredAt: now };
  const event: TrackEvent = { t: now, type: "recovered", detail: `last sign of life ${new Date(lastLife).toISOString()}` };
  await store.putMeta(meta);
  await store.append(id, [], [event]);
  const reloaded = await store.load(id);
  return reloaded ? analyzeSession(reloaded) : null;
}

/** Plain words for a geolocation error, iPhone first (codes per the Geolocation API). */
export function describeGeoError(e: GeoErrorLike | null): string | null {
  if (!e) return null;
  switch (e.code) {
    case 1: return "Location permission was refused. Check Settings › Privacy & Security › Location Services › Safari (or the Home Screen app) and allow While Using.";
    case 2: return "Location is unavailable right now (no GPS signal, or Location Services is off). Recording continues and picks up when fixes return.";
    case 3: return "No fix for 30 seconds. Keep the phone where it can see the sky; recording continues.";
    case 0: return "This browser has no location support. Recording continues without fixes.";
    default: return `Location error ${e.code}: ${e.message}`;
  }
}
