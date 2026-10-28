// Learner form (concept screen B, approved by Tony 2026-10-12): the pure view-model behind the grouped form cards
// (Student / Address / Licence & eligibility, and the EDIT form's folded "More" with Transfer and Archive —
// Tony's decision 3, 2026-10-13).
//
// Presentation only. Nothing here changes a validation, a payload or a rule: the server still checks every field
// (lib/repo.ts#createLearner / updateLearner) with its own messages, the transfer and archive flows keep their
// handlers, guards and confirmations in app/driver-app.tsx; only where they appear on screen changed.

/** The one client-side pre-check: an empty name shows inline, with the server's exact wording, before anything is sent. */
export function nameIssue(fullName: string): string | null {
  return fullName.trim() ? null : "Student name is required.";
}

export type AddressPartChip = { label: string; value: string };

/** The parts kept from a picked street suggestion (intake D7), as chips under the Address field; "—" while none is kept. */
export function addressPartChips(parts: { addressSuburb: string; addressState: string; addressPostcode: string }): AddressPartChip[] {
  const show = (value: string) => value.trim() || "—";
  return [
    { label: "Suburb", value: show(parts.addressSuburb) },
    { label: "State", value: show(parts.addressState) },
    { label: "Postcode", value: show(parts.addressPostcode) },
  ];
}

export type LearnerPanelKind = "active" | "completed" | "archived" | "draft";
export type MoreSection = { shown: boolean; transfer: boolean; archive: boolean };

/**
 * The EDIT form's "More" fold holds the existing Transfer and Archive actions (Tony's decision 3). It exists only when
 * at least one of them applies: Transfer under the same rule as before (`canTransfer`), Archive for an active learner
 * (a completed learner keeps the archive suggestion on its own card; an archived one is restored from its banner).
 */
export function moreSection(input: { editing: boolean; canTransfer: boolean; panel: LearnerPanelKind }): MoreSection {
  if (!input.editing) return { shown: false, transfer: false, archive: false };
  const transfer = input.canTransfer && input.panel !== "draft";
  const archive = input.panel === "active" || input.panel === "draft";
  return { shown: transfer || archive, transfer, archive };
}

/** The one-line note under the form title. */
export function formSubline(editing: boolean, saas = false): string {
  // SaaS edition: the instructor is always the signed-in account (no field) and there is no Transfer.
  if (saas) return editing ? "Only the name is required. Archive is under More." : "Only the name is required. Everything else can wait.";
  return editing ? "Only the name is required. Transfer and Archive are under More." : "Only the name and instructor are required. Everything else can wait.";
}

/** The sticky bar's single primary action. */
export function saveLabel(input: { editing: boolean; saving: boolean; draft?: boolean }): string {
  if (input.saving) return "Saving…";
  if (input.draft) return "Confirm learner";
  return input.editing ? "Save changes" : "Save learner";
}

/**
 * Why the "More" actions are locked right now, or null when they are usable. A done transfer or archive closes the Edit
 * form, so both wait while a lesson is running / ended-but-unsaved (the rule they always had) or while the form holds
 * unsaved edits (otherwise those edits would be dropped without a word).
 */
export function moreLockedMessage(input: { phase: string; formDirty: boolean }): string | null {
  if (input.phase !== "ready") return "Save or discard the current lesson first.";
  if (input.formDirty) return "Save or cancel your changes to this learner first.";
  return null;
}
