/**
 * v2 conformance coverage
 *
 * Exercises conformance-server capabilities that the v1-era suite never
 * touched: transport header parameters, JSON Schema 2020-12 inputs, client
 * capability reporting, list_changed notifications, the Notifications and
 * Elicitation tabs, and the modern input_required elicitation round-trip.
 *
 * Runs in every matrix mode: standalone inspector (mix/prod) connects through
 * the connect form, the builtin inspector auto-connects.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  connectToConformanceServer,
  countRpcMessages,
  goToInspectorWithAutoConnectAndOpenTools,
  navigateToTools,
  openRpcPanel,
  openTab,
} from "./helpers/connection";
import { getTestMatrix } from "./helpers/test-matrix";

/** Select a tool, fill string params, execute, and return the text result. */
async function runTool(
  page: Page,
  toolName: string,
  params: Record<string, string> = {}
): Promise<Locator> {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("tool-execution-execute-button")).toBeVisible();
  for (const [key, value] of Object.entries(params)) {
    await expect(page.getByTestId(`tool-param-${key}`)).toBeVisible();
    await page.getByTestId(`tool-param-${key}`).fill(value);
  }
  await page.getByTestId("tool-execution-execute-button").click();
  const result = page.getByTestId("tool-execution-results-text-content");
  await expect(result).toBeVisible({ timeout: 10000 });
  return result;
}

test.describe("v2 conformance coverage", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

    const { usesBuiltinInspector, inspectorUrl } = getTestMatrix();
    if (usesBuiltinInspector) {
      await goToInspectorWithAutoConnectAndOpenTools(page);
    } else {
      await page.goto(inspectorUrl);
      await page.evaluate(() => localStorage.clear());
      await connectToConformanceServer(page);
      await navigateToTools(page);
    }
  });

  test("test_custom_header - x-mcp-header parameter reaches the server", async ({
    page,
  }) => {
    // Known gap: the Inspector sends x-mcp-header parameters in the JSON body
    // only. The server rejects the call with "the body carries value=... but
    // the Mcp-Param-Conformance-Value header is absent". Marked as an expected
    // failure so the run stays green until the client forwards these params
    // as Mcp-Param-* headers; Playwright flags it when it starts passing.
    test.fail(
      true,
      "Inspector does not yet send x-mcp-header params as Mcp-Param-* headers"
    );
    const result = await runTool(page, "test_custom_header", {
      value: "conformance-e2e",
    });
    await expect(result).toContainText("Custom header value: conformance-e2e");
  });

  test("test_missing_capability - modern connections reject legacy sampling requests", async ({
    page,
  }) => {
    // Modern (2026-07-28) connections do not advertise the legacy sampling
    // capability, so a tool that asks for sampling/createMessage must fail
    // with the capability error rather than hang or succeed.
    await page.getByTestId("tool-item-test_missing_capability").click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeEnabled();
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(
      page.getByText(/do not declare the required capability/)
    ).toBeVisible({ timeout: 10000 });
  });

  test("json_schema_2020_12_tool - accepts input validated by a 2020-12 schema", async ({
    page,
  }) => {
    // allOf/anyOf requires phone or email; the form must accept the optional
    // properties and the server must validate the conditional schema.
    const result = await runTool(page, "json_schema_2020_12_tool", {
      email: "e2e@example.com",
    });
    await expect(result).toContainText("JSON Schema accepted");
  });

  test("test_logging_tool - completes without unsolicited log frames", async ({
    page,
  }) => {
    const result = await runTool(page, "test_logging_tool");
    await expect(result).toContainText("logging complete");
  });

  test("report-client-capabilities - Inspector advertises MCP Apps support", async ({
    page,
  }) => {
    const result = await runTool(page, "report-client-capabilities");
    await expect(result).toContainText('"supportsApps":true');
    await expect(
      page.getByTestId("tool-execution-results-structured-content")
    ).toContainText("supportsApps");
  });

  test("test_trigger_tool_change - tools/list_changed reaches the RPC panel", async ({
    page,
  }) => {
    await openRpcPanel(page);
    const result = await runTool(page, "test_trigger_tool_change");
    await expect(result).toContainText("tool list changed");

    const rows = page.getByTestId(
      "rpc-message-notifications-tools-list_changed"
    );
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await countRpcMessages(rows)).toBeGreaterThanOrEqual(1);
  });

  test("test_trigger_prompt_change - prompts/list_changed reaches the RPC panel", async ({
    page,
  }) => {
    await openRpcPanel(page);
    const result = await runTool(page, "test_trigger_prompt_change");
    await expect(result).toContainText("prompt list changed");

    const rows = page.getByTestId(
      "rpc-message-notifications-prompts-list_changed"
    );
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test("Notifications tab - lists server log notifications", async ({
    page,
  }) => {
    const result = await runTool(page, "test_tool_with_logging");
    await expect(result).toContainText("Tool execution completed with logging");

    await openTab(page, "notifications", /Notifications/);
    await expect(page.getByText("notifications/message").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("Elicitation tab - shows its empty state when nothing is pending", async ({
    page,
  }) => {
    await openTab(page, "elicitation");
    await expect(page.getByTestId("elicitation-tab-header")).toBeVisible();
    await expect(page.getByText("No elicitation requests")).toBeVisible();
  });

  test("test_input_required_result_elicitation - modern input_required round-trips through the Elicitation tab", async ({
    page,
  }) => {
    // Modern MCP replaces server-initiated elicitation with an input_required
    // tool result; the client should surface it exactly like an elicitation.
    await page
      .getByTestId("tool-item-test_input_required_result_elicitation")
      .click();
    await expect(
      page.getByTestId("tool-execution-execute-button")
    ).toBeEnabled();
    await page.getByTestId("tool-execution-execute-button").click();

    const viewDetails = page.getByTestId("elicitation-toast-view-details");
    await expect(viewDetails).toBeVisible({ timeout: 10000 });
    await viewDetails.click();

    await expect(page.getByTestId("elicitation-tab-header")).toBeVisible();
    await expect(page.getByTestId("elicitation-request-item-0")).toBeVisible();
    await page.getByTestId("elicitation-field-name").fill("Ada");
    await page.getByTestId("elicitation-accept-button").click();

    const viewToolResult = page.getByTestId("elicitation-view-tool-result");
    await expect(viewToolResult).toBeVisible({ timeout: 10000 });
    await viewToolResult.click();

    const result = page.getByTestId("tool-execution-results-text-content");
    await expect(result).toBeVisible({ timeout: 10000 });
    await expect(result).toContainText("Hello, Ada!");
  });
});
