import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/deno/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/index.ts"],
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      "@": "./src",
      // Stub the inspector package for tests to avoid build errors
      // The server code uses dynamic imports with try-catch, so this won't affect runtime
      "@mcp-use/inspector": "./tests/helpers/inspector-stub.js",
    },
  },
  optimizeDeps: {
    exclude: ["@mcp-use/inspector"],
  },
});
