// P4 GPS recorder (isolated, default OFF). Device-local only: nothing in lib/gps is imported by the lesson app
// (app/driver-app.tsx, lib/repo.ts) and nothing here uploads anything. Design: docs/superpowers/specs/2026-10-13-gps-tracking-design.md.

export type Visibility = "visible" | "hidden";

/** One position fix as delivered to the page. `t` is the fix's own timestamp, `rx` when our callback ran. */
export type Fix = {
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

/**
 * Recorder events. "pause" / "resume_recording" are the instructor's Pause / Resume buttons; "lifecycle_resume" is the
 * browser's Page Lifecycle `resume` event (after `freeze`) — unrelated, hence the distinct names.
 */
export type EventType =
  | "start"
  | "pause"
  | "resume_recording"
  | "stop"
  | "recovered"
  | "visibility"
  | "pagehide"
  | "pageshow"
  | "freeze"
  | "lifecycle_resume"
  | "wakelock"
  | "wakelock_error"
  | "geo_error"
  | "heartbeat"
  | "store_error";

export type TrackEvent = { t: number; type: EventType; detail?: string };

export type SessionEnv = {
  userAgent: string;
  standalone: boolean;
  wakeLockSupported: boolean;
  geolocationSupported: boolean;
  startVisibility: Visibility;
  /** "synthetic" = replayed drive (no location API touched); "device" = this device's geolocation after consent. */
  source?: "synthetic" | "device";
};

/** One Pause → Resume period; `to` is missing while the pause is still open (or the session was interrupted during it). */
export type Pause = { from: number; to?: number };

export type SessionMeta = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  /** Set when the session was closed by recovery (page killed/reloaded without Stop). */
  recoveredAt?: number;
  pauses?: Pause[];
  env: SessionEnv;
};

export type SessionData = { meta: SessionMeta; samples: Fix[]; events: TrackEvent[] };

/** The synthetic driver's end-of-script "error" message (code 3): a note for the page, not a location failure. */
export const SYNTHETIC_DRIVE_FINISHED = "synthetic drive finished";
