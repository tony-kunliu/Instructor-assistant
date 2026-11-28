import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAppMode } from "@/lib/app-mode.ts";
import SaasPageShell from "../saas-page-shell.tsx";
import WelcomeForm from "./welcome-form.tsx";

// Decided per request: the mode is a Worker var, never baked in at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Welcome · Instructor Assistant" };

/** SaaS edition first-time profile (spec §4, §8). The private edition never auto-creates an instructor: 404 there. */
export default function Page() {
  if (currentAppMode() !== "saas") notFound();
  return (
    <SaasPageShell title="Welcome">
      <WelcomeForm />
    </SaasPageShell>
  );
}
