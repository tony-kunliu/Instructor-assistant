"use client";

import { useEffect, useState } from "react";
import { accessLogoutUrl } from "@/lib/access-logout.ts";

/**
 * The SaaS pages' Sign out link: the same Cloudflare Access logout as the main screen (lib/access-logout.ts) — ends the
 * Access session on this app's own origin and returns to it.
 */
export default function SignOutLink() {
  const [logoutUrl, setLogoutUrl] = useState(() => accessLogoutUrl(null));
  useEffect(() => setLogoutUrl(accessLogoutUrl(window.location.origin)), []);
  return <a href={logoutUrl} className="signout-link" data-testid="signout-link">Sign out</a>;
}
