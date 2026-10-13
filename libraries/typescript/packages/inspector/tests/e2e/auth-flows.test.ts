/**
 * Authentication Flows E2E Tests
 *
 * Tests for API Key, Custom Header, and OAuth authentication flows in the inspector.
 *
 * The fixture servers are started by this file's beforeAll hook:
 * 1. API Key server: Port 3003
 * 2. Custom Header server: Port 3004
 * 3. OAuth mock servers: issuers on 3005-3008, MCP servers on 3105-3108
 *    (Linear, Supabase, GitHub, Vercel)
 *
 * They share fixed ports, so this file runs in a single worker.
 *
 * Until initialize succeeds the inspector does not know the server name, so
 * failed and pending-auth tiles are headed by the server URL.
 */

import { expect, test } from "@playwright/test";
import {
  addCustomHeaderInSettingsTab,
  returnToDashboardAndWaitReady,
  connectToApiKeyServer,
  connectToCustomHeaderServer,
  connectToOAuthServer,
  clickAuthenticateButton,
  executeToolAndVerifyAuth,
  navigateToServerTools,
  openConnectionSettings,
  waitForServerState,
} from "./helpers/auth";
import { AuthServersManager } from "./fixtures/auth-servers.js";

// Fixed ports mean the fixtures cannot be shared across parallel workers:
// "default" keeps this file in one worker (overriding fullyParallel) without
// serial's skip-the-rest-after-a-failure behaviour.
test.describe.configure({ mode: "default" });

let authServers: AuthServersManager;

// oauth2-mock-server issuers have no registration endpoint and accept any
// client id at /authorize, so register a static client before connecting.
const MOCK_OAUTH_CLIENT = { clientId: "test-client" };

test.beforeAll(async () => {
  authServers = new AuthServersManager();
  await authServers.startAll();
});

test.afterAll(async () => {
  await authServers?.stopAll();
});

