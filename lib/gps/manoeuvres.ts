// Manoeuvre detection from a recorded track: reversing, three-point turns, lateral shifts
// (possible lane changes), stops and moving-off, and the deceleration approach to each stop.
// Pure geometry, no I/O, no coordinates in the output — only times, distances and speeds.
// Maps to docs/gps-cbt-mapping.md: competencies 4 (moving off), 9 (slowing), 10 (stopping),
// 13 (reversing), 17 (three-point turn), 18 (lane changing).
//
// Confidence: stops and reversing are high/medium; three-point turns are a sequence pattern
// (medium); lateral shifts are LOW confidence — GPS accuracy (±5 m) is the same size as a lane
// width, so a shift is only ever reported as "possible" and must be confirmed by the instructor.
// A U-turn that happens while moving is in turns.ts, not here; a parking U-turn or a
// three-point turn is never a "moving U-turn" (turns.ts abandons a manoeuvre on a stop).
import { GAP_MS, GOOD_ACCURACY_M, haversineM, MAX_PLAUSIBLE_MS } from "./analysis.ts";
import { MOVING_MPS, STOP_MIN_MS, STOP_MPS } from "./summary.ts";
import type { Fix, SessionData } from "./types.ts";

export type StopEvent = {
  /** First fix below STOP_MPS. */
  at: number;
  durationMs: number;
  /** First fix at/after the stop ends (the moving-off); null when still stopped at the end of the recording. */
  endAt: number | null;
  /** Steepest deceleration in the 10 s before the stop, m/s²; null when no speed pair is usable. */
  approachMaxDecelMps2: number | null;
};
export type ReverseSegment = { at: number; distanceM: number; durationMs: number };
export type ThreePointTurn = { at: number; durationMs: number };
export type LateralShift = { at: number; offsetM: number };

const MAX_LEG_MS = 10_000;
/** Reversing is slow: faster than this with a flipped bearing is a jump or a U-turn leg. */
const REVERSE_MAX_MPS = 4;
const MIN_REVERSE_M = 5;
const MIN_REVERSE_MS = 3_000;
/** Bearing flip vs the last forward bearing that counts as "the car is now facing the other way". */
const REVERSE_FLIP_DEG = 150;
/** The car must have been stationary this long before a reverse leg starts (gear change). */
const STOP_BEFORE_REVERSE_MS = 2_000;
/** Three-point turn: forward — stop — reverse — stop — forward, within this window. */
const THREE_POINT_MAX_MS = 90_000;
/** The approach and departure bearings must differ by at least this much (opposite direction). */
const THREE_POINT_HEADING_DEG = 120;
/** The reverse spot must be within this distance of both the approach and the departure. */
const THREE_POINT_PROXIMITY_M = 30;
/** A lane change shifts the car sideways by a lane width, no more (a bend shifts it further). */
const LANE_SHIFT_MIN_M = 3.5;
const LANE_SHIFT_MAX_M = 8;
/** Lane changes happen at speed; a slow sideways drift is parking, not a lane change. */
const LANE_SHIFT_MIN_SPEED_MPS = 5;
/** Legs a straight run needs before it can be the reference line. */
const LANE_STRAIGHT_LEGS = 3;
/** The heading must be back near the reference for this many legs to confirm a shift. */
const LANE_CONFIRM_LEGS = 2;
/** A candidate that does not confirm within this long is dropped. */
const LANE_SETTLE_MS = 15_000;
/** Legs this clean in a row re-anchor the reference line (bounds drift on long straights). */
const LANE_REANCHOR_LEGS = 5;

const RAD = Math.PI / 180;

