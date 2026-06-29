import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser.ts",
  },
  format: ["esm"],
  outDir: "dist",
  dts: false,
  clean: true,
  splitting: false,
  external: ["mcp-use", /^mcp-use\/.*/],
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
