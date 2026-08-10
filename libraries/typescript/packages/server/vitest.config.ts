import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The Deno smoke test uses URL imports and runs in its dedicated workflow.
    exclude: ["node_modules/**", "dist/**", "tests/deno/**"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
