import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "sharp",
    "playwright-core",
    "imapflow",
  ],
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
