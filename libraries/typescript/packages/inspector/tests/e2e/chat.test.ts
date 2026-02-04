import { expect, test } from "@playwright/test";
import {
  connectToConformanceServer,
  navigateToTools,
} from "./helpers/connection";

test.describe.serial("Inspector Chat Tests", () => {
  // Note: To run these tests with a real MCP server:
  // 1. cd packages/mcp-use/examples/server/features/conformance
  // 2. pnpm build && pnpm start --port 3002
  // 3. Ensure you have OPENAI_API_KEY in your .env file
  // Then run: pnpm test:e2e tests/e2e/chat.test.ts
  //
  // Tests run sequentially to avoid interference between chat sessions

  // Helper function to configure API key for chat
  async function configureChatAPI(page: any) {
    const apiKey = process.env.OPENAI_API_KEY || "";

    // Navigate to Chat tab
    await page.getByRole("tab", { name: /Chat/ }).first().click();
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

    // Click Configure API Key button
    await page.getByTestId("chat-configure-api-key-button").click();

    // Verify dialog opens
    await expect(page.getByTestId("chat-config-dialog")).toBeVisible();

    // Enter API key
    await page.getByTestId("chat-config-api-key-input").fill(apiKey);

    // Wait for models to load
    await page.waitForTimeout(1000);

    // Click on the model selector to open the popover
    await page.getByTestId("chat-config-model-select").click();

    // Search for and select gpt-4o-mini model
    const modelSearch = page.getByPlaceholder("Search models...");
    await expect(modelSearch).toBeVisible();
    await modelSearch.fill("gpt-5-nano");

    // Click on the model option
    await page
      .getByRole("option", { name: /gpt-5-nano/ })
      .first()
      .click();

    // Save configuration
    await page.getByTestId("chat-config-save-button").click();

    // Verify dialog closes and landing form appears
    await expect(page.getByTestId("chat-config-dialog")).not.toBeVisible();
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
  }

  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());

    // Connect to server using helper
    await connectToConformanceServer(page);

    // Navigate to Tools tab
    await navigateToTools(page);
    await configureChatAPI(page);
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
