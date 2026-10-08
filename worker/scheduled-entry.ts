// Custom Worker entrypoint (wrangler.toml `main`), used INSTEAD of pointing
// `main` directly at OpenNext's generated `.open-next/worker.js`.
//
// Why this file exists: OpenNext's Cloudflare adapter (this version) only
// generates a `fetch` handler — no `scheduled` export — so there is no
// built-in way to run a periodic job (ACTGDS Integration V1's outbox retry
// sweep, see docs/integrations/actgds-instructor-assistant-v1.md and
// lib/integration/sender.ts#processDueOutbox) inside the same Worker.
// `open-next.config.ts` has no config surface for adding one either (see
// @opennextjs/cloudflare's `CloudflareOverrides` type — no `scheduled`
// hook). This is the officially-supported way to extend a generated
// Worker: wrap it from a separate entry file, never edit the generated
// file itself (which is gitignored/rebuilt on every `opennextjs-cloudflare
// build` — see tsconfig.json's `exclude: ["worker"]`, since this file only
// resolves its `.open-next/worker.js` import after that build has run, not
// during `next build`'s own typecheck).
//
// This wrapper changes nothing about request handling — `fetch` is passed
// through untouched — and only adds `scheduled`.
//
// @ts-expect-error: only resolvable after `opennextjs-cloudflare build` has generated .open-next/worker.js — never present during `next build`'s typecheck.
import openNextWorker from "../.open-next/worker.js";
// @ts-expect-error: same as above — re-exports whatever Durable Object classes (if any) the generated worker declares, for any binding that references them.
export * from "../.open-next/worker.js";

import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { CRON_SWEEP_LIMIT, processDueOutbox } from "../lib/integration/sender.ts";

type MinimalScheduledEvent = { cron: string; scheduledTime: number };
type MinimalExecutionContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: openNextWorker.fetch,

  /**
   * Fires on the Cloudflare Cron Trigger(s) configured in wrangler.toml's
   * `[triggers]`/`[env.production.triggers]`. Sweeps every outbox row whose
   * `next_attempt_at` has passed — the counterpart to the best-effort
   * immediate delivery attempt already fired right after a lesson
   * save/edit (see lib/integration/context.ts) — so a retry scheduled for
   * later isn't stuck waiting for the next unrelated lesson save to
   * (accidentally) trigger it again.
   *
   * A no-op when the integration is disabled or `env.DB` is absent —
   * matches every other integration entry point's "disabled means
   * completely inert" behavior.
   */
  async scheduled(_event: MinimalScheduledEvent, env: CloudflareEnv, ctx: MinimalExecutionContext) {
    const config = resolveIntegrationConfig(env);
    if (!config.enabled || !env.DB) return;
    ctx.waitUntil(processDueOutbox(env.DB, config, fetch, new Date(), CRON_SWEEP_LIMIT));
  },
};
