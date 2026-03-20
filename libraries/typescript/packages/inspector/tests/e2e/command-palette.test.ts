import { expect, test, type Page } from "@playwright/test";
import {
  connectToConformanceServer,
  navigateToTools,
} from "./helpers/connection";

let page: Page;

test.describe("Inspector Command Palette Tests", () => {
  // Note: To run these tests with a real MCP server:
  // 1. cd packages/mcp-use/examples/server/features/conformance
  // 2. pnpm build && pnpm start --port 3002
  // Then run: pnpm test:e2e tests/e2e/command-palette.test.ts

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto("http://localhost:3000/inspector");
    await page.waitForLoadState("networkidle");
    // Clear localStorage and cookies after navigation
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Connect to conformance server
    await connectToConformanceServer(page);
    await navigateToTools(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("should open command palette with Cmd+K keyboard shortcut", async () => {
    // Press Cmd+K (Meta+K on Mac, Ctrl+K on Windows)
    await page.keyboard.press("Meta+k");

    // Verify command palette dialog opens
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Verify input is focused (ready for typing)
    await expect(page.getByTestId("command-palette-input")).toBeFocused();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette-dialog")).not.toBeVisible();
  });

  test("should open command palette with button click", async () => {
    // Click the Cmd+K button in header
    await page.getByTestId("command-palette-trigger-button").click();

    // Verify command palette dialog opens
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette-dialog")).not.toBeVisible();
  });

  test("should list all tools, prompts, and resources from conformance server", async () => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Verify tool items (conformance server has 12 tools)
    const toolItems = page.locator(
      '[data-testid^="command-palette-item-tool-"]'
    );
    await expect(toolItems.first()).toBeVisible({ timeout: 5000 });
    const toolCount = await toolItems.count();
    expect(toolCount).toBeGreaterThanOrEqual(12);

    // Verify prompt items (conformance server has 4 prompts)
    const promptItems = page.locator(
      '[data-testid^="command-palette-item-prompt-"]'
    );
    const promptCount = await promptItems.count();
    expect(promptCount).toBeGreaterThanOrEqual(4);

    // Verify resource items (conformance server has 3 resources)
    const resourceItems = page.locator(
      '[data-testid^="command-palette-item-resource-"]'
    );
    const resourceCount = await resourceItems.count();
    expect(resourceCount).toBeGreaterThanOrEqual(3);

    // Close palette
    await page.keyboard.press("Escape");
  });

  test("should navigate to tool when selected from palette", async () => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Click on a specific tool (test_simple_text)
    await page
      .getByTestId("command-palette-item-tool-test_simple_text")
      .click();

    // Verify palette closes
    await expect(page.getByTestId("command-palette-dialog")).not.toBeVisible();

    // Verify navigated to Tools tab
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();

    // Verify the tool is selected/visible
    await expect(page.getByTestId("tool-item-test_simple_text")).toBeVisible();
  });

  test("should navigate to prompt when selected from palette", async () => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Click on a specific prompt
    await page
      .getByTestId("command-palette-item-prompt-test_simple_prompt")
      .click();

    // Verify palette closes
    await expect(page.getByTestId("command-palette-dialog")).not.toBeVisible();

    // Verify navigated to Prompts tab
    await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();

    // Verify the prompt is selected/visible
    await expect(
      page.getByTestId("prompt-item-test_simple_prompt")
    ).toBeVisible();
  });

  test("should navigate to resource when selected from palette", async () => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("command-palette-dialog")).toBeVisible();

    // Click on a specific resource
    // Note: Resource IDs use the URI, which includes "://"
    await page
      .getByTestId("command-palette-item-resource-test://static-text")
      .click();

    // Verify palette closes
    await expect(page.getByTestId("command-palette-dialog")).not.toBeVisible();

    // Verify navigated to Resources tab
    await expect(
      page.getByRole("heading", { name: "Resources" })
    ).toBeVisible();

    // Verify the resource is selected/visible
    await expect(page.getByTestId("resource-item-static_text")).toBeVisible();
  });
});
