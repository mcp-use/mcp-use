import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/evals.ts", "src/screenshot.ts", "src/cli.ts"],
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    "mcp-use",
    "mcp-use/client",
    "ws",
    "yaml",
    "zod",
  ],
});
