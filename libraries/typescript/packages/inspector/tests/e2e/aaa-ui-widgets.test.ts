import { expect, test } from "@playwright/test";
import {
  connectToConformanceServer,
  goToInspectorWithAutoConnectAndOpenTools,
  navigateToTools,
  warmWidgets,
} from "./helpers/connection";
import { getTestMatrix } from "./helpers/test-matrix";

test.describe.configure({ mode: "serial" });

test.describe("Conformance UI widgets - Tools Tab", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

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

    // Pre-warm widgets to avoid Vite cold start delays
    await warmWidgets(page, ["get-weather-delayed", "apps-sdk-only-card"]);
  });

  test("get-weather-delayed - should show weather widget in both Apps SDK and MCP Apps tabs", async ({
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

    // Tab 1: Component (Apps SDK) - verify pending state first
    await expect(page.getByTestId("tool-result-view-chatgpt-app")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("tool-result-view-chatgpt-app").click();

    const appsSdkFrame = page.frameLocator(
      'iframe[title^="OpenAI Component: get-weather-delayed"]'
    );

    // Test pending state: loader should be visible while tool is executing (10s delay)
    const spinner = appsSdkFrame.locator('[class*="animate-spin"]').first();
    await expect(spinner).toBeVisible({ timeout: 10000 });

    // Wait for loader to disappear and content to appear (10s delay + buffer)
    await expect(spinner).not.toBeVisible({ timeout: 15000 });
    await expect(appsSdkFrame.getByText(/tokyo/i)).toBeVisible();
    await expect(appsSdkFrame.getByText("Partly Cloudy")).toBeVisible();
    await expect(appsSdkFrame.getByText(/22/)).toBeVisible();

    // Tab 2: Component (MCP Apps) - double iframe (outer proxy, inner guest)
    await expect(page.getByTestId("tool-result-view-mcp-apps")).toBeVisible();
    await page.getByTestId("tool-result-view-mcp-apps").click();
    const mcpAppsOuter = page.frameLocator(
      'iframe[title^="MCP App: get-weather-delayed"]'
    );
    const mcpAppsGuest = mcpAppsOuter.frameLocator("iframe");
    await expect(mcpAppsGuest.getByText(/tokyo/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(mcpAppsGuest.getByText("Partly Cloudy")).toBeVisible();
    await expect(mcpAppsGuest.getByText(/22/)).toBeVisible();
  });

  test("apps-sdk-only-card - should show Apps SDK only widget", async ({
    page,
  }) => {
    // Tool name from resources/ may be apps-sdk-only-card (confirm at runtime)
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

    await expect(page.getByTestId("tool-result-maximize")).toBeVisible({
      timeout: 10000,
    });

    const widgetFrame = page.frameLocator(
      'iframe[title^="OpenAI Component: apps-sdk-only-card"]'
    );
    // Default or custom message (regex can match multiple elements; assert first match)
    await expect(
      widgetFrame
        .getByText(/ChatGPT-only widget|Custom|appsSdkMetadata only/)
        .first()
    ).toBeVisible({ timeout: 45000 });
  });
});

test.describe("Conformance UI widgets - Resources Tab", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

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

    // Pre-warm widgets to avoid Vite cold start delays
    await warmWidgets(page, ["weather-display"]);

    await page
      .getByRole("tab", { name: /Resources/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();
  });

  test("weather-display resource - should render widget in Resources tab", async ({
    page,
  }) => {
    await page.getByTestId("resource-item-weather-display").click();

    // Resource result shows either Apps SDK or MCP Apps widget (priority order)
    const widgetIframe = page.locator('iframe[title*="weather-display"]');
    await expect(widgetIframe).toBeVisible({ timeout: 5000 });
    const frame = page.frameLocator('iframe[title*="weather-display"]').first();
    await expect(frame.locator("body")).toBeVisible({ timeout: 3000 });
  });

  test("weather-display resource - should switch between preview and JSON view", async ({
    page,
  }) => {
    await page.getByTestId("resource-item-weather-display").click();

    await expect(page.locator('iframe[title*="weather-display"]')).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: "JSON" }).click();
    await expect(page.getByTestId("resource-result-json")).toBeVisible({
      timeout: 3000,
    });
    const resultContent = page.getByTestId("resource-result-json");
    await expect(resultContent).toContainText('"uri"');

    await page.getByRole("button", { name: /Component|Preview/ }).click();
    await expect(page.locator('iframe[title*="weather-display"]')).toBeVisible({
      timeout: 3000,
    });
  });
});

