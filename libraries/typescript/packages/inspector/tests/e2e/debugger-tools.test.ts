import { expect, test } from "@playwright/test";
import {
  configureLLMAPI,
  goToInspectorWithAutoConnectAndOpenTools,
} from "./helpers/connection";
import {
  changeDeviceType,
  changeLocale,
  changeTimezone,
  configurePropsManually,
  configurePropsViaLLM,
  enterFullscreenMode,
  enterPipMode,
  executeWeatherTool,
  exitFullscreenMode,
  exitPipMode,
  getAppsSdkWeatherFrame,
  getMcpAppsWeatherFrame,
  getWeatherResourceFrame,
  navigateToResourcesAndSelectWeather,
  openPropsDialog,
  switchToAppsSdkAndGetFrame,
  switchToMcpAppsAndGetFrame,
  toggleHover,
  toggleTouch,
  updateSafeAreaInsets,
  verifyFullscreenMode,
  verifyInlineMode,
  verifyPipMode,
  verifyWeatherWidgetProps,
  verifyWidgetDebugInfo,
  waitForWeatherWidgetAppsSdk,
  waitForWeatherWidgetMcpApps,
} from "./helpers/debugger-tools";

/**
 * Debugger tools tests run against the test matrix:
 * - Builtin dev (TEST_SERVER_MODE=builtin-dev): autoConnect, no manual connect; inspector + server on 3000.
 * - External built (default): connectToConformanceServer + navigateToTools; inspector 3000, server 3002.
 * - Production: TEST_MODE=production with external-built uses production inspector, same connect flow.
 */
