import { expect, type FrameLocator, type Page } from "@playwright/test";

// CI environments (Docker/xvfb) need longer timeouts due to slower rendering
const CI_MULTIPLIER = process.env.CI ? 3 : 1;
const WIDGET_LOAD_TIMEOUT = 8000 * CI_MULTIPLIER;
const TOGGLE_UPDATE_TIMEOUT = 5000 * CI_MULTIPLIER;

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
    timeout: 2000 * CI_MULTIPLIER,
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
  const hasActiveClass = await btn.evaluate((el) => {
    const classAttr = (el as any).className;
    return typeof classAttr === "string" && classAttr.includes("border-blue");
  });
  if (hasActiveClass !== enabled) {
    await btn.click();
  }
}

/**
 * Toggle hover capability.
 */
export async function toggleHover(page: Page, enabled: boolean): Promise<void> {
  const btn = page.getByTestId("debugger-hover-button");
  const hasActiveClass = await btn.evaluate((el) => {
    const classAttr = (el as any).className;
    return typeof classAttr === "string" && classAttr.includes("border-blue");
  });
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

/**
 * Navigate to Resources tab and select the weather-display resource.
 */
export async function navigateToResourcesAndSelectWeather(
  page: Page
): Promise<void> {
  await page
    .getByRole("tab", { name: /Resources/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  await page.getByTestId("resource-item-weather-display").click();
  // Wait for widget iframe to appear
  await expect(page.locator('iframe[title*="weather-display"]')).toBeVisible({
    timeout: 5000,
  });
}

/**
 * Get weather-display resource widget frame (works for both MCP Apps and Apps SDK).
 */
export function getWeatherResourceFrame(page: Page): FrameLocator {
  // Try MCP Apps first (nested iframe)
  const mcpAppsOuter = page.frameLocator('iframe[title*="weather-display"]');
  const innerFrames = mcpAppsOuter.frameLocator("iframe");
  // If no inner frame, it's Apps SDK (single iframe)
  return innerFrames;
}

/**
 * Open props configuration dialog via the debugger controls.
 */
export async function openPropsDialog(page: Page): Promise<void> {
  // Click props button to open popover
  await page.getByTestId("debugger-props-button").click();
  await expect(page.getByTestId("debugger-props-popover")).toBeVisible();
  // Click "Create Preset"
  await page.getByTestId("debugger-props-create-preset").click();
  // Verify dialog opens
  await expect(page.getByTestId("props-config-dialog")).toBeVisible();
}

/**
 * Configure props manually in the props dialog.
 * The props object keys should match the schema fields (e.g., {city: "Paris", temperature: "25"}).
 */
export async function configurePropsManually(
  page: Page,
  presetName: string,
  props: Record<string, string>
): Promise<void> {
  // Enter preset name
  await page.getByTestId("props-config-preset-name").fill(presetName);

  // For schema-based props, SchemaFormField uses id={name} on inputs
  // We need to fill each prop value by finding the input with id matching the field name
  for (const [key, value] of Object.entries(props)) {
    // Schema fields are rendered by SchemaFormField - look for input with id attribute
    const input = page.locator(`input#${key}`);
    await expect(input).toBeVisible({ timeout: 2000 });
    await input.fill(value);
  }

  // Save the preset
  await page.getByTestId("props-config-save-button").click();
  // Dialog should close
  await expect(page.getByTestId("props-config-dialog")).not.toBeVisible({
    timeout: 3000,
  });

  // Close the props popover by clicking outside or pressing Escape
  // The popover may still be open after the dialog closes, which could interfere with prop application
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("debugger-props-popover")).not.toBeVisible({
    timeout: 1000,
  });
}

/**
 * Configure props using LLM generation.
 */
export async function configurePropsViaLLM(
  page: Page,
  presetName: string
): Promise<void> {
  // Enter preset name
  await page.getByTestId("props-config-preset-name").fill(presetName);

  // Wait for LLM to be available (button should appear instead of "not configured" message)
  await expect(
    page.getByTestId("props-config-generate-llm-button")
  ).toBeVisible({
    timeout: 5000,
  });

  // Click generate button
  await page.getByTestId("props-config-generate-llm-button").click();

  // Wait for generation to complete (spinner disappears)
  await expect(page.getByTestId("props-config-generating")).toBeVisible();
  await expect(page.getByTestId("props-config-generating")).not.toBeVisible({
    timeout: 30000, // LLM might take time
  });

  // Save the preset
  await page.getByTestId("props-config-save-button").click();
  // Dialog should close
  await expect(page.getByTestId("props-config-dialog")).not.toBeVisible();
}

/**
 * Verify weather widget displays expected prop values.
 * Props should include city, temperature, conditions, humidity, windSpeed.
 */
export async function verifyWeatherWidgetProps(
  frame: FrameLocator,
  props: {
    city?: string;
    temperature?: string | number;
    conditions?: string;
    humidity?: string | number;
    windSpeed?: string | number;
  }
): Promise<void> {
  if (props.city !== undefined) {
    await expect(
      frame.getByText(new RegExp(escapeRegex(props.city), "i"))
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (props.temperature !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`${escapeRegex(String(props.temperature))}°`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (props.conditions !== undefined) {
    await expect(
      frame.getByText(new RegExp(escapeRegex(props.conditions), "i"))
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (props.humidity !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`${escapeRegex(String(props.humidity))}%`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
  if (props.windSpeed !== undefined) {
    await expect(
      frame.getByText(
        new RegExp(`${escapeRegex(String(props.windSpeed))}.*km/h`, "i")
      )
    ).toBeVisible({ timeout: TOGGLE_UPDATE_TIMEOUT });
  }
}

/**
 * Enter fullscreen mode for MCP Apps widget.
 */
export async function enterFullscreenMode(page: Page): Promise<void> {
  await page.getByTestId("debugger-fullscreen-button").click();
  // Wait a bit for fullscreen animation
  await page.waitForTimeout(500);
}

/**
 * Exit fullscreen mode for MCP Apps widget.
 */
export async function exitFullscreenMode(page: Page): Promise<void> {
  await page.getByTestId("debugger-exit-fullscreen-button").click();
  // Wait a bit for exit animation
  await page.waitForTimeout(500);
}

/**
 * Enter PiP mode for MCP Apps widget.
 */
export async function enterPipMode(page: Page): Promise<void> {
  await page.getByTestId("debugger-pip-button").click();
  // Wait a bit for PiP animation
  await page.waitForTimeout(500);
}

/**
 * Exit PiP mode for MCP Apps widget.
 */
export async function exitPipMode(page: Page): Promise<void> {
  await page.getByTestId("debugger-exit-pip-button").click();
  // Wait a bit for exit animation
  await page.waitForTimeout(500);
}

/**
 * Verify fullscreen mode is active.
 */
export async function verifyFullscreenMode(page: Page): Promise<void> {
  // In fullscreen, the exit button should be visible and the enter buttons should not
  await expect(page.getByTestId("debugger-exit-fullscreen-button")).toBeVisible(
    {
      timeout: 2000,
    }
  );
  await expect(
    page.getByTestId("debugger-fullscreen-button")
  ).not.toBeVisible();
  await expect(page.getByTestId("debugger-pip-button")).not.toBeVisible();
}

/**
 * Verify PiP mode is active.
 */
export async function verifyPipMode(page: Page): Promise<void> {
  // In PiP, the exit button should be visible and the enter buttons should not
  await expect(page.getByTestId("debugger-exit-pip-button")).toBeVisible({
    timeout: 2000,
  });
  await expect(
    page.getByTestId("debugger-fullscreen-button")
  ).not.toBeVisible();
  await expect(page.getByTestId("debugger-pip-button")).not.toBeVisible();
}

/**
 * Verify inline mode is active (neither fullscreen nor PiP).
 */
export async function verifyInlineMode(page: Page): Promise<void> {
  // In inline mode, the enter buttons should be visible and exit buttons should not
  await expect(page.getByTestId("debugger-fullscreen-button")).toBeVisible({
    timeout: 2000,
  });
  await expect(page.getByTestId("debugger-pip-button")).toBeVisible();
  await expect(
    page.getByTestId("debugger-exit-fullscreen-button")
  ).not.toBeVisible();
  await expect(page.getByTestId("debugger-exit-pip-button")).not.toBeVisible();
}
