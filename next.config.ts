import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static, client-side output: `next build` emits `out/` and the app
  // then runs with no server at all.
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
  // The preview environment serves this app from a sandbox proxy host.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
