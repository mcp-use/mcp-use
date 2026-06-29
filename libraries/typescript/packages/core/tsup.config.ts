import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  esbuildOptions(options) {
    // Preserve node: prefix for Deno compatibility
    options.platform = "neutral";
  },
});
