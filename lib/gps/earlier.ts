// Read-only projection for "Earlier recordings": a one-line summary for the newest few stored recordings, computed
// in memory from data already on this device with the existing summarizeTrack. It never writes (only `store.load` is
// touched), reads one recording at a time, ignores results the page no longer wants (`isCurrent`), and degrades per
// recording: a missing, unreadable or malformed one yields `null` for that id only.
import type { SampleStore } from "./store.ts";
import { earlierSummaryLine } from "./format.ts";
import { summarizeTrack } from "./summary.ts";
import type { SessionMeta } from "./types.ts";

export const EARLIER_SUMMARY_LIMIT = 5;

export type EarlierOptions = {
  limit?: number;
  /** False once a newer list superseded this run: stop reading and drop any result. */
  isCurrent: () => boolean;
  /** One call per recording: its line, or null when it cannot be summarised. Never called after isCurrent() is false. */
  onResult: (id: string, line: string | null) => void;
  /** Ids that already have a line (not read again). */
  skip?: (id: string) => boolean;
};

export async function loadEarlierSummaries(store: Pick<SampleStore, "load">, metas: SessionMeta[], options: EarlierOptions): Promise<void> {
  const limit = options.limit ?? EARLIER_SUMMARY_LIMIT;
  for (const meta of metas.slice(0, limit)) {
    if (!options.isCurrent()) return;
    if (options.skip?.(meta.id)) continue;
    let line: string | null = null;
    try {
      const data = await store.load(meta.id);
      if (data) line = earlierSummaryLine(summarizeTrack(data));
    } catch {
      line = null; // unreadable or malformed: this recording keeps today's plain button
    }
    if (!options.isCurrent()) return;
    options.onResult(meta.id, line);
  }
}
