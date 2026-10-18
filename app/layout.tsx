import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NAVY, THEME_BOOT_SCRIPT } from "@/lib/theme.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACTGDS Instructor",
  description: "CBT&A Lesson Checklist for ACT Golden Driving School instructors",
  applicationName: "ACTGDS Instructor",
  appleWebApp: { capable: true, title: "Instructor", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The navy top bar (shared with the ACTGDS website), in both themes (app/globals.css --navy). A forced Light / Dark
  // choice (app/theme-switch.tsx) rewrites both metas to that theme's navy.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: NAVY.light },
    { media: "(prefers-color-scheme: dark)", color: NAVY.dark },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script sets data-theme on <html> before React hydrates (expected mismatch).
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        {/* Applies the stored Appearance choice before the first paint (lib/theme.ts); no network, no dependency. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
