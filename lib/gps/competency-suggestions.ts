// GPS suggestion list for the CBT&A form's Taught / Competencies Assessed / Achieved columns
// (ACT form 10,044, 7/2002; see docs/gps-cbt-mapping.md).
//
// A suggestion is evidence, not a judgement: it says "GPS saw this", never "the learner passed".
// The instructor chooses which column a competency goes into — Taught, Assessed or Achieved —
// by ticking it in the app (the tick UI is the next step); nothing here writes to a lesson.
// A competency appears only when there is at least one traceable observation (a time and a
// value), never on a total alone: at most 3 concrete observations are listed, plus a total line
// when there are more. Competencies GPS cannot observe (1, 2, 3, 5, 6, 11, 14, 15, 19, 21, 22,
// the Reviews and Final Drive 23) never appear here — the instructor judges those by hand.
import act from "../../public/openstreetmap/act-junctions-2026-11-01.json" with { type: "json" };
import { canberraDateTime } from "../calc.ts";
import { competencyFullName } from "../competency.ts";
import { lessonEnvironments, type Junction } from "./lesson-environments.ts";
import { describeApproach, detectLateralShifts, detectReversing, detectStops, detectThreePointTurns } from "./manoeuvres.ts";
import { summarizeTrack } from "./summary.ts";
import { detectTurns } from "./turns.ts";
import type { SessionData } from "./types.ts";

export type CompetencySuggestion = {
  /** CBT&A competency number (1-22). The instructor picks Taught / Assessed / Achieved. */
  competency: number;
  /** Official title (display-only, from lib/competency.ts). */
  title: string;
  /** Traceable observations: each names a time and a value, never just a total. */
  evidence: string[];
};

const timeOf = (at: number) => canberraDateTime(new Date(at).toISOString())?.time ?? "";

/** Concrete observations first (at most 3), then a total line when there are more. */
function cap(items: string[], total: number, noun: string): string[] {
  if (items.length <= 3) return items;
  return [...items.slice(0, 3), `${total} ${noun} in total`];
}

const secs = (ms: number) => Math.round(ms / 1000);

export function gpsCompetencySuggestions(data: SessionData): CompetencySuggestion[] {
  const summary = summarizeTrack(data);
  if (summary.usedFixes < 2 || summary.distanceM === 0) return [];
  const { junctions } = lessonEnvironments(data, act.junctions as Junction[]);
  const roundabouts = junctions.filter((item) => item.kind === "roundabout");
  const { turns, uTurnAt } = detectTurns(data, roundabouts.map((item) => item.at));
  const stops = detectStops(data);
  const reverses = detectReversing(data);
  const threePoint = detectThreePointTurns(data, reverses);
  const shifts = detectLateralShifts(data);
  const out: CompetencySuggestion[] = [];
  const push = (competency: number, evidence: string[]) => {
    if (!evidence.length) return;
    out.push({ competency, title: competencyFullName(String(competency)) ?? `Competency ${competency}`, evidence });
  };

  // 4 Moving Off: every stop that ended with a moving-off.
  push(4, cap(
    stops.filter((stop) => stop.endAt !== null).map((stop) => `${timeOf(stop.endAt as number)} moved off after a ${secs(stop.durationMs)} s stop`),
    stops.filter((stop) => stop.endAt !== null).length,
    "moving-offs",
  ));
  // 7 Turns, Left and Right.
  push(7, cap(
    turns.map((turn) => `${timeOf(turn.at)} ${turn.direction === "left" ? "Left" : "Right"} turn (${turn.degrees}°)`),
    turns.length,
    "turns",
  ));
  // 8 Speed Control: the numbers only — no speeding verdict (there is no speed-limit data).
  if (summary.maxSpeedKmh !== null) {
    const avgKmh = summary.movingMs > 0 ? Math.round((summary.distanceM / (summary.movingMs / 1000)) * 3.6 * 10) / 10 : null;
    push(8, [`Max ${summary.maxSpeedKmh} km/h`, ...(avgKmh !== null ? [`Avg ${avgKmh} km/h moving`] : [])]);
  }
  // 9 Slowing Procedure: the deceleration into each stop.
  push(9, cap(
    stops.filter((stop) => stop.approachMaxDecelMps2 !== null).map((stop) => {
      const word = describeApproach(stop.approachMaxDecelMps2);
      return `${timeOf(stop.at)} slowed to a stop (max ${stop.approachMaxDecelMps2} m/s²${word ? `, ${word}` : ""})`;
    }),
    stops.filter((stop) => stop.approachMaxDecelMps2 !== null).length,
    "slowdowns",
  ));
  // 10 Stopping Procedure.
  push(10, cap(
    stops.map((stop) => `${timeOf(stop.at)} stopped ${secs(stop.durationMs)} s`),
    stops.length,
    "stops",
  ));
  // 12 Give Way Rules: a stop on the approach to a junction just passed (the stop is usually
  // at the stop line, just past the junction centre, so the window extends either side).
  const giveWay = junctions.filter((pass) =>
    stops.some((stop) => {
      const end = stop.endAt ?? stop.at + stop.durationMs;
      return stop.at <= pass.at + 15_000 && end >= pass.at - 15_000;
    }),
  );
  push(12, cap(
    giveWay.map((pass) => `${timeOf(pass.at)} stopped before the ${pass.kind === "signal" ? "signals" : "roundabout"}${pass.name ? ` — ${pass.name}` : ""}`),
    giveWay.length,
    "give-way stops",
  ));
  // 13 Reversing.
  push(13, cap(
    reverses.map((rev) => `${timeOf(rev.at)} reversed ${rev.distanceM} m (${secs(rev.durationMs)} s)`),
    reverses.length,
    "reverse segments",
  ));
  // 16 U-Turns (moving only; a parking U-turn never counts).
  push(16, cap(
    uTurnAt.map((at) => `${timeOf(at)} U-turn`),
    uTurnAt.length,
    "U-turns",
  ));
  // 17 Turning Around on the Road (Three Point Turn).
  push(17, cap(
    threePoint.map((tp) => `${timeOf(tp.at)} three-point turn (${secs(tp.durationMs)} s)`),
    threePoint.length,
    "three-point turns",
  ));
  // 18 Lane Changing: low confidence — GPS accuracy is the size of a lane, so only "possible".
  push(18, cap(
    shifts.map((shift) => `${timeOf(shift.at)} possible lane change (≈${shift.offsetM} m)`),
    shifts.length,
    "possible lane changes",
  ));
  // 20 Observation / Hazard: exposure — the junctions actually driven through.
  push(20, cap(
    junctions.map((pass) => `${timeOf(pass.at)} ${pass.kind === "signal" ? "Signals" : "Roundabout"}${pass.name ? ` — ${pass.name}` : ""}`),
    junctions.length,
    "junctions passed",
  ));
  return out;
}
