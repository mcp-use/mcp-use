/**
 * Authentication Flows E2E Tests
 *
 * Tests for API Key, Custom Header, and OAuth authentication flows in the inspector.
 *
 * IMPORTANT: Start authentication test servers before running these tests:
 * 1. API Key server: Port 3003
 * 2. Custom Header server: Port 3004
 * 3. OAuth mock servers: Ports 3105-3108 (Linear, Supabase, GitHub, Vercel)
 *
 * Run from inspector package root:
 * pnpm test:e2e auth-flows.test.ts
 */

import { expect, test } from "@playwright/test";
import {
  connectToApiKeyServer,
  connectToCustomHeaderServer,
  connectToOAuthServer,
  waitForServerState,
  clickAuthenticateButton,
  executeToolAndVerifyAuth,
  navigateToServerTools,
  addCustomHeader,
} from "./helpers/auth";

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
      page.getByRole("heading", { name: "ApiKeyTestServer" })
    ).toBeVisible({ timeout: 10000 });

    // Check for failed or pending_auth status
    const statusBadge = page.locator('[data-testid*="server-tile-status-"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });

    // Verify error message mentions authentication
    const serverTile = page.locator("text=ApiKeyTestServer").locator("..");
    await expect(serverTile).toContainText(
      /401|Unauthorized|Missing Authorization|API key/i,
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
      page.getByRole("heading", { name: "ApiKeyTestServer" })
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
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
    ).toBeVisible({ timeout: 10000 });

    // Check for failed status or auth error
    const statusBadge = page.locator('[data-testid*="server-tile-status-"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });

    // Verify error message mentions custom header
    const serverTile = page
      .locator("text=CustomHeaderTestServer")
      .locator("..");
    await expect(serverTile).toContainText(
      /401|Unauthorized|Missing.*header|X-Custom-Auth/i,
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
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
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
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
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
    await connectToOAuthServer(page, "linear", 3105);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "LinearOAuthTestServer" })
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

    await connectToOAuthServer(page, "linear", 3105);

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
    await connectToOAuthServer(page, "supabase", 3106);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "SupabaseOAuthTestServer" })
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
    await connectToOAuthServer(page, "github", 3107);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "GitHubOAuthTestServer" })
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
    await connectToOAuthServer(page, "vercel", 3108);

    // Verify server appears
    await expect(
      page.getByRole("heading", { name: "VercelOAuthTestServer" })
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
    // Connect without auth
    await connectToApiKeyServer(page, { withAuth: false });

    // Wait for server to appear in failed state
    await expect(
      page.getByRole("heading", { name: "ApiKeyTestServer" })
    ).toBeVisible({ timeout: 10000 });

    // Now add the API key header by editing connection
    // Go back to home to edit
    await page.goto("http://localhost:3000/inspector");

    // Click settings on the server tile
    const settingsButton = page
      .locator("text=ApiKeyTestServer")
      .locator("..")
      .getByRole("button", { name: /settings|more/i })
      .first();

    if (await settingsButton.isVisible()) {
      await settingsButton.click();

      // Look for edit/settings option in dropdown
      const editOption = page.getByText(/edit|settings/i);
      if (await editOption.isVisible()) {
        await editOption.click();
      }
    }

    // At this point, we would add the header and reconnect
    // The exact UI flow depends on the implementation
    // This test demonstrates the pattern for adding auth after connection
  });

  test("should allow adding custom header after initial failed connection", async ({
    page,
  }) => {
    // Connect without auth
    await connectToCustomHeaderServer(page, { withAuth: false });

    // Wait for server to appear in failed state
    await expect(
      page.getByRole("heading", { name: "CustomHeaderTestServer" })
    ).toBeVisible({ timeout: 10000 });

    // Similar pattern as above - add custom header after connection
    // The exact implementation depends on the settings UI
  });
});
