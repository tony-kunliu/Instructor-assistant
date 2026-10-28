import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAppMode } from "@/lib/app-mode.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Terms · Instructor Assistant" };

/**
 * SaaS edition Terms of Use (spec §8): drafted by the agent, marked DRAFT until Tony (or a professional) reviews it.
 * Unknown facts are bracketed placeholders for Tony to fill in. Not part of the private edition: 404 there.
 */
export default function Page() {
  if (currentAppMode() !== "saas") notFound();
  return (
    <main className="app saas-page legal-page">
      <p className="draft-notice" data-testid="draft-notice">DRAFT — not yet reviewed</p>
      <h1 className="legal-title">Terms of Use</h1>
      <article className="card legal" data-testid="terms-page">
        <p className="meta">Operated by [operator name — Tony to add]. Last updated [date — Tony to add].</p>

        <h2>1. What the service is</h2>
        <p>Instructor Assistant is an online record-keeping tool for accredited ACT driving instructors. It helps you record CBT&amp;A lessons, competencies, odometer readings, hours and signatures, and print the CBT&amp;A checklist as a PDF.</p>
        <p>It is a tool, not advice. Nothing in the service is legal or regulatory advice, and it does not replace the official ACT rules, the Code of Practice or guidance from Access Canberra.</p>

        <h2>2. Your responsibilities</h2>
        <p>You remain responsible for the accuracy and completeness of every record you make, and for complying with the ACT rules that apply to you as an accredited driving instructor. Reminders and checks in the app are a help only; they may be incomplete or wrong.</p>
        <p>You must have your learners&rsquo; permission to record their details in the service (see the Privacy Policy).</p>

        <h2>3. Free trial</h2>
        <p>A new account has a free trial of 30 days. After the trial the account becomes read-only: you can still open your records, export PDFs and download all your data, but you cannot add or change records.</p>

        <h2>4. Acceptable use</h2>
        <ul>
          <li>Use the service only for your own work as a driving instructor.</li>
          <li>Enter only information you are entitled to record.</li>
          <li>Do not try to access other accounts or data that is not yours, interfere with the service, or use it for anything unlawful.</li>
          <li>Keep your sign-in e-mail secure; you are responsible for activity under your account.</li>
        </ul>

        <h2>5. No warranty</h2>
        <p>The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without any warranty that it will be uninterrupted, error-free or fit for a particular purpose. Keep your own copies of important records (you can export them at any time from the Account page). To the extent the law allows, [operator name — Tony to add] is not liable for any loss arising from use of the service. Nothing in these terms excludes rights you have under the Australian Consumer Law that cannot be excluded.</p>

        <h2>6. Termination</h2>
        <p>You can stop using the service at any time and ask for your account to be deleted. We may suspend or close an account that breaches these terms, or close the service, with reasonable notice where possible. Before an account is closed you will be able to export your data, unless the law prevents it.</p>

        <h2>7. Changes</h2>
        <p>We may update these terms. Material changes will be shown in the app before they apply.</p>

        <h2>8. Governing law</h2>
        <p>These terms are governed by the laws of the Australian Capital Territory, Australia, and the courts of the ACT have jurisdiction.</p>

        <h2>9. Contact</h2>
        <p>[contact e-mail — Tony to add]</p>

        <p className="saas-back"><a href="/">Back to the app</a></p>
      </article>
    </main>
  );
}
