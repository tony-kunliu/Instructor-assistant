/**
 * Cloudflare Access logout for the current application origin.
 *
 * `<app-origin>/cdn-cgi/access/logout` revokes the Access session and deletes
 * this application's `CF_Authorization` cookie (Cloudflare's session-management
 * docs). Without a return target it stops on a generic Cloudflare page, which
 * strands the user. Cloudflare's endpoint also accepts a `returnTo` query
 * parameter — observed behaviour, not covered in the public docs: a same-origin
 * absolute URL answers 302 + `Set-Cookie: CF_Authorization=deleted`, while a
 * relative or foreign-origin value answers 400. So `returnTo` is always this
 * app's own origin root, which then re-enters the Access login flow because
 * the session is gone. If Cloudflare ever stops honouring it, the worst case
 * is the previous behaviour (logout succeeds, generic page) — never a
 * still-authenticated user.
 */
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

export function accessLogoutUrl(origin: string | null | undefined): string {
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) return ACCESS_LOGOUT_PATH;
  return `${ACCESS_LOGOUT_PATH}?returnTo=${encodeURIComponent(`${origin}/`)}`;
}
