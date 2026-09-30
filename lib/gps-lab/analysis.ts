// Pure analysis of a recorded trace: gaps, coverage, background behaviour and a
// PWA-vs-native verdict. No I/O — unit-tested with synthetic traces.
import type { LabEvent, Sample, SessionData, Visibility } from "./types.ts";

export const GAP_MS = 15_000; // a silence longer than this between fixes is a gap
export const SUSPEND_MS = 25_000; // no heartbeat for this long = page JS was suspended/throttled
export const MAX_PLAUSIBLE_MS = 70; // m/s (~250 km/h); faster implied speed = GPS jump
export const GOOD_ACCURACY_M = 50;
export const LATE_DELIVERY_MS = 10_000;
export const MIN_REAL_TEST_MS = 20 * 60_000;
export const MIN_BACKGROUND_MS = 60_000;

/** Decision thresholds (docs/GPS_PWA_FEASIBILITY.md). */
export const CRITERIA = {
  foregroundCoverage: 0.98,
  foregroundMaxGapMs: 20_000,
  foregroundP95IntervalMs: 10_000,
  backgroundCoverage: 0.95,
  backgroundMaxGapMs: 30_000,
};

export type Period = { from: number; to: number };
export type GapClass = "foreground" | "background";
export type Gap = { from: number; to: number; ms: number; kind: "leading" | "between" | "trailing"; cls: GapClass; hiddenOverlapMs: number; jsSuspended: boolean };

export type Verdict = "PASS" | "FAIL" | "NA";
export type Report = {
  schema: "gps-lab-report-v1";
  sessionId: string;
  recovered: boolean;
  env: SessionData["meta"]["env"];
  startedAt: string;
  durationMs: number;
  samples: number;
  timeToFirstFixMs: number | null;
  intervals: { medianMs: number | null; p95Ms: number | null; maxMs: number | null };
  coverage: { overall: number; foreground: number | null; background: number | null; hiddenMs: number };
  gaps: { count: number; foreground: number; background: number; maxMs: number; maxForegroundMs: number; maxBackgroundMs: number; list: Gap[] };
  jsSuspension: { periods: number; totalMs: number; maxMs: number };
  dataQuality: { outOfOrder: number; duplicates: number; jumps: number; lateDelivered: number; maxDeliveryLagMs: number };
  accuracy: { medianM: number | null; p95M: number | null; over50mPct: number | null };
  speed: { maxMps: number | null; missingPct: number };
  distanceM: number;
  wakeLock: { supported: boolean; acquired: number; released: number; errors: number; heldMs: number; heldPct: number };
  visibilityChanges: number;
  verdict: { foreground: Verdict; background: Verdict; overall: "PWA_VIABLE" | "FOREGROUND_ONLY" | "NATIVE_REQUIRED" | "INCONCLUSIVE"; reasons: string[] };
};

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Periods the page was hidden, from visibility events (clamped to [from, to]). */
export function hiddenPeriods(events: LabEvent[], startVisibility: Visibility, from: number, to: number): Period[] {
  const out: Period[] = [];
  let hiddenSince: number | null = startVisibility === "hidden" ? from : null;
  for (const e of [...events].filter((x) => x.type === "visibility").sort((a, b) => a.t - b.t)) {
    if (e.detail === "hidden" && hiddenSince === null) hiddenSince = Math.max(e.t, from);
    else if (e.detail === "visible" && hiddenSince !== null) {
      if (e.t > hiddenSince) out.push({ from: hiddenSince, to: Math.min(e.t, to) });
      hiddenSince = null;
    }
  }
  if (hiddenSince !== null && to > hiddenSince) out.push({ from: hiddenSince, to });
  return out.filter((p) => p.to > p.from);
}

const overlap = (a: Period, b: Period) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
const overlapWith = (p: Period, list: Period[]) => list.reduce((sum, q) => sum + overlap(p, q), 0);

/** Gaps in [start, end]: before the first fix, between fixes, after the last fix. */
export function detectGaps(times: number[], start: number, end: number, hidden: Period[], suspended: Period[], gapMs = GAP_MS): Gap[] {
  const gaps: Gap[] = [];
  const push = (from: number, to: number, kind: Gap["kind"]) => {
    const ms = to - from;
    if (ms <= gapMs) return;
    const hiddenOverlapMs = overlapWith({ from, to }, hidden);
    gaps.push({ from, to, ms, kind, cls: hiddenOverlapMs >= ms / 2 ? "background" : "foreground", hiddenOverlapMs, jsSuspended: overlapWith({ from, to }, suspended) > 0 });
  };
  if (!times.length) {
    push(start, end, "leading");
    return gaps;
  }
  push(start, times[0], "leading");
  for (let i = 1; i < times.length; i++) push(times[i - 1], times[i], "between");
  push(times[times.length - 1], end, "trailing");
  return gaps;
}

