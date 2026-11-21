import act from "../../public/openstreetmap/act-junctions-2026-11-01.json" with { type: "json" };
import { canberraDateTime } from "../calc.ts";
import { lessonEnvironments, type Junction } from "./lesson-environments.ts";
import { summarizeTrack } from "./summary.ts";
import type { SessionData } from "./types.ts";

export type LessonGpsNotes = { line: string; details: string[]; incomplete: boolean };

export function lessonGpsNotes(data: SessionData, interrupted: boolean): LessonGpsNotes | null {
  const summary = summarizeTrack(data);
  if (summary.usedFixes < 2 || summary.distanceM === 0) return null;
  const { junctions, lightMs } = lessonEnvironments(data, act.junctions as Junction[]);
  const roundabouts = junctions.filter((item) => item.kind === "roundabout").length;
  const signals = junctions.length - roundabouts;
  const light = Object.entries(lightMs).flatMap(([kind, ms]) => ms >= 60_000 ? [`${Math.floor(ms / 60_000)} min ${kind}`] : []);
  const incomplete = interrupted || summary.recovered || summary.coveragePct < 95 || summary.gaps.count > 0;
  const line = [
    `GPS estimates (${incomplete ? "partial, " : ""}${Math.round(summary.coveragePct)}% coverage)`,
    `${(summary.distanceM / 1000).toFixed(1)} km`,
    `${Math.round(summary.movingMs / 60_000)} min moving`,
    `${roundabouts} possible roundabout ${roundabouts === 1 ? "pass" : "passes"}`,
    `${signals} possible signalised ${signals === 1 ? "junction" : "junctions"}`,
    ...light,
  ].join(" · ");
  const details = junctions.map(({ kind, name, at }) =>
    `${canberraDateTime(new Date(at).toISOString())?.time ?? ""} ${kind === "signal" ? "Signals" : "Roundabout"}${name ? ` — ${name}` : ""}`);
  return { line, details, incomplete };
}
