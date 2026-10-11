// PDF "Eligibility" auto-fill (learner intake P1, design 2026-10-11 D18, Tony Q6).
//
// The generated value is `C23 from YYYY-MM-DD`, or `C23 from ~YYYY-MM-DD` when the licence issue date is estimated
// from the expiry (ASCII "~": the compact PDF font may lack "≈"). A stored value is the app's own only while it is
// empty or matches GENERATED_ELIGIBILITY exactly; anything else is the instructor's text and is never overwritten.
// Pure functions: no clock, no database. Nothing here writes to D1; the form sends the value in the normal learner save.

import { finalDriveEligibleFrom, type EligibilityLearner } from "./rules.ts";

/**
 * "Generated" = exactly this pattern. Anything else (even one extra character) is the instructor's own text.
 * The pattern is RESERVED for the app: hand-typed text that is identical to it (e.g. "C23 from 2026-11-15") is
 * treated as generated and refreshed/recomputed like the app's own value. Add any other character to keep it as typed.
 */
export const GENERATED_ELIGIBILITY = /^C23 from ~?\d{4}-\d{2}-\d{2}$/;

/** The value the app would write now, or null when no Competency 23 date can be worked out. */
export function generatedEligibility(learner: EligibilityLearner): string | null {
  const from = finalDriveEligibleFrom(learner);
  return from.ok ? `C23 from ${from.estimated ? "~" : ""}${from.date}` : null;
}

/** True while the app owns the field: empty/blank, or exactly a previously generated value. */
export function isAppOwnedEligibility(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "" || GENERATED_ELIGIBILITY.test(value);
}

/** The form's Eligibility value after a change to the learner's dates: refreshed (or cleared) while app-owned, else unchanged. */
export function autoFillEligibility(current: string, learner: EligibilityLearner): string {
  return isAppOwnedEligibility(current) ? generatedEligibility(learner) ?? "" : current;
}

/** What the PDF prints in the Eligibility box: the value computed at export while the stored one is app-owned, else the stored text unchanged. */
export function pdfEligibility(learner: EligibilityLearner & { eligibility: string | null }): string {
  return isAppOwnedEligibility(learner.eligibility) ? generatedEligibility(learner) ?? "" : (learner.eligibility as string);
}

/**
 * The learner fields the "C23 from" DATE depends on. Only an edit of one of these refreshes an app-owned Eligibility
 * in the form (hours and HPT do not change the date), so opening Edit and saving untouched sends no change.
 */
export const ELIGIBILITY_DATE_KEYS = ["dob", "licenceExpiry", "learnerLicenceIssuedOn", "learnerLicenceFirstIssuedOn"] as const;

/** Value sent on save (D18): an empty/blank box gets the generated value (if computable); anything else is sent as is. */
export function eligibilityAtSave(current: string, learner: EligibilityLearner): string {
  return current.trim() === "" ? generatedEligibility(learner) ?? current : current;
}

/** Whether the form shows "auto: from the licence dates": the value is generated, or the box is empty and a date is computable (filled on save). */
export function showsAutoHint(current: string, learner: EligibilityLearner): boolean {
  return GENERATED_ELIGIBILITY.test(current) || (current.trim() === "" && generatedEligibility(learner) !== null);
}
