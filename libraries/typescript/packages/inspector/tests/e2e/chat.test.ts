import { expect, test } from "@playwright/test";
import {
  configureLLMAPI,
  connectToConformanceServer,
  enableHostedChatMode,
  goToInspectorWithAutoConnectAndOpenTools,
  navigateToTools,
} from "./helpers/connection";
import { getTestMatrix } from "./helpers/test-matrix";

test.describe("Inspector Chat Tests", () => {
  // Note: To run these tests with a real MCP server:
  // 1. cd packages/server/examples/conformance
  // 2. pnpm build && pnpm start --port 3002
  // 3. Ensure you have OPENAI_API_KEY in your .env file
  // Then run: pnpm test:e2e tests/e2e/chat.test.ts
  //
  // Tests run sequentially to avoid interference between chat sessions

  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForWidgets: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());

      // Connect to server using helper
      await connectToConformanceServer(page);

      // Navigate to Tools tab
      await navigateToTools(page);
    }

    // Configure LLM API
    await configureLLMAPI(page);

    // Verify chat landing page appears after configuration
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
  });

  test("should send message and receive response, then send followup", async ({
    page,
    context,
  }) => {
    // Type initial message
    await page.getByTestId("chat-input").fill("What is 2+2?");

    // Send message
    await page.getByTestId("chat-send-button").click();

    // Verify user message appears
    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });
    await expect(
      page.getByTestId("chat-message-content").first()
    ).toContainText("What is 2+2?");

    // Verify assistant response appears
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });

    // Wait for response to complete (no loading state)
    await page.waitForTimeout(2000);

    // Send followup message
    await page.getByTestId("chat-input").fill("What about 3+3?");
    await page.getByTestId("chat-send-button").click();

    // Verify followup user message appears (should be second user message)
    const userMessages = page.getByTestId("chat-message-user");
    await expect(userMessages).toHaveCount(2, { timeout: 3000 });

    // Verify assistant responds to followup
    const assistantMessages = page.getByTestId("chat-message-assistant");
    await expect(assistantMessages).toHaveCount(2, { timeout: 15000 });
  });

  test("should attach file and send with message", async ({
    page,
    context,
  }) => {
    // Create a test image file
    const testImageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    // Click attach button to open file picker
    await page.getByTestId("chat-attach-button").click();

    // Upload file using setInputFiles
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "test-image.png",
      mimeType: "image/png",
      buffer: testImageBuffer,
    });

    // Verify attachment preview appears
    await expect(page.getByTestId("chat-attachment-0")).toBeVisible();

    // Type message with attachment
    await page.getByTestId("chat-input").fill("What's in this image?");

    // Send message with attachment
    await page.getByTestId("chat-send-button").click();

    // Verify user message appears with attachment
    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });

    // Verify assistant response appears
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });
  });

  test("should select prompt and send without additional message", async ({
    page,
    context,
  }) => {
    // Type "/" to trigger prompts dropdown
    await page.getByTestId("chat-input").fill("/");

    // Verify dropdown appears
    await expect(page.getByTestId("chat-prompts-dropdown")).toBeVisible();

    // Select first prompt
    await page.getByTestId("chat-prompt-option-0").click();

    // Wait for dropdown to close
    await expect(page.getByTestId("chat-prompts-dropdown")).not.toBeVisible();

    // Click send button to submit the prompt
    await page.getByTestId("chat-send-button").click();

    // Verify user message appears
    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });

    // Verify assistant response appears
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });
  });

  test("should select prompt and add additional message", async ({
    page,
    context,
  }) => {
    // Type "/" to trigger prompts dropdown
    await page.getByTestId("chat-input").fill("/");

    // Verify dropdown appears
    await expect(page.getByTestId("chat-prompts-dropdown")).toBeVisible();

    // Select first prompt
    await page.getByTestId("chat-prompt-option-0").click();

    // Add additional message after prompt
    await page
      .getByTestId("chat-input")
      .fill("Also explain why this is important");

    // Send
    await page.getByTestId("chat-send-button").click();

    // Verify user messages appear (they might appear at slightly different times)
    const userMessages = page.getByTestId("chat-message-user");
    await expect(userMessages.first()).toBeVisible({ timeout: 3000 });

    // Wait for second user message (the additional message)
    await expect(userMessages).toHaveCount(2, { timeout: 5000 });

    // Verify assistant response appears
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });
  });

  test("should request tool call and verify execution", async ({
    page,
    context,
  }) => {
    // Ask LLM to use a specific tool
    await page
      .getByTestId("chat-input")
      .fill("Use the test_simple_text tool with message 'Hello from chat'");

    // Send message
    await page.getByTestId("chat-send-button").click();

    // Verify user message appears
    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });

    // Verify tool call appears in response
    await expect(
      page.getByTestId("chat-tool-call-test_simple_text")
    ).toBeVisible({ timeout: 20000 });

    // Verify tool result status is success
    await expect(
      page.getByTestId("chat-tool-call-status-result")
    ).toBeVisible();
  });

  test("should open tool drawer when clicking tool call", async ({
    page,
    context,
  }) => {
    // First, create a tool call to test the drawer
    await page
      .getByTestId("chat-input")
      .fill("Use the test_simple_text tool with message 'Drawer test'");
    await page.getByTestId("chat-send-button").click();

    // Wait for tool call to appear
    await expect(
      page.getByTestId("chat-tool-call-test_simple_text")
    ).toBeVisible({ timeout: 20000 });

    // Now click on the tool call to open drawer
    await page.getByTestId("chat-tool-call-test_simple_text").click();

    // Verify drawer opens
    await expect(page.getByTestId("chat-tool-drawer")).toBeVisible();

    // Verify arguments are displayed
    await expect(page.getByTestId("chat-tool-drawer-args")).toBeVisible();
    await expect(page.getByTestId("chat-tool-drawer-args")).toContainText(
      "message"
    );

    // Verify result is displayed
    await expect(page.getByTestId("chat-tool-drawer-result")).toBeVisible();
    await expect(page.getByTestId("chat-tool-drawer-result")).toContainText(
      "Echo: Drawer test"
    );
  });

  test("should display different tool call states - success", async ({
    page,
    context,
  }) => {
    // Create a successful tool call
    await page
      .getByTestId("chat-input")
      .fill("Use the test_simple_text tool with message 'Success test'");
    await page.getByTestId("chat-send-button").click();

    // Wait for tool call to appear and verify success status
    await expect(
      page.getByTestId("chat-tool-call-test_simple_text")
    ).toBeVisible({ timeout: 20000 });
    const successStatus = page
      .getByTestId("chat-tool-call-test_simple_text")
      .getByTestId("chat-tool-call-status-result");
    await expect(successStatus).toBeVisible();
  });

  test("should copy chat to clipboard when copy button is clicked", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.getByTestId("chat-input").fill("What is 2+2?");
    await page.getByTestId("chat-send-button").click();

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });

    await page.getByTestId("chat-copy-button").click();

    await expect(page.getByText("Chat copied to clipboard")).toBeVisible({
      timeout: 3000,
    });

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    expect(clipboardText).toContain("What is 2+2?");
  });

  test("should show scroll-to-bottom button when not at bottom", async ({
    page,
  }) => {
    // Create enough content to overflow the messages container.
    // Keep this short enough to avoid timeouts, but long enough to force scrolling.
    for (let i = 0; i < 6; i++) {
      await page
        .getByTestId("chat-input")
        .fill(`Write a short list of 10 items. Iteration ${i + 1}.`);
      await page.getByTestId("chat-send-button").click();
      // Each iteration adds one user + one assistant message. Assert on the
      // count (not visibility) so the locator stays unambiguous after the
      // first turn, which would otherwise trip Playwright strict mode.
      await expect(page.getByTestId("chat-message-user")).toHaveCount(i + 1, {
        timeout: 3000,
      });
      await expect(page.getByTestId("chat-message-assistant")).toHaveCount(
        i + 1,
        { timeout: 45000 }
      );
    }

    const container = page.getByTestId("chat-messages-scroll-container");
    await expect(container).toBeVisible();

    // Scroll away from the bottom.
    await container.evaluate((el) => {
      el.scrollTop = 0;
    });

    // Button should appear when not near the bottom.
    const scrollButton = page.getByTestId("chat-scroll-to-bottom");
    await expect(scrollButton).toBeVisible({ timeout: 3000 });

    // Click button and ensure we end up at the bottom. The scroll is animated,
    // so poll until it settles instead of measuring synchronously.
    await scrollButton.click();

    await expect
      .poll(
        () =>
          container.evaluate(
            (el) => el.scrollHeight - (el.scrollTop + el.clientHeight)
          ),
        { timeout: 5000 }
      )
      .toBeLessThanOrEqual(80);

    await expect(scrollButton).not.toBeVisible({ timeout: 3000 });
  });

  test("should export chat as JSON when export JSON is clicked", async ({
    page,
    context,
  }) => {
    await page.getByTestId("chat-input").fill("What is 2+2?");
    await page.getByTestId("chat-send-button").click();

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });

    const downloadPromise = page.waitForEvent("download");

    await page.getByTestId("chat-export-button").click();
    await page.getByTestId("chat-export-json").click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^chat-export-\d{4}-\d{2}-\d{2}\.json$/
    );

    await expect(page.getByText("Chat exported as JSON")).toBeVisible({
      timeout: 3000,
    });
  });

  test("should export chat as Markdown when export Markdown is clicked", async ({
    page,
    context,
  }) => {
    await page.getByTestId("chat-input").fill("What is 2+2?");
    await page.getByTestId("chat-send-button").click();

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });

    const downloadPromise = page.waitForEvent("download");

    await page.getByTestId("chat-export-button").click();
    await page.getByTestId("chat-export-markdown").click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^chat-export-\d{4}-\d{2}-\d{2}\.md$/
    );

    await expect(page.getByText("Chat exported as MARKDOWN")).toBeVisible({
      timeout: 3000,
    });
  });

  test("should display different tool call states - error", async ({
    page,
    context,
  }) => {
    // Ask to use error tool
    await page
      .getByTestId("chat-input")
      .fill("Use the test_error_handling tool");
    await page.getByTestId("chat-send-button").click();

    // Wait for tool call to appear
    await expect(
      page.getByTestId("chat-tool-call-test_error_handling")
    ).toBeVisible({ timeout: 20000 });

    // Verify error status
    await expect(page.getByTestId("chat-tool-call-status-error")).toBeVisible();

    // Click to open drawer and verify error message
    await page.getByTestId("chat-tool-call-test_error_handling").click();
    await expect(page.getByTestId("chat-tool-drawer-result")).toBeVisible();
    await expect(page.getByTestId("chat-tool-drawer-result")).toContainText(
      "intentional error"
    );
  });
});

