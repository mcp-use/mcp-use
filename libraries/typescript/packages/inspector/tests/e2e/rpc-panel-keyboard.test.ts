import { expect, test } from "@playwright/test";
import { getTestMatrix } from "./helpers/test-matrix";
import { openRpcPanel } from "./helpers/connection";

test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("MCP_USE_ANONYMIZED_TELEMETRY", "false");
    if (!localStorage.getItem("inspector-rpc-logger-open")) {
      localStorage.setItem("inspector-rpc-logger-open", "false");
    }
  });
  const matrix = getTestMatrix();
  const inspectorUrl = baseURL || matrix.inspectorUrl;
  const origins = new Set([
    new URL(inspectorUrl).origin,
    new URL(matrix.serverUrl).origin,
  ]);
  await page.route("**/*", (route) =>
    origins.has(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort()
  );
  await page.goto(
    matrix.usesBuiltinInspector
      ? inspectorUrl
      : `${inspectorUrl}?autoConnect=${encodeURIComponent(matrix.serverUrl)}`
  );
  await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();
});

test("Tab skips the collapsed RPC panel", async ({ page }) => {
  const panel = page.locator('aside[aria-label="RPC Panel"]');
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(0);
  await page.getByTestId("tool-item-test_simple_text").focus();
  for (let index = 0; index < 40; index++) {
    await page.keyboard.press("Tab");
    expect(
      await panel.evaluate((element) =>
        element.contains(document.activeElement)
      )
    ).toBe(false);
  }
});

test("open RPC controls stay keyboard accessible and retain their state", async ({
  page,
}) => {
  const panel = page.locator('aside[aria-label="RPC Panel"]');
  await openRpcPanel(page);
  await expect
    .poll(async () => (await panel.boundingBox())?.width || 0)
    .toBeGreaterThan(100);
  const copy = panel.getByRole("button", { name: "Copy filtered RPC traffic" });
  await page.getByTestId("tool-item-test_simple_text").focus();
  for (
    let index = 0;
    index < 40 &&
    !(await copy.evaluate((element) => element === document.activeElement));
    index++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(copy).toBeFocused();
  await page.keyboard.press("Tab");
  const download = panel.getByRole("button", {
    name: "Download filtered RPC traffic as JSON",
  });
  await expect(download).toBeFocused();
  await expect(download).toBeVisible();
  expect(
    await download.evaluate((element) => element.matches(":focus-visible"))
  ).toBe(true);
  const buttonBox = await download.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
    panelBox!.x + panelBox!.width
  );
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("button", { name: "Clear RPC traffic" })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const search = panel.getByRole("textbox", { name: "Search RPC traffic" });
  await expect(search).toBeFocused();
  const uiFilter = panel.getByRole("checkbox", { name: "UI", exact: true });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(uiFilter).toBeFocused();
  await page.keyboard.press("Space");
  await expect(uiFilter).not.toBeChecked();
  await search.fill("initialize");
  const toggle = page.getByRole("switch", { name: "RPC Panel" }).first();
  await toggle.click();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await toggle.click();
  await expect(search).toHaveValue("initialize");
  await expect(uiFilter).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("inspector-rpc-logger-open"))
    )
    .toBe("true");
  await page.reload();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(
    panel.getByRole("textbox", { name: "Search RPC traffic" })
  ).toBeVisible();
  await page.getByRole("switch", { name: "RPC Panel" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("inspector-rpc-logger-open"))
    )
    .toBe("false");
  await page.reload();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
});
