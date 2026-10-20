import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration suites start real HTTP servers on ephemeral ports; the
    // in-process analytics state is per file, so files may run in parallel.
    pool: "forks",
    env: {
      // Never reach a real ingest endpoint or third-party telemetry from tests.
      MANUFACT_ANALYTICS_KEY: "",
      MANUFACT_ANALYTICS_URL: "http://127.0.0.1:9",
      MANUFACT_ANALYTICS_DISABLED: "",
      SKYBRIDGE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
    },
  },
});
