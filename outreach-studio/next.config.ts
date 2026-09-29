import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "sharp",
    "@resvg/resvg-js",
    "playwright-core",
    "imapflow",
    "satori",
  ],
  poweredByHeader: false,
};

export default nextConfig;
