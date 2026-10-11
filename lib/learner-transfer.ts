// Learner transfer to another instructor (learner management 3c, T1; migration 0011).
// Pure helpers shared by the server (lib/repo.ts#transferLearner) and the learner panel / History in
// app/driver-app.tsx. Design: docs/superpowers/specs/2026-10-11-learner-transfer-design.md (D1-D17).
import { LESSON_TIME_ZONE } from "./calc.ts";
import type { Learner, LearnerTransferEvent } from "./types.ts";

export const MAX_TRANSFER_NOTE_LENGTH = 200;

export class TransferInputError extends Error {}

/** Optional short note (D17): control characters become spaces, then trimmed; empty = null; longer than 200 characters is rejected. */
export function parseTransferNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TransferInputError("Transfer note must be text.");
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_TRANSFER_NOTE_LENGTH) throw new TransferInputError(`Transfer note must be ${MAX_TRANSFER_NOTE_LENGTH} characters or fewer.`);
  return cleaned;
}

/** A stored UTC ISO timestamp as a Canberra date "Sun 11 Oct 2026" (AGENTS.md §15), or "" if it does not parse. */
export function canberraLongDate(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: LESSON_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" })
      .formatToParts(when)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

/** The History divider (D6): "Transferred from Tony to Anna, Sun 11 Oct 2026". */
export function transferLine(event: Pick<LearnerTransferEvent, "fromName" | "toName" | "at">): string {
  return `Transferred from ${event.fromName || "another instructor"} to ${event.toName || "another instructor"}, ${canberraLongDate(event.at)}`;
}

/**
 * The transfer whose CoP 9.1 h / 9.2 e records check is still open (D7): the learner's LATEST transfer, only
 * while it is unchecked and the learner still belongs to its receiving instructor. Null otherwise.
 */
export function pendingRecordsCheck(learner: Pick<Learner, "instructorId" | "transfers">): LearnerTransferEvent | null {
  const latest = learner.transfers.at(-1);
  if (!latest || latest.recordsCheckedAt !== null || latest.toInstructorId !== learner.instructorId) return null;
  return latest;
}

/** The D7 reminder text shown to the receiving instructor. Reminder only: it never blocks a lesson or a save. */
export function recordsCheckText(fromName: string): string {
  return `Check the records from ${fromName || "the previous instructor"}. If any is not filled out correctly, or is false, misleading or incomplete, tell ADI Audit as soon as possible (CoP 9.1 h, 9.2 e).`;
}

export type HistoryItem<L> = { kind: "lesson"; lesson: L } | { kind: "transfer"; event: LearnerTransferEvent };

/**
 * History (newest first) with one divider per transfer (D6), placed between the last lesson recorded before the
 * transfer and the first one recorded after it (by record time, `createdAt`). The lesson order is never changed.
 */
export function withTransferDividers<L extends { createdAt: string }>(lessonsNewestFirst: readonly L[], transfers: readonly LearnerTransferEvent[]): HistoryItem<L>[] {
  const pending = [...transfers].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const items: HistoryItem<L>[] = [];
  for (const lesson of lessonsNewestFirst) {
    while (pending.length && pending[0].at > lesson.createdAt) items.push({ kind: "transfer", event: pending.shift()! });
    items.push({ kind: "lesson", lesson });
  }
  for (const event of pending) items.push({ kind: "transfer", event });
  return items;
}
