import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessIdentity } from "./lib/access.ts";
import { findInstructorByEmail } from "./lib/repo.ts";

declare global {
  interface CloudflareEnv {
    /** The Cloudflare Access Application `aud` protecting *this* environment's hostname — differs per environment (Staging vs. Production each have their own Access app). Set via `[vars]`/`[env.production.vars]` in wrangler.toml. */
    ACCESS_AUD?: string;
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
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { env } = getCloudflareContext();
  if (!env.DB) return NextResponse.next();

  let identity: Awaited<ReturnType<typeof verifyAccessIdentity>>;
  try {
    identity = env.ACCESS_AUD ? await verifyAccessIdentity(request, undefined, env.ACCESS_AUD) : await verifyAccessIdentity(request);
  } catch {
    return new NextResponse("Could not verify Cloudflare Access identity.", { status: 403 });
  }
  if (!identity) {
    return new NextResponse("Cloudflare Access identity required.", { status: 403 });
  }

  const instructor = await findInstructorByEmail(env.DB, identity.email);
  if (!instructor) {
    return new NextResponse("Your Cloudflare Access identity has no matching Instructor Assistant account.", { status: 403 });
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-instructor-id", instructor.id);
  forwardedHeaders.set("x-instructor-name", instructor.fullName);
  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: "/((?!_next/static|_next/image).*)",
};
