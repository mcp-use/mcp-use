import { defineConfig } from "vitest/config";

// Scenario suite E0-E21. Target from E2E_TARGET=local|manufact, fixture from
// E2E_FIXTURE_DIR. Scenario files share one target each and run serially.
export default defineConfig({
  test: {
    include: ["scenarios/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "e2e-results.xml" },
  },
});
