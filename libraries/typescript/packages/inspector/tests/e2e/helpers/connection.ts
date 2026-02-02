import { expect, type Page } from "@playwright/test";

import { getTestMatrix } from "./test-matrix";

/**
 * Wait for HMR reload to propagate. Use after modifying server or widget files.
 * Gives the dev server time to rebuild and the Inspector time to reflect changes.
 */
export async function waitForHMRReload(
  page: Page,
  options?: { minMs?: number }
): Promise<void> {
  const minMs = options?.minMs ?? 2500;
  await page.waitForTimeout(minMs);
}

/**
 * Connect to the conformance test server
 * This helper can be used in beforeEach or beforeAll hooks
 */
export async function connectToConformanceServer(page: Page) {
  const { serverUrl } = getTestMatrix();
  const serverName = process.env.TEST_SERVER_NAME || "ConformanceTestServer";

  await expect(
    page.getByRole("heading", { name: "Connect", exact: true })
  ).toBeVisible();
  await page.getByTestId("connection-form-url-input").fill(serverUrl);
  await page.getByTestId("connection-form-connect-button").click();

  await expect(page.getByRole("heading", { name: serverName })).toBeVisible();
  await expect(page.getByTestId("server-tile-status-ready")).toBeVisible();
}

/**
 * Navigate to the Tools tab for the connected server
 */
export async function navigateToTools(page: Page) {
  const { serverUrl } = getTestMatrix();
  await page.getByTestId(`server-tile-${serverUrl}`).click();
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();
}

/** Inspector and MCP server URLs when running builtin dev (HMR) — both on port 3000. */
const BUILTIN_DEV_INSPECTOR_URL = "http://localhost:3000/inspector";
const BUILTIN_DEV_SERVER_URL = "http://localhost:3000/mcp";

/**
 * For builtin inspector (TEST_SERVER_MODE=builtin-dev): navigate with autoConnect
 * and ensure the Tools tab is open. Use in HMR tests only; inspector and server
 * are both on port 3000 in this setup.
 */
export async function goToInspectorWithAutoConnectAndOpenTools(page: Page) {
  const url = `${BUILTIN_DEV_INSPECTOR_URL}?autoConnect=${encodeURIComponent(BUILTIN_DEV_SERVER_URL)}`;
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();
}
