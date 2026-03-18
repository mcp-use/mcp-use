/**
 * E2E tests for completion/autocomplete in the Inspector.
 *
 * These tests verify that the Inspector displays completion suggestions when
 * filling prompt arguments (and resource template variables, when supported).
 *
 * Prerequisite: Issue #1103 (Inspector completion UI) must be implemented
 * for these tests to pass. The completion UI adds data-testid attributes
 * such as completion-dropdown and completion-option-* for assertions.
 */

import { expect, test } from "@playwright/test";
import {
  connectToConformanceServer,
  navigateToPrompts,
} from "./helpers/connection";

test.describe("Inspector Completion", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("http://localhost:3000/inspector");
    await page.evaluate(() => localStorage.clear());
    await connectToConformanceServer(page);
    await navigateToPrompts(page);
  });

  test("prompt with completable args - should execute with completion-suggested values", async ({
    page,
  }) => {
    // Smoke test: verify the prompt flow works with values that completion would suggest.
    // The conformance server's test_prompt_with_arguments has arg1/arg2 completable
    // returning ["default1"] and ["default2"]. This validates the test setup.
    await page.getByTestId("prompt-item-test_prompt_with_arguments").click();
    await page.getByTestId("prompt-param-arg1").fill("default1");
    await page.getByTestId("prompt-param-arg2").fill("default2");
    await page.getByTestId("prompt-execute-button").click();

    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg1='default1'"
    );
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg2='default2'"
    );
  });

  test.skip("prompt argument completion - should show suggestions for completable arg1", async ({
    page,
  }) => {
    // Blocked on Issue #1103: Inspector completion UI for prompts and resource templates.
    // Once #1103 adds completion dropdown with data-testid="completion-dropdown"
    // and data-testid="completion-option-{value}" for each suggestion, remove this skip.

    await page.getByTestId("prompt-item-test_prompt_with_arguments").click();

    // Type partial value to trigger completion (conformance server returns ["default1"] for arg1)
    await page.getByTestId("prompt-param-arg1").fill("def");

    // Assert completion dropdown appears with "default1" suggestion
    const completionDropdown = page.getByTestId("completion-dropdown");
    await expect(completionDropdown).toBeVisible();
    await expect(
      page.getByTestId("completion-option-default1")
    ).toBeVisible();

    // Select the suggestion
    await page.getByTestId("completion-option-default1").click();

    // Verify arg1 was filled with the selected value
    await expect(page.getByTestId("prompt-param-arg1")).toHaveValue(
      "default1"
    );

    // Fill arg2 and execute
    await page.getByTestId("prompt-param-arg2").fill("default2");
    await page.getByTestId("prompt-execute-button").click();

    // Verify the output contains the completed values
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg1='default1'"
    );
    await expect(page.getByTestId("prompt-message-content-0")).toContainText(
      "arg2='default2'"
    );
  });
});
