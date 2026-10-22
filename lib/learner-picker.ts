import type { Learner } from "./types.ts";

export type PickerView = "mine" | "all" | "archived";

/** My learners only makes sense with a verified instructor identity (Cloudflare Access); local dev has none. */
export function availableViews(signedInInstructorId: string | null): PickerView[] {
  return signedInInstructorId ? ["mine", "all", "archived"] : ["all", "archived"];
}

/** The view every fresh page load starts in — decided by the authenticated identity alone, never by device state. */
export function defaultView(signedInInstructorId: string | null): PickerView {
  return signedInInstructorId ? "mine" : "all";
}

/** The single rule for which view a learner belongs to (archived learners belong only to "archived"). */
export function learnerInView(learner: Learner, view: PickerView, signedInInstructorId: string | null): boolean {
  if (view === "archived") return learner.archivedAt !== null;
  if (learner.archivedAt !== null) return false;
  if (view === "all") return true;
  return !signedInInstructorId || learner.instructorId === signedInInstructorId;
}

export function viewLearners(active: readonly Learner[], archived: readonly Learner[], view: PickerView, signedInInstructorId: string | null): Learner[] {
  return (view === "archived" ? archived : active).filter((learner) => learnerInView(learner, view, signedInInstructorId));
}

/**
 * What to pre-select on page load. The view is always the identity's
 * default; a device's remembered last learner is restored only if it is a
 * member of that view, so stale local state (e.g. a colleague's learner)
 * can never switch the signed-in instructor to All.
 */
export function initialSelection(options: { signedInInstructorId: string | null; activeLearners: readonly Learner[]; lastLearnerId: string | null }): { view: PickerView; learnerId: string | null } {
  const view = defaultView(options.signedInInstructorId);
  const last = options.lastLearnerId ? options.activeLearners.find((learner) => learner.id === options.lastLearnerId) : undefined;
  return { view, learnerId: last && learnerInView(last, view, options.signedInInstructorId) ? last.id : null };
}

/** Switching view keeps the open learner only if they belong to the target view; otherwise the selection is cleared. */
export function selectionAfterViewChange(selected: Learner | undefined, nextView: PickerView, signedInInstructorId: string | null): "keep" | "clear" {
  if (!selected) return "keep";
  return learnerInView(selected, nextView, signedInInstructorId) ? "keep" : "clear";
}

/** Which main panel an open learner gets: normal lessons, the CBT&A Completed card (archive suggestion, no Start Lesson), or the archived banner. */
export type LearnerPanel = "active" | "completed" | "archived" | "draft";

export function learnerPanel(options: { archivedAt: string | null; completed: boolean; draftAt?: string | null }): LearnerPanel {
  if (options.archivedAt !== null) return "archived";
  if (options.draftAt) return "draft";
  return options.completed ? "completed" : "active";
}
