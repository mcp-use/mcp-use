import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for MCP Inspector E2E tests
 * @see https://playwright.dev/docs/test-configuration
 *
 * Environment variables:
 * - TEST_MODE=dev (default): Standalone inspector via pnpm dev
 * - TEST_MODE=production: Standalone inspector via pnpm build && pnpm start
 * - TEST_SERVER_MODE=external-built (default): Built server at :3002, standalone inspector at :3000
 * - TEST_SERVER_MODE=builtin-dev: Server dev at :3000 with builtin inspector (for HMR)
 * - TEST_SERVER_MODE=remote: Remote server via TEST_SERVER_URL
 * - TEST_SERVER_URL: Custom MCP endpoint URL (optional)
 */

// Disable telemetry during test runs
process.env.MCP_USE_ANONYMIZED_TELEMETRY = "false";

const testMode = process.env.TEST_MODE || "dev";
const serverMode = process.env.TEST_SERVER_MODE || "external-built";

const { baseURL, webServer } = (() => {
  if (serverMode === "builtin-dev") {
    // Config 3: Server dev with builtin inspector (same port 3000)
    return {
      baseURL: "http://localhost:3000/inspector",
      webServer: undefined, // Must start server manually
    };
  }

  // Config 1/2: Standalone inspector at :3000, server at :3002
  return {
    baseURL: "http://localhost:3000/inspector",
    webServer:
      testMode === "production"
        ? {
            command: "pnpm start",
            url: "http://localhost:3000/inspector",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          }
        : {
            command: "pnpm dev",
            url: "http://localhost:3000/inspector",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
  };
})();

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests share a single MCP server, so they must run serially to avoid interference
  // (e.g., HMR tests modify server files, tool calls can change server state)
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 90_000, // 90 seconds per test (chat tests with LLM can be slow)
  // CI environments (Docker/xvfb) need longer timeouts due to slower rendering
  expect: {
    timeout: process.env.CI ? 15_000 : 5_000, // Default expect timeout (3x for CI)
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Slow down actions in CI for more reliable iframe interactions
    ...(process.env.CI && { actionTimeout: 10_000 }),
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
  ],

  webServer,
});
