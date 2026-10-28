"use client";

import { useEffect, useState } from "react";
import { accessLogoutUrl } from "@/lib/access-logout.ts";
import { trialBanner } from "@/lib/saas/trial-banner.ts";
import type { Instructor } from "@/lib/types.ts";

type Me = { instructor: { id: string; fullName: string } | null; trialEndsAt?: string | null };

/**
 * The /account page body: the signed-in instructor's name and ADI number (from `/api/me` and the instructor list,
 * which in the SaaS edition holds only themself), the trial line, the data export download and the same Cloudflare
 * Access Sign out link as the main screen (lib/access-logout.ts).
 */
export default function AccountView() {
  const [me, setMe] = useState<Me | null>(null);
  const [adiNumber, setAdiNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ends the Cloudflare Access session on this app's own origin and returns to it (see lib/access-logout.ts).
  const [logoutUrl, setLogoutUrl] = useState(() => accessLogoutUrl(null));
  useEffect(() => setLogoutUrl(accessLogoutUrl(window.location.origin)), []);

  useEffect(() => {
    void (async () => {
      try {
        const [meResponse, instructorsResponse] = await Promise.all([fetch("/api/me"), fetch("/api/instructors")]);
        const meData = (await meResponse.json().catch(() => null)) as Me | null;
        if (!meResponse.ok || !meData) throw new Error("Could not load your account. Please try again.");
        if (!meData.instructor) {
          window.location.replace("/welcome");
          return;
        }
        setMe(meData);
        if (instructorsResponse.ok) {
          const { instructors } = (await instructorsResponse.json()) as { instructors: Instructor[] };
          setAdiNumber(instructors.find((i) => i.id === meData.instructor?.id)?.adiNumber ?? null);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const trial = me ? trialBanner(me.trialEndsAt ?? "", new Date()) : null;

  return (
    <>
      {error ? <p className="status error" role="alert">{error}</p> : null}
      <section className="card saas-form" data-testid="account-details">
        {!me ? <p className="empty" role="status">Loading your account…</p> : (
          <>
            <dl className="account-facts">
              <dt>Name</dt><dd data-testid="account-name">{me.instructor?.fullName}</dd>
              <dt>ADI number</dt><dd data-testid="account-adi">{adiNumber ?? "—"}</dd>
            </dl>
            {trial ? <p className={`trial-line ${trial.kind}`} data-testid="account-trial" data-kind={trial.kind}>{trial.text}</p> : null}
          </>
        )}
      </section>
      <section className="card saas-form">
        <h2>Your data</h2>
        <p className="meta">Download every learner and lesson you have recorded (including archived learners and signatures) as one JSON file. Available at any time, also after the free trial.</p>
        <a href="/api/account/export" download className="btn primary block" data-testid="export-link">Export my data</a>
      </section>
      <nav className="saas-links" aria-label="More">
        <a href="/" data-testid="back-link">Back to learners</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy Policy</a>
        <a href={logoutUrl} className="signout-link" data-testid="signout-link">Sign out</a>
      </nav>
    </>
  );
}
