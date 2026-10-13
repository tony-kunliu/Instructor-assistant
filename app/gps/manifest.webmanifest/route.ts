// Separate install target so the GPS test page can be added to the iPhone Home Screen (real standalone-PWA behaviour,
// where Screen Wake Lock matters) without touching the app's own manifest. Colours = the shared light tokens.
export function GET() {
  return Response.json(
    {
      name: "GPS recorder",
      short_name: "GPS",
      start_url: "/gps",
      scope: "/gps",
      display: "standalone",
      background_color: "#f6f3eb",
      theme_color: "#0b1b2b",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
