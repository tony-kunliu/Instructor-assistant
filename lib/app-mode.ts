import { getCloudflareContext } from "@opennextjs/cloudflare";

declare global {
  interface CloudflareEnv {
    /** Which edition this Worker runs: exactly `"private"` (Tony/Anna) or `"saas"`. Set via `[vars]`/`[env.production.vars]` in wrangler.toml; anything else fails closed (503) in a deployed Worker. */
    APP_MODE?: string;
  }
}

export type AppMode = "private" | "saas";

/**
 * Resolves the raw `APP_MODE` value, failing closed (SaaS edition spec §2).
 *
 * Only the exact strings `"private"` and `"saas"` are accepted. In a
 * deployed Worker (D1 bound) anything else is `"invalid"` — never a silent
 * fallback to `private`, which in the SaaS Worker would let every signed-up
 * instructor see every learner. Without a D1 binding (local dev, build,
 * tests — nothing publicly exposed) a missing/unknown value means `private`.
 */
export function resolveAppMode(raw: unknown, hasDb: boolean): AppMode | "invalid" {
  if (raw === "private" || raw === "saas") return raw;
  return hasDb ? "invalid" : "private";
}

/**
 * Middleware decision: a 503 response to return, or `null` to continue.
 * An invalid mode is 503, and so is `saas` without a D1 binding (the
 * local-dev pass-through must never be reachable in a SaaS deployment).
 */
export function modeGate(rawMode: unknown, hasDb: boolean): { status: 503; message: string } | null {
  const mode = resolveAppMode(rawMode, hasDb);
  if (mode === "invalid") return { status: 503, message: "Instructor Assistant is misconfigured: APP_MODE must be \"private\" or \"saas\"." };
  if (mode === "saas" && !hasDb) return { status: 503, message: "Instructor Assistant is misconfigured: SaaS mode requires a D1 binding." };
  return null;
}

/** The current Worker's app mode; throws if it is invalid (middleware has already answered such requests with 503). */
export function currentAppMode(): AppMode {
  let env: CloudflareEnv;
  try {
    ({ env } = getCloudflareContext());
  } catch {
    // Not running inside a Cloudflare Worker (e.g. `next build`, `npm test`) — no D1, so only an exact "saas" opts in.
    return resolveAppMode(process.env.APP_MODE, false) as AppMode;
  }
  const mode = resolveAppMode(env.APP_MODE, Boolean(env.DB));
  if (mode === "invalid") throw new Error("Invalid APP_MODE: must be exactly \"private\" or \"saas\".");
  return mode;
}