test.describe("API Key Authentication", () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show auth error when connecting without API key", async ({
    page,
  }) => {
    // Connect without authentication
    await connectToApiKeyServer(page, { withAuth: false });

    // Verify server appears but is in failed/pending_auth state
    await expect(
      page.getByRole("heading", { name: "http://localhost:3003/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Check for failed or pending_auth status
    const statusBadge = page.locator('[data-testid*="server-tile-status-"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });

    // Verify error message mentions authentication
    const serverTile = page.getByTestId("server-tile-error");
    await expect(serverTile).toContainText(
      /401|Unauthorized|Missing Authorization|API key|metadata|Registration/i,
      {
        timeout: 5000,
      }
    );
  });

  test("should connect successfully with API key at connection time", async ({
    page,
  }) => {
    // Connect with API key header
    await connectToApiKeyServer(page, { withAuth: true });

    // Verify server appears and reaches ready state
    await expect(
      page.getByRole("heading", { name: "ApiKeyTestServer" })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should execute tools with valid API key", async ({ page }) => {
    // Connect with authentication
    await connectToApiKeyServer(page, { withAuth: true });

    // Wait for ready state
    await expect(
      page.getByRole("heading", { name: "ApiKeyTestServer" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });

    // Navigate to tools
    await navigateToServerTools(page, "http://localhost:3003/mcp");

    // Execute verify_auth tool
    await executeToolAndVerifyAuth(
      page,
      "verify_auth",
      "Authentication successful"
    );
  });

  test("should fail with invalid API key", async ({ page }) => {
    // Connect with wrong API key
    await connectToApiKeyServer(page, {
      withAuth: true,
      apiKey: "wrong-key",
    });

    // Verify server shows auth error
    await expect(
      page.getByRole("heading", { name: "http://localhost:3003/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Should not reach ready state
    await expect(page.getByTestId("server-tile-status-ready")).not.toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Custom Header Authentication", () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show auth error when connecting without custom header", async ({
    page,
  }) => {
    // Connect without authentication
    await connectToCustomHeaderServer(page, { withAuth: false });

    // Verify server appears but is in failed state
    await expect(
      page.getByRole("heading", { name: "http://localhost:3004/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Check for failed status or auth error
    const statusBadge = page.locator('[data-testid*="server-tile-status-"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });

    // Verify error message mentions custom header
    const serverTile = page.getByTestId("server-tile-error");
    await expect(serverTile).toContainText(
      /401|Unauthorized|Missing.*header|X-Custom-Auth|metadata|Registration/i,
      {
        timeout: 5000,
      }
    );
  });

  test("should connect successfully with custom header at connection time", async ({
    page,
  }) => {
    // Connect with custom header
    await connectToCustomHeaderServer(page, { withAuth: true });

    // Verify server appears and reaches ready state
    await expect(
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should execute tools with valid custom header", async ({ page }) => {
    // Connect with authentication
    await connectToCustomHeaderServer(page, { withAuth: true });

    // Wait for ready state
    await expect(
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });

    // Navigate to tools
    await navigateToServerTools(page, "http://localhost:3004/mcp");

    // Execute verify_auth tool
    await executeToolAndVerifyAuth(
      page,
      "verify_auth",
      "Authentication successful"
    );
  });

  test("should fail with invalid custom header value", async ({ page }) => {
    // Connect with wrong token
    await connectToCustomHeaderServer(page, {
      withAuth: true,
      headerValue: "wrong-token",
    });

    // Verify server shows auth error
    await expect(
      page.getByRole("heading", { name: "http://localhost:3004/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Should not reach ready state
    await expect(page.getByTestId("server-tile-status-ready")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("should fail with wrong custom header name", async ({ page }) => {
    // Connect with wrong header name
    await connectToCustomHeaderServer(page, {
      withAuth: true,
      headerName: "X-Wrong-Header",
    });

    // Verify server shows auth error
    await expect(
      page.getByRole("heading", { name: "http://localhost:3004/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Should not reach ready state
    await expect(page.getByTestId("server-tile-status-ready")).not.toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("OAuth Authentication - Linear", () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show authenticate button for OAuth server", async ({ page }) => {
    // Connect to Linear OAuth server (port 3105 = 3005 + 100)
    await connectToOAuthServer(page, "linear", 3105, MOCK_OAUTH_CLIENT);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "http://localhost:3105/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Should show pending_auth or authenticating state
    const statusBadge = page.locator('[data-testid*="server-tile-status-"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });

    // Authenticate button should be visible
    const authenticateButton = page.getByTestId("server-tile-authenticate");
    await expect(authenticateButton).toBeVisible({ timeout: 5000 });
  });

  test.skip("should complete OAuth flow and reach ready state", async ({
    page,
  }) => {
    // This test requires proper OAuth flow simulation
    // Skip for now until oauth2-mock-server integration is complete

    await connectToOAuthServer(page, "linear", 3105, MOCK_OAUTH_CLIENT);

    // Wait for authenticate button
    const authenticateButton = await clickAuthenticateButton(page);

    // In a real test, we would:
    // 1. Click the authenticate button
    // 2. Handle the OAuth popup/redirect
    // 3. Complete the OAuth flow
    // 4. Verify the server reaches ready state

    // For now, just verify the button appears
    expect(authenticateButton).toBeTruthy();
  });
});

test.describe("OAuth Authentication - Supabase", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show authenticate button for Supabase OAuth", async ({
    page,
  }) => {
    // Connect to Supabase OAuth server (port 3106 = 3006 + 100)
    await connectToOAuthServer(page, "supabase", 3106, MOCK_OAUTH_CLIENT);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "http://localhost:3106/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Authenticate button should be visible
    await expect(page.getByTestId("server-tile-authenticate")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("OAuth Authentication - GitHub", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show authenticate button for GitHub OAuth", async ({ page }) => {
    // Connect to GitHub OAuth server (port 3107 = 3007 + 100)
    await connectToOAuthServer(page, "github", 3107, MOCK_OAUTH_CLIENT);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "http://localhost:3107/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Authenticate button should be visible
    await expect(page.getByTestId("server-tile-authenticate")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("OAuth Authentication - Vercel", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should show authenticate button for Vercel OAuth", async ({ page }) => {
    // Connect to Vercel OAuth server (port 3108 = 3008 + 100)
    await connectToOAuthServer(page, "vercel", 3108, MOCK_OAUTH_CLIENT);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "http://localhost:3108/mcp" })
    ).toBeVisible({ timeout: 10000 });

    // Authenticate button should be visible
    await expect(page.getByTestId("server-tile-authenticate")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Authentication - Add after connection", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
  });

  test("should allow adding API key after initial failed connection", async ({
    page,
  }) => {
    const serverUrl = "http://localhost:3003/mcp";

    // Connect without auth and land in a non-ready state
    await connectToApiKeyServer(page, { withAuth: false });
    await expect(
      page.getByRole("heading", { name: "http://localhost:3003/mcp" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("server-tile-status-ready")).not.toBeVisible({
      timeout: 5000,
    });

    // Add the Authorization header on the Connection Settings tab and save.
    // Saving reconnects with the new headers.
    await openConnectionSettings(page, serverUrl);
    await addCustomHeaderInSettingsTab(
      page,
      "Authorization",
      "Bearer test-api-key-12345"
    );

    // Saving remounts the connection with the header; wait for it in-app.
    await returnToDashboardAndWaitReady(page, "ApiKeyTestServer");

    await navigateToServerTools(page, serverUrl);
    await executeToolAndVerifyAuth(
      page,
      "verify_auth",
      "Authentication successful"
    );
  });

  test("should allow adding custom header after initial failed connection", async ({
    page,
  }) => {
    const serverUrl = "http://localhost:3004/mcp";

    await connectToCustomHeaderServer(page, { withAuth: false });
    await expect(
      page.getByRole("heading", { name: "http://localhost:3004/mcp" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("server-tile-status-ready")).not.toBeVisible({
      timeout: 5000,
    });

    await openConnectionSettings(page, serverUrl);
    await addCustomHeaderInSettingsTab(
      page,
      "X-Custom-Auth",
      "custom-auth-token-xyz"
    );

    await returnToDashboardAndWaitReady(page, "CustomHeaderTestServer");

    await navigateToServerTools(page, serverUrl);
    await executeToolAndVerifyAuth(page, "verify_auth");
  });
});
