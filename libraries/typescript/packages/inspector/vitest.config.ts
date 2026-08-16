import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
    // Matches agent, client, cli and server. These cases mount a server and
    // decompress the bundled app, so a CI runner regularly needs several times
    // the local wall clock for them.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
