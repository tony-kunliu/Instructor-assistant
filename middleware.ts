import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

declare global {
  interface CloudflareEnv {
    STAGING_BASIC_AUTH_USER?: string;
    STAGING_BASIC_AUTH_PASSWORD?: string;
  }
}

/**
 * Interim staging access protection: HTTP Basic Auth via a Cloudflare Worker
 * secret (`STAGING_BASIC_AUTH_USER` / `STAGING_BASIC_AUTH_PASSWORD`, set with
 * `wrangler secret put`, never committed to git).
 *
 * This is a stand-in until Cloudflare Zero Trust Access is enabled on the
 * account (a one-time manual dashboard step — see STATUS.md) and a proper
 * Access application replaces it.
 */
export function middleware(request: NextRequest): NextResponse {
  const { env } = getCloudflareContext();
  const user = env.STAGING_BASIC_AUTH_USER;
  const pass = env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Basic ${btoa(`${user}:${pass}`)}`;
  if (authHeader === expected) return NextResponse.next();

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ACTGDS Driver Staging"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image).*)",
};
