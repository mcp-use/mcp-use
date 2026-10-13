/**
 * Authentication Test Helpers
 *
 * Helper functions for testing authentication flows in the inspector.
 *
 * Two surfaces edit custom headers:
 * - The dashboard connect form opens a "Custom Headers" dialog
 *   (connection-form-headers-button) that closes via its own Save button.
 * - The Connection Settings tab renders the headers editor inline and saves
 *   through the tab header's Save button (connection-form-save-button).
 */

import { expect, type Page } from "@playwright/test";

const INSPECTOR_URL = "http://localhost:3000/inspector";

/**
 * Add a custom header through the dashboard connect form's headers dialog.
 * Leaves the dialog closed and the header staged for the next Connect.
 */
export async function addCustomHeaderInConnectForm(
  page: Page,
  name: string,
  value: string
): Promise<void> {
  await page.getByTestId("connection-form-headers-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("custom-headers-add-button").click();
  const index =
    (await dialog.getByTestId(/^custom-header-row-\d+$/).count()) - 1;
  await dialog.getByTestId(`custom-header-name-${index}`).fill(name);
  await dialog.getByTestId(`custom-header-value-${index}`).fill(value);
  await dialog.getByTestId("custom-headers-save-button").click();
  await expect(dialog).not.toBeVisible();
}

/**
 * Add a custom header on the Connection Settings tab (inline editor) and save
 * the connection options. Assumes the tab is already open.
 */
export async function addCustomHeaderInSettingsTab(
  page: Page,
  name: string,
  value: string
): Promise<void> {
  await page.getByTestId("custom-headers-add-button").click();
  const index = (await page.getByTestId(/^custom-header-row-\d+$/).count()) - 1;
  await page.getByTestId(`custom-header-name-${index}`).fill(name);
  await page.getByTestId(`custom-header-value-${index}`).fill(value);
  await page.getByTestId("connection-form-save-button").click();
  await expect(
    page.getByText("Connection settings updated").first()
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Return to the dashboard with client-side navigation and wait for the server
 * to become ready.
 *
 * Saving connection options remounts the connection with the new settings,
 * but the "Connection settings updated" toast fires before the update is
 * awaited and persisted. A full page load at that moment restores the stale
 * stored config (without the new headers), so navigate in-app instead.
 */
export async function returnToDashboardAndWaitReady(
  page: Page,
  serverName: string
): Promise<void> {
  await page.getByRole("link", { name: /mcp-use.*Inspector/ }).click();
  await waitForServerState(page, serverName, "ready", 20000);
}

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

  if (withAuth) {
    await addCustomHeaderInConnectForm(
      page,
      "Authorization",
      `Bearer ${apiKey}`
    );
  }

  await page.getByTestId("connection-form-url-input").fill(serverUrl);
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

  if (withAuth) {
    await addCustomHeaderInConnectForm(page, headerName, headerValue);
  }

  await page.getByTestId("connection-form-url-input").fill(serverUrl);
  await page.getByTestId("connection-form-connect-button").click();
}

/**
 * Pre-register OAuth client credentials in the connect form's Authentication
 * dialog. Servers whose authorization server does not offer dynamic client
 * registration (Google, most mocks) need this before Connect, otherwise the
 * client fails with "does not support dynamic client registration".
 */
export async function fillOAuthClientCredentials(
  page: Page,
  options: { clientId: string; clientSecret?: string; scope?: string }
): Promise<void> {
  await page.getByTestId("connection-form-auth-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByTestId("auth-dialog-client-id-input")
    .fill(options.clientId);
  if (options.clientSecret !== undefined) {
    await dialog
      .getByTestId("auth-dialog-client-secret-input")
      .fill(options.clientSecret);
  }
  if (options.scope !== undefined) {
    await dialog.getByTestId("auth-dialog-scope-input").fill(options.scope);
  }
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).not.toBeVisible();
}

/**
 * Connect to an OAuth server. Static client credentials are registered first
 * when provided.
 */
export async function connectToOAuthServer(
  page: Page,
  _provider: string,
  port: number,
  options: { clientId?: string; clientSecret?: string } = {}
) {
  const serverUrl = `http://localhost:${port}/mcp`;

  if (options.clientId) {
    await fillOAuthClientCredentials(page, {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
  }

  await page.getByTestId("connection-form-url-input").fill(serverUrl);
  await page.getByTestId("connection-form-connect-button").click();
}

/**
 * Open the Connection Settings tab for a server from its dashboard tile.
 */
export async function openConnectionSettings(page: Page, serverUrl: string) {
  await page.goto(INSPECTOR_URL);
  await page.getByTestId("server-tile-settings").click();
  await expect(page.getByTestId("connection-form-url-input")).toBeVisible();
  await expect(page.getByTestId("connection-form-url-input")).toHaveValue(
    serverUrl
  );
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
 * Locate the authenticate button for a server
 */
export async function clickAuthenticateButton(page: Page) {
  const authenticateButton = page.getByTestId("server-tile-authenticate");
  await expect(authenticateButton).toBeVisible({ timeout: 5000 });
  return authenticateButton;
}

/**
 * Execute a tool to verify authenticated access
 */
export async function executeToolAndVerifyAuth(
  page: Page,
  toolName: string,
  expectedMessage?: string
) {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("tool-execution-execute-button")).toBeVisible();
  await page.getByTestId("tool-execution-execute-button").click();
  await expect(
    page.getByTestId("tool-execution-results-text-content")
  ).toBeVisible({ timeout: 10000 });

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
  // The inspector restores the last active tab (e.g. Connection Settings
  // after editing auth); select Tools explicitly.
  await page.locator('[data-testid="tab-tools"]:visible').click();
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
}

/**
 * Reconnect to a server from its dashboard tile
 */
export async function reconnectServer(page: Page, _serverUrl: string) {
  await page.goto(INSPECTOR_URL);
  await page.getByTestId("server-tile-reconnect").click();
}
