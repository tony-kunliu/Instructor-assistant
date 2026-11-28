import act from "../../public/openstreetmap/act-junctions-2026-11-01.json" with { type: "json" };
import { MAX_LOCATION_LENGTH } from "../route-check.ts";
import { canberraDateTime } from "../calc.ts";
import { lessonEnvironments, signalWaits, type Junction, type JunctionPass } from "./lesson-environments.ts";
import { describeApproach, detectLateralShifts, detectReversing, detectStops, detectThreePointTurns } from "./manoeuvres.ts";
import { summarizeTrack } from "./summary.ts";
import { detectTurns } from "./turns.ts";
import type { SessionData } from "./types.ts";

export type LessonGpsNotes = {
  line: string;
  details: string[];
  /**
   * Route summary for the form's Location column: the named streets/junctions passed, in
   * time order, whole names only, capped at the Location limit. Null when no named junction
   * was passed (or outside the ACT, where there is no junction data) — the instructor types
   * the location instead. Street names, not suburbs: GPS has no suburb data.
   */
  route: string | null;
  incomplete: boolean;
};

/**
 * The named junctions passed, in time order, de-duplicated, whole names only, capped at the
 * Location cell's length. A street name is what the OSM data has; a suburb is not.
 */
function routeFromJunctions(junctions: readonly JunctionPass[]): string | null {
  const names: string[] = [];
  for (const junction of junctions) {
    const name = junction.name.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return null;
  let out = "";
  for (const name of names) {
    const next = out ? `${out}, ${name}` : name;
    if (next.length > MAX_LOCATION_LENGTH) break;
    out = next;
  }
  return out || null;
}

export function lessonGpsRoute(data: SessionData): string | null {
  return routeFromJunctions(lessonEnvironments(data, act.junctions as Junction[]).junctions);
}

const timeOf = (at: number) => canberraDateTime(new Date(at).toISOString())?.time ?? "";
/** The approach to a stop, in words (see manoeuvres.ts). */
const approachWord = (decel: number | null) => {
  const word = describeApproach(decel);
  return word ? ` · ${word}` : "";
};

export function lessonGpsNotes(data: SessionData, interrupted: boolean): LessonGpsNotes | null {
  const summary = summarizeTrack(data);
  if (summary.usedFixes < 2 || summary.distanceM === 0) return null;
  const { junctions, lightMs } = lessonEnvironments(data, act.junctions as Junction[]);
  const roundabouts = junctions.filter((item) => item.kind === "roundabout");
  const signals = junctions.filter((item) => item.kind === "signal");
  const { turns, uTurns, uTurnAt } = detectTurns(data, roundabouts.map((item) => item.at));
  const waits = signalWaits(data, act.junctions as Junction[], junctions);
  const waitMs = waits.reduce((sum, wait) => sum + wait.waitMs, 0);
  const stops = detectStops(data);
  const stopMs = stops.reduce((sum, stop) => sum + stop.durationMs, 0);
  const reverses = detectReversing(data);
  const reverseM = reverses.reduce((sum, rev) => sum + rev.distanceM, 0);
  const threePoint = detectThreePointTurns(data, reverses);
  const shifts = detectLateralShifts(data);
  const light = Object.entries(lightMs).flatMap(([kind, ms]) => ms >= 60_000 ? [`${Math.floor(ms / 60_000)} min ${kind}`] : []);
  const incomplete = interrupted || summary.recovered || summary.coveragePct < 95 || summary.gaps.count > 0;
  const left = turns.filter((turn) => turn.direction === "left").length;
  const right = turns.length - left;
  const avgKmh = summary.movingMs > 0 ? Math.round((summary.distanceM / (summary.movingMs / 1000)) * 3.6 * 10) / 10 : null;
  const parts = [
    `GPS estimates (${incomplete ? "partial, " : ""}${Math.round(summary.coveragePct)}% coverage)`,
    `${(summary.distanceM / 1000).toFixed(1)} km`,
    `${Math.round(summary.movingMs / 60_000)} min moving`,
    `${left} left ${left === 1 ? "turn" : "turns"}`,
    `${right} right ${right === 1 ? "turn" : "turns"}`,
    ...(uTurns ? [`${uTurns} U-${uTurns === 1 ? "turn" : "turns"}`] : []),
    ...(stops.length ? [`${stops.length} ${stops.length === 1 ? "stop" : "stops"}`] : []),
    ...(stopMs >= 60_000 ? [`≈ ${Math.floor(stopMs / 60_000)} min stopped`] : []),
    ...(reverses.length ? [`${reverses.length} reverse ${reverses.length === 1 ? "segment" : "segments"} (${reverseM} m)`] : []),
    ...(threePoint.length ? [`${threePoint.length} three-point ${threePoint.length === 1 ? "turn" : "turns"}`] : []),
    ...(shifts.length ? [`${shifts.length} possible lane ${shifts.length === 1 ? "change" : "changes"}`] : []),
    `${roundabouts.length} possible roundabout ${roundabouts.length === 1 ? "pass" : "passes"}`,
    `${signals.length} possible signalised ${signals.length === 1 ? "junction" : "junctions"}`,
    ...(waitMs >= 60_000 ? [`≈ ${Math.floor(waitMs / 60_000)} min waiting near signals`] : []),
    ...(summary.maxSpeedKmh !== null ? [`max ${summary.maxSpeedKmh} km/h`] : []),
    ...(avgKmh !== null ? [`avg ${avgKmh} km/h moving`] : []),
    ...light,
  ];
  const line = parts.join(" · ");
  // Evidence trail, time-ordered: every number in the line traces back to one of these
  // observations (time, place, value). No coordinates, no device ids — only what the
  // instructor needs to check the suggestion against the lesson.
  const evidence: { at: number; text: string }[] = [
    ...turns.map((turn) => ({ at: turn.at, text: `${timeOf(turn.at)} ${turn.direction === "left" ? "Left" : "Right"} turn (${turn.degrees}°)` })),
    ...uTurnAt.map((at) => ({ at, text: `${timeOf(at)} U-turn` })),
    ...stops.map((stop) => ({
      at: stop.at,
      text: `${timeOf(stop.at)} Stopped ${Math.round(stop.durationMs / 1000)} s${approachWord(stop.approachMaxDecelMps2)}${stop.endAt !== null ? ` · moved off ${timeOf(stop.endAt)}` : ""}`,
    })),
    ...reverses.map((rev) => ({ at: rev.at, text: `${timeOf(rev.at)} Reversed ${rev.distanceM} m (${Math.round(rev.durationMs / 1000)} s)` })),
    ...threePoint.map((tp) => ({ at: tp.at, text: `${timeOf(tp.at)} Three-point turn (${Math.round(tp.durationMs / 1000)} s)` })),
    ...shifts.map((shift) => ({ at: shift.at, text: `${timeOf(shift.at)} Possible lane change (≈${shift.offsetM} m)` })),
    ...junctions.map(({ kind, name, at }) => ({
      at,
      text: `${timeOf(at)} ${kind === "signal" ? "Signals" : "Roundabout"}${name ? ` — ${name}` : ""}`,
    })),
    ...waits.map((wait) => ({
      at: wait.at,
      text: `${timeOf(wait.at)} Waited ≈${Math.round(wait.waitMs / 1000)} s near signals${wait.name ? ` — ${wait.name}` : ""}`,
    })),
  ];
  const details = evidence.sort((a, b) => a.at - b.at).map((item) => item.text);
  return { line, details, route: routeFromJunctions(junctions), incomplete };
}
