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
    exclude: [
      "node_modules/**",
      "dist/**",
      "tests/cli/.tmp/**",
      "tests/deno/**",
    ],
    // Real Vite build/dev servers in tests/cli/*.test.ts (moved from the
    // now-folded-in @mcp-use/devkit package) need more headroom than the rest
    // of this package's tests.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
