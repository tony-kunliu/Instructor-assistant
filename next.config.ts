import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [],
};

export default nextConfig;

// Lets `next dev` read Cloudflare bindings (e.g. D1) from `wrangler.toml`
// via `getCloudflareContext()`, matching the deployed Worker's behaviour.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
