import type { Metadata } from "next";
import GpsRecorder from "./gps.tsx";

// P4 GPS recorder: isolated test page, not linked from the app's navigation, not indexed, own install manifest.
// Design: docs/superpowers/specs/2026-10-13-gps-tracking-design.md.
export const metadata: Metadata = {
  title: "GPS recorder",
  manifest: "/gps/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GPS recorder", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export default function Page() {
  return <GpsRecorder />;
}
