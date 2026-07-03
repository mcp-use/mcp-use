import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/cli/.tmp/**"],
    // Real Vite build/dev servers in tests/cli/*.test.ts (moved from the
    // now-folded-in @mcp-use/devkit package) need more headroom than the rest
    // of this package's tests.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
