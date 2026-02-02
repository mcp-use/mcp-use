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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
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
