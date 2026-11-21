import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { prepareLicenceOcr } from "./scripts/prepare-licence-ocr.ts";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [],
  // The bundled street index (public/data/streets-<gnaf-release>.json) carries the release in its name, so it can be
  // cached forever (learner intake D3); a new release is a new file name.
  async headers() {
    return ["/data/:path*", "/licence-ocr-v7/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }));
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) prepareLicenceOcr();
  return nextConfig;
}

// Lets `next dev` read Cloudflare bindings (e.g. D1) from `wrangler.toml`
// via `getCloudflareContext()`, matching the deployed Worker's behaviour.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