test.describe("Debugger Tools - Live Widget Updates", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    // await page.evaluate(() => localStorage.clear());

    // const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    // if (usesBuiltinInspector) {
    await goToInspectorWithAutoConnectAndOpenTools(page, {
      waitForWidgets: true,
    });
    // } else {
    //   await page.goto(inspectorUrl);
    //   await connectToConformanceServer(page);
    //   await navigateToTools(page);
    // }
  });

  test.describe("Apps SDK Protocol", () => {
    test("device type toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      const frame = getAppsSdkWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { device: "desktop" });

      await changeDeviceType(page, "mobile");
      const frameAfter = await switchToAppsSdkAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { device: "mobile" });
    });

    test("locale toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      const frame = getAppsSdkWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { locale: "en-US" });

      await changeLocale(page, "fr-FR");
      const frameAfter = await switchToAppsSdkAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { locale: "fr-FR" });
    });

    test("touch capability toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      const frame = getAppsSdkWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { touch: false });

      await toggleTouch(page, true);
      const frameAfter = await switchToAppsSdkAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { touch: true });
    });

    test("hover capability toggle - button state updates", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);

      await toggleHover(page, true);
      const hoverBtn = page.getByTestId("debugger-hover-button");
      await expect(hoverBtn).toHaveClass(/border-blue/, { timeout: 5000 });
    });

    test("safe area insets - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      const frame = getAppsSdkWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { safeArea: "0/0/0/0" });

      await updateSafeAreaInsets(page, {
        top: 20,
        right: 0,
        bottom: 34,
        left: 0,
      });
      const frameAfter = await switchToAppsSdkAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { safeArea: "20/0/34/0" });
    });
  });

  test.describe("MCP Apps Protocol", () => {
    test("device type toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);
      const frame = getMcpAppsWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { device: "desktop" });

      await changeDeviceType(page, "mobile");
      const frameAfter = await switchToMcpAppsAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { device: "mobile" });
    });

    test("locale toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);
      const frame = getMcpAppsWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { locale: "en-US" });

      await changeLocale(page, "ja-JP");
      const frameAfter = await switchToMcpAppsAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { locale: "ja-JP" });
    });

    test("timezone toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);

      await changeTimezone(page, "Europe/Paris");
      const frameAfter = await switchToMcpAppsAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { timezone: "Europe/Paris" });
    });

    test("touch capability toggle - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);
      const frame = getMcpAppsWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { touch: false });

      await toggleTouch(page, true);
      const frameAfter = await switchToMcpAppsAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { touch: true });
    });

    test("hover capability toggle - button state updates", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);

      await toggleHover(page, true);
      const hoverBtn = page.getByTestId("debugger-hover-button");
      await expect(hoverBtn).toHaveClass(/border-blue/, { timeout: 5000 });
    });

    test("safe area insets - updates widget live", async ({ page }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);
      const frame = getMcpAppsWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { safeArea: "0/0/0/0" });

      await updateSafeAreaInsets(page, {
        top: 10,
        right: 10,
        bottom: 10,
        left: 10,
      });
      const frameAfter = await switchToMcpAppsAndGetFrame(page);
      await verifyWidgetDebugInfo(frameAfter, { safeArea: "10/10/10/10" });
    });

    test("CSP mode toggle - dialog works", async ({ page }) => {
      //TODO
    });
  });

  test.describe("Resources Tab with Debugger", () => {
    test("toggle changes then Resources tab - Tools widget still works", async ({
      page,
    }) => {
      await executeWeatherTool(page, { city: "tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await changeLocale(page, "de-DE");
      let frame = await switchToAppsSdkAndGetFrame(page);
      await verifyWidgetDebugInfo(frame, { locale: "de-DE" });

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();
      await page.getByTestId("resource-item-static_text").click();
      await expect(page.getByTestId("resource-result-json")).toBeVisible({
        timeout: 5000,
      });

      await page.getByRole("tab", { name: /Tools/ }).first().click();
      await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
      await page.getByTestId("tool-item-get-weather-delayed").click();
      await page.getByTestId("tool-result-view-chatgpt-app").click();
      frame = getAppsSdkWeatherFrame(page);
      await verifyWidgetDebugInfo(frame, { locale: "de-DE" });
    });
  });

  test.describe("Props Configuration", () => {
    test("manual props setting - updates widget live", async ({ page }) => {
      // Navigate to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);

      // Get initial frame
      const initialFrame = getWeatherResourceFrame(page);
      // Wait for widget to load
      await expect(initialFrame.locator("body")).toBeVisible({
        timeout: 5000,
      });

      // Open props dialog
      await openPropsDialog(page);

      // Configure props manually with custom values
      await configurePropsManually(page, "Custom Weather", {
        city: "Paris",
        temperature: "25",
        conditions: "Sunny",
        humidity: "65",
        windSpeed: "15",
      });

      // Verify widget rerenders with new prop values
      const frame = getWeatherResourceFrame(page);
      await verifyWeatherWidgetProps(frame, {
        city: "Paris",
        temperature: "25",
        conditions: "Sunny",
        humidity: "65",
        windSpeed: "15",
      });
    });

    test("LLM props generation - generates and applies props", async ({
      page,
    }) => {
      // Configure LLM API key first
      const apiKey = process.env.OPENAI_API_KEY || "";
      if (!apiKey) {
        test.skip();
        return;
      }

      // Configure LLM using shared helper
      await configureLLMAPI(page);

      // Navigate to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);

      // Get initial frame
      const initialFrame = getWeatherResourceFrame(page);
      await expect(initialFrame.locator("body")).toBeVisible({
        timeout: 5000,
      });

      // Open props dialog
      await openPropsDialog(page);

      // Configure props via LLM
      await configurePropsViaLLM(page, "LLM Generated");

      // Verify widget updated (LLM should generate reasonable weather values)
      const frame = getWeatherResourceFrame(page);
      // Check that the widget body is visible (props were applied)
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Verify at least the city name appears in the widget
      // (we can't predict exact LLM output, but city should be present)
      const cityElement = frame.getByText(/[A-Z][a-z]+/);
      await expect(cityElement.first()).toBeVisible({ timeout: 5000 });
    });

    test("props presets persist after page refresh", async ({ page }) => {
      // Navigate to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);

      // Get initial frame
      const initialFrame = getWeatherResourceFrame(page);
      await expect(initialFrame.locator("body")).toBeVisible({
        timeout: 5000,
      });

      // Open props dialog and create a preset
      await openPropsDialog(page);
      await configurePropsManually(page, "Berlin Weather", {
        city: "Berlin",
        temperature: "18",
        conditions: "Cloudy",
        humidity: "70",
        windSpeed: "20",
      });

      // Verify widget shows Berlin data
      let frame = getWeatherResourceFrame(page);
      await verifyWeatherWidgetProps(frame, {
        city: "Berlin",
        temperature: "18",
      });

      // Refresh the page
      await page.reload();

      // Wait for reconnection and navigation
      await goToInspectorWithAutoConnectAndOpenTools(page, {
        waitForWidgets: true,
      });

      // Navigate back to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);
      frame = getWeatherResourceFrame(page);
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Open props popover and verify preset is available
      await page.getByTestId("debugger-props-button").click();
      await expect(page.getByTestId("debugger-props-popover")).toBeVisible();

      // Find the preset by looking for a button containing "Berlin Weather"
      const berlinPresetButton = page.getByRole("button", {
        name: "Berlin Weather",
      });
      await expect(berlinPresetButton).toBeVisible();

      // Click the preset to apply it
      await berlinPresetButton.click();

      // Verify widget still shows Berlin data after refresh
      frame = getWeatherResourceFrame(page);
      await verifyWeatherWidgetProps(frame, {
        city: "Berlin",
        temperature: "18",
        conditions: "Cloudy",
      });
    });
  });

  test.describe("Display Mode Controls", () => {
    test("fullscreen mode - Resources tab", async ({ page }) => {
      // Navigate to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);

      // Wait for widget to load
      const frame = getWeatherResourceFrame(page);
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Verify inline mode initially
      await verifyInlineMode(page);

      // Enter fullscreen mode
      await enterFullscreenMode(page);

      // Verify fullscreen mode is active
      await verifyFullscreenMode(page);

      // Widget should still be visible in fullscreen
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Exit fullscreen mode
      await exitFullscreenMode(page);

      // Verify back to inline mode
      await verifyInlineMode(page);

      // Widget should still be visible after exiting
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });
    });

    test("PiP mode - Resources tab", async ({ page }) => {
      // Navigate to Resources tab and select weather-display
      await navigateToResourcesAndSelectWeather(page);

      // Wait for widget to load
      const frame = getWeatherResourceFrame(page);
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Verify inline mode initially
      await verifyInlineMode(page);

      // Enter PiP mode
      await enterPipMode(page);

      // Verify PiP mode is active
      await verifyPipMode(page);

      // Widget should still be visible in PiP
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Exit PiP mode
      await exitPipMode(page);

      // Verify back to inline mode
      await verifyInlineMode(page);

      // Widget should still be visible after exiting
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });
    });

    test("fullscreen mode - Tools tab", async ({ page }) => {
      // Execute weather tool to get MCP Apps widget
      await executeWeatherTool(page, { city: "London", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);

      // Click to view MCP Apps result
      await page.getByTestId("tool-result-view-mcp-apps").click();

      // Wait for MCP Apps widget to load
      const frame = getMcpAppsWeatherFrame(page);
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Verify inline mode initially
      await verifyInlineMode(page);

      // Enter fullscreen mode
      await enterFullscreenMode(page);

      // Verify fullscreen mode is active
      await verifyFullscreenMode(page);

      // Widget should still be visible in fullscreen
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Exit fullscreen mode
      await exitFullscreenMode(page);

      // Verify back to inline mode
      await verifyInlineMode(page);

      // Widget should still be visible after exiting
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });
    });

    test("PiP mode - Tools tab", async ({ page }) => {
      // Execute weather tool to get MCP Apps widget
      await executeWeatherTool(page, { city: "Tokyo", delay: "2000" });
      await waitForWeatherWidgetAppsSdk(page);
      await waitForWeatherWidgetMcpApps(page);

      // Click to view MCP Apps result
      await page.getByTestId("tool-result-view-mcp-apps").click();

      // Wait for MCP Apps widget to load
      const frame = getMcpAppsWeatherFrame(page);
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Verify inline mode initially
      await verifyInlineMode(page);

      // Enter PiP mode
      await enterPipMode(page);

      // Verify PiP mode is active
      await verifyPipMode(page);

      // Widget should still be visible in PiP
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });

      // Exit PiP mode
      await exitPipMode(page);

      // Verify back to inline mode
      await verifyInlineMode(page);

      // Widget should still be visible after exiting
      await expect(frame.locator("body")).toBeVisible({ timeout: 5000 });
    });
  });
});
