import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [],
  // The bundled street index (public/data/streets-<gnaf-release>.json) carries the release in its name, so it can be
  // cached forever (learner intake D3); a new release is a new file name.
  async headers() {
    return [{ source: "/data/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;

// Lets `next dev` read Cloudflare bindings (e.g. D1) from `wrangler.toml`
// via `getCloudflareContext()`, matching the deployed Worker's behaviour.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
