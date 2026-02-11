import { expect, type Page } from "@playwright/test";

import { getTestMatrix } from "./test-matrix";

// CI environments (Docker/xvfb) need longer timeouts due to slower rendering
const CI_MULTIPLIER = process.env.CI ? 3 : 1;

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
 * Pre-warm widgets by fetching their URLs to trigger Vite build.
 * This eliminates cold start delays when widgets are first rendered in tests.
 * Only runs when Vite dev server is active (TEST_SERVER_MODE=builtin-dev).
 */
export async function warmWidgets(
  page: Page,
  widgetNames: string[]
): Promise<void> {
  const { supportsHMR, serverUrl } = getTestMatrix();

  // Only warm widgets in dev mode with Vite
  if (!supportsHMR) {
    return;
  }

  // Extract base URL from server URL (remove /mcp path)
  const baseUrl = serverUrl.replace(/\/mcp$/, "");

  // Fetch each widget URL to trigger Vite transformation
  await Promise.all(
    widgetNames.map(async (widgetName) => {
      try {
        await page.request.get(
          `${baseUrl}/mcp-use/widgets/${widgetName}/index.html`,
          { timeout: 10000 * CI_MULTIPLIER }
        );
      } catch (e) {
        // Ignore errors - widget may not exist or build may fail
        // Tests will fail later if widget is actually broken
      }
    })
  );
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
 * Wait for widget tools to be registered on the server.
 * Widget tools are auto-registered from the resources/ directory.
 * This prevents race conditions where tests run before widgets finish registering.
 *
 * After HMR events (especially from other tests), widget tools may not be immediately
 * available. This function handles that by:
 * 1. First waiting briefly for widgets to appear
 * 2. If not found, reloading the page to get fresh tools list
 * 3. Then waiting again with full timeout
 *
 * @param page - Playwright page object
 * @param options - Optional configuration
 * @param options.skipIfMissing - If true, silently skip if widgets are not found (default: false)
 */
export async function waitForWidgetTools(
  page: Page,
  options?: { skipIfMissing?: boolean }
) {
  const skipIfMissing = options?.skipIfMissing ?? false;

  if (skipIfMissing) {
    // Try to wait for widgets, but don't fail if they're not present
    // This is useful for HMR tests that start with a minimal server configuration
    try {
      await expect(
        page.getByTestId("tool-item-apps-sdk-only-card")
      ).toBeVisible({
        timeout: 2000 * CI_MULTIPLIER,
      });
      await expect(page.getByTestId("tool-item-display-info")).toBeVisible({
        timeout: 2000 * CI_MULTIPLIER,
      });
    } catch {
      // Widgets not present, continue anyway
    }
  } else {
    // Wait for auto-registered widget tools to appear
    // These are registered asynchronously after the server starts
    await expect(page.getByTestId("tool-item-apps-sdk-only-card")).toBeVisible({
      timeout: 10000 * CI_MULTIPLIER,
    });
    await expect(page.getByTestId("tool-item-display-info")).toBeVisible({
      timeout: 10000 * CI_MULTIPLIER,
    });
  }
}

/**
 * Navigate to the Tools tab for the connected server
 */
export async function navigateToTools(page: Page) {
  const { serverUrl } = getTestMatrix();
  await page.getByTestId(`server-tile-${serverUrl}`).click();
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();

  // Wait for widget tools to be registered to avoid race conditions
  await waitForWidgetTools(page);
}

/**
 * Navigate to inspector with autoConnect and ensure the Tools tab is open.
 * Works across all test matrix configurations by using getTestMatrix() for URLs.
 *
 * @param page - Playwright page object
 * @param options - Optional configuration
 * @param options.waitForWidgets - Whether to wait for widget tools (default: false for HMR tests)
 */
export async function goToInspectorWithAutoConnectAndOpenTools(
  page: Page,
  options?: { waitForWidgets?: boolean }
) {
  const { inspectorUrl, serverUrl } = getTestMatrix();
  const waitForWidgets = options?.waitForWidgets ?? false;
  const url = `${inspectorUrl}?autoConnect=${encodeURIComponent(serverUrl)}`;
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();

  // Wait for widget tools to be registered if requested (ui-widgets tests)
  // HMR tests skip this since they start with a minimal server
  if (waitForWidgets) {
    await waitForWidgetTools(page);
  }
}

/**
 * Configure LLM API key for sampling/chat features.
 * Reusable across chat and sampling tests.
 */
export async function configureLLMAPI(page: Page): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY || "";

  // Navigate to Chat tab
  await page.getByRole("tab", { name: /Chat/ }).first().click();
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

  // Click Configure API Key button
  await page.getByTestId("chat-configure-api-key-button").click();
  await expect(page.getByTestId("chat-config-dialog")).toBeVisible();

  // Enter API key
  await page.getByTestId("chat-config-api-key-input").fill(apiKey);
  await page.waitForTimeout(1000);

  // Select model
  await page.getByTestId("chat-config-model-select").click();
  const modelSearch = page.getByPlaceholder("Search models...");
  await expect(modelSearch).toBeVisible();
  await modelSearch.fill("gpt-5-nano");
  await page
    .getByRole("option", { name: /gpt-5-nano/ })
    .first()
    .click();

  // Save configuration
  await page.getByTestId("chat-config-save-button").click();
  await expect(page.getByTestId("chat-config-dialog")).not.toBeVisible();
}
