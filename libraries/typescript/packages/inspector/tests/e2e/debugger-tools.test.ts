import { expect, test } from "@playwright/test";
import { goToInspectorWithAutoConnectAndOpenTools } from "./helpers/connection";
import {
  changeDeviceType,
  changeLocale,
  changeTimezone,
  executeWeatherTool,
  getAppsSdkWeatherFrame,
  getMcpAppsWeatherFrame,
  switchToAppsSdkAndGetFrame,
  switchToMcpAppsAndGetFrame,
  toggleHover,
  toggleTouch,
  updateSafeAreaInsets,
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
    await goToInspectorWithAutoConnectAndOpenTools(page);
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
});
