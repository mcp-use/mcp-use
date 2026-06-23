import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser.ts",

    "auth/index": "src/auth/index.ts",
    "auth/index-node": "src/auth/index-node.ts",
  },
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    "@mcp-use/core",
    "@modelcontextprotocol/sdk",
    "zod",
    "jose",
  ],
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
