import { expect, test } from "@playwright/test";
import { configureLLMAPI } from "./helpers/connection";

const PYTHON_INSPECTOR_URL =
  process.env.PYTHON_INSPECTOR_URL || "http://127.0.0.1:8000/inspector";
const PYTHON_SERVER_URL =
  process.env.TEST_SERVER_URL || "http://127.0.0.1:8000/mcp";

/**
 * Python inspector opens with ?autoConnect=... and lands on Tools tab already connected.
 * Wait for the tools list to be visible (echo tool from server_example.py).
 */
async function waitForPythonServerReady(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("tool-item-echo")).toBeVisible({
    timeout: 15000,
  });
}

test.describe("python", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(PYTHON_INSPECTOR_URL);
    await page.evaluate(() => localStorage.clear());
    await waitForPythonServerReady(page);
  });

  test("tools list appears with echo tool", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
    await expect(page.getByTestId("tool-item-echo")).toBeVisible();
  });

  test("echo tool call works", async ({ page }) => {
    await page.getByTestId("tool-item-echo").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeVisible();
    await expect(page.getByTestId("tool-param-message")).toBeVisible();
    await page.getByTestId("tool-param-message").fill("Hello from E2E");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("You said: Hello from E2E");
  });

  test("chat sends message and receives response when API key configured", async ({
    page,
  }) => {
    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      test.skip();
      return;
    }
    await configureLLMAPI(page);
    await expect(page.getByTestId("chat-landing-header")).toBeVisible();
    await page.getByTestId("chat-input").fill("What is 2+2?");
    await page.getByTestId("chat-send-button").click();
    await expect(page.getByTestId("chat-message-user")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({
      timeout: 45000,
    });
  });
});
