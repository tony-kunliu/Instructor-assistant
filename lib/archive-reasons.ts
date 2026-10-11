// Archive reason presets and note rules (learner management Phase 3b, migration 0010).
// Shared by the server (validation in lib/repo.ts#setLearnerArchived) and the archive panel / banner in
// app/driver-app.tsx. The stored value is the key; labels are display-only and may be reworded freely.

export const ARCHIVE_REASONS = [
  { value: "completed_licence", label: "Completed / licensed" },
  { value: "stopped", label: "Stopped learning" },
  { value: "moved_away", label: "Moved away" },
  { value: "transferred", label: "Went to another instructor" },
  { value: "other", label: "Other" },
] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]["value"];

export const MAX_ARCHIVE_NOTE_LENGTH = 200;

export class ArchiveInputError extends Error {}

/** undefined / null / "" = no reason (archiving without one is allowed). Anything else must be a preset key. */
export function parseArchiveReason(value: unknown): ArchiveReason | null {
  if (value === undefined || value === null || value === "") return null;
  const found = ARCHIVE_REASONS.find((r) => r.value === value);
  if (!found) throw new ArchiveInputError("Unknown archive reason.");
  return found.value;
}

/** Optional short note: control characters become spaces, then trimmed; empty = null; longer than 200 characters is rejected. */
export function parseArchiveNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ArchiveInputError("Archive note must be text.");
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_ARCHIVE_NOTE_LENGTH) throw new ArchiveInputError(`Archive note must be ${MAX_ARCHIVE_NOTE_LENGTH} characters or fewer.`);
  return cleaned;
}

/** Display label of a stored reason key; an unknown stored key is shown as-is, never hidden. */
export function archiveReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return ARCHIVE_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

/** "<reason label>[: note]", just the note when no reason was chosen, or null when neither is known. */
export function archiveReasonText(reason: string | null, note: string | null): string | null {
  const label = archiveReasonLabel(reason);
  if (label && note) return `${label}: ${note}`;
  return label ?? note ?? null;
}
