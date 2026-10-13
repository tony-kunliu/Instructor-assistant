import type { Metadata } from "next";
import GpsLab from "./lab.tsx";

// EXPERIMENT (branch experiment/gps-pwa-feasibility): standalone measurement tool, not linked from the app.
export const metadata: Metadata = {
  title: "GPS Lab",
  manifest: "/gps-lab/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GPS Lab", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export default function Page() {
  return <GpsLab />;
}
