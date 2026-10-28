import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAppMode } from "@/lib/app-mode.ts";
import SaasPageShell from "../saas-page-shell.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account disabled · Instructor Assistant" };

/** SaaS edition: where middleware sends an inactive instructor (spec §4). Reads no data. 404 in the private edition. */
export default function Page() {
  if (currentAppMode() !== "saas") notFound();
  return (
    <SaasPageShell title="Account disabled">
      <section className="card" data-testid="disabled-page">
        <p className="saas-lead">This account is disabled. Contact support.</p>
      </section>
    </SaasPageShell>
  );
}
