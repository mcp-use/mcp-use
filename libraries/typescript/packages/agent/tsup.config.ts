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
    "@langchain/core",
    "langchain",
    "zod",
    "langfuse",
    "langfuse-langchain",
    "@langchain/anthropic",
    "@langchain/openai",
  ],
  esbuildOptions(options) {
    options.platform = "neutral";
  },
});
