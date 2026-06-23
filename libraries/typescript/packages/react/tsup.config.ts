import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    "@mcp-use/core",
    "@mcp-use/client",
    "@modelcontextprotocol/sdk",
    "zod",
    "react",
    "react-router",
  ],
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
