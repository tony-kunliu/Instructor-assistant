declare global {
  interface CloudflareEnv {
    /** SaaS edition only: free-trial length in days (positive integer). Missing or invalid means 30 (spec §7). */
    SAAS_TRIAL_DAYS?: string;
  }
}

/**
 * SaaS edition free trial (spec 2026-10-21-saas-edition-design §7): trial end = `instructors.created_at` +
 * `SAAS_TRIAL_DAYS` × 24 h. Shared by the gate (lib/saas/gate.ts) and `/api/me` (lib/saas/accounts.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TRIAL_DAYS = 30;
export const MAX_TRIAL_DAYS = 3650;

/** `SAAS_TRIAL_DAYS`: a whole number of days 1..3650 as a string; anything else (missing, 0, negative, too large, decimal, text) is 30. */
export function parseTrialDays(raw: unknown): number {
  if (typeof raw !== "string" || !/^\s*\d+\s*$/.test(raw)) return DEFAULT_TRIAL_DAYS;
  const days = Number(raw.trim());
  return Number.isInteger(days) && days >= 1 && days <= MAX_TRIAL_DAYS ? days : DEFAULT_TRIAL_DAYS;
}

/** Trial end in epoch ms; NaN when `created_at` is not a valid timestamp (callers treat NaN as expired). */
export function trialEndMs(createdAt: string, trialDays: number): number {
  return Date.parse(createdAt) + trialDays * DAY_MS;
}

/** Trial end as an ISO string (`created_at` + days × 24 h), or null when `created_at` is not a valid timestamp. */
export function trialEndsAt(createdAt: string, trialDays: number): string | null {
  const end = trialEndMs(createdAt, trialDays);
  return Number.isFinite(end) ? new Date(end).toISOString() : null;
}
