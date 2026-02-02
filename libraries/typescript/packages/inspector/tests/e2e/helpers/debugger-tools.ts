import { expect, type FrameLocator, type Page } from "@playwright/test";

const WIDGET_LOAD_TIMEOUT = 8000;
const TOGGLE_UPDATE_TIMEOUT = 5000;

/**
 * Execute get-weather-delayed tool and wait for execution to start.
 */
export async function executeWeatherTool(
  page: Page,
  options: { city?: string; delay?: string } = {}
): Promise<void> {
  const { city = "tokyo", delay = "2000" } = options;
  await page.getByTestId("tool-item-get-weather-delayed").click();
  await expect(page.getByTestId("tool-execution-execute-button")).toBeVisible();
  await expect(page.getByTestId("tool-param-city")).toBeVisible();
  await page.getByTestId("tool-param-city").fill(city);
  await expect(page.getByTestId("tool-param-delay")).toBeVisible();
  await page.getByTestId("tool-param-delay").fill(delay);
  await page.getByTestId("tool-execution-execute-button").click();
}

/**
 * Wait for weather widget to load (spinner gone, content visible) in Apps SDK tab.
 */
export async function waitForWeatherWidgetAppsSdk(page: Page): Promise<void> {
  await expect(page.getByTestId("tool-result-view-chatgpt-app")).toBeVisible({
    timeout: 2000,
  });
  await page.getByTestId("tool-result-view-chatgpt-app").click();
  const appsSdkFrame = getAppsSdkWeatherFrame(page);
  await expect(appsSdkFrame.getByText("Host Context Settings")).toBeVisible({
    timeout: TOGGLE_UPDATE_TIMEOUT,
  });
}

/**
 * Wait for weather widget to load in MCP Apps tab.
 */
export async function waitForWeatherWidgetMcpApps(page: Page): Promise<void> {
  await expect(page.getByTestId("tool-result-view-mcp-apps")).toBeVisible();
  await page.getByTestId("tool-result-view-mcp-apps").click();
  const mcpAppsGuest = getMcpAppsWeatherFrame(page);
  await expect(mcpAppsGuest.getByText("Host Context Settings")).toBeVisible({
    timeout: WIDGET_LOAD_TIMEOUT,
  });
}

/**
 * Get Apps SDK iframe locator for get-weather-delayed widget.
 */
export function getAppsSdkWeatherFrame(page: Page): FrameLocator {
  return page.frameLocator(
    'iframe[title^="OpenAI Component: get-weather-delayed"]'
  );
}

/**
 * Get MCP Apps inner (guest) iframe locator for get-weather-delayed widget.
 */
export function getMcpAppsWeatherFrame(page: Page): FrameLocator {
  const mcpAppsOuter = page.frameLocator(
    'iframe[title^="MCP App: get-weather-delayed"]'
  );
  return mcpAppsOuter.frameLocator("iframe");
}

/**
 * Switch to Apps SDK tab and return its frame.
 */
export async function switchToAppsSdkAndGetFrame(
  page: Page
): Promise<FrameLocator> {
  await page.getByTestId("tool-result-view-chatgpt-app").click();
  return getAppsSdkWeatherFrame(page);
}

/**
 * Switch to MCP Apps tab and return guest frame.
 */
export async function switchToMcpAppsAndGetFrame(
  page: Page
): Promise<FrameLocator> {
  await page.getByTestId("tool-result-view-mcp-apps").click();
  return getMcpAppsWeatherFrame(page);
}

/**
 * Change device type via debugger controls.
 */
export async function changeDeviceType(
  page: Page,
  device: "desktop" | "mobile" | "tablet"
): Promise<void> {
  await page.getByTestId("debugger-device-button").click();
  await expect(page.getByTestId("debugger-device-dialog")).toBeVisible();
  await page.getByTestId(`debugger-device-option-${device}`).click();
  await expect(page.getByTestId("debugger-device-dialog")).not.toBeVisible();
}

/**
 * Change locale via debugger controls. Use search to find and select.
 */
