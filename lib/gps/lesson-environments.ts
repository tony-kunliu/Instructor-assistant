import { haversineM } from "./analysis.ts";
import type { Fix, SessionData } from "./types.ts";

export type Junction = [kind: "roundabout" | "signal", id: string, lat: number, lon: number, radiusM: number, name: string];
type Leg = { from: Fix; to: Fix; distanceM: number };
export type JunctionPass = { kind: Junction[0]; id: string; name: string; at: number };
export type SignalWait = { id: string; name: string; at: number; waitMs: number };

// Use short, accurate, continuous legs. A gap on a locked phone cannot prove that a junction was passed.
const MAX_LEG_MS = 10_000;
const MAX_JUNCTION_ACCURACY_M = 22;
const EARTH_M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;
// A wait near signals is only a dwell at low speed, never proof of a red light or of running one.
const WAIT_RADIUS_EXTRA_M = 30;
const WAIT_SPEED_MPS = 1;
const MIN_WAIT_MS = 5_000;

function legsOf(data: SessionData): Leg[] {
  const start = data.meta.startedAt;
  const end = data.meta.stoppedAt ?? start;
  const fixes = data.samples.filter((fix) => fix.t >= start && fix.t <= end).sort((a, b) => a.t - b.t);
  const legs: Leg[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const from = fixes[i - 1];
    const to = fixes[i];
    const ms = to.t - from.t;
    if (ms <= 0 || ms > MAX_LEG_MS || from.acc === null || to.acc === null
      || Math.max(from.acc, to.acc) > MAX_JUNCTION_ACCURACY_M
      || data.meta.pauses?.some((pause) => pause.from < to.t && (pause.to ?? end) > from.t)) continue;
    const distanceM = haversineM(from, to);
    if (!Number.isFinite(distanceM) || distanceM > ms * .055) continue;
    legs.push({ from, to, distanceM });
  }
  return legs;
}

function localPoint(fix: Fix, lat: number, lon: number) {
  return { x: (fix.lon - lon) * EARTH_M_PER_DEGREE * Math.cos(lat * RAD), y: (fix.lat - lat) * EARTH_M_PER_DEGREE };
}

function segmentDistance(x: number, y: number, nextX: number, nextY: number) {
  const dx = nextX - x;
  const dy = nextY - y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared ? Math.min(1, Math.max(0, -(x * dx + y * dy) / lengthSquared)) : 0;
  return Math.hypot(x + fraction * dx, y + fraction * dy);
}

function junctionPasses(legs: Leg[], junctions: readonly Junction[]): JunctionPass[] {
  const passes: JunctionPass[] = [];
  for (const [kind, id, lat, lon, radiusM, name] of junctions) {
    let position = 0;
    let priorArrival = -Infinity;
    let visit: { at: number; entryAngle: number; near: boolean; motionM: number } | null = null;
    for (const { from, to, distanceM } of legs) {
      if (position !== from.t) visit = null;
      position = to.t;
      if (Math.abs(from.lat - lat) > .008 || Math.abs(from.lon - lon) > .01) { visit = null; continue; }
      const a = localPoint(from, lat, lon);
      const b = localPoint(to, lat, lon);
      const outer = radiusM + 24;
      const approaching = Math.hypot(a.x, a.y) >= outer;
      const departing = Math.hypot(b.x, b.y) >= outer;
      const closest = segmentDistance(a.x, a.y, b.x, b.y);
      if (!visit && approaching && closest < outer && distanceM >= 3) {
        visit = { at: from.t, entryAngle: Math.atan2(a.y, a.x), near: false, motionM: 0 };
      }
      if (!visit) continue;
      visit.motionM += distanceM;
      if (closest <= radiusM + (kind === "roundabout" ? 4 : 0)) {
        if (!visit.near) visit.at = to.t;
        visit.near = true;
      }
      if (!departing) continue;
      // The radial angle between entry and exit excludes clips that return to the same side of a roundabout.
      const angle = Math.atan2(b.y, b.x) - visit.entryAngle;
      const traversed = kind === "signal" || Math.cos(angle) <= Math.cos(40 * RAD);
      if (visit.near && traversed && visit.motionM >= 25 && visit.at - priorArrival > 20_000) {
        passes.push({ kind, id, name, at: visit.at });
        priorArrival = visit.at;
      }
      visit = null;
    }
  }
  return passes.sort((a, b) => a.at - b.at);
}

