import { haversineM } from "./analysis.ts";
import type { Fix, SessionData } from "./types.ts";

export type Junction = [kind: "roundabout" | "signal", id: string, lat: number, lon: number, radiusM: number, name: string];
type Leg = { from: Fix; to: Fix; distanceM: number };
type JunctionPass = { kind: Junction[0]; id: string; name: string; at: number };

// Use short, accurate, continuous legs. A gap on a locked phone cannot prove that a junction was passed.
const MAX_LEG_MS = 10_000;
const MAX_JUNCTION_ACCURACY_M = 22;
const EARTH_M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

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
