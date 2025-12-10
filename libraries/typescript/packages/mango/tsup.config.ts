import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "@langchain/core",
    "@langchain/openai",
    "@langchain/anthropic",
    "@langchain/google-genai",
    "langchain",
    "mcp-use",
    "hono",
  ],
  treeshake: true,
});
