import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Cloudflare Access identity resolution (Instructor Identity V1, STEP 3/4).
 *
 * Cloudflare Access sits in front of the Worker for the app's Access
 * Application (see STATUS.md — team domain `actgds.cloudflareaccess.com`,
 * shared by every environment). Once a request passes Access's own policy
 * (only Tony's and Anna's emails are allowed to authenticate at all),
 * Cloudflare forwards it to the origin with a signed
 * `Cf-Access-Jwt-Assertion` header containing the verified identity. We
 * never trust that header at face value — we verify its RS256 signature
 * against Access's own JWKS and check the `aud` claim, exactly as
 * Cloudflare's own docs specify, before ever reading the `email` claim
 * out of it.
 *
 * Each environment (Staging, Production) is protected by its own Access
 * Application with its own `aud` — a request's JWT is only valid against
 * the Access app for that exact hostname. The caller (`middleware.ts`)
 * must pass the correct `audience` for the environment it's running in
 * (via the `ACCESS_AUD` Worker var, set per `wrangler.toml` environment);
 * `DEFAULT_APP_AUD` below is Staging's, kept only as a safe fallback for
 * local dev/tooling that doesn't set the var.
 */

const TEAM_DOMAIN = "actgds.cloudflareaccess.com";
const DEFAULT_APP_AUD = "dbaecdf29cb50d215f3edbb3b260b2c85209db78728fb19e3c53c39c5d9759e3";

const JWKS = createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));

/** One remote JWKS per team domain, reused across requests (jose caches the fetched keys inside each). */
const JWKS_BY_DOMAIN = new Map<string, JWTVerifyGetKey>([[TEAM_DOMAIN, JWKS]]);

/**
 * The Access team domain for this environment (SaaS edition spec §3): the optional `ACCESS_TEAM_DOMAIN` Worker var,
 * defaulting to the private apps' `actgds.cloudflareaccess.com`. A value that is not a bare host name (scheme, path,
 * port, spaces, a single label) throws, so a misconfigured var fails closed in middleware (403) rather than
 * verifying against some other host.
 */
export function accessTeamDomain(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return TEAM_DOMAIN;
  const domain = String(raw).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new Error("ACCESS_TEAM_DOMAIN must be a bare host name such as team.cloudflareaccess.com.");
  }
  return domain;
}

/** The JWT issuer Access uses for a team domain. */
export function accessIssuer(domain: string): string {
  return `https://${domain}`;
}

/** The (cached) remote JWKS for a team domain; the default domain gets the same instance as before. */
export function accessJwks(domain: string): JWTVerifyGetKey {
  let jwks = JWKS_BY_DOMAIN.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${accessIssuer(domain)}/cdn-cgi/access/certs`));
    JWKS_BY_DOMAIN.set(domain, jwks);
  }
  return jwks;
}

export type AccessIdentity = { email: string };

/**
 * Verifies the `Cf-Access-Jwt-Assertion` header Cloudflare Access attaches
 * to requests that passed its policy, and returns the verified email.
 * Returns null when the header is absent (e.g. local dev, or any request
 * path not sitting behind this Access Application) — callers must not
 * treat a missing header as "authenticated as nobody in particular" for
 * anything security-sensitive; it just means Access identity isn't
 * available for this request, and Basic Auth remains the actual gate.
 * Throws if the header is present but fails verification (tampered/expired
 * — a real problem, not just "no Access identity here").
 */
export async function verifyAccessIdentity(
  request: Request,
  jwks: JWTVerifyGetKey = JWKS,
  audience: string = DEFAULT_APP_AUD,
  issuer: string = `https://${TEAM_DOMAIN}`,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const { payload } = await jwtVerify(token, jwks, { audience, issuer });
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!email) throw new Error("Access JWT verified but had no email claim.");
  return { email };
}
