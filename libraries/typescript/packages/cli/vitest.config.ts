import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
    globalSetup: ["tests/cli/global-setup.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