export async function changeLocale(
  page: Page,
  localeValue: string
): Promise<void> {
  await page.getByTestId("debugger-locale-button").click();
  await expect(page.getByTestId("debugger-locale-dialog")).toBeVisible();
  await page.getByTestId("debugger-locale-search").fill(localeValue);
  await page
    .getByTestId(`debugger-locale-option-${localeValue}`)
    .first()
    .click();
  await expect(page.getByTestId("debugger-locale-dialog")).not.toBeVisible();
}

/**
 * Change timezone via debugger controls (MCP Apps only).
 * timezoneValue is e.g. "America/New_York"; testid uses dashes: "America-New_York".
 */
export async function changeTimezone(
  page: Page,
  timezoneValue: string
): Promise<void> {
  await page.getByTestId("debugger-timezone-button").click();
  await expect(page.getByTestId("debugger-timezone-dialog")).toBeVisible();
  await page.getByTestId("debugger-timezone-search").fill(timezoneValue);
  const optionTestId = `debugger-timezone-option-${timezoneValue.replace(/\//g, "-")}`;
  await page.getByTestId(optionTestId).first().click();
  await expect(page.getByTestId("debugger-timezone-dialog")).not.toBeVisible();
}

/**
 * Toggle touch capability.
 */
export async function toggleTouch(page: Page, enabled: boolean): Promise<void> {
  const btn = page.getByTestId("debugger-touch-button");
  const hasActiveClass = await btn.evaluate((el) =>
    (el as HTMLElement).className.includes("border-blue")
  );
  if (hasActiveClass !== enabled) {
    await btn.click();
  }
}

/**
 * Toggle hover capability.
 */
export async function toggleHover(page: Page, enabled: boolean): Promise<void> {
  const btn = page.getByTestId("debugger-hover-button");
  const hasActiveClass = await btn.evaluate((el) =>
    (el as HTMLElement).className.includes("border-blue")
  );
  if (hasActiveClass !== enabled) {
    await btn.click();
  }
}

/**
 * Open safe area popover and set insets.
 */
export async function updateSafeAreaInsets(
  page: Page,
  insets: { top: number; right: number; bottom: number; left: number }
): Promise<void> {
  await page.getByTestId("debugger-safe-area-button").click();
  await expect(page.getByTestId("debugger-safe-area-dialog")).toBeVisible();
  await page.getByTestId("debugger-safe-area-top").fill(String(insets.top));
  await page.getByTestId("debugger-safe-area-right").fill(String(insets.right));
  await page
    .getByTestId("debugger-safe-area-bottom")
    .fill(String(insets.bottom));
  await page.getByTestId("debugger-safe-area-left").fill(String(insets.left));
  // Close by clicking outside or pressing Escape
  await page.keyboard.press("Escape");
}

/**
 * Change CSP mode (MCP Apps only).
 */
export async function changeCspMode(
  page: Page,
  mode: "permissive" | "widget-declared"
): Promise<void> {
  await page.getByTestId("debugger-csp-button").click();
  await expect(page.getByTestId("debugger-csp-dialog")).toBeVisible();
  await page
    .getByTestId(
      mode === "permissive"
        ? "debugger-csp-option-permissive"
        : "debugger-csp-option-widget-declared"
    )
    .click();
  await expect(page.getByTestId("debugger-csp-dialog")).not.toBeVisible();
}

export interface WidgetDebugInfoExpected {
  device?: "web" | "mobile" | "desktop" | "tablet";
  locale?: string;
  timezone?: string;
  touch?: boolean;
  safeArea?: string; // e.g. "20/0/34/0"
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verify widget "Host Context Settings" section shows expected values.
 */
export async function verifyWidgetDebugInfo(
  frame: FrameLocator,
  expected: WidgetDebugInfoExpected
): Promise<void> {
  if (expected.device !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`Device:.*${escapeRegex(expected.device)}`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (expected.locale !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`Locale:.*${escapeRegex(expected.locale)}`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (expected.timezone !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`Timezone:.*${escapeRegex(expected.timezone)}`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (expected.touch !== undefined) {
    const touchText = expected.touch ? "Touch:.*Yes" : "Touch:.*No";
    await expect(frame.getByText(new RegExp(touchText, "i"))).toBeVisible({
      timeout: TOGGLE_UPDATE_TIMEOUT,
    });
  }
  if (expected.safeArea !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`Safe Area:.*${escapeRegex(expected.safeArea)}`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
}
