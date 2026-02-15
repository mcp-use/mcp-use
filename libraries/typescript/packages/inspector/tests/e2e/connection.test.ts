import { expect, test } from "@playwright/test";
import {
  configureLLMAPI,
  connectToConformanceServer,
  navigateToTools,
} from "./helpers/connection";

test.describe("Inspector MCP Server Connections", () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());

    // Connect to server using helper
    await connectToConformanceServer(page);

    // Navigate to Tools tab
    await navigateToTools(page);
  });

  test("server should still be there after page refresh", async ({ page }) => {
    // go to home
    await page.goto("http://localhost:3000/inspector");

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "ConformanceTestServer" })
    ).toBeVisible();
    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible();
  });

  test("server should not be there after removing it", async ({ page }) => {
    // go to home
    await page.goto("http://localhost:3000/inspector");
    await page.getByTestId("server-tile-remove").click();
    await expect(
      page.getByRole("heading", { name: "ConformanceTestServer" })
    ).not.toBeVisible();
    await expect(
      page.getByTestId("server-tile-status-ready")
    ).not.toBeVisible();

    // refresh and verify server is not there
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "ConformanceTestServer" })
    ).not.toBeVisible();
  });

  test("server info modal should display server metadata and capabilities", async ({
    page,
  }) => {
    // go to home
    await page.goto("http://localhost:3000/inspector");

    // Click the info button to open the server info modal
    await page.getByTestId("server-tile-info").click();

    // Verify modal opens
    await expect(page.getByTestId("server-info-modal")).toBeVisible();
    await expect(page.getByTestId("server-info-modal-title")).toContainText(
      "Server Information"
    );

    // Verify server name is displayed
    await expect(page.getByTestId("server-info-name")).toBeVisible();
    await expect(page.getByTestId("server-info-name")).toContainText(
      "ConformanceTestServer"
    );

    // Verify capabilities JSON is displayed
    await expect(page.getByTestId("server-info-capabilities")).toBeVisible();

    // Close the modal by clicking outside or ESC
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("server-info-modal")).not.toBeVisible();
  });

  test("should reconnect server from dashboard tile", async ({ page }) => {
    await page.goto("http://localhost:3000/inspector");

    await page.getByTestId("server-tile-reconnect").click();

    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("server-tile-http://localhost:3002/mcp").click();
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();
    await page.getByTestId("tool-param-message").fill("Reconnect check");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Echo: Reconnect check");
  });

  test("should update connection settings from dashboard tile", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000/inspector");

    await page.getByTestId("server-tile-settings").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("connection-form-url-input")).toBeVisible();
    await expect(dialog.getByTestId("connection-form-url-input")).toHaveValue(
      "http://localhost:3002/mcp"
    );

    await dialog.getByTestId("connection-form-config-button").click();
    await expect(
      page.getByTestId("config-dialog-request-timeout-input")
    ).toBeVisible();
    await page.getByTestId("config-dialog-request-timeout-input").fill("60000");
    await page.getByRole("button", { name: "Save" }).first().click();

    await dialog.getByTestId("connection-form-connect-button").click();

    await expect(
      page.getByText("Connection settings updated").first()
    ).toBeVisible({
      timeout: 3000,
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "ConformanceTestServer" })
    ).toBeVisible();
    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should update connection settings from server dropdown", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Edit connection settings" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("connection-form-url-input")).toBeVisible();
    await expect(dialog.getByTestId("connection-form-url-input")).toHaveValue(
      "http://localhost:3002/mcp"
    );

    await dialog.getByTestId("connection-form-config-button").click();
    await expect(
      page.getByTestId("config-dialog-request-timeout-input")
    ).toBeVisible();
    await page.getByTestId("config-dialog-request-timeout-input").fill("45000");
    await page.getByRole("button", { name: "Save" }).first().click();

    await dialog.getByTestId("connection-form-connect-button").click();

    await expect(
      page.getByText("Connection settings updated").first()
    ).toBeVisible({
      timeout: 3000,
    });
  });

  test("should reconnect after updating connection settings", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000/inspector");

    await page.getByTestId("server-tile-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("connection-form-url-input")).toBeVisible();

    await dialog.getByTestId("connection-form-config-button").click();
    await page.getByTestId("config-dialog-request-timeout-input").fill("30000");
    await page.getByRole("button", { name: "Save" }).first().click();
    await dialog.getByTestId("connection-form-connect-button").click();

    await expect(
      page.getByText("Connection settings updated").first()
    ).toBeVisible({
      timeout: 3000,
    });

    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("server-tile-http://localhost:3002/mcp").click();
    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();
    await page.getByTestId("tool-param-message").fill("After settings update");
    await page.getByTestId("tool-execution-execute-button").click();
    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText("Echo: After settings update");
  });

  test("should show red when URL is invalid, then green after reconnecting through dialog", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000/inspector");

    await page.getByTestId("server-tile-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("connection-form-url-input")).toBeVisible();

    await dialog.getByTestId("connection-form-url-input").fill("");
    await dialog
      .getByTestId("connection-form-url-input")
      .fill("http://localhost:29999/mcp");
    await dialog.getByTestId("connection-form-connect-button").click();

    await expect(page.getByTestId("server-tile-status-failed")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("server-tile-settings").click();
    await expect(dialog.getByTestId("connection-form-url-input")).toBeVisible();
    await dialog.getByTestId("connection-form-url-input").fill("");
    await dialog
      .getByTestId("connection-form-url-input")
      .fill("http://localhost:3002/mcp");
    await dialog.getByTestId("connection-form-connect-button").click();

    const toast = page.getByText("Connection settings updated").first();
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId("server-tile-status-ready")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("server-tile-http://localhost:3002/mcp").click();
    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();
    await page.getByTestId("tool-param-message").fill("Reconnected");
    await page.getByTestId("tool-execution-execute-button").click();
    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText("Echo: Reconnected");
  });

  test("test_simple_text - should accept message param and echo it", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Fill message parameter
    await expect(page.getByTestId("tool-param-message")).toBeVisible();
    await page.getByTestId("tool-param-message").fill("Hello from test");

    // Execute tool
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains echoed message
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Echo: Hello from test");
  });

  test("test_image_content - should return image content", async ({ page }) => {
    await page.getByTestId("tool-item-test_image_content").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains image content type
    await expect(
      page.getByTestId("tool-execution-results-image-content")
    ).toBeVisible();
  });

  test("test_audio_content - should return audio content", async ({ page }) => {
    await page.getByTestId("tool-item-test_audio_content").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains audio content type
    await expect(
      page.getByTestId("tool-execution-results-audio-content")
    ).toBeVisible();
  });

  test("test_embedded_resource - should return embedded resource", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_embedded_resource").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains resource content
    await expect(
      page.getByTestId("tool-execution-results-resource-uri")
    ).toContainText("test://embedded");
    await expect(
      page.getByTestId("tool-execution-results-mime-type")
    ).toBeVisible();
    await expect(
      page.getByTestId("tool-execution-results-resource-text-content")
    ).toContainText("This is embedded resource content");
  });

  test("test_multiple_content_types - should return mixed content", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_multiple_content_types").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains text, image, and resource
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Multiple content types test:");
    await expect(
      page.getByTestId("tool-execution-results-image-content")
    ).toBeVisible();
    await expect(
      page.getByTestId("tool-execution-results-resource-uri")
    ).toContainText("test://mixed-content-resource");
  });

  test("test_tool_with_logging - should show log messages", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_tool_with_logging").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains completion message
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Tool execution completed with logging");

    // Verify RPC panel shows increased message count (log notifications)
    const messageCountBadge = page.getByTestId("rpc-message-count").first();
    await expect(messageCountBadge).toBeVisible({ timeout: 5000 });

    // Expand RPC panel to check for log notifications
    await page.getByTestId("rpc-panel-toggle").first().click();

    // Wait for and verify log notifications are present in RPC panel
    // The conformance server sends 3 log messages via notifications/message
    await expect(
      page.getByTestId("rpc-message-notifications-message").first()
    ).toBeVisible();
  });

  test("test_tool_with_progress - should accept steps param and show progress", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_tool_with_progress").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Fill steps parameter
    await expect(page.getByTestId("tool-param-steps")).toBeVisible();
    await page.getByTestId("tool-param-steps").fill("3");

    // Execute tool
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains completion message with step count
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Completed 3 steps");

    // If RPC panel is not already expanded, expand it
    const rpcPanelToggle = page.getByTestId("rpc-panel-toggle").first();
    if (await rpcPanelToggle.isVisible()) {
      await rpcPanelToggle.click();
      await page.waitForTimeout(300); // Wait for panel expansion animation
    }

    // Wait for and verify progress notifications are present in RPC panel
    // The conformance server sends progress notifications via notifications/progress
    const progressMessages = page.getByTestId(
      "rpc-message-notifications-progress"
    );
    await expect(progressMessages.first()).toBeVisible({ timeout: 5000 });

    // Verify we have at least 3 progress notifications (for steps 1, 2, 3)
    const count = await progressMessages.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("test_sampling - should accept prompt param and handle sampling request", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_sampling").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Fill prompt parameter
    await expect(page.getByTestId("tool-param-prompt")).toBeVisible();
    await page.getByTestId("tool-param-prompt").fill("Test prompt");

    // Execute tool
    await page.getByTestId("tool-execution-execute-button").click();

    // Wait for sampling toast to appear and click Approve
    const approveButton = page.getByTestId("sampling-toast-approve");
    await expect(approveButton).toBeVisible({ timeout: 5000 });
    await approveButton.click();

    // Verify response contains the expected "positive" text from the default sampling response
    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText("positive");
  });

  test("test_sampling - should generate response with LLM", async ({
    page,
  }) => {
    // Skip if no API key available
    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      test.skip();
      return;
    }

    // Configure LLM first
    await configureLLMAPI(page);

    await page.getByRole("tab", { name: /Tools/ }).first().click();
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();

    // Execute sampling tool
    await page.getByTestId("tool-item-test_sampling").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();
    await expect(page.getByTestId("tool-param-prompt")).toBeVisible();
    await page
      .getByTestId("tool-param-prompt")
      .fill("Analyze sentiment: how are you? reply positive");
    await page.getByTestId("tool-execution-execute-button").click();

    // Wait for sampling toast and click "View Details"
    const viewDetailsButton = page.getByTestId("sampling-toast-view-details");
    await expect(viewDetailsButton).toBeVisible({ timeout: 5000 });
    await viewDetailsButton.click();

    // Verify we're on the Sampling tab
    await expect(page.getByRole("heading", { name: "Sampling" })).toBeVisible();

    // Switch to LLM mode
    await page.getByTestId("sampling-response-mode-select").click();
    await page.getByTestId("sampling-response-mode-llm").click();

    // Wait for LLM to be available (button should appear instead of "not configured" message)
    await expect(page.getByTestId("sampling-generate-llm-button")).toBeVisible({
      timeout: 5000,
    });

    // Click Generate with LLM
    await page.getByTestId("sampling-generate-llm-button").click();

    // Wait for generation to complete
    await expect(page.getByTestId("sampling-generating")).toBeVisible();
    await expect(page.getByTestId("sampling-generating")).not.toBeVisible({
      timeout: 30000, // LLM might take time
    });

    // Verify form fields are populated with LLM response
    const modelInput = page.getByTestId("sampling-model-input");
    await expect(modelInput).not.toHaveValue("stub-model");

    const textContent = page.getByTestId("sampling-text-content");
    await expect(textContent).not.toBeEmpty();

    // Approve the response
    await page.getByTestId("sampling-approve-button").click();

    // Wait for success toast and click "View Tool Result"
    const viewToolResultButton = page.getByTestId("sampling-view-tool-result");
    await expect(viewToolResultButton).toBeVisible({ timeout: 5000 });
    await viewToolResultButton.click();

    // Verify we're back on the Tools tab
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible({
      timeout: 3000,
    });

    // Verify tool execution completes
    const textContentResult = page.getByTestId(
      "tool-execution-results-text-content"
    );
    await expect(textContentResult).toBeVisible({ timeout: 10000 });
  });

  test("test_elicitation - should handle elicitation flow and accept request", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_elicitation").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Wait for elicitation toast to appear and click View Details
    const viewDetailsButton = page.getByTestId(
      "elicitation-toast-view-details"
    );
    await expect(viewDetailsButton).toBeVisible({ timeout: 5000 });
    await viewDetailsButton.click();

    // Verify we're on the Elicitation tab
    await expect(page.getByTestId("elicitation-tab-header")).toBeVisible({
      timeout: 3000,
    });

    // Verify there's 1 elicitation request item in the sidebar
    await expect(page.getByTestId("elicitation-request-item-0")).toBeVisible();

    // Wait for form fields to be visible and ready
    const nameField = page.getByTestId("elicitation-field-name");
    const ageField = page.getByTestId("elicitation-field-age");
    await expect(nameField).toBeVisible();
    await expect(ageField).toBeVisible();

    // Fill in the form fields
    await nameField.fill("TestUser");

    // For number input, use keyboard to select all and replace
    await ageField.click();
    await page.keyboard.press("Meta+a"); // Cmd+A on Mac, Ctrl+A on Windows
    await page.keyboard.type("25");

    // Click the Accept button
    await page.getByTestId("elicitation-accept-button").click();

    // Wait for "View Tool Result" toast button and click it
    const viewToolResultButton = page.getByTestId(
      "elicitation-view-tool-result"
    );
    await expect(viewToolResultButton).toBeVisible({ timeout: 5000 });
    await viewToolResultButton.click();

    // Verify we're back on the Tools tab
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible({
      timeout: 3000,
    });

    // Verify the result contains the values we filled in
    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText("Received: TestUser, age 25");
  });

  test("test_elicitation_sep1034_defaults - should handle elicitation with defaults and accept", async ({
    page,
  }) => {
    await page
      .getByTestId("tool-item-test_elicitation_sep1034_defaults")
      .click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Wait for elicitation toast to appear and click View Details
    const viewDetailsButton = page.getByTestId(
      "elicitation-toast-view-details"
    );
    await expect(viewDetailsButton).toBeVisible({ timeout: 5000 });
    await viewDetailsButton.click();

    // Verify we're on the Elicitation tab
    await expect(page.getByTestId("elicitation-tab-header")).toBeVisible({
      timeout: 3000,
    });

    // Verify there's 1 elicitation request item in the sidebar
    await expect(page.getByTestId("elicitation-request-item-0")).toBeVisible();

    // Wait for form fields to be visible with default values
    // This test specifically uses SEP-1034 defaults (name, age, score, status, verified)
    const nameField = page.getByTestId("elicitation-field-name");
    const ageField = page.getByTestId("elicitation-field-age");
    const scoreField = page.getByTestId("elicitation-field-score");
    const statusField = page.getByTestId("elicitation-field-status");
    const verifiedField = page.getByTestId("elicitation-field-verified");

    await expect(nameField).toBeVisible();
    await expect(ageField).toBeVisible();

    // Verify the default values are pre-filled from the conformance server
    await expect(nameField).toHaveValue("John Doe");
    await expect(ageField).toHaveValue("30");
    await expect(scoreField).toHaveValue("95.5");
    await expect(statusField).toHaveValue("active");
    await expect(verifiedField).toBeChecked();

    // Click the Accept button (accepts with default values)
    await page.getByTestId("elicitation-accept-button").click();

    // Wait for "View Tool Result" toast button and click it
    const viewToolResultButton = page.getByTestId(
      "elicitation-view-tool-result"
    );
    await expect(viewToolResultButton).toBeVisible({ timeout: 5000 });
    await viewToolResultButton.click();

    // Verify we're back on the Tools tab
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible({
      timeout: 3000,
    });

    // Verify response contains the expected text with SEP-1034 defaults
    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText(
      "Elicitation completed: action=accept"
    );
    // The default values from the conformance server: John Doe, age 30, score 95.5, status active, verified true
    await expect(textContent).toContainText("John Doe");
  });

  test("test_elicitation_sep1330_enums - should handle all enum schema variants", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_elicitation_sep1330_enums").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    await page.getByTestId("tool-execution-execute-button").click();

    const viewDetailsButton = page.getByTestId(
      "elicitation-toast-view-details"
    );
    await expect(viewDetailsButton).toBeVisible({ timeout: 5000 });
    await viewDetailsButton.click();

    await expect(page.getByTestId("elicitation-tab-header")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByTestId("elicitation-request-item-0")).toBeVisible();

    // 1) Untitled single-select: string + enum
    const untitledSingle = page.getByTestId("elicitation-field-untitledSingle");
    await expect(untitledSingle).toBeVisible();
    await untitledSingle.selectOption("option2");
    await expect(untitledSingle).toHaveValue("option2");

    // 2) Titled single-select: string + oneOf (const/title)
    const titledSingle = page.getByTestId("elicitation-field-titledSingle");
    await expect(titledSingle).toBeVisible();
    await expect(titledSingle.locator("option")).toContainText([
      "Select...",
      "First Option",
      "Second Option",
      "Third Option",
    ]);
    await titledSingle.selectOption("value1");
    await expect(titledSingle).toHaveValue("value1");

    // 3) Legacy titled enum: string + enum + enumNames
    const legacyEnum = page.getByTestId("elicitation-field-legacyEnum");
    await expect(legacyEnum).toBeVisible();
    await expect(legacyEnum.locator("option")).toContainText([
      "Select...",
      "Option One",
      "Option Two",
      "Option Three",
    ]);
    await legacyEnum.selectOption("opt1");
    await expect(legacyEnum).toHaveValue("opt1");

    // 4) Untitled multi-select: array + items.enum
    const untitledMulti = page.getByTestId("elicitation-field-untitledMulti");
    await expect(untitledMulti).toBeVisible();
    await untitledMulti.getByLabel("option1").click();
    await untitledMulti.getByLabel("option3").click();

    // 5) Titled multi-select: array + items.anyOf (const/title)
    const titledMulti = page.getByTestId("elicitation-field-titledMulti");
    await expect(titledMulti).toBeVisible();
    await titledMulti.getByLabel("First Choice").click();
    await titledMulti.getByLabel("Third Choice").click();

    await page.getByTestId("elicitation-accept-button").click();

    const viewToolResultButton = page.getByTestId(
      "elicitation-view-tool-result"
    );
    await expect(viewToolResultButton).toBeVisible({ timeout: 5000 });
    await viewToolResultButton.click();

    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible({
      timeout: 3000,
    });

    const textContent = page.getByTestId("tool-execution-results-text-content");
    await expect(textContent).toBeVisible({ timeout: 10000 });
    await expect(textContent).toContainText(
      "Elicitation completed: action=accept"
    );

    // Ensure selected enum values were submitted correctly.
    await expect(textContent).toContainText('"untitledSingle":"option2"');
    await expect(textContent).toContainText('"titledSingle":"value1"');
    await expect(textContent).toContainText('"legacyEnum":"opt1"');
    await expect(textContent).toContainText(
      '"untitledMulti":["option1","option3"]'
    );
    await expect(textContent).toContainText(
      '"titledMulti":["value1","value3"]'
    );
  });

  test("test_error_handling - should display error message", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-test_error_handling").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Execute tool (no parameters)
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify error is displayed
    await expect(
      page.getByText("This is an intentional error for testing")
    ).toBeVisible();
  });

  test("update_subscribable_resource - should accept newValue param and update resource", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-update_subscribable_resource").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Fill newValue parameter
    await expect(page.getByTestId("tool-param-newValue")).toBeVisible();
    await page.getByTestId("tool-param-newValue").fill("Test update value");

    // Execute tool
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify response contains update confirmation
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Resource updated to: Test update value");
  });

  // Prompts tests
  test("test_simple_prompt - should execute prompt without arguments", async ({
    page,
  }) => {
    // Navigate to Prompts tab using role selector (handles collapsed/expanded states)
    await page
      .getByRole("tab", { name: /Prompts/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();

    // Select the prompt
    await page.getByTestId("prompt-item-test_simple_prompt").click();

    // Execute the prompt
    await page.getByTestId("prompt-execute-button").click();

    // Verify the output message
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "This is a simple prompt without any arguments"
    );
  });

  test("test_prompt_with_arguments - should fill args and execute", async ({
    page,
  }) => {
    // Navigate to Prompts tab using role selector (handles collapsed/expanded states)
    await page
      .getByRole("tab", { name: /Prompts/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();

    // Select the prompt
    await page.getByTestId("prompt-item-test_prompt_with_arguments").click();

    // Fill arguments
    await page.getByTestId("prompt-param-arg1").fill("value1");
    await page.getByTestId("prompt-param-arg2").fill("value2");

    // Execute the prompt
    await page.getByTestId("prompt-execute-button").click();

    // Verify the output contains the arguments
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg1='value1'"
    );
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg2='value2'"
    );
  });

  test("test_prompt_with_embedded_resource - should display resource", async ({
    page,
  }) => {
    // Navigate to Prompts tab using role selector (handles collapsed/expanded states)
    await page
      .getByRole("tab", { name: /Prompts/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();

    // Select the prompt
    await page
      .getByTestId("prompt-item-test_prompt_with_embedded_resource")
      .click();

    // Fill the resourceUri parameter
    await page
      .getByTestId("prompt-param-resourceUri")
      .fill("config://embedded");

    // Execute the prompt
    await page.getByTestId("prompt-execute-button").click();

    // Verify the output contains both text and resource
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "Here is the configuration"
    );
    // The second message should contain the resource with URI and JSON object
    const resourceContent = page.getByTestId("prompt-message-content-1");
    await expect(resourceContent).toBeVisible();
    await expect(resourceContent).toContainText("Resource:");
    await expect(resourceContent).toContainText("config://embedded");
    await expect(resourceContent).toContainText('"setting"');
    await expect(resourceContent).toContainText('"value"');
  });

  test("test_prompt_with_image - should display image content", async ({
    page,
  }) => {
    // Navigate to Prompts tab using role selector (handles collapsed/expanded states)
    await page
      .getByRole("tab", { name: /Prompts/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();

    // Select the prompt
    await page.getByTestId("prompt-item-test_prompt_with_image").click();

    // Execute the prompt
    await page.getByTestId("prompt-execute-button").click();

    // Verify the output contains text message
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "Here is a test image"
    );
    // The second message should be an image
    await expect(page.getByTestId("prompt-message-content-1")).toContainText(
      "Image:"
    );
  });

  // Resources tests
  test("static_text - should display text resource content", async ({
    page,
  }) => {
    // Navigate to Resources tab
    await page
      .getByRole("tab", { name: /Resources/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();

    // Select the static_text resource
    await page.getByTestId("resource-item-static_text").click();

    // Wait for result to load
    await expect(page.getByTestId("resource-result-json")).toBeVisible({
      timeout: 5000,
    });

    // Verify the JSON response contains the correct structure
    const resultContent = page.getByTestId("resource-result-json");
    await expect(resultContent).toContainText('"uri"');
    await expect(resultContent).toContainText("test://static-text");
    await expect(resultContent).toContainText('"mimeType"');
    await expect(resultContent).toContainText("text/plain");
    await expect(resultContent).toContainText('"text"');
    await expect(resultContent).toContainText("This is static text content");
  });

  test("static_binary - should display binary resource content", async ({
    page,
  }) => {
    // Navigate to Resources tab
    await page
      .getByRole("tab", { name: /Resources/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();

    // Select the static_binary resource
    await page.getByTestId("resource-item-static_binary").click();

    // Wait for result to load
    await expect(page.getByTestId("resource-result-json")).toBeVisible({
      timeout: 5000,
    });

    // Verify the JSON response contains the correct structure
    const resultContent = page.getByTestId("resource-result-json");
    await expect(resultContent).toContainText('"uri"');
    await expect(resultContent).toContainText("test://static-binary");
    await expect(resultContent).toContainText('"mimeType"');
    await expect(resultContent).toContainText("application/octet-stream");
    await expect(resultContent).toContainText('"blob"');
    await expect(resultContent).toContainText("AAECA//+/Q==");
  });

  test("subscribable_resource - should display updated resource content", async ({
    page,
  }) => {
    // Navigate to Resources tab
    await page
      .getByRole("tab", { name: /Resources/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();

    // Select the subscribable_resource
    await page.getByTestId("resource-item-subscribable_resource").click();

    // Wait for result to load
    await expect(page.getByTestId("resource-result-json")).toBeVisible({
      timeout: 5000,
    });

    // Verify the JSON response contains the updated value from the earlier test
    const resultContent = page.getByTestId("resource-result-json");
    await expect(resultContent).toContainText('"uri"');
    await expect(resultContent).toContainText("test://subscribable");
    await expect(resultContent).toContainText('"mimeType"');
    await expect(resultContent).toContainText("text/plain");
    await expect(resultContent).toContainText('"text"');
    await expect(resultContent).toContainText("Test update value");
  });
});
