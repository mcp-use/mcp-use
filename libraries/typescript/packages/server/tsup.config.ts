import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  // ESM-only: the v2 @modelcontextprotocol/* packages ship no CJS entry, so a
  // CJS build of this package could never load them.
  format: ["esm"],
  target: "node24",
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
});
