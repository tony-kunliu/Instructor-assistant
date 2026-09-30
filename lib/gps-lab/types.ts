// P4-A GPS PWA feasibility spike — EXPERIMENT ONLY (branch experiment/gps-pwa-feasibility).
// Isolated from lessons, D1 and Integration: nothing here is imported by the real app.

export type Visibility = "visible" | "hidden";

/** One position fix as delivered to the page. `t` is the fix's own timestamp, `rx` when our callback ran. */
export type Sample = {
  seq: number;
  t: number;
  rx: number;
  lat: number;
  lon: number;
  acc: number | null;
  speed: number | null;
  heading: number | null;
  vis: Visibility;
};

export type EventType =
  | "start"
  | "stop"
  | "recovered"
  | "visibility"
  | "pagehide"
  | "pageshow"
  | "freeze"
  | "resume"
  | "wakelock"
  | "wakelock_error"
  | "geo_error"
  | "heartbeat"
  | "store_error";

export type LabEvent = { t: number; type: EventType; detail?: string };

export type SessionEnv = {
  userAgent: string;
  standalone: boolean;
  wakeLockSupported: boolean;
  geolocationSupported: boolean;
  startVisibility: Visibility;
};

export type SessionMeta = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  /** Set when the session was closed by recovery (page killed/reloaded without Stop). */
  recoveredAt?: number;
  env: SessionEnv;
};

export type SessionData = { meta: SessionMeta; samples: Sample[]; events: LabEvent[] };