test.describe("Conformance UI widgets - Chat Tab", () => {
  async function configureChatAPI(page: import("@playwright/test").Page) {
    const apiKey = process.env.OPENAI_API_KEY || "";

    await page.getByRole("tab", { name: /Chat/ }).first().click();
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
    await page.getByTestId("chat-configure-api-key-button").click();
    await expect(page.getByTestId("chat-config-dialog")).toBeVisible();
    await page.getByTestId("chat-config-api-key-input").fill(apiKey);
    await page.waitForTimeout(1000);
    await page.getByTestId("chat-config-model-select").click();
    const modelSearch = page.getByPlaceholder("Search models...");
    await expect(modelSearch).toBeVisible();
    await modelSearch.fill("gpt-5-nano");
    await page
      .getByRole("option", { name: /gpt-5-nano/ })
      .first()
      .click();
    await page.getByTestId("chat-config-save-button").click();
    await expect(page.getByTestId("chat-config-dialog")).not.toBeVisible();
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
  }

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

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

    // Pre-warm widgets to avoid Vite cold start delays
    await warmWidgets(page, ["get-weather-delayed", "apps-sdk-only-card"]);

    await configureChatAPI(page);
  });

  test("get-weather-delayed in chat - should render weather widget inline", async ({
    page,
  }) => {
    await page
      .getByTestId("chat-input")
      .fill("Use the get-weather-delayed tool with city Tokyo and delay 2000");
    await page.getByTestId("chat-send-button").click();

    await expect(
      page.getByTestId("chat-tool-call-get-weather-delayed")
    ).toBeVisible({ timeout: 20000 });

    await expect(page.getByTestId("chat-tool-call-status-result")).toBeVisible({
      timeout: 45000,
    });

    // MCP Apps uses double-nested iframe (outer proxy + inner guest)
    const outerFrame = page.frameLocator(
      'iframe[title*="get-weather-delayed"]'
    );
    const widgetFrame = outerFrame.frameLocator("iframe");
    await expect(widgetFrame.getByText(/tokyo/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("apps-sdk-only-card in chat - should render Apps SDK widget", async ({
    page,
  }) => {
    await page
      .getByTestId("chat-input")
      .fill("Use the apps-sdk-only-card tool");
    await page.getByTestId("chat-send-button").click();

    await expect(
      page.getByTestId("chat-tool-call-apps-sdk-only-card")
    ).toBeVisible({ timeout: 20000 });

    await expect(page.getByTestId("chat-tool-call-status-result")).toBeVisible({
      timeout: 45000,
    });

    const widgetFrame = page
      .frameLocator('iframe[title^="OpenAI Component: apps-sdk-only-card"]')
      .first();
    await expect(
      widgetFrame.getByText(/ChatGPT-only widget|appsSdkMetadata only/).first()
    ).toBeVisible({ timeout: 45000 });
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
    const outerFrame = page.frameLocator(
      'iframe[title*="get-weather-delayed"]'
    );
    const widgetFrame = outerFrame.frameLocator("iframe");
    const spinner = widgetFrame.locator('[class*="animate-spin"]').first();
    await expect(spinner).toBeVisible({ timeout: 3000 });

    await expect(spinner).not.toBeVisible({ timeout: 10000 });
    await expect(widgetFrame.getByText(/london/i)).toBeVisible({
      timeout: 5000,
    });
  });
});