/** Bearing of a leg, degrees clockwise from north, [0, 360). */
function bearing(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const dLat = (to.lat - from.lat) * RAD;
  const dLon = (to.lon - from.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(to.lat * RAD);
  const x = Math.cos(from.lat * RAD) * Math.sin(to.lat * RAD) - Math.sin(from.lat * RAD) * Math.cos(to.lat * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Signed smallest angle from a to b, in (-180, 180]. */
function delta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

type PreparedFix = Fix & { speed: number | null; jumped: boolean };

/**
 * Fixes usable for geometry: accuracy known and ≤ 50 m, inside the session, outside pauses,
 * one per timestamp, in time order. Speed per fix is the device value, else the speed implied
 * by the leg that leads to the fix; a fix that implies > 70 m/s from the last accepted fix is
 * a GPS jump (speed null, excluded from stops and manoeuvres) — same rule as summary.ts.
 */
function preparedFixes(data: SessionData): PreparedFix[] {
  const start = data.meta.startedAt;
  const end = data.meta.stoppedAt ?? start;
  const paused = (t: number) => data.meta.pauses?.some((p) => t >= p.from && t < (p.to ?? end)) ?? false;
  const fixes = [...data.samples]
    .filter((f) => f.t >= start && f.t <= end && f.acc !== null && f.acc <= GOOD_ACCURACY_M && !paused(f.t))
    .sort((a, b) => a.t - b.t || a.seq - b.seq)
    .filter((f, i, arr) => i === 0 || f.t !== arr[i - 1].t);
  const out: PreparedFix[] = fixes.map((f) => ({ ...f, speed: f.speed, jumped: false }));
  let prev = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[prev];
    const b = out[i];
    const dtMs = b.t - a.t;
    const d = haversineM(a, b);
    const implied = dtMs > 0 ? d / (dtMs / 1000) : 0;
    if (implied > MAX_PLAUSIBLE_MS) {
      out[i].jumped = true;
      out[i].speed = null;
      continue;
    }
    prev = i;
    if (out[i].speed === null) out[i].speed = implied;
  }
  return out;
}

type Leg = { fromT: number; toT: number; from: PreparedFix; to: PreparedFix; bearingDeg: number; implied: number; d: number };

/** Consecutive fix pairs with a plausible implied speed (no gap, no jump). */
function legsOf(fixes: PreparedFix[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const dtMs = b.t - a.t;
    if (dtMs <= 0 || dtMs > Math.min(MAX_LEG_MS, GAP_MS) || a.jumped || b.jumped) continue;
    const d = haversineM(a, b);
    const implied = d / (dtMs / 1000);
    if (implied > MAX_PLAUSIBLE_MS) continue;
    legs.push({ fromT: a.t, toT: b.t, from: a, to: b, bearingDeg: bearing(a, b), implied, d });
  }
  return legs;
}

/**
 * The approach to a stop, in words: a gentle stop is normal; a steep one is worth a look.
 * Shared by the lesson notes and the competency suggestions so the wording never drifts.
 */
export function describeApproach(decel: number | null): string {
  if (decel === null) return "";
  if (decel < 3) return "smooth approach";
  if (decel <= 5) return "firm braking";
  return "harsh braking";
}

/**
 * Stops: runs of consecutive fixes below STOP_MPS lasting ≥ STOP_MIN_MS (no gap or jump inside).
 * Same rule as summary.ts, but per-stop (time, duration, moving-off) instead of a count, plus
 * the steepest deceleration in the 10 s approach — the slowing evidence for competency 9.
 */
export function detectStops(data: SessionData): StopEvent[] {
  const fixes = preparedFixes(data);
  const stops: StopEvent[] = [];
  let runStart: number | null = null;
  let runStartIdx = -1;
  const closeRun = (endIdx: number, endAt: number | null) => {
    if (runStart === null || runStartIdx < 0) return;
    const endT = endAt ?? fixes[endIdx].t;
    if (endT - runStart >= STOP_MIN_MS) {
      // Approach: steepest speed drop over consecutive fix pairs in the 10 s before the stop.
      let maxDecel: number | null = null;
      for (let i = runStartIdx; i > 0; i--) {
        const cur = fixes[i];
        const prev = fixes[i - 1];
        if (cur.t - prev.t <= 0 || cur.t - prev.t > MAX_LEG_MS) break;
        if (cur.t < runStart - 10_000) break;
        if (prev.speed === null || cur.speed === null || prev.jumped || cur.jumped) continue;
        const decel = (prev.speed - cur.speed) / ((cur.t - prev.t) / 1000);
        if (decel > 0) maxDecel = maxDecel === null ? decel : Math.max(maxDecel, decel);
      }
      stops.push({ at: runStart, durationMs: endT - runStart, endAt, approachMaxDecelMps2: maxDecel === null ? null : Math.round(maxDecel * 100) / 100 });
    }
    runStart = null;
    runStartIdx = -1;
  };
  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i];
    const slow = !f.jumped && f.speed !== null && f.speed < STOP_MPS;
    const broken = i > 0 && (f.t - fixes[i - 1].t > GAP_MS || fixes[i - 1].jumped || f.jumped);
    if (broken && runStart !== null) closeRun(i - 1, null);
    if (slow) {
      if (runStart === null) { runStart = f.t; runStartIdx = i; }
    } else if (runStart !== null) closeRun(i, f.t);
  }
  if (runStart !== null) closeRun(fixes.length - 1, null);
  return stops;
}

