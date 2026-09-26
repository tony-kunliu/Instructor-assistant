import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessIdentity } from "./lib/access.ts";
import { findInstructorByEmail } from "./lib/repo.ts";

declare global {
  interface CloudflareEnv {
    STAGING_BASIC_AUTH_USER?: string;
    STAGING_BASIC_AUTH_PASSWORD?: string;
  }
}

/**
 * Access protection, two layers (Instructor Identity V1, STEP 3/7):
 *
 * 1. Cloudflare Access (self_hosted app, team domain
 *    `actgds.cloudflareaccess.com`) sits in front of the Worker for this
 *    hostname and only lets Tony's/Anna's emails authenticate at all — so
 *    for real external traffic, an unrecognized email never reaches this
 *    code. We still verify the `Cf-Access-Jwt-Assertion` header's signature
 *    ourselves (never trust it at face value) and map the verified email to
 *    an instructor record; an email with no matching *active* instructor is
 *    refused here too (defense in depth — belt and braces, not just Access's
 *    own policy), per instruction never to auto-create an unrecognized
 *    identity. On success, the resolved instructor id/name are forwarded to
 *    route handlers via trusted request headers (set here, never
 *    client-submitted) so lesson create/edit can attribute automatically.
 * 2. HTTP Basic Auth via a Cloudflare Worker secret
 *    (`STAGING_BASIC_AUTH_USER` / `STAGING_BASIC_AUTH_PASSWORD`) is kept as
 *    a second, independent gate — not removed by this round, per the
 *    cautious migration order in STATUS.md/TASK.md.
 *
 * A request with no `Cf-Access-Jwt-Assertion` header at all (e.g. local
 * dev/tests, or Access not in front for some reason) skips step 1 entirely
 * and falls through to Basic Auth alone, exactly as before this round.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { env } = getCloudflareContext();

  let identityHeaders: HeadersInit | null = null;
  try {
    const identity = await verifyAccessIdentity(request);
    // env.DB is only absent outside the deployed Worker (local dev/build) —
    // there's no Access in front there either, so this never matters in practice.
    if (identity && env.DB) {
      const instructor = await findInstructorByEmail(env.DB, identity.email);
      if (!instructor) {
        return new NextResponse("Your Cloudflare Access identity has no matching Instructor Assistant account.", { status: 403 });
      }
      identityHeaders = { "x-instructor-id": instructor.id, "x-instructor-name": instructor.fullName };
    }
  } catch {
    return new NextResponse("Could not verify Cloudflare Access identity.", { status: 403 });
  }

  const user = env.STAGING_BASIC_AUTH_USER;
  const pass = env.STAGING_BASIC_AUTH_PASSWORD;
  if (user && pass) {
    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Basic ${btoa(`${user}:${pass}`)}`;
    if (authHeader !== expected) {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="ACTGDS Driver Staging"' },
      });
    }
  }

  if (!identityHeaders) return NextResponse.next();
  const forwardedHeaders = new Headers(request.headers);
  for (const [key, value] of Object.entries(identityHeaders)) forwardedHeaders.set(key, value as string);
  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: "/((?!_next/static|_next/image).*)",
};
