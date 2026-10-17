// The ONE place the /gps page turns a TrackSummary into display text. The Results card and the "Earlier recordings"
// summary line both call these, so the same recording can never show two different numbers. Pure; no I/O.
import type { TrackSummary } from "./summary.ts";

/** Milliseconds as "—", "12.3 s" or "4.5 min". */
export const fmtMs = (ms: number | null): string => (ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);

/** "16.99 km" — GPS distance (diagnostic; the odometer stays official). */
export const distanceText = (s: Pick<TrackSummary, "distanceM">): string => `${(s.distanceM / 1000).toFixed(2)} km`;

/** Start → Stop wall time, INCLUDING any pause (the card's "Recorded"). Not moving time, not parked time. */
export const recordedText = (s: Pick<TrackSummary, "recordedMs">): string => fmtMs(s.recordedMs);

/** Share of active time with a fix, e.g. "97.4%". */
export const coverageText = (s: Pick<TrackSummary, "coveragePct">): string => `${s.coveragePct}%`;

/** The one-line summary under an earlier recording: distance, total recorded duration, coverage (same wording as the card). */
export function earlierSummaryLine(s: Pick<TrackSummary, "distanceM" | "recordedMs" | "coveragePct">): string {
  return `${distanceText(s)} · Recorded ${recordedText(s)} · Coverage ${coverageText(s)}`;
}
