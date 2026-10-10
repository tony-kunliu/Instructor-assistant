import type { Reminder } from "./rules.ts";
import type { Learner } from "./types.ts";

/**
 * Learner management Phase 3a: display-only checks on data the app already
 * holds (no D1 query, no API). Same tone rules as lib/rules.ts: amber =
 * needs attention, grey = cannot check, nothing = fine. They never block a save.
 */

/** Learner-record fields printed in the CBT&A PDF header (lib/pdf-export.ts#drawHeader), with the labels the learner form uses. */
export const PDF_LEARNER_FIELDS = [
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "dob", label: "DOB" },
  { key: "licenceNumber", label: "Licence number" },
  { key: "licenceExpiry", label: "Licence expiry" },
  { key: "eligibility", label: "Eligibility" },
  { key: "schoolWork", label: "School / Work" },
  { key: "transmission", label: "Manual / Auto" },
] as const;

export type PdfLearnerField = (typeof PDF_LEARNER_FIELDS)[number]["key"];

/** Labels (in form order) of the PDF fields that are empty or blank. Empty list = complete. */
export function missingPdfFields(learner: Pick<Learner, PdfLearnerField>): string[] {
  return PDF_LEARNER_FIELDS.filter(({ key }) => {
    const value = learner[key];
    return value === null || value === undefined || String(value).trim() === "";
  }).map(({ label }) => label);
}

/** One amber line listing what the PDF will print empty; null when complete. The "Edit learner" hint only for someone who can edit. */
export function missingPdfReminder(learner: Pick<Learner, PdfLearnerField>, canEdit: boolean): Reminder | null {
  const missing = missingPdfFields(learner);
  if (!missing.length) return null;
  return { id: "pdf-missing", tone: "amber", text: `Missing for the PDF: ${missing.join(", ")}.${canEdit ? " Add them with Edit learner." : ""}` };
}

/** Comparison key for a licence number: trimmed, case-insensitive, spaces ignored. "" = no number (never matches). */
export function licenceKey(licenceNumber: string | null | undefined): string {
  return (licenceNumber ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Other learners (by id, never `selfId`) with the same licence number, each listed once, sorted by name. */
export function sameLicenceLearners(licenceNumber: string | null | undefined, selfId: string | null, learners: readonly Learner[]): Learner[] {
  const key = licenceKey(licenceNumber);
  if (!key) return [];
  const seen = new Map<string, Learner>();
  for (const learner of learners) {
    if (learner.id === selfId || seen.has(learner.id)) continue;
    if (licenceKey(learner.licenceNumber) === key) seen.set(learner.id, learner);
  }
  return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Amber, non-blocking warning naming the other learner(s). "(archived)" when
 * archived; the other instructor's name when they belong to someone other
 * than `ownerInstructorId` (an unknown owner names every instructor).
 */
export function duplicateLicenceReminder(matches: readonly Learner[], ownerInstructorId: string | null, where: "panel" | "form"): Reminder | null {
  if (!matches.length) return null;
  const names = matches.map((m) => {
    const notes: string[] = [];
    if (m.archivedAt !== null) notes.push("archived");
    if (!ownerInstructorId || m.instructorId !== ownerInstructorId) notes.push(`${m.instructorName}'s learner`);
    return notes.length ? `${m.fullName} (${notes.join(", ")})` : m.fullName;
  });
  const tail = where === "form" ? "Check this is not the same learner entered twice. You can still save." : "Check this is not the same learner entered twice.";
  return { id: "dup-licence", tone: "amber", text: `Same licence number as ${joinNames(names)}. ${tail}` };
}

/** Grey: archived learners normally preload in the background; if that has not loaded (still loading or failed) they were not checked. */
export function archivedNotCheckedReminder(licenceNumber: string | null | undefined, archivedLoaded: boolean): Reminder | null {
  if (archivedLoaded || !licenceKey(licenceNumber)) return null;
  return { id: "dup-licence-archived", tone: "grey", text: "Archived learners are not checked for this licence number because the archived list has not loaded." };
}
