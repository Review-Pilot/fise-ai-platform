import type { NextConfig } from "next";
import path from "node:path";

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
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
