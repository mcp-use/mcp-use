import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "index.ts",
    "src/adapters/index": "src/adapters/index.ts",
    "src/agents/index": "src/agents/index.ts",
    "src/auth/index": "src/auth/index.ts",
    "src/auth/index-node": "src/auth/index-node.ts",
    "src/bin": "src/bin.ts",
    "src/client": "src/client.ts",
    "src/server/index": "src/server/index.ts",
    "src/telemetry/tel-fetch": "src/telemetry/tel-fetch.ts",
    "src/utils/index": "src/utils/index.ts",
    "src/browser": "src/browser.ts",
    "src/browser-agent": "src/browser-agent.ts",
    "src/react/index": "src/react/index.ts",
  },
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false,
  external: [
    "@mcp-use/core",
    "@mcp-use/client",
    "@mcp-use/react",
    "@mcp-use/server",
    "@mcp-use/agent",
    "@mcp-use/cli",
    "@mcp-use/inspector",
    "@modelcontextprotocol/sdk",
    "zod",
    "react",
    "react-router",
    "langchain",
    "@langchain/core",
  ],
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
