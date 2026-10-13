// Deterministic synthetic drives for tests, the page's "Synthetic drive" source and the browser QA.
// Canberra-ish start, constant cruising speed heading north-east, with scripted stops, outages, a GPS jump and
// missing speed values. NO real location API is involved anywhere in this file.
import type { GeoErrorLike, GeoLike, GeoPositionLike } from "./recorder.ts";
import type { Fix, Pause, SessionData, SessionMeta, TrackEvent, Visibility } from "./types.ts";

export type Outage = { fromS: number; toS: number };
export type DriveProfile = {
  intervalS?: number;
  speedMps?: number;
  accuracyM?: number;
  /** No fixes are produced (signal lost). */
  outages?: Outage[];
  /** The car stands still (speed 0, position frozen). */
  stops?: Outage[];
  /** Fixes carry speed = null (iOS does this at times); the summary must imply it. */
  speedMissing?: Outage[];
  /** One fix displaced by ~111 km at this second (a GPS jump). */
  jumpAtS?: number | null;
};
export type SyntheticOptions = DriveProfile & {
  durationS: number;
  /** Periods the page is hidden (screen locked / other app in front). */
  hidden?: Outage[];
  /** Periods the page's JS is suspended (no heartbeats). Usually the same as hidden on iOS. */
  suspended?: Outage[];
  /** Instructor's Pause → Resume periods (no fixes; the car may move meanwhile). */
  pauses?: Outage[];
  startAt?: number;
  startVisibility?: Visibility;
  heartbeatS?: number;
  wakeLock?: boolean;
};

const M_PER_DEG_LAT = 111_320;
const ORIGIN = { lat: -35.28, lon: 149.13 };
const cosLat = Math.cos((ORIGIN.lat * Math.PI) / 180);
const inside = (s: number, list: Outage[] | undefined) => (list ?? []).some((o) => s >= o.fromS && s < o.toS);

/** The default drive the page replays: 30 min at 43 km/h with 4 stops, a 40 s signal loss, one jump and a minute of missing speed. */
export const DEFAULT_DRIVE: Required<Pick<DriveProfile, "intervalS" | "speedMps" | "accuracyM" | "outages" | "stops" | "speedMissing">> & { jumpAtS: number; durationS: number } = {
  durationS: 30 * 60,
  intervalS: 1,
  speedMps: 12,
  accuracyM: 8,
  stops: [{ fromS: 120, toS: 140 }, { fromS: 400, toS: 425 }, { fromS: 900, toS: 930 }, { fromS: 1500, toS: 1515 }],
  outages: [{ fromS: 600, toS: 640 }],
  speedMissing: [{ fromS: 1200, toS: 1260 }],
  jumpAtS: 1000,
};

/** Metres the car covers in the scripted drive between two seconds (stops excluded) — the QA's expected distance. */
export function expectedDistanceM(profile: DriveProfile, fromS: number, toS: number): number {
  const speed = profile.speedMps ?? 12;
  let d = 0;
  for (let s = Math.max(0, Math.floor(fromS)); s < toS; s++) if (!inside(s, profile.stops)) d += speed;
  return d;
}

/** Position and speed of the scripted car at second `s` (moving only outside stops). */
export function fixAt(profile: DriveProfile, s: number, t: number): GeoPositionLike {
  const speed = profile.speedMps ?? 12;
  const distance = expectedDistanceM(profile, 0, s);
  const jump = profile.jumpAtS != null && s === profile.jumpAtS ? 1 : 0;
  return {
    timestamp: t,
    coords: {
      latitude: ORIGIN.lat + (distance * Math.SQRT1_2) / M_PER_DEG_LAT + jump,
      longitude: ORIGIN.lon + (distance * Math.SQRT1_2) / (M_PER_DEG_LAT * cosLat),
      accuracy: profile.accuracyM ?? 8,
      speed: inside(s, profile.speedMissing) ? null : inside(s, profile.stops) ? 0 : speed,
      heading: 45,
    },
  };
}

export function syntheticSession(opts: SyntheticOptions): SessionData {
  const { durationS, intervalS = 5, outages = [], hidden = [], suspended = [], pauses = [], startAt = Date.UTC(2026, 9, 1, 0, 0, 0), heartbeatS = 10 } = opts;
  const samples: Fix[] = [];
  const events: TrackEvent[] = [{ t: startAt, type: "start" }];
  let seq = 0;
  for (let s = 1; s <= durationS; s += intervalS) {
    if (inside(s, outages) || inside(s, pauses)) continue;
    const p = fixAt(opts, s, startAt + s * 1000);
    samples.push({
      seq: seq++, t: p.timestamp, rx: p.timestamp + 300,
      lat: p.coords.latitude, lon: p.coords.longitude,
      acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, vis: inside(s, hidden) ? "hidden" : "visible",
    });
  }
  for (let s = heartbeatS; s <= durationS; s += heartbeatS) if (!inside(s, suspended)) events.push({ t: startAt + s * 1000, type: "heartbeat", detail: inside(s, hidden) ? "hidden" : "visible" });
  for (const h of hidden) {
    events.push({ t: startAt + h.fromS * 1000, type: "visibility", detail: "hidden" });
    events.push({ t: startAt + h.toS * 1000, type: "visibility", detail: "visible" });
  }
  const metaPauses: Pause[] = [];
  for (const p of pauses) {
    events.push({ t: startAt + p.fromS * 1000, type: "pause" });
    events.push({ t: startAt + p.toS * 1000, type: "resume_recording" });
    metaPauses.push({ from: startAt + p.fromS * 1000, to: startAt + p.toS * 1000 });
  }
  if (opts.wakeLock !== false) {
    events.push({ t: startAt + 100, type: "wakelock", detail: "acquired" });
    for (const h of [...hidden, ...pauses]) {
      events.push({ t: startAt + h.fromS * 1000, type: "wakelock", detail: "released" });
      events.push({ t: startAt + h.toS * 1000 + 50, type: "wakelock", detail: "acquired" });
    }
  }
  events.push({ t: startAt + durationS * 1000, type: "stop" });
  const meta: SessionMeta = {
    id: "synthetic", startedAt: startAt, stoppedAt: startAt + durationS * 1000, pauses: metaPauses,
    env: { userAgent: "synthetic", standalone: true, wakeLockSupported: true, geolocationSupported: true, startVisibility: opts.startVisibility ?? "visible", source: "synthetic" },
  };
  return { meta, samples, events };
}

