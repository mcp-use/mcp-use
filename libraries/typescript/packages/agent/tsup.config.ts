import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts", "src/langchain.ts"],
  // ESM-only: @mcp-use/agent depends on the ESM-only v2 client stack, and its
  // package exports intentionally expose no CommonJS entry points.
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  define: {
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(version),
  },
});