/**
 * Reversing: a run of slow legs whose bearing is flipped > 150° from the last forward bearing,
 * starting after the car was stationary ≥ 2 s. A slow U-turn is not reversing: its legs rotate
 * gradually (each leg is compared against the running forward bearing, so no single leg flips),
 * and it has no stationary fix before the flipped leg. GPS drift at a stop is not reversing
 * either: a run needs ≥ 2 legs or ≥ 10 m.
 */
export function detectReversing(data: SessionData): ReverseSegment[] {
  const fixes = preparedFixes(data);
  const legs = legsOf(fixes);
  const out: ReverseSegment[] = [];
  let forwardBearing: number | null = null;
  let lastMovingEndT: number | null = null;
  let run: { at: number; endT: number; distanceM: number; bearing: number; legs: number } | null = null;
  const closeRun = () => {
    if (run && run.distanceM >= MIN_REVERSE_M && run.endT - run.at >= MIN_REVERSE_MS && (run.legs >= 2 || run.distanceM >= 10)) {
      out.push({ at: run.at, distanceM: Math.round(run.distanceM), durationMs: run.endT - run.at });
    }
    run = null;
  };
  for (const leg of legs) {
    const moving = leg.implied >= MOVING_MPS;
    if (!moving) {
      // Stopped (or drifting below 5 km/h): a reverse run in progress ends here.
      closeRun();
      continue;
    }
    if (run) {
      if (leg.implied <= REVERSE_MAX_MPS && Math.abs(delta(run.bearing, leg.bearingDeg)) <= 30) {
        run.distanceM += leg.d;
        run.endT = leg.toT;
        run.legs++;
        continue;
      }
      closeRun();
      // The leg that ended the run may itself be forward driving again.
    }
    const flipped = forwardBearing !== null && Math.abs(delta(forwardBearing, leg.bearingDeg)) > REVERSE_FLIP_DEG;
    const slow = leg.implied <= REVERSE_MAX_MPS;
    const stoppedBefore = lastMovingEndT !== null && leg.fromT - lastMovingEndT >= STOP_BEFORE_REVERSE_MS && leg.from.speed !== null && leg.from.speed < STOP_MPS;
    if (flipped && slow && stoppedBefore) {
      run = { at: leg.fromT, endT: leg.toT, distanceM: leg.d, bearing: leg.bearingDeg, legs: 1 };
    } else {
      forwardBearing = leg.bearingDeg;
      lastMovingEndT = leg.toT;
    }
  }
  closeRun();
  return out;
}

/**
 * Three-point turns: forward — stop — reverse — stop — forward, where the approach and the
 * departure head in (roughly) opposite directions and the whole manoeuvre happens near the
 * reverse spot. The approach/departure BEARINGS come from the longest legs either side (so the
 * turn itself, a short leg, does not set them); the PROXIMITY is measured from the legs nearest
 * the reverse (where the car stopped, and where it started moving forward again).
 */
export function detectThreePointTurns(data: SessionData, reverses: ReverseSegment[] = detectReversing(data)): ThreePointTurn[] {
  if (!reverses.length) return [];
  const fixes = preparedFixes(data);
  const legs = legsOf(fixes).filter((leg) => leg.implied >= MOVING_MPS);
  const out: ThreePointTurn[] = [];
  for (const rev of reverses) {
    const revEnd = rev.at + rev.durationMs;
    const before = legs.filter((leg) => leg.toT <= rev.at && leg.fromT >= rev.at - 30_000);
    const after = legs.filter((leg) => leg.fromT >= revEnd && leg.toT <= revEnd + 30_000);
    if (!before.length || !after.length) continue;
    const approach = before.reduce((a, b) => (b.d > a.d ? b : a));
    const departure = after.reduce((a, b) => (b.d > a.d ? b : a));
    if (Math.abs(delta(approach.bearingDeg, departure.bearingDeg)) <= THREE_POINT_HEADING_DEG) continue;
    if (after[after.length - 1].toT - before[0].fromT > THREE_POINT_MAX_MS) continue;
    const mid = fixes.find((f) => f.t >= rev.at) ?? fixes[fixes.length - 1];
    if (!mid) continue;
    if (haversineM(mid, before[before.length - 1].to) > THREE_POINT_PROXIMITY_M) continue;
    if (haversineM(mid, after[0].from) > THREE_POINT_PROXIMITY_M) continue;
    out.push({ at: rev.at, durationMs: after[after.length - 1].toT - before[0].fromT });
  }
  return out;
}

