import type { IntegrationConfig } from "./types.ts";

declare global {
  interface CloudflareEnv {
    /** Kill switch — integration disabled means create/edit lesson behaves exactly as before this round. Default: disabled. */
    ACTGDS_INTEGRATION_ENABLED?: string;
    /** ACTGDS's webhook endpoint. Never configured with a real value this round (see STATUS.md). */
    ACTGDS_WEBHOOK_URL?: string;
    /** HMAC signing secret — a Worker secret, never a plain [vars] value in wrangler.toml. Never configured with a real value this round. */
    ACTGDS_WEBHOOK_SECRET?: string;
    /** Which environment this Worker is (staging/production) — echoed in the payload's source.environment, not a secret. */
    ACTGDS_INTEGRATION_ENV?: string;
  }
}

type EnvLike = Partial<Record<"ACTGDS_INTEGRATION_ENABLED" | "ACTGDS_WEBHOOK_URL" | "ACTGDS_WEBHOOK_SECRET" | "ACTGDS_INTEGRATION_ENV", string | undefined>>;

/**
 * Resolves integration config from environment-style vars. Defaults to fully disabled — a missing/absent
 * `ACTGDS_INTEGRATION_ENABLED` (or any value other than the literal string "true") never turns this on by
 * accident. Missing `ACTGDS_WEBHOOK_URL`/`ACTGDS_WEBHOOK_SECRET` while enabled is a valid (if useless) state —
 * this function never throws; the sender degrades gracefully (see lib/integration/sender.ts).
 */
export function resolveIntegrationConfig(env: EnvLike): IntegrationConfig {
  return {
    enabled: env.ACTGDS_INTEGRATION_ENABLED === "true",
    webhookUrl: env.ACTGDS_WEBHOOK_URL || null,
    webhookSecret: env.ACTGDS_WEBHOOK_SECRET || null,
    environment: env.ACTGDS_INTEGRATION_ENV === "production" ? "production" : "staging",
  };
}

/** The disabled config used whenever a caller doesn't pass integration hooks at all (existing callers, local dev, tests). */
export const DISABLED_INTEGRATION_CONFIG: IntegrationConfig = resolveIntegrationConfig({});
