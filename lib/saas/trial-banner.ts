/**
 * SaaS edition free-trial banner (spec 2026-10-21-saas-edition-design §7, §8): what the main screen and /account show,
 * from `/api/me`'s `trialEndsAt`. Days are whole 24 h periods rounded up (12 days 3 hours left → 13; anything up to
 * 24 h → the last day). A trial end at or before `now`, or one that does not parse, is expired — the same fail-closed
 * reading as the gate (lib/saas/gate.ts treats a NaN trial end as expired).
 */

export type TrialBanner = { kind: "active" | "last-day" | "expired"; text: string; daysLeft: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_EXPIRED_TEXT = "Free trial ended — read-only. Your records and PDFs stay available.";

export function trialBanner(trialEndsAt: string, now: Date): TrialBanner {
  const msLeft = Date.parse(trialEndsAt) - now.getTime();
  if (!Number.isFinite(msLeft) || msLeft <= 0) return { kind: "expired", text: TRIAL_EXPIRED_TEXT, daysLeft: 0 };
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft === 1) return { kind: "last-day", text: "Free trial: last day", daysLeft };
  return { kind: "active", text: `Free trial: ${daysLeft} days left`, daysLeft };
}

/** What the app shows when a write is refused because the free trial has ended (middleware: 402 `trial_expired`). */
export const TRIAL_ENDED_MESSAGE = "Your free trial has ended. Your records and PDFs stay available.";

/**
 * The message for a failed API response, shared by the client fetch helpers: the server's `error` text, or
 * "Request failed." — exactly as before — except that a 402 `trial_expired` (SaaS edition only; the private edition
 * never sends it) becomes TRIAL_ENDED_MESSAGE instead of the raw code.
 */
export function requestErrorMessage(status: number, data: { error?: unknown }): string {
  if (status === 402 && data.error === "trial_expired") return TRIAL_ENDED_MESSAGE;
  return (data.error as string) || "Request failed.";
}
