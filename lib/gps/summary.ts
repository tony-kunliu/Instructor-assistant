// Pure track summary: what a lesson would keep from a recording (numbers only). No I/O, no coordinates in the
// output — the only coordinate-bearing field is `specialPoints`, reserved and always EMPTY in this step.
// Design: docs/superpowers/specs/2026-10-13-gps-tracking-design.md (Tony's decisions §11: 150 m start/end
// trimming on by default; GPS distance is diagnostic, the odometer stays official).
import { detectGaps, GAP_MS, GOOD_ACCURACY_M, haversineM, hiddenPeriods, MAX_PLAUSIBLE_MS, pausedPeriods, suspensionPeriods, type Period } from "./analysis.ts";
import type { Fix, SessionData } from "./types.ts";

export const MOVING_MPS = 5 / 3.6; // > 5 km/h = moving
export const STOP_MPS = 1; // < 1 m/s for ≥ STOP_MIN_MS = a stop
export const STOP_MIN_MS = 3_000;
export const TRIM_RADIUS_M = 150;

export type SummaryOptions = {
  /** Exclude points within `trimRadiusM` of the first/last fix from any point list (default on, 150 m). */
  trim?: boolean;
  trimRadiusM?: number;
};

/** Reserved for P4 V1 special points (stops, signs, turns); always [] in this step. */
export type SpecialPoint = { kind: string; t: number; lat: number; lon: number };

export type TrackSummary = {
  schema: "ia-gps-track-summary-v1";
  sessionId: string;
  startedAt: string;
  recovered: boolean;
  /** Start → Stop wall time. */
  recordedMs: number;
  pausedMs: number;
  pauses: number;
  /** recordedMs − pausedMs. */
  activeMs: number;
  fixes: number;
  /** Fixes with accuracy ≤ 50 m, after de-duplication. */
  usedFixes: number;
  /** Diagnostic distance in metres: the odometer stays the official km. */
  distanceM: number;
  movingMs: number;
  stoppedMs: number;
  stops: { count: number; totalMs: number };
  maxSpeedMps: number | null;
  maxSpeedKmh: number | null;
  /** Share of active time with a fix (gaps > 15 s excluded), 0-100. */
  coveragePct: number;
  gaps: { count: number; totalMs: number; maxMs: number };
  jumps: number;
  trimming: { enabled: boolean; radiusM: number; trimmedStart: number; trimmedEnd: number; keptPoints: number };
  specialPoints: SpecialPoint[];
};

const kmh = (mps: number) => Math.round(mps * 3.6 * 10) / 10;

/** Fixes usable for geometry: accuracy known and ≤ 50 m, one per timestamp, in time order. */
export function usableFixes(samples: Fix[]): Fix[] {
  return [...samples]
    .filter((s) => s.acc !== null && s.acc <= GOOD_ACCURACY_M)
    .sort((a, b) => a.t - b.t || a.seq - b.seq)
    .filter((s, i, arr) => i === 0 || s.t !== arr[i - 1].t);
}

/**
 * The points that may appear in any list, map or export: everything within `radiusM` of the first fix and of the last
 * fix is removed (the start and end of a lesson are usually the learner's home). Distance is NOT affected.
 */
export function trimEnds(fixes: Fix[], radiusM = TRIM_RADIUS_M): { kept: Fix[]; trimmedStart: number; trimmedEnd: number } {
  if (!fixes.length) return { kept: [], trimmedStart: 0, trimmedEnd: 0 };
  const first = fixes[0];
  const last = fixes[fixes.length - 1];
  let trimmedStart = 0;
  let trimmedEnd = 0;
  const kept = fixes.filter((f) => {
    const nearStart = haversineM(first, f) <= radiusM;
    const nearEnd = haversineM(last, f) <= radiusM;
    if (nearStart) trimmedStart++;
    if (nearEnd && !nearStart) trimmedEnd++;
    return !nearStart && !nearEnd;
  });
  return { kept, trimmedStart, trimmedEnd };
}

const inside = (t: number, periods: Period[]) => periods.some((p) => t >= p.from && t < p.to);
const spans = (a: number, b: number, periods: Period[]) => periods.some((p) => a <= p.from && b >= p.to) || inside(a, periods) !== inside(b, periods);

