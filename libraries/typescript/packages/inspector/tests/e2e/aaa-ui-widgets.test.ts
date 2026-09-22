import { expect, test } from "@playwright/test";
import {
  configureLLMAPI,
  connectToConformanceServer,
  goToInspectorWithAutoConnectAndOpenTools,
  navigateToTools,
} from "./helpers/connection";
import { getMcpAppsGuestFrame } from "./helpers/debugger-tools";
import { getTestMatrix } from "./helpers/test-matrix";

test.describe("Conformance UI widgets - Tools Tab", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForViews: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }
  });

  test("get-weather-delayed - should show weather widget via MCP Apps", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-get-weather-delayed").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    await expect(page.getByTestId("tool-param-city")).toBeVisible();
    await page.getByTestId("tool-param-city").fill("tokyo");
    await expect(page.getByTestId("tool-param-delay")).toBeVisible();
    // Use longer delay to account for Vite cold start (widget JS compilation can take 5+ seconds)
    await page.getByTestId("tool-param-delay").fill("10000");

    await page.getByTestId("tool-execution-execute-button").click();

    // MCP Apps is the only component view (no ChatGPT/Apps SDK tab)
    await expect(page.getByTestId("tool-result-view-mcp-apps")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId("tool-result-view-chatgpt-app")
    ).not.toBeVisible();

    const mcpAppsGuest = getMcpAppsGuestFrame(page, "get-weather-delayed");

    // Pending state: guest widget shows spinner while tool executes (10s delay)
    const spinner = mcpAppsGuest.locator('[class*="animate-spin"]').first();
    await expect(spinner).toBeVisible({ timeout: 10000 });

    // Wait for loader to disappear and content to appear (10s delay + buffer)
    await expect(spinner).not.toBeVisible({ timeout: 15000 });
    await expect(mcpAppsGuest.getByText(/tokyo/i)).toBeVisible();
    await expect(mcpAppsGuest.getByText("Partly Cloudy")).toBeVisible();
    await expect(mcpAppsGuest.getByText(/22/)).toBeVisible();
  });

  test("apps-sdk-only-card - should fall back to raw JSON (no MCP Apps widget)", async ({
    page,
  }) => {
    // Fixture declares only openai/outputTemplate (no _meta.ui.resourceUri).
    // Inspector must NOT emulate ChatGPT — show raw/JSON result only.
    const toolItem = page.getByTestId("tool-item-apps-sdk-only-card");
    await toolItem.click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();

    // Optional message param
    const messageParam = page.getByTestId("tool-param-message");
    if (await messageParam.isVisible()) {
      await messageParam.fill("Custom");
    }

    await page.getByTestId("tool-execution-execute-button").click();

    // Non-UI results show Formatted/Raw toggles (no maximize / no component tab)
    await expect(page.getByRole("heading", { name: "Response" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Formatted" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Raw" })).toBeVisible();

    // No MCP Apps frame and no ChatGPT tab
    await expect(page.getByTestId("mcp-app-frame")).not.toBeVisible();
    await expect(
      page.getByTestId("tool-result-view-chatgpt-app")
    ).not.toBeVisible();
    await expect(
      page.getByTestId("tool-result-view-mcp-apps")
    ).not.toBeVisible();

    // Formatted content shows the tool result (message from args)
    await expect(
      page.getByTestId("tool-execution-results-content")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByTestId("tool-execution-results-content")
    ).toContainText("Custom");
  });

  test("chat-conformance fixture keeps Chat capabilities off the Tools surface", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-chat-conformance-fixture").click();
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByTestId("tool-result-view-mcp-apps")).toBeVisible({
      timeout: 10000,
    });

    const fixture = getMcpAppsGuestFrame(page, "chat-conformance-fixture");
    await expect(fixture.getByText("Chat conformance fixture")).toBeVisible();

    await fixture.getByRole("button", { name: "Call app-only tool" }).click();
    await expect(fixture.getByTestId("fixture-helper-status")).toContainText(
      "App helper received"
    );

    await fixture.getByRole("button", { name: "Send follow-up" }).click();
    await expect(fixture.getByTestId("fixture-follow-up-status")).toContainText(
      /support|message/i
    );
  });
});

