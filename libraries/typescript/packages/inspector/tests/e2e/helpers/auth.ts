/**
 * Authentication Test Helpers
 *
 * Helper functions for testing authentication flows in the inspector.
 */

import { expect, type Page } from "@playwright/test";

/**
 * Connect to API Key server with or without authentication
 */
export async function connectToApiKeyServer(
  page: Page,
  options: {
    withAuth?: boolean;
    apiKey?: string;
  } = {}
) {
  const { withAuth = false, apiKey = "test-api-key-12345" } = options;
  const serverUrl = "http://localhost:3003/mcp";

  // If withAuth, add the API key header before connecting
  if (withAuth) {
    await page.goto("http://localhost:3000/inspector");

    // Add custom header
    await page.getByTestId("connection-form-advanced-toggle").click();
    await page.getByTestId("custom-headers-add-button").click();

    // Fill in header name and value
    await page.getByTestId("custom-header-name-0").fill("Authorization");
    await page.getByTestId("custom-header-value-0").fill(`Bearer ${apiKey}`);
  }

  // Fill in the URL
  await page.getByTestId("connection-form-url-input").click();
  await page.getByTestId("connection-form-url-input").fill(serverUrl);

  // Click connect
  await page.getByTestId("connection-form-connect-button").click();
}

/**
 * Connect to Custom Header server with or without authentication
 */
export async function connectToCustomHeaderServer(
  page: Page,
  options: {
    withAuth?: boolean;
    headerName?: string;
    headerValue?: string;
  } = {}
) {
  const {
    withAuth = false,
    headerName = "X-Custom-Auth",
    headerValue = "custom-auth-token-xyz",
  } = options;
  const serverUrl = "http://localhost:3004/mcp";

  // If withAuth, add the custom header before connecting
  if (withAuth) {
    await page.goto("http://localhost:3000/inspector");

    // Add custom header
    await page.getByTestId("connection-form-advanced-toggle").click();
    await page.getByTestId("custom-headers-add-button").click();

    // Fill in header name and value
    await page.getByTestId("custom-header-name-0").fill(headerName);
    await page.getByTestId("custom-header-value-0").fill(headerValue);
  }

  // Fill in the URL
  await page.getByTestId("connection-form-url-input").click();
  await page.getByTestId("connection-form-url-input").fill(serverUrl);

  // Click connect
  await page.getByTestId("connection-form-connect-button").click();
}

/**
 * Connect to OAuth server
 */
export async function connectToOAuthServer(
  page: Page,
  provider: string,
  port: number
) {
  const serverUrl = `http://localhost:${port}/mcp`;

  // Navigate to inspector
  await page.goto("http://localhost:3000/inspector");

  // Fill in the URL
  await page.getByTestId("connection-form-url-input").click();
  await page.getByTestId("connection-form-url-input").fill(serverUrl);

  // Click connect
  await page.getByTestId("connection-form-connect-button").click();
}

/**
 * Add a custom header via the connection form
 */
export async function addCustomHeader(
  page: Page,
  name: string,
  value: string,
  index: number = 0
) {
  // Expand advanced settings if not already expanded
  const advancedToggle = page.getByTestId("connection-form-advanced-toggle");
  if (await advancedToggle.isVisible()) {
    await advancedToggle.click();
  }

  // Add header button if this is the first one
  if (index === 0) {
    const addButton = page.getByTestId("custom-headers-add-button");
    if (await addButton.isVisible()) {
      await addButton.click();
    }
  }

  // Fill in header
  await page.getByTestId(`custom-header-name-${index}`).fill(name);
  await page.getByTestId(`custom-header-value-${index}`).fill(value);
}

/**
 * Open connection settings for a server
 */
export async function openConnectionSettings(page: Page, serverUrl: string) {
  // Find and click the settings button for the server
  await page.getByTestId(`server-tile-settings-${serverUrl}`).click();
}

/**
 * Wait for server to reach a specific state
 */
export async function waitForServerState(
  page: Page,
  serverName: string,
  state: "ready" | "failed" | "pending_auth" | "authenticating",
  timeout: number = 10000
) {
  await expect(page.getByRole("heading", { name: serverName })).toBeVisible({
    timeout,
  });
  await expect(page.getByTestId(`server-tile-status-${state}`)).toBeVisible({
    timeout,
  });
}

/**
 * Click the authenticate button for a server
 */
export async function clickAuthenticateButton(page: Page) {
  const authenticateButton = page.getByTestId("server-tile-authenticate");
  await expect(authenticateButton).toBeVisible({ timeout: 5000 });
  return authenticateButton;
}

/**
 * Complete OAuth flow by clicking authenticate and handling the popup
 * For mock OAuth, we can intercept the redirect and complete it programmatically
 */
export async function completeOAuthFlow(page: Page, oauthHelper: any) {
  // Get the authenticate button
  const authenticateButton = await clickAuthenticateButton(page);

  // Get the authUrl from the button's href
  const authUrl = await authenticateButton.getAttribute("href");
  expect(authUrl).toBeTruthy();

  // For testing, we can generate a token and simulate the OAuth callback
  const token = await oauthHelper.generateToken();

  // Navigate to the OAuth callback URL with the token
  // The format depends on how the inspector handles OAuth callbacks
  // This is a simplified version - adjust based on actual implementation
  const _callbackUrl = `http://localhost:3000/inspector/oauth/callback?access_token=${token}&token_type=Bearer`;

  // Open auth URL in a new context to simulate popup
  const context = page.context();
  const authPage = await context.newPage();
  await authPage.goto(authUrl!);

  // The mock OAuth server should auto-approve and redirect
  // Wait for redirect to callback URL
  await authPage.waitForURL(/callback/, { timeout: 5000 });

  // Close the auth page
  await authPage.close();

  // Wait for the main page to update with the token
  await page.waitForTimeout(1000);
}

/**
 * Execute a tool to verify authenticated access
 */
export async function executeToolAndVerifyAuth(
  page: Page,
  toolName: string,
  expectedMessage?: string
) {
  // Click on the tool
  await page.getByTestId(`tool-item-${toolName}`).click();

  // Wait for execute button
  await expect(page.getByTestId("tool-execution-execute-button")).toBeVisible();

  // Execute the tool
  await page.getByTestId("tool-execution-execute-button").click();

  // Wait for results
  await expect(
    page.getByTestId("tool-execution-results-text-content")
  ).toBeVisible({ timeout: 10000 });

  // If expected message provided, verify it
  if (expectedMessage) {
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText(expectedMessage);
  }
}

/**
 * Navigate to a server's tools tab
 */
export async function navigateToServerTools(page: Page, serverUrl: string) {
  await page.getByTestId(`server-tile-${serverUrl}`).click();
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
}

/**
 * Reconnect to a server after adding authentication
 */
export async function reconnectServer(page: Page, serverUrl: string) {
  // Go back to home
  await page.goto("http://localhost:3000/inspector");

  // Find the server and click reconnect/retry
  await page.getByTestId(`server-tile-retry-${serverUrl}`).click();

  // Wait a moment for reconnection
  await page.waitForTimeout(1000);
}
