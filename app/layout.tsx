import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACTGDS Driver",
  description: "CBT&A Lesson Checklist for ACT Golden Driving School instructors",
  applicationName: "ACTGDS Driver",
  appleWebApp: { capable: true, title: "ACTGDS Driver", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1b2b", // the navy top bar (shared with the ACTGDS website)
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