/**
 * Possible lane changes: a sideways offset of 4-8 m from a straight reference line, with the
 * heading back near the reference afterwards and the offset holding. LOW confidence — GPS
 * accuracy is the same size as a lane width, so this is only ever "possible". The reference
 * line is re-anchored after 5 clean legs so a slow bearing drift on a long straight cannot
 * accumulate into a false shift.
 */
export function detectLateralShifts(data: SessionData): LateralShift[] {
  const fixes = preparedFixes(data);
  const legs = legsOf(fixes).filter((leg) => leg.implied >= LANE_SHIFT_MIN_SPEED_MPS);
  const out: LateralShift[] = [];
  // Local metres east/north of a reference fix.
  const toLocal = (ref: PreparedFix) => (f: PreparedFix) => ({
    x: (f.lon - ref.lon) * Math.cos(ref.lat * RAD) * 111_320,
    y: (f.lat - ref.lat) * 110_540,
  });
  const offsetFrom = (ref: PreparedFix, refBearing: number, f: PreparedFix) => {
    const p = toLocal(ref)(f);
    const b = refBearing * RAD;
    return p.x * Math.cos(b) - p.y * Math.sin(b); // signed cross-track distance, metres
  };

  let ref: { fix: PreparedFix; bearing: number } | null = null;
  let straight = 0; // consecutive legs within 10° of the first straight leg's bearing
  let straightBearing: number | null = null;
  let clean = 0; // consecutive legs with |offset| < 2 m and heading within 5° of the reference
  let candidate: { at: number; maxOffset: number } | null = null;
  let confirm = 0;

  const resetToSeeking = () => {
    ref = null;
    straight = 0;
    straightBearing = null;
    clean = 0;
    candidate = null;
    confirm = 0;
  };

  for (const leg of legs) {
    if (!ref) {
      if (straightBearing === null) {
        straightBearing = leg.bearingDeg;
        straight = 1;
      } else if (Math.abs(delta(straightBearing, leg.bearingDeg)) <= 10) {
        straight++;
        if (straight >= LANE_STRAIGHT_LEGS) {
          ref = { fix: leg.from, bearing: straightBearing };
          straight = 0;
          straightBearing = null;
          clean = 0;
        }
      } else {
        straightBearing = leg.bearingDeg;
        straight = 1;
      }
      continue;
    }
    const dHeading = delta(ref.bearing, leg.bearingDeg);
    if (Math.abs(dHeading) > 20) {
      // Turning (or a bend): this is not a lane change; start over.
      resetToSeeking();
      straightBearing = leg.bearingDeg;
      straight = 1;
      continue;
    }
    const offset = offsetFrom(ref.fix, ref.bearing, leg.to);
    const abs = Math.abs(offset);
    if (candidate) {
      if (leg.toT - candidate.at > LANE_SETTLE_MS) {
        candidate = null;
        confirm = 0;
      } else if (abs >= 3 && Math.abs(dHeading) <= 10) {
        candidate.maxOffset = Math.max(candidate.maxOffset, abs);
        confirm++;
        if (confirm >= LANE_CONFIRM_LEGS) {
          out.push({ at: candidate.at, offsetM: Math.round(candidate.maxOffset * 10) / 10 });
          resetToSeeking();
        }
        continue;
      } else if (abs > LANE_SHIFT_MAX_M) {
        resetToSeeking();
        straightBearing = leg.bearingDeg;
        straight = 1;
        continue;
      }
    } else if (abs >= LANE_SHIFT_MIN_M) {
      if (abs > LANE_SHIFT_MAX_M) {
        resetToSeeking();
        straightBearing = leg.bearingDeg;
        straight = 1;
        continue;
      }
      candidate = { at: leg.toT, maxOffset: abs };
      confirm = 0;
      continue;
    }
    // Clean leg: heading near the reference, offset small — count towards re-anchoring.
    if (abs < 2 && Math.abs(dHeading) <= 5) {
      clean++;
      if (clean >= LANE_REANCHOR_LEGS) {
        ref = { fix: leg.to, bearing: leg.bearingDeg };
        clean = 0;
        candidate = null;
        confirm = 0;
      }
    } else {
      clean = 0;
    }
  }
  return out;
}