// Regression for MCP-2419 / managed localhost chat: in hosted mode with a
// loopback MCP server, the browser runs MCPAgent client-side and routes LLM
// calls through `/inspector/llm/*` — never the server-side `/chat/stream`.
test.describe("Inspector Chat Tests - hosted mode + localhost server", () => {
  const CLOUD_CHAT_URL =
    "https://cloud.manufact.com/api/v1/inspector/chat/stream";

  let cloudCalls: string[];
  let llmCalls: string[];
  let llmAuthorizations: string[];

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

    ({ calls: cloudCalls, llmCalls, llmAuthorizations } =
      await enableHostedChatMode(page, CLOUD_CHAT_URL, {
        mockLlmProxy: "success",
      }));

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForWidgets: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }

    await page.getByRole("tab", { name: /Chat/ }).first().click();
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
  });

  test("routes LLM through the proxy and never calls /chat/stream", async ({
    page,
  }) => {
    await page.getByTestId("chat-input").fill("What is 2+2?");
    await page.getByTestId("chat-send-button").click();

    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });

    expect(cloudCalls).toHaveLength(0);
    expect(llmCalls.length).toBeGreaterThan(0);
  });

  test("anonymous send offers delegated cloud sign-in on 429", async ({ page }) => {
    await page.unroute(`${CLOUD_CHAT_URL.replace(/\/chat\/stream\/?$/, "/llm")}/**`);
    const llmBase = CLOUD_CHAT_URL.replace(/\/chat\/stream\/?$/, "/llm");
    await page.route(`${llmBase}/**`, async (route) => {
      llmCalls.push(route.request().url());
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "rate_limited",
          loginRequired: true,
          loginUrl: "https://manufact.com/login",
        }),
      });
    });

    await page.getByTestId("chat-input").fill("hello");
    await page.getByTestId("chat-send-button").click();

    await expect(
      page.getByText("Sign in through Manufact Cloud to continue with managed chat.")
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" }).last()).toBeVisible();
  });

  test("delegates OAuth to cloud and sends its bearer token", async ({
    page,
    context,
  }) => {
    const origin = new URL(CLOUD_CHAT_URL).origin;
    await context.route(`${origin}/api/auth/oauth2/register`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ client_id: "inspector-e2e" }),
      });
    });
    await context.route(`${origin}/api/auth/oauth2/token`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          access_token: "oauth-e2e-token",
          refresh_token: "oauth-e2e-refresh",
          expires_in: 3600,
        }),
      });
    });
    await context.route(`${origin}/api/auth/oauth2/userinfo`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          sub: "user-e2e",
          name: "OAuth User",
          email: "oauth@example.com",
        }),
      });
    });
    await context.route(`${origin}/api/auth/oauth2/authorize**`, async (route) => {
      const requestUrl = new URL(route.request().url());
      const redirectUri = requestUrl.searchParams.get("redirect_uri")!;
      const state = requestUrl.searchParams.get("state")!;
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", "oauth-e2e-code");
      callback.searchParams.set("state", state);
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<script>location.href=${JSON.stringify(callback.toString())}</script>`,
      });
    });

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).first().click();
    const popup = await popupPromise;
    await popup.waitForEvent("close");

    await expect(page.getByRole("button", { name: "User menu" }).first()).toBeVisible();
    await page.getByTestId("chat-input").fill("authenticated hello");
    await page.getByTestId("chat-send-button").click();
    await expect.poll(() => llmAuthorizations.at(-1)).toBe(
      "Bearer oauth-e2e-token"
    );
  });
});

// Managed-key notice only appears when hosted chat URL is absent (BYOK required).
test.describe("Inspector Chat Tests - localhost managed-key notice", () => {
  const CLOUD_CHAT_URL =
    "https://cloud.manufact.com/api/v1/inspector/chat/stream";
  const NOTICE = "chat-localhost-managed-key-notice";

  async function connect(page: Parameters<typeof navigateToTools>[0]) {
    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForWidgets: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }
  }

  test("hosted mode + localhost uses managed chat without the BYOK notice", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await enableHostedChatMode(page, CLOUD_CHAT_URL, { mockLlmProxy: true });
    await connect(page);

    await page.getByRole("tab", { name: /Chat/ }).first().click();
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
    await expect(page.getByTestId(NOTICE)).toHaveCount(0);
  });

  test("local inspector + localhost server shows no notice", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    // No enableHostedChatMode → no chatApiUrl → ordinary local BYOK flow.
    await connect(page);

    await page.getByRole("tab", { name: /Chat/ }).first().click();
    await expect(
      page.getByTestId("chat-configure-api-key-button")
    ).toBeVisible();
    await expect(page.getByTestId(NOTICE)).toHaveCount(0);
  });
});
