import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAppMode } from "@/lib/app-mode.ts";
import SaasPageShell from "../saas-page-shell.tsx";
import AccountView from "./account-view.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account · Instructor Assistant" };

/** SaaS edition account page (spec §8): profile, trial, "Export my data", Sign out. 404 in the private edition. */
export default function Page() {
  if (currentAppMode() !== "saas") notFound();
  return (
    <SaasPageShell title="Account">
      <AccountView />
    </SaasPageShell>
  );
}
