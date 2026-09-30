// Orchestrates one recording session: watchPosition + Screen Wake Lock + visibility/lifecycle
// tracking + heartbeat + batched device-local persistence + crash recovery. All browser APIs are
// injected, so the same code runs against fakes in unit tests and real APIs on the phone.
import { analyzeSession, type Report } from "./analysis.ts";
import type { SampleStore } from "./store.ts";
import type { EventType, LabEvent, Sample, SessionEnv, SessionMeta, Visibility } from "./types.ts";

export type GeoPositionLike = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; speed: number | null; heading: number | null } };
export type GeoErrorLike = { code: number; message: string };
export type GeoLike = {
  watchPosition(ok: (p: GeoPositionLike) => void, err: (e: GeoErrorLike) => void, options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number }): number;
  clearWatch(id: number): void;
};
export type WakeLockSentinelLike = { release(): Promise<void>; onrelease(cb: () => void): void };
export type WakeLockLike = { request(): Promise<WakeLockSentinelLike> };
export type LifecycleType = "pagehide" | "pageshow" | "freeze" | "resume";
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

export type WakeLockState = "unsupported" | "idle" | "held" | "released" | "error";
export type Snapshot = {
  active: boolean;
  sessionId: string | null;
  samples: number;
  lastFixAt: number | null;
  lastAcc: number | null;
  lastSpeed: number | null;
  visibility: Visibility;
  wakeLock: WakeLockState;
  geoError: string | null;
  storeErrors: number;
  unflushed: number;
};

const finite = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

export class Recorder {
  deps: RecorderDeps;
  meta: SessionMeta | null = null;
  seq = 0;
  sampleCount = 0;
  pendingSamples: Sample[] = [];
  pendingEvents: LabEvent[] = [];
  lastFix: Sample | null = null;
  watchId: number | null = null;
  sentinel: WakeLockSentinelLike | null = null;
  wakeLockState: WakeLockState;
  geoError: string | null = null;
  storeErrors = 0;
  timers: unknown[] = [];
  offs: (() => void)[] = [];
  listeners = new Set<() => void>();
  flushing: Promise<void> = Promise.resolve();
  /** Last few events, for the on-screen log (the durable copy is in the store). */
  recent: LabEvent[] = [];

  constructor(deps: RecorderDeps) {
    this.deps = deps;
    this.wakeLockState = deps.wakeLock ? "idle" : "unsupported";
  }

  get active(): boolean {
    return this.meta !== null && this.meta.stoppedAt === undefined;
  }

  snapshot(): Snapshot {
    return {
      active: this.active,
      sessionId: this.meta?.id ?? null,
      samples: this.sampleCount,
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
    const e: LabEvent = { t: this.deps.now(), type, ...(detail !== undefined ? { detail } : {}) };
    this.pendingEvents.push(e);
    if (type !== "heartbeat") this.recent = [...this.recent, e].slice(-30);
    this.#notify();
  }

  async start(): Promise<void> {
    if (this.active) return;
    const { deps } = this;
    this.meta = { id: deps.newId(), startedAt: deps.now(), env: { ...deps.env, startVisibility: deps.doc.visibility() } };
    this.seq = 0;
    this.sampleCount = 0;
    this.lastFix = null;
    this.geoError = null;
    this.pendingSamples = [];
    this.pendingEvents = [];
    try {
      await deps.store.putMeta(this.meta);
    } catch {
      this.storeErrors++;
    }
    this.event("start");

    this.offs.push(deps.doc.onVisibility(() => this.#onVisibility()));
    this.offs.push(deps.doc.onLifecycle((type) => this.#onLifecycle(type)));
    if (deps.geo) {
      this.watchId = deps.geo.watchPosition((p) => this.#onPosition(p), (e) => this.#onGeoError(e), { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    } else this.#onGeoError({ code: 0, message: "geolocation unsupported" });
    this.timers.push(deps.setInterval(() => void this.flush(), FLUSH_MS));
    this.timers.push(deps.setInterval(() => this.#heartbeat(), HEARTBEAT_MS));
    this.#heartbeat();
    await this.#acquireWakeLock();
    this.#notify();
  }

  #heartbeat() {
    if (this.active) this.event("heartbeat", this.deps.doc.visibility());
  }

  #onPosition(p: GeoPositionLike) {
    if (!this.active) return;
    const sample: Sample = {
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
    this.lastFix = sample;
    this.sampleCount++;
    this.geoError = null;
    this.pendingSamples.push(sample);
    if (this.pendingSamples.length >= FLUSH_COUNT) void this.flush();
    this.#notify();
  }

  #onGeoError(e: GeoErrorLike) {
    this.geoError = `${e.code}: ${e.message}`;
    this.event("geo_error", this.geoError);
  }

  #onVisibility() {
    if (!this.active) return;
    const state = this.deps.doc.visibility();
    this.event("visibility", state);
    if (state === "hidden") void this.flush(); // best effort before a possible suspension
    else void this.#acquireWakeLock(); // wake locks are released automatically when the page is hidden
  }

  #onLifecycle(type: LifecycleType) {
    if (!this.active) return;
    this.event(type);
    if (type === "pagehide" || type === "freeze") void this.flush();
  }

  async #acquireWakeLock() {
    const { wakeLock } = this.deps;
    if (!wakeLock || !this.active || this.sentinel) return;
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
        this.pendingEvents = [...events, { t: this.deps.now(), type: "store_error", detail: (error as Error).message } as LabEvent, ...this.pendingEvents].slice(-MAX_PENDING);
      }
      this.#notify();
    });
    return this.flushing;
  }

  async stop(): Promise<Report | null> {
    if (!this.active || !this.meta) return null;
    const { deps } = this;
    if (this.watchId !== null) deps.geo?.clearWatch(this.watchId);
    this.watchId = null;
    for (const id of this.timers) deps.clearInterval(id);
    this.timers = [];
    for (const off of this.offs) off();
    this.offs = [];
    if (this.sentinel) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      try { await sentinel.release(); } catch { /* already released */ }
    }
    this.event("stop");
    this.meta = { ...this.meta, stoppedAt: deps.now() };
    await this.flush();
    try {
      await deps.store.putMeta(this.meta);
    } catch {
      this.storeErrors++;
    }
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

/** Closes an interrupted session at its last sign of life and returns its report. */
export async function recoverSession(store: SampleStore, id: string, now: number): Promise<Report | null> {
  const data = await store.load(id);
  if (!data) return null;
  const lastLife = Math.max(data.meta.startedAt, ...data.samples.map((s) => s.t), ...data.events.map((e) => e.t));
  const meta: SessionMeta = { ...data.meta, stoppedAt: lastLife, recoveredAt: now };
  const event: LabEvent = { t: now, type: "recovered", detail: `last sign of life ${new Date(lastLife).toISOString()}` };
  await store.putMeta(meta);
  await store.append(id, [], [event]);
  const reloaded = await store.load(id);
  return reloaded ? analyzeSession(reloaded) : null;
}
