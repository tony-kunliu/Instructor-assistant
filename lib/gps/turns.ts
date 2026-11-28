// Turn detection from a recorded track: left / right turns and moving U-turns, from heading change.
// Pure geometry, no I/O, no coordinates in the output — only times, directions and angles.
//
// A manoeuvre is a run of heading change in one direction. It completes when the heading steadies
// (a near-straight leg), when the heading reverses (an S-bend is two turns), or when it grows past a
// U-turn. Classification at completion: 40-150 deg = left/right turn, 150-210 deg = moving U-turn,
// past 210 deg = a roundabout-like loop (ignored). Anything below 40 deg is a curve, not a turn.
//
// Noise rules (a turn has to be a real manoeuvre, not GPS jitter):
// - only legs while moving (implied speed >= 5 km/h), accuracy <= 50 m, gap <= 10 s, no GPS jump;
// - heading changes below 8 deg per leg are treated as noise (deadband) and never accumulate;
// - a manoeuvre must complete within 20 s and cover >= 8 m;
// - a stop (or a gap) abandons the manoeuvre in progress, so a parking U-turn or a three-point turn
//   never counts;
// - heading changes inside a known roundabout (a pass within +/- 15 s) are suppressed: circling a
//   roundabout is a roundabout pass, not a turn.
import { GAP_MS, GOOD_ACCURACY_M, haversineM, MAX_PLAUSIBLE_MS } from "./analysis.ts";
import { MOVING_MPS } from "./summary.ts";
import type { SessionData } from "./types.ts";

export type TurnDirection = "left" | "right";
export type Turn = { at: number; direction: TurnDirection; degrees: number };
/** `uTurnAt` carries the time of each moving U-turn, so a note can trace it back to an observation. */
export type TurnDetection = { turns: Turn[]; uTurns: number; uTurnAt: number[] };

const MAX_LEG_MS = 10_000;
const NOISE_DEADBAND_DEG = 8;
const MIN_TURN_DEG = 40;
const MAX_TURN_DEG = 150;
const MAX_UTURN_DEG = 210;
const MAX_TURN_MS = 20_000;
const MIN_TURN_DISTANCE_M = 8;
const ROUNDABOUT_SUPPRESS_MS = 15_000;

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

export function detectTurns(data: SessionData, roundaboutAt: readonly number[] = []): TurnDetection {
  const start = data.meta.startedAt;
  const end = data.meta.stoppedAt ?? start;
  const fixes = [...data.samples]
    .filter((f) => f.t >= start && f.t <= end && f.acc !== null && f.acc <= GOOD_ACCURACY_M)
    .sort((a, b) => a.t - b.t || a.seq - b.seq)
    .filter((f, i, arr) => i === 0 || f.t !== arr[i - 1].t);
  const paused = (t: number) => data.meta.pauses?.some((p) => t >= p.from && t < (p.to ?? end)) ?? false;
  const nearRoundabout = (t: number) => roundaboutAt.some((at) => Math.abs(t - at) <= ROUNDABOUT_SUPPRESS_MS);

  const turns: Turn[] = [];
  let uTurns = 0;
  const uTurnAt: number[] = [];
  let prevBearing: number | null = null;
  let prevT: number | null = null;
  let prevFix: (typeof fixes)[number] | null = null;
  let acc = 0; // signed heading change of the manoeuvre in progress
  let accStart: number | null = null;
  let accDistance = 0;

  const reset = () => { acc = 0; accStart = null; accDistance = 0; };
  const complete = (at: number) => {
    if (accStart === null || at - accStart > MAX_TURN_MS || accDistance < MIN_TURN_DISTANCE_M) { reset(); return; }
    const degrees = Math.round(Math.abs(acc));
    if (degrees >= MIN_TURN_DEG && !nearRoundabout(at)) {
      if (degrees <= MAX_TURN_DEG) turns.push({ at, direction: acc > 0 ? "right" : "left", degrees });
      else if (degrees <= MAX_UTURN_DEG) { uTurns++; uTurnAt.push(at); }
    }
    reset();
  };

  for (const fix of fixes) {
    if (prevFix && prevT !== null) {
      const dtMs = fix.t - prevT;
      const d = haversineM(prevFix, fix);
      const implied = dtMs > 0 ? d / (dtMs / 1000) : 0;
      const moving = implied >= MOVING_MPS && implied <= MAX_PLAUSIBLE_MS;
      const continuous = dtMs > 0 && dtMs <= Math.min(MAX_LEG_MS, GAP_MS) && !paused(fix.t) && !paused(prevT);
      if (!moving || !continuous) {
        // A stop, a gap or a jump abandons any manoeuvre in progress: it was not one continuous turn.
        reset();
        prevBearing = null;
      } else {
        const b = bearing(prevFix, fix);
        if (prevBearing !== null) {
          const step = delta(prevBearing, b);
          if (Math.abs(step) < NOISE_DEADBAND_DEG) {
            // Heading steadied: the manoeuvre (if any) is complete.
            if (acc !== 0) complete(fix.t);
            else if (accStart !== null && fix.t - accStart > MAX_TURN_MS) reset();
          } else if (acc !== 0 && Math.sign(step) !== Math.sign(acc)) {
            // Heading reversed: the first manoeuvre is complete, the step starts the next one.
            complete(fix.t);
            acc = step;
            accStart = prevT;
            accDistance = d;
          } else {
            accStart ??= prevT;
            acc += step;
            accDistance += d;
            if (Math.abs(acc) > MAX_UTURN_DEG) reset(); // a roundabout-like loop, not a turn
            else if (accStart !== null && fix.t - accStart > MAX_TURN_MS) reset();
          }
        }
        prevBearing = b;
      }
    }
    prevFix = fix;
    prevT = fix.t;
  }
  return { turns, uTurns, uTurnAt };
}
