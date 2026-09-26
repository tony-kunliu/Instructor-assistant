import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ACTGDS Driver",
    short_name: "ACTGDS Driver",
    description: "CBT&A Lesson Checklist for ACT Golden Driving School instructors",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f2ee",
    theme_color: "#1d1d1f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
