import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@mcp-use/inspector",
    "@mcp-use/modelcontextprotocol-sdk",
  ],
  esbuildOptions(options) {
    options.banner = {
      js: '"use client";',
    };
  },
});
