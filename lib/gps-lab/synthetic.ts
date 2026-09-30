// Deterministic synthetic drives for tests and the browser QA. Canberra-ish start, constant speed heading north-east.
import type { LabEvent, Sample, SessionData, SessionMeta, Visibility } from "./types.ts";

export type Outage = { fromS: number; toS: number };
export type SyntheticOptions = {
  durationS: number;
  intervalS?: number;
  speedMps?: number;
  accuracyM?: number;
  outages?: Outage[];
  /** Periods the page is hidden (screen locked / other app in front). */
  hidden?: Outage[];
  /** Periods the page's JS is suspended (no heartbeats). Usually the same as hidden on iOS. */
  suspended?: Outage[];
  startAt?: number;
  startVisibility?: Visibility;
  heartbeatS?: number;
  wakeLock?: boolean;
};

const M_PER_DEG_LAT = 111_320;

export function syntheticSession(opts: SyntheticOptions): SessionData {
  const { durationS, intervalS = 5, speedMps = 12, accuracyM = 8, outages = [], hidden = [], suspended = [], startAt = Date.UTC(2026, 9, 1, 0, 0, 0), heartbeatS = 10 } = opts;
  const inside = (s: number, list: Outage[]) => list.some((o) => s >= o.fromS && s < o.toS);
  const cosLat = Math.cos((-35.28 * Math.PI) / 180);
  const samples: Sample[] = [];
  const events: LabEvent[] = [{ t: startAt, type: "start" }];
  let seq = 0;
  for (let s = 1; s <= durationS; s += intervalS) {
    if (inside(s, outages)) continue;
    const dist = speedMps * s;
    samples.push({
      seq: seq++, t: startAt + s * 1000, rx: startAt + s * 1000 + 300,
      lat: -35.28 + (dist * Math.SQRT1_2) / M_PER_DEG_LAT, lon: 149.13 + (dist * Math.SQRT1_2) / (M_PER_DEG_LAT * cosLat),
      acc: accuracyM, speed: speedMps, heading: 45, vis: inside(s, hidden) ? "hidden" : "visible",
    });
  }
  for (let s = heartbeatS; s <= durationS; s += heartbeatS) if (!inside(s, suspended)) events.push({ t: startAt + s * 1000, type: "heartbeat", detail: inside(s, hidden) ? "hidden" : "visible" });
  for (const h of hidden) {
    events.push({ t: startAt + h.fromS * 1000, type: "visibility", detail: "hidden" });
    events.push({ t: startAt + h.toS * 1000, type: "visibility", detail: "visible" });
  }
  if (opts.wakeLock !== false) {
    events.push({ t: startAt + 100, type: "wakelock", detail: "acquired" });
    for (const h of hidden) {
      events.push({ t: startAt + h.fromS * 1000, type: "wakelock", detail: "released" });
      events.push({ t: startAt + h.toS * 1000 + 50, type: "wakelock", detail: "acquired" });
    }
  }
  events.push({ t: startAt + durationS * 1000, type: "stop" });
  const meta: SessionMeta = {
    id: "synthetic", startedAt: startAt, stoppedAt: startAt + durationS * 1000,
    env: { userAgent: "synthetic", standalone: true, wakeLockSupported: true, geolocationSupported: true, startVisibility: opts.startVisibility ?? "visible" },
  };
  return { meta, samples, events };
}
