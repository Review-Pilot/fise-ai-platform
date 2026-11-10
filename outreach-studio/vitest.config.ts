import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.spec.ts"], environment: "node" },
});
