import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  // The React entry remains separate because React is optional. Root entries
  // select their platform implementation through package export conditions.
  entry: {
    index: "src/index.ts",
    "index-browser": "src/index-browser.ts",
    "react/index": "src/react/index.ts",
    sandbox: "src/sandbox.ts",
  },
  // ESM-only: @mcp-use/client targets Node 22+ ESM natively and the package exports
  // map has no "require" condition, so CJS output is unnecessary.
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // React is an optional peer dependency — never bundle it into the react
  // subpath (a second copy would break hooks).
  external: [
    "react",
    "react-dom",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/ext-apps",
    "@modelcontextprotocol/ext-apps/app-bridge",
    "@ai-sdk/provider-utils",
  ],
  define: {
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(version),
  },
});
