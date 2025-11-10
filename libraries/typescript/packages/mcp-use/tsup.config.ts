import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "index.ts",
    "src/agents/index.ts",
    "src/browser.ts",
    "src/react/index.ts",
    "src/server/index.ts",
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
    // Keep Langchain packages external to reduce memory usage during build
    "@langchain/core",
    "@langchain/anthropic",
    "@langchain/openai",
    "langchain",
    "@langfuse/langchain",
  ],
  esbuildOptions(options) {
    // Preserve node: prefix for Deno compatibility
    options.platform = "neutral";
  },
});
