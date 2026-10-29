import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

// Unlike the rest of the workspace (ESM-only, Node 22), this package ships
// ESM and CJS for Node >= 18, Bun, Deno, Workers and Vercel Edge: it is
// installed into servers built with any toolchain and has no runtime
// dependencies, so it targets the lowest common runtime.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  target: "es2022",
  platform: "neutral",
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: true,
  define: {
    __MCP_USE_ANALYTICS_VERSION__: JSON.stringify(version),
  },
});
