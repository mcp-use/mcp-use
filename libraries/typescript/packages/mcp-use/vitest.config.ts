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
    env: {
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
});
