// Separate install target so the lab can be added to the iPhone Home Screen (real standalone-PWA behaviour) without touching the app's own manifest.
export function GET() {
  return Response.json(
    {
      name: "GPS Lab",
      short_name: "GPS Lab",
      start_url: "/gps-lab",
      scope: "/gps-lab",
      display: "standalone",
      background_color: "#f4f2ee",
      theme_color: "#1d1d1f",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