// Approximate solar elevation from the timestamp and location. Civil twilight ends at -6°.
function solarElevation(fix: Fix) {
  const days = fix.t / 86_400_000 - 10_957.5; // Days since J2000 noon.
  const anomaly = (357.529 + .98560028 * days) * RAD;
  const longitude = (280.459 + .98564736 * days + 1.915 * Math.sin(anomaly) + .02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - .00000036 * days) * RAD;
  const ascension = Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(longitude));
  const hourAngle = (280.160 + 360.9856235 * days + fix.lon) * RAD - ascension;
  const latitude = fix.lat * RAD;
  return Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)) / RAD;
}

export function lessonEnvironments(data: SessionData, junctions: readonly Junction[]) {
  const legs = legsOf(data);
  const lightMs = { daylight: 0, twilight: 0, night: 0 };
  for (const { from, to, distanceM } of legs) {
    const ms = to.t - from.t;
    if (distanceM < 3 || (to.speed ?? distanceM / (ms / 1000)) < 5 / 3.6) continue;
    const midpoint = { ...from, t: (from.t + to.t) / 2, lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
    const elevation = solarElevation(midpoint);
    lightMs[elevation < -6 ? "night" : elevation < -.833 ? "twilight" : "daylight"] += ms;
  }
  return { junctions: junctionPasses(legs, junctions), lightMs };
}

/**
 * Dwell at low speed near a signalised junction that was actually passed. This is "the car waited near
 * signals for about X" — it cannot say whether the light was red, or whether a light was run. Only junctions
 * in `passes` are considered, so parking near lights never manufactures a wait.
 */
export function signalWaits(data: SessionData, junctions: readonly Junction[], passes: readonly JunctionPass[]): SignalWait[] {
  const start = data.meta.startedAt;
  const end = data.meta.stoppedAt ?? start;
  const byId = new Map(junctions.map((j) => [j[1], j]));
  const fixes = data.samples
    .filter((fix) => fix.t >= start && fix.t <= end && fix.acc !== null && fix.acc <= MAX_JUNCTION_ACCURACY_M)
    .sort((a, b) => a.t - b.t);
  const paused = (t: number) => data.meta.pauses?.some((pause) => t >= pause.from && t < (pause.to ?? end)) ?? false;
  const out: SignalWait[] = [];
  for (const pass of passes) {
    if (pass.kind !== "signal") continue;
    const junction = byId.get(pass.id);
    if (!junction) continue;
    const [, , lat, lon, radiusM, name] = junction;
    const near = radiusM + WAIT_RADIUS_EXTRA_M;
    let runStart: number | null = null;
    let runMs = 0;
    let firstAt: number | null = null;
    const closeRun = (endT: number) => {
      if (runStart !== null && endT - runStart >= MIN_WAIT_MS) {
        runMs += endT - runStart;
        firstAt ??= runStart;
      }
      runStart = null;
    };
    for (let i = 0; i < fixes.length; i++) {
      const fix = fixes[i];
      const d = haversineM(fix, { lat, lon });
      const prev = fixes[i - 1];
      const implied = prev && fix.t > prev.t ? haversineM(prev, fix) / ((fix.t - prev.t) / 1000) : null;
      const speed = fix.speed ?? implied;
      const slow = d <= near && speed !== null && speed < WAIT_SPEED_MPS && !paused(fix.t);
      const broken = i > 0 && (fix.t - fixes[i - 1].t > MAX_LEG_MS || paused(fix.t));
      if (broken) closeRun(fixes[i - 1].t);
      if (slow) runStart ??= fix.t;
      else closeRun(fix.t);
    }
    if (fixes.length) closeRun(fixes[fixes.length - 1].t);
    if (runMs >= MIN_WAIT_MS && firstAt !== null) out.push({ id: pass.id, name, at: firstAt, waitMs: runMs });
  }
  return out.sort((a, b) => a.at - b.at);
}
