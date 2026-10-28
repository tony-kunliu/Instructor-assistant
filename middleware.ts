import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessIssuer, accessJwks, accessTeamDomain, verifyAccessIdentity } from "./lib/access.ts";
import { audienceGate, modeGate, resolveAppMode } from "./lib/app-mode.ts";
import { findInstructorByEmail } from "./lib/repo.ts";
import { forwardHeaders, saasGate } from "./lib/saas/gate.ts";
import { parseTrialDays } from "./lib/saas/trial.ts";

declare global {
  interface CloudflareEnv {
    /** The Cloudflare Access Application `aud` protecting *this* environment's hostname — differs per environment (Staging vs. Production each have their own Access app). Set via `[vars]`/`[env.production.vars]` in wrangler.toml. */
    ACCESS_AUD?: string;
    /** The Cloudflare Access team domain whose JWTs this environment accepts (SaaS edition spec §3). Optional; defaults to `actgds.cloudflareaccess.com`, the private apps' team. */
    ACCESS_TEAM_DOMAIN?: string;
  }
}

/**
 * Cloudflare Access is now the sole access-control gate (Instructor
 * Identity V1, STEP 7 — Basic Auth retired once Tony and Anna had each
 * verified their real Access login worked end to end; see STATUS.md).
 *
 * The self_hosted Access Application (team domain
 * `actgds.cloudflareaccess.com`) sits in front of the Worker for this
 * hostname and only lets Tony's/Anna's emails authenticate at all — so an
 * unrecognized email never reaches this code in real deployed traffic. We
 * still verify the `Cf-Access-Jwt-Assertion` header's signature ourselves
 * (never trust it at face value) and map the verified email to an
 * instructor record; an email with no matching *active* instructor is
 * refused here too (defense in depth beyond Access's own policy), per
 * instruction never to auto-create an unrecognized identity. On success,
 * the resolved instructor id/name are forwarded to route handlers via
 * trusted request headers (set here, never client-submitted) so lesson
 * create/edit can attribute automatically.
 *
 * In the deployed Worker (`env.DB` present), a request with no verified
 * Access identity at all is rejected outright — this Worker has no other
 * route for traffic to reach it except through Access, so a missing
 * identity here means Access isn't actually in front for some reason,
 * which must fail closed, not silently allow the request through.
 * Outside the deployed Worker (local dev/build/tests, where `env.DB` is
 * absent and nothing is publicly exposed), this check is skipped.
 *
 * Before any of that, `modeGate` (lib/app-mode.ts) fails closed with 503
 * on an invalid `APP_MODE`, or on `saas` without a D1 binding, so the
 * local-dev pass-through can never be reached in a SaaS deployment.
 *
 * In the SaaS edition (`APP_MODE = "saas"`, spec 2026-10-21-saas-edition-design)
 * Access lets anyone who proves an e-mail through, so after the same JWT
 * verification every decision (onboarding, disabled accounts, per-instructor
 * route guard, free trial) is made by `saasGate` in lib/saas/gate.ts, and
 * `forwardHeaders` replaces any client-supplied identity headers. The
 * private path below is unchanged.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { env } = getCloudflareContext();
  const gate = modeGate(env.APP_MODE, Boolean(env.DB));
  if (gate) return new NextResponse(gate.message, { status: gate.status });
  if (!env.DB) return NextResponse.next();
  const saas = resolveAppMode(env.APP_MODE, true) === "saas";
  const audience = audienceGate(saas ? "saas" : "private", env.ACCESS_AUD);
  if (audience) return new NextResponse(audience.message, { status: audience.status });

  let identity: Awaited<ReturnType<typeof verifyAccessIdentity>>;
  try {
    const team = accessTeamDomain(env.ACCESS_TEAM_DOMAIN);
    identity = await verifyAccessIdentity(request, accessJwks(team), env.ACCESS_AUD || undefined, accessIssuer(team));
  } catch {
    return new NextResponse("Could not verify Cloudflare Access identity.", { status: 403 });
  }
  if (!identity) {
    return new NextResponse("Cloudflare Access identity required.", { status: 403 });
  }

  if (saas) return saasMiddleware(request, env, identity.email);

  const instructor = await findInstructorByEmail(env.DB, identity.email);
  if (!instructor) {
    return new NextResponse("Your Cloudflare Access identity has no matching Instructor Assistant account.", { status: 403 });
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete("x-access-email");
  forwardedHeaders.set("x-instructor-id", instructor.id);
  forwardedHeaders.set("x-instructor-name", instructor.fullName);
  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

/** SaaS edition only: every authorization decision is `saasGate`'s; a gate failure (e.g. D1 error) fails closed with 503. */
async function saasMiddleware(request: NextRequest, env: CloudflareEnv, email: string): Promise<NextResponse> {
  let result: Awaited<ReturnType<typeof saasGate>>;
  try {
    result = await saasGate(env.DB, { email, method: request.method, pathname: request.nextUrl.pathname, now: new Date(), trialDays: parseTrialDays(env.SAAS_TRIAL_DAYS) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (result.kind === "redirect") return NextResponse.redirect(new URL(result.to, request.url));
  if (result.kind === "error") return NextResponse.json({ error: result.error }, { status: result.status });
  const instructor = result.instructor ?? null;
  return NextResponse.next({ request: { headers: forwardHeaders(request, instructor, instructor ? null : email) } });
}

export const config = {
  matcher: "/((?!_next/static|_next/image).*)",
};