// ── Accelerated replay through the recorder's GeoLike interface ──────────────────────────────────────────────────

export type TimerLike = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  /** Wall clock, ms. */
  now: () => number;
};

export type SyntheticDriverOptions = {
  /** Simulated seconds per wall second (90 = 30 simulated minutes in 20 s). */
  speedup?: number;
  /** Simulated epoch at creation (defaults to the wall clock). */
  startAt?: number;
  timers?: TimerLike;
};

export type SyntheticDriver = GeoLike & {
  profile: DriveProfile & { durationS: number };
  speedup: number;
  /** Simulated clock for the recorder (`now`, `setInterval`, `clearInterval` run `speedup`× faster than the wall). */
  clock: { now: () => number; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
  /** Simulated seconds since creation. */
  elapsedS: () => number;
  watching: () => boolean;
  /** Deliver one geolocation error to the active watch (1 denied, 2 unavailable, 3 timeout). No-op without a watch. */
  injectGeoError: (code: 1 | 2 | 3) => boolean;
  /** Stop all timers (page unmount). */
  dispose: () => void;
};

const realTimers: TimerLike = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

/**
 * Replays a scripted drive through `watchPosition` at accelerated wall-clock speed. The simulated clock starts
 * when the driver is created and keeps running whether or not a watch is active, so a Pause (clearWatch) → Resume
 * (watchPosition) leaves a hole in the recording exactly like a real pause while the car drives on.
 */
export function syntheticDriver(profile: DriveProfile & { durationS: number }, options: SyntheticDriverOptions = {}): SyntheticDriver {
  const timers = options.timers ?? realTimers;
  const speedup = options.speedup ?? 90;
  const wallStart = timers.now();
  const simStart = options.startAt ?? wallStart;
  const intervalS = profile.intervalS ?? 1;
  const simNow = () => simStart + (timers.now() - wallStart) * speedup;
  const elapsedS = () => (simNow() - simStart) / 1000;
  let watch: { id: number; ok: (p: GeoPositionLike) => void; err: (e: GeoErrorLike) => void; timer: unknown; nextS: number } | null = null;
  let nextId = 1;
  const intervals = new Set<unknown>();

  const schedule = () => {
    if (!watch) return;
    const w = watch;
    const wallDelay = Math.max(0, ((simStart + w.nextS * 1000) - simNow()) / speedup);
    w.timer = timers.setTimeout(() => {
      if (watch !== w) return;
      const s = w.nextS;
      w.nextS += intervalS;
      if (s <= profile.durationS && !inside(s, profile.outages)) w.ok(fixAt(profile, s, simStart + s * 1000));
      if (s + intervalS <= profile.durationS) schedule();
      else w.err({ code: 3, message: "synthetic drive finished" });
    }, wallDelay);
  };

  return {
    profile,
    speedup,
    clock: {
      now: simNow,
      setInterval: (fn, ms) => { const id = timers.setInterval(fn, Math.max(1, ms / speedup)); intervals.add(id); return id; },
      clearInterval: (id) => { intervals.delete(id); timers.clearInterval(id); },
    },
    elapsedS,
    watching: () => watch !== null,
    watchPosition(ok, err) {
      if (watch) timers.clearTimeout(watch.timer);
      // Next whole simulated second after now: fixes line up with the scripted timeline, never a stale position.
      const nextS = Math.floor(elapsedS() / intervalS) * intervalS + intervalS;
      watch = { id: nextId++, ok, err, timer: null, nextS };
      schedule();
      return watch.id;
    },
    clearWatch(id) {
      if (watch?.id !== id) return;
      timers.clearTimeout(watch.timer);
      watch = null;
    },
    injectGeoError(code) {
      if (!watch) return false;
      const messages = { 1: "User denied Geolocation", 2: "Position unavailable", 3: "Timeout expired" } as const;
      watch.err({ code, message: messages[code] });
      return true;
    },
    dispose() {
      if (watch) timers.clearTimeout(watch.timer);
      watch = null;
      for (const id of intervals) timers.clearInterval(id);
      intervals.clear();
    },
  };
}