export function summarizeTrack(data: SessionData, options: SummaryOptions = {}): TrackSummary {
  const { meta, events } = data;
  const trim = options.trim ?? true;
  const trimRadiusM = options.trimRadiusM ?? TRIM_RADIUS_M;
  const lastLife = Math.max(0, ...data.samples.map((s) => s.t), ...events.map((e) => e.t));
  const start = meta.startedAt;
  const end = meta.stoppedAt ?? Math.max(lastLife, start);
  const recordedMs = Math.max(0, end - start);
  const paused = pausedPeriods(meta.pauses, start, end);
  const pausedMs = paused.reduce((s, p) => s + (p.to - p.from), 0);
  const activeMs = Math.max(0, recordedMs - pausedMs);

  const fixes = usableFixes(data.samples).filter((f) => !inside(f.t, paused));

  let distanceM = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  let jumps = 0;
  let maxSpeed: number | null = null;
  // Per-fix speed: the device's value, else the speed implied by the leg that leads to the fix. A fix that implies
  // > 70 m/s from the last accepted fix is a GPS jump: it is skipped (not a stop, no speed, no distance) and the next
  // leg is measured from the fix before it.
  const speedAt: (number | null)[] = fixes.map((f) => f.speed);
  const jumped: boolean[] = fixes.map(() => false);
  let prev = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[prev];
    const b = fixes[i];
    const dtMs = b.t - a.t;
    const d = haversineM(a, b);
    const implied = d / (dtMs / 1000);
    if (implied > MAX_PLAUSIBLE_MS) {
      jumps++;
      jumped[i] = true;
      speedAt[i] = null;
      continue;
    }
    prev = i;
    if (spans(a.t, b.t, paused)) continue; // not recorded
    if (dtMs > GAP_MS) continue; // a gap: unknown movement, no distance, neither moving nor stopped
    distanceM += d;
    if (speedAt[i] === null) speedAt[i] = implied;
    const v = speedAt[i] as number;
    if (v > MOVING_MPS) movingMs += dtMs;
    else stoppedMs += dtMs;
  }
  for (const v of speedAt) if (v !== null) maxSpeed = maxSpeed === null ? v : Math.max(maxSpeed, v);

  // Stops: runs of consecutive fixes below STOP_MPS lasting ≥ STOP_MIN_MS (no gap or pause inside the run).
  let stopCount = 0;
  let stopTotalMs = 0;
  let runStart: number | null = null;
  const closeRun = (endT: number) => {
    if (runStart !== null && endT - runStart >= STOP_MIN_MS) { stopCount++; stopTotalMs += endT - runStart; }
    runStart = null;
  };
  for (let i = 0; i < fixes.length; i++) {
    const v = speedAt[i];
    const slow = !jumped[i] && v !== null && v < STOP_MPS;
    const broken = i > 0 && (fixes[i].t - fixes[i - 1].t > GAP_MS || spans(fixes[i - 1].t, fixes[i].t, paused));
    if (broken) closeRun(fixes[i - 1].t);
    if (slow) runStart ??= fixes[i].t;
    else closeRun(fixes[i].t);
  }
  if (fixes.length) closeRun(fixes[fixes.length - 1].t);

  const hidden = hiddenPeriods(events, meta.env.startVisibility, start, end);
  const gaps = detectGaps(fixes.map((f) => f.t), start, end, hidden, suspensionPeriods(events, start, end), GAP_MS, paused);
  const gapMs = gaps.reduce((s, g) => s + g.ms, 0);
  const trimmed = trim ? trimEnds(fixes, trimRadiusM) : { kept: fixes, trimmedStart: 0, trimmedEnd: 0 };

  return {
    schema: "ia-gps-track-summary-v1",
    sessionId: meta.id,
    startedAt: new Date(start).toISOString(),
    recovered: meta.recoveredAt !== undefined,
    recordedMs,
    pausedMs,
    pauses: paused.length,
    activeMs,
    fixes: data.samples.length,
    usedFixes: fixes.length,
    distanceM: Math.round(distanceM),
    movingMs,
    stoppedMs,
    stops: { count: stopCount, totalMs: stopTotalMs },
    maxSpeedMps: maxSpeed === null ? null : Math.round(maxSpeed * 100) / 100,
    maxSpeedKmh: maxSpeed === null ? null : kmh(maxSpeed),
    coveragePct: activeMs > 0 ? Math.round(Math.max(0, 1 - gapMs / activeMs) * 1000) / 10 : 0,
    gaps: { count: gaps.length, totalMs: gapMs, maxMs: gaps.reduce((m, g) => Math.max(m, g.ms), 0) },
    jumps,
    trimming: { enabled: trim, radiusM: trimRadiusM, trimmedStart: trimmed.trimmedStart, trimmedEnd: trimmed.trimmedEnd, keptPoints: trimmed.kept.length },
    specialPoints: [],
  };
}
