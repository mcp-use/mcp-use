import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  define: {
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(version),
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup/browser-storage.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
    },
  },
});
