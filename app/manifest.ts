import type { MetadataRoute } from "next";
import { currentAppMode } from "../lib/app-mode.ts";
import { NAVY } from "../lib/theme.ts";

// The Home Screen app's splash and status bar follow the redesigned light tokens (app/globals.css --paper and --navy);
// a manifest holds ONE value per colour, so it carries the light pair (the in-page theme-color metas switch with the
// phone's theme / the Appearance toggle). tests/manifest-colours.test.ts keeps these in step with the stylesheet.
export const MANIFEST_BACKGROUND = "#f6f3eb"; // --paper (light)

// Decided per request: the edition (APP_MODE) is a Worker var, never baked in at build time.
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  // SaaS edition: the product's own name and description, not the school's; everything else is shared.
  const saas = currentAppMode() === "saas";
  return {
    name: saas ? "Instructor Assistant" : "ACTGDS Instructor",
    short_name: "Instructor",
    description: saas ? "CBT&A lesson records for accredited ACT driving instructors" : "CBT&A Lesson Checklist for ACT Golden Driving School instructors",
    start_url: "/",
    display: "standalone",
    background_color: MANIFEST_BACKGROUND,
    theme_color: NAVY.light,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
