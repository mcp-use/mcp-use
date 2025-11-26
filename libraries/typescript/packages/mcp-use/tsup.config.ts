import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "index.ts",
    "src/agents/index.ts",
    "src/browser.ts",
    "src/react/index.ts",
    "src/server/index.ts",
    "src/client/prompts.ts",
  ],
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    // Keep Tailwind CSS and its dependencies external (native modules)
    "tailwindcss",
    "@tailwindcss/vite",
    "@tailwindcss/oxide",
    // Keep Vite and React plugin external (optional peer dependencies)
    "vite",
    "@vitejs/plugin-react",
    // Keep Connect middleware dependencies external (optional dependencies, dynamically imported)
    "connect",
    "node-mocks-http",
    // Keep Langchain packages external to reduce memory usage during build
    "@langchain/core",
    "@langchain/anthropic",
    "@langchain/openai",
    "langchain",
    "@langfuse/langchain",
    // Keep chalk and supports-color external (uses Node.js built-ins, incompatible with neutral platform)
    "chalk",
    "supports-color",
  ],
  esbuildOptions(options) {
    // Preserve node: prefix for Deno compatibility
    options.platform = "neutral";
  },
});
