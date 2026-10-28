import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAppMode } from "@/lib/app-mode.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Privacy Policy · Instructor Assistant" };

/**
 * SaaS edition Privacy Policy (spec §8): drafted by the agent, marked DRAFT until Tony (or a professional) reviews it.
 * Unknown facts are bracketed placeholders for Tony to fill in; no data region is claimed. 404 in the private edition.
 */
export default function Page() {
  if (currentAppMode() !== "saas") notFound();
  return (
    <main className="app saas-page legal-page">
      <p className="draft-notice" data-testid="draft-notice">DRAFT — not yet reviewed</p>
      <h1 className="legal-title">Privacy Policy</h1>
      <article className="card legal" data-testid="privacy-page">
        <p className="meta">Operated by [operator name — Tony to add]. Last updated [date — Tony to add].</p>

        <h2>1. What we collect</h2>
        <p>About you, the instructor: your name, your ADI number and the e-mail address you sign in with.</p>
        <p>About your learners, only what you enter: names, contact details, licence details, lesson records (dates, times, odometer readings, competencies, comments) and signatures.</p>

        <h2>2. Why</h2>
        <p>We use this information only to provide the service to you: storing your records, showing them to you and producing your PDFs and exports. We do not sell it and do not use it for advertising.</p>

        <h2>3. Where it is stored</h2>
        <p>The service runs on Cloudflare, and your data is stored with Cloudflare. Data region: [data region — Tony to confirm].</p>

        <h2>4. Who can see it</h2>
        <p>Each account sees only its own data. Other instructors using the service cannot see your learners or lessons, and you cannot see theirs.</p>

        <h2>5. Your learners&rsquo; permission</h2>
        <p>You are responsible for having each learner&rsquo;s permission to record their details in the service, and for telling them how their information is used.</p>

        <h2>6. Export and deletion</h2>
        <p>You can download all your data at any time from the Account page (&ldquo;Export my data&rdquo;). To have your account and data deleted, contact us at [contact e-mail — Tony to add].</p>

        <h2>7. Australian Privacy Act</h2>
        <p>We aim to handle personal information in line with the Australian Privacy Principles in the Privacy Act 1988 (Cth). You can ask to access or correct personal information we hold about you, or make a complaint, at [contact e-mail — Tony to add]. If you are not satisfied with our response, you can contact the Office of the Australian Information Commissioner (OAIC).</p>

        <h2>8. Changes</h2>
        <p>We may update this policy. Material changes will be shown in the app before they apply.</p>

        <p className="saas-back"><a href="/">Back to the app</a></p>
      </article>
    </main>
  );
}
