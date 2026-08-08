import { expect, type Page } from "@playwright/test";

import { getTestMatrix } from "./test-matrix";

// CI environments (Docker/xvfb) need longer timeouts due to slower rendering
const CI_MULTIPLIER = process.env.CI ? 3 : 1;

/**
 * Wait for HMR reload to propagate. Use after modifying server or view files.
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
 * Wait for the conformance tools used by view tests to be visible.
 *
 * @param page - Playwright page object
 * @param options - Optional configuration
 * @param options.skipIfMissing - If true, silently skip if the tools are not found
 */
export async function waitForViewTools(
  page: Page,
  options?: { skipIfMissing?: boolean }
) {
  const skipIfMissing = options?.skipIfMissing ?? false;

  if (skipIfMissing) {
    // HMR tests can start from a temporarily incomplete server definition.
    try {
      await expect(
        page.getByTestId("tool-item-get-weather-delayed")
      ).toBeVisible({
        timeout: 2000 * CI_MULTIPLIER,
      });
      await expect(
        page.getByTestId("tool-item-apps-sdk-only-card")
      ).toBeVisible({
        timeout: 2000 * CI_MULTIPLIER,
      });
    } catch {
      // Tools not present, continue anyway.
    }
  } else {
    await expect(page.getByTestId("tool-item-get-weather-delayed")).toBeVisible(
      {
        timeout: 10000 * CI_MULTIPLIER,
      }
    );
    await expect(page.getByTestId("tool-item-apps-sdk-only-card")).toBeVisible({
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

  await waitForViewTools(page);
}

/**
 * Navigate to inspector with autoConnect and ensure the Tools tab is open.
 * Works across all test matrix configurations by using getTestMatrix() for URLs.
 *
 * @param page - Playwright page object
 * @param options - Optional configuration
 * @param options.waitForViews - Whether to wait for view-related tools (default: false for HMR tests)
 */
export async function goToInspectorWithAutoConnectAndOpenTools(
  page: Page,
  options?: { waitForViews?: boolean }
) {
  const { inspectorUrl, serverUrl, usesBuiltinInspector } = getTestMatrix();
  const waitForViews = options?.waitForViews ?? false;
  const url = `${inspectorUrl}?autoConnect=${encodeURIComponent(serverUrl)}`;
  await page.goto(usesBuiltinInspector ? inspectorUrl : url);
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();

  if (waitForViews) {
    await waitForViewTools(page);
  }
}

/**
 * Simulate the hosted inspector (e.g. inspector.manufact.com) by injecting the
 * runtime `window.__MANUFACT_CHAT_URL__` the server normally bakes in. This
 * flips the Chat tab to route through the managed cloud backend at `chatApiUrl`.
 *
 * Must be called before navigating to the inspector. Returns a list that
 * records every request made to the cloud chat endpoint, so tests can assert
 * whether (or not) chat was routed there.
 */
export async function enableHostedChatMode(
  page: Page,
  cloudChatUrl: string,
  opts?: { mockLlmProxy?: boolean | "login-required" | "success" }
): Promise<{
  calls: string[];
  llmCalls: string[];
  llmAuthorizations: string[];
}> {
  await page.addInitScript((url) => {
    (
      window as unknown as { __MANUFACT_CHAT_URL__?: string }
    ).__MANUFACT_CHAT_URL__ = url;
  }, cloudChatUrl);

  // Record + short-circuit any call to the cloud endpoint so the test never
  // depends on a real backend and a regression surfaces immediately.
  const calls: string[] = [];
  const llmCalls: string[] = [];
  const llmAuthorizations: string[] = [];
  await page.route(`${cloudChatUrl}**`, async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ status: 502, body: "Bad Gateway" });
  });

  if (opts?.mockLlmProxy) {
    const llmBase = cloudChatUrl.replace(/\/chat\/stream\/?$/, "/llm");
    await page.route(`${llmBase}/**`, async (route) => {
      llmCalls.push(route.request().url());
      llmAuthorizations.push(
        (await route.request().allHeaders()).authorization ?? ""
      );
      if (opts.mockLlmProxy === "login-required") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            error: "rate_limited",
            loginRequired: true,
            loginUrl: "https://manufact.com/login",
          }),
        });
        return;
      }
      const sse = [
        'data: {"choices":[{"delta":{"content":"4"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse,
      });
    });
  }

  // Hosted identity discovers the cloud OAuth provider on mount. Stub an
  // anonymous provider so tests never reach the real cloud backend.
  const cloudOrigin = new URL(cloudChatUrl).origin;
  await page.route(`${cloudOrigin}/api/auth/get-session**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "null",
    });
  });
  await page.route(
    `${cloudOrigin}/api/auth/.well-known/openid-configuration**`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          authorization_endpoint: `${cloudOrigin}/api/auth/oauth2/authorize`,
          token_endpoint: `${cloudOrigin}/api/auth/oauth2/token`,
          userinfo_endpoint: `${cloudOrigin}/api/auth/oauth2/userinfo`,
          registration_endpoint: `${cloudOrigin}/api/auth/oauth2/register`,
        }),
      });
    }
  );

  return { calls, llmCalls, llmAuthorizations };
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
