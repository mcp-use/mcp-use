import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    "@mcp-use/core",
    "@mcp-use/client",
    "@modelcontextprotocol/sdk",
    "zod",
    // Keep heavy optional server deps external
    "redis",
    "@redis/client",
    "posthog-node",
    "chalk",
    "hono",
    "@hono/node-server",
    "express",
    "jose",
  ],
  esbuildOptions(options) {
    options.platform = "node";
  },
});
