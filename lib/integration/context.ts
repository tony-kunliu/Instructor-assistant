// Bridges the Cloudflare-specific execution context (env vars, waitUntil)
// into the plain `IntegrationHooks` shape lib/repo.ts accepts. Kept out of
// lib/repo.ts itself, which — like lib/db.ts's own comment says of the
// storage layer — only depends on plain interfaces, never Cloudflare APIs
// directly, so it works unmodified in tests/local dev.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveIntegrationConfig } from "./config.ts";
import type { IntegrationHooks } from "./types.ts";

/**
 * Returns integration hooks wired to the real deployed Worker's config and `ExecutionContext.waitUntil`
 * (so a slow/unreachable webhook can't hold up or crash the request), or `undefined` outside a Worker
 * (local dev, `next build`, tests) or when the integration is disabled — either way, callers that receive
 * `undefined` behave exactly as if this feature didn't exist.
 */
export function integrationHooksFromRequestContext(): IntegrationHooks | undefined {
  try {
    const { env, ctx } = getCloudflareContext();
    const config = resolveIntegrationConfig(env);
    if (!config.enabled) return undefined;
    return { config, fetchImpl: fetch, schedule: (attempt) => ctx.waitUntil(attempt()) };
  } catch {
    return undefined;
  }
}