test.describe("Conformance UI widgets - Resources Tab", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForViews: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }

    await page.locator('[data-testid="tab-resources"]:visible').first().click();
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();
  });

  test("weather-display resource - should render widget in Resources tab", async ({
    page,
  }) => {
    await page.getByTestId("resource-item-weather-display").click();

    // The MCP Apps view mounts directly in the resource preview (it shows its
    // pending state until props or tool data arrive).
    await expect(page.getByTestId("resource-widget-preview")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="mcp-app-frame"]').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("weather-display resource - should switch between preview and JSON view", async ({
    page,
  }) => {
    await page.getByTestId("resource-item-weather-display").click();

    await expect(page.getByTestId("resource-widget-preview")).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: "JSON" }).click();
    await expect(page.getByTestId("resource-result-json")).toBeVisible({
      timeout: 10000,
    });
    const resultContent = page.getByTestId("resource-result-json");
    await expect(resultContent).toContainText('"uri"');

    // The header toggle reads "Preview" (the "MCP Apps" pill is a badge).
    await page.getByRole("button", { name: /Preview/ }).click();
    // Back to the component preview
    await expect(page.getByTestId("resource-widget-preview")).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Conformance UI widgets - Chat Tab", () => {
  test.beforeEach(async ({ page, context }) => {
    test.skip(
      !process.env.OPENAI_API_KEY,
      "OPENAI_API_KEY required for chat widget tests"
    );

    await context.clearCookies();

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForViews: true,
      });
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }

    await configureLLMAPI(page);
  });

  test("get-weather-delayed in chat - should render weather widget inline", async ({
    page,
  }) => {
    await page
      .getByTestId("chat-input")
      .fill("Use the get-weather-delayed tool with city Tokyo and delay 2000");
    await page.getByTestId("chat-send-button").click();

    const toolCall = page.getByTestId("chat-tool-call-get-weather-delayed");
    await expect(toolCall).toBeVisible({ timeout: 20000 });

    await expect(
      toolCall.getByTestId("chat-tool-call-status-result")
    ).toBeVisible({ timeout: 45000 });

    // MCP Apps uses double-nested iframe (outer proxy + inner guest)
    const widgetFrame = getMcpAppsGuestFrame(page, "get-weather-delayed");
    await expect(widgetFrame.getByText(/tokyo/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("app-only tools stay out of the Chat model tool selector", async ({
    page,
  }) => {
    await page.getByTestId("chat-tool-selector").click();
    // Each selector row is a button named after the tool. Match by role so the
    // (mounted but hidden) Tools tab list does not interfere.
    await expect(
      page.getByRole("button", {
        name: "chat-conformance-fixture",
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "chat-conformance-helper", exact: true })
    ).toHaveCount(0);
  });

  test("chat-conformance fixture sends follow-ups and replaces model context", async ({
    page,
  }) => {
    // Two LLM turns plus a view round-trip; dev-mode (builtin) runs need the
    // extra headroom.
    test.slow();
    await page
      .getByTestId("chat-input")
      .fill("Use the chat-conformance-fixture tool now");
    await page.getByTestId("chat-send-button").click();

    // The model may call other tools first; scope the status to this call.
    const toolCall = page.getByTestId(
      "chat-tool-call-chat-conformance-fixture"
    );
    await expect(toolCall).toBeVisible({ timeout: 20000 });
    await expect(
      toolCall.getByTestId("chat-tool-call-status-result")
    ).toBeVisible({ timeout: 45000 });

    const fixture = getMcpAppsGuestFrame(page, "chat-conformance-fixture");
    await expect(fixture.getByText("Chat conformance fixture")).toBeVisible();
    await fixture.getByRole("button", { name: "Update model context" }).click();
    await fixture.getByRole("button", { name: "Update model context" }).click();
    await expect(fixture.getByTestId("fixture-context-value")).toContainText(
      "Selection: 2"
    );

    // Chat rejects view follow-ups while a turn is still streaming, so wait
    // for the first turn to finish (the send button leaves its stop state).
    await expect(page.getByTestId("chat-send-button")).toHaveAttribute(
      "title",
      "Send",
      { timeout: 45000 }
    );

    // The view's <ModelContext> must reach the model: the follow-up turn's LLM
    // request carries it as a system message.
    const followUpRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        (request.postData() ?? "").includes(
          "Follow up from fixture selection 2"
        ),
      { timeout: 45000 }
    );
    await fixture.getByRole("button", { name: "Send follow-up" }).click();
    expect((await followUpRequest).postData()).toContain(
      "Fixture selection is 2"
    );
    // The view's follow-up resolves once the whole follow-up turn completes.
    await expect(fixture.getByTestId("fixture-follow-up-status")).toHaveText(
      "sent",
      { timeout: 90000 }
    );

    await expect(page.getByText("State synced to model").first()).toBeVisible();
  });

  test("apps-sdk-only-card in chat - should show raw result without widget", async ({
    page,
  }) => {
    await page
      .getByTestId("chat-input")
      .fill("Use the apps-sdk-only-card tool");
    await page.getByTestId("chat-send-button").click();

    await expect(
      page.getByTestId("chat-tool-call-apps-sdk-only-card")
    ).toBeVisible({ timeout: 20000 });

    await expect(
      page
        .getByTestId("chat-tool-call-apps-sdk-only-card")
        .getByTestId("chat-tool-call-status-result")
    ).toBeVisible({ timeout: 45000 });

    // No ChatGPT emulation — no MCP Apps frame for apps-sdk-only tools
    await expect(page.getByTestId("mcp-app-frame")).not.toBeVisible();

    // Tool call completed; result text/JSON should be present in the chat
    const toolCall = page.getByTestId("chat-tool-call-apps-sdk-only-card");
    await expect(toolCall).toBeVisible();
  });

  test("widget pending state in chat - should show loading then content", async ({
    page,
  }) => {
    await page
      .getByTestId("chat-input")
      .fill(
        "Use get-weather-delayed with city London and delay 3000 milliseconds"
      );
    await page.getByTestId("chat-send-button").click();

    await expect(
      page.getByTestId("chat-tool-call-get-weather-delayed")
    ).toBeVisible({ timeout: 25000 });

    // MCP Apps uses double-nested iframe (outer proxy + inner guest)
    const widgetFrame = getMcpAppsGuestFrame(page, "get-weather-delayed");
    const spinner = widgetFrame.locator('[class*="animate-spin"]').first();
    await expect(spinner).toBeVisible({ timeout: 20000 });

    await expect(spinner).not.toBeVisible({ timeout: 10000 });
    await expect(widgetFrame.getByText(/london/i)).toBeVisible({
      timeout: 5000,
    });
  });
});