/** Periods where the page's own timers stopped (heartbeat silence) — iOS suspension/throttling evidence. */
export function suspensionPeriods(events: LabEvent[], start: number, end: number): Period[] {
  const beats = events.filter((e) => e.type === "heartbeat").map((e) => e.t).sort((a, b) => a - b);
  const marks = [start, ...beats, end];
  const out: Period[] = [];
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > SUSPEND_MS) out.push({ from: marks[i - 1], to: marks[i] });
  return out;
}

export function analyzeSession(data: SessionData): Report {
  const { meta, events } = data;
  const samples = [...data.samples].sort((a, b) => a.seq - b.seq);
  const recovered = meta.recoveredAt !== undefined;
  const lastLife = Math.max(0, ...samples.map((s) => s.t), ...events.map((e) => e.t));
  const end = meta.stoppedAt ?? Math.max(lastLife, meta.startedAt);
  const start = meta.startedAt;
  const durationMs = Math.max(0, end - start);

  // Data quality.
  let outOfOrder = 0;
  let duplicates = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t < samples[i - 1].t) outOfOrder++;
    else if (samples[i].t === samples[i - 1].t) duplicates++;
  }
  const byTime = [...samples].sort((a, b) => a.t - b.t).filter((s, i, arr) => i === 0 || s.t !== arr[i - 1].t);
  const times = byTime.map((s) => s.t);

  const hidden = hiddenPeriods(events, meta.env.startVisibility, start, end);
  const suspended = suspensionPeriods(events, start, end);
  const gaps = detectGaps(times, start, end, hidden, suspended);

  const intervals = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const hiddenMs = hidden.reduce((s, p) => s + (p.to - p.from), 0);
  const visibleMs = Math.max(0, durationMs - hiddenMs);
  // Uncovered time per class = the gap's overlap with hidden (background) or its remainder (foreground).
  const gapBackgroundMs = gaps.reduce((s, g) => s + g.hiddenOverlapMs, 0);
  const gapForegroundMs = gaps.reduce((s, g) => s + (g.ms - g.hiddenOverlapMs), 0);
  const cover = (uncovered: number, total: number) => (total > 0 ? round(Math.max(0, 1 - uncovered / total)) : null);
  const coverage = {
    overall: durationMs > 0 ? (cover(gapForegroundMs + gapBackgroundMs, durationMs) as number) : 0,
    foreground: cover(gapForegroundMs, visibleMs),
    background: hiddenMs >= MIN_BACKGROUND_MS ? cover(gapBackgroundMs, hiddenMs) : null,
    hiddenMs,
  };

  // Distance / jumps (diagnostic only — never the official distance).
  let distanceM = 0;
  let jumps = 0;
  for (let i = 1; i < byTime.length; i++) {
    const a = byTime[i - 1];
    const b = byTime[i];
    const dt = (b.t - a.t) / 1000;
    const d = haversineM(a, b);
    if (dt > 0 && d / dt > MAX_PLAUSIBLE_MS) {
      jumps++;
      continue;
    }
    if ((a.acc ?? 0) <= GOOD_ACCURACY_M && (b.acc ?? 0) <= GOOD_ACCURACY_M) distanceM += d;
  }

  const accs = samples.map((s) => s.acc).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const speeds = samples.map((s) => s.speed).filter((v): v is number => v !== null);
  const lags = samples.map((s) => Math.max(0, s.rx - s.t));

  // Wake lock.
  const wl = events.filter((e) => e.type === "wakelock").sort((a, b) => a.t - b.t);
  let heldMs = 0;
  let heldSince: number | null = null;
  for (const e of wl) {
    if (e.detail === "acquired" && heldSince === null) heldSince = e.t;
    else if (e.detail === "released" && heldSince !== null) {
      heldMs += e.t - heldSince;
      heldSince = null;
    }
  }
  if (heldSince !== null) heldMs += Math.max(0, end - heldSince);

  const gapsFg = gaps.filter((g) => g.cls === "foreground");
  const gapsBg = gaps.filter((g) => g.cls === "background");
  const maxOf = (list: Gap[]) => list.reduce((m, g) => Math.max(m, g.ms), 0);
  const p95 = percentile(intervals, 0.95);

  // Verdict.
  const reasons: string[] = [];
  let foreground: Verdict = "NA";
  if (coverage.foreground !== null && visibleMs >= 60_000) {
    const ok = coverage.foreground >= CRITERIA.foregroundCoverage && maxOf(gapsFg) <= CRITERIA.foregroundMaxGapMs && (p95 ?? 0) <= CRITERIA.foregroundP95IntervalMs;
    foreground = ok ? "PASS" : "FAIL";
    if (!ok) reasons.push(`foreground: coverage ${coverage.foreground}, max gap ${maxOf(gapsFg)}ms, p95 interval ${p95}ms`);
  }
  let background: Verdict = "NA";
  if (coverage.background !== null) {
    const ok = coverage.background >= CRITERIA.backgroundCoverage && maxOf(gapsBg) <= CRITERIA.backgroundMaxGapMs;
    background = ok ? "PASS" : "FAIL";
    if (!ok) reasons.push(`background/locked: coverage ${coverage.background}, max gap ${maxOf(gapsBg)}ms`);
  }
  let overall: Report["verdict"]["overall"];
  if (durationMs < MIN_REAL_TEST_MS) {
    overall = "INCONCLUSIVE";
    reasons.push(`test shorter than ${MIN_REAL_TEST_MS / 60000} min (${Math.round(durationMs / 60000)} min) — a real drive needs ≥ 20 min`);
  } else if (foreground === "NA") {
    overall = "INCONCLUSIVE";
    reasons.push("no measurable foreground time");
  } else if (foreground === "FAIL") overall = "NATIVE_REQUIRED";
  else if (background === "NA") {
    overall = "INCONCLUSIVE";
    reasons.push(`no background/screen-lock period ≥ ${MIN_BACKGROUND_MS / 1000}s — lock the screen and use another app during the drive`);
  } else overall = background === "PASS" ? "PWA_VIABLE" : "FOREGROUND_ONLY";
  if (overall === "FOREGROUND_ONLY") reasons.push("foreground is reliable but locked/background tracking fails — a PWA cannot keep the trace complete in normal use; decision gate → native shell");

  return {
    schema: "gps-lab-report-v1",
    sessionId: meta.id,
    recovered,
    env: meta.env,
    startedAt: new Date(meta.startedAt).toISOString(),
    durationMs,
    samples: samples.length,
    // A fix stamped before Start (cached/stale position) counts as instant, never negative.
    timeToFirstFixMs: times.length ? Math.max(0, times[0] - start) : null,
    intervals: { medianMs: percentile(intervals, 0.5), p95Ms: p95, maxMs: intervals.length ? intervals[intervals.length - 1] : null },
    coverage,
    gaps: { count: gaps.length, foreground: gapsFg.length, background: gapsBg.length, maxMs: maxOf(gaps), maxForegroundMs: maxOf(gapsFg), maxBackgroundMs: maxOf(gapsBg), list: gaps },
    jsSuspension: { periods: suspended.length, totalMs: suspended.reduce((s, p) => s + p.to - p.from, 0), maxMs: suspended.reduce((m, p) => Math.max(m, p.to - p.from), 0) },
    dataQuality: { outOfOrder, duplicates, jumps, lateDelivered: lags.filter((l) => l > LATE_DELIVERY_MS).length, maxDeliveryLagMs: lags.reduce((m, l) => Math.max(m, l), 0) },
    accuracy: { medianM: percentile(accs, 0.5), p95M: percentile(accs, 0.95), over50mPct: accs.length ? round((accs.filter((a) => a > GOOD_ACCURACY_M).length / accs.length) * 100, 1) : null },
    speed: { maxMps: speeds.length ? Math.max(...speeds) : null, missingPct: samples.length ? round(((samples.length - speeds.length) / samples.length) * 100, 1) : 0 },
    distanceM: Math.round(distanceM),
    wakeLock: {
      supported: meta.env.wakeLockSupported,
      acquired: wl.filter((e) => e.detail === "acquired").length,
      released: wl.filter((e) => e.detail === "released").length,
      errors: events.filter((e) => e.type === "wakelock_error").length,
      heldMs,
      heldPct: durationMs > 0 ? round((heldMs / durationMs) * 100, 1) : 0,
    },
    visibilityChanges: events.filter((e) => e.type === "visibility").length,
    verdict: { foreground, background, overall, reasons },
  };
}
