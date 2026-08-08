/**
 * The authorize redirect is top-level navigation in both Auto and forced Proxy
 * modes (useRedirectFlow: true), so the user-picker page is driven identically.
 * Auto starts direct and can fall back; forced Proxy routes through the inspector
 * backend from the start.
 */

import { expect, test } from "@playwright/test";
import {
  GOOGLE_MOCK_USER,
  startGoogleEmulateFixture,
  type GoogleEmulateHandle,
} from "./fixtures/google-emulate-server.js";

type ConnectionMode = "auto" | "proxy";

// Both variants share one fixture on fixed ports (the MCP server's registered
// redirect URI pins us to a known port), so they must run in the same worker.
test.describe.configure({ mode: "serial" });

let fixture: GoogleEmulateHandle;

test.beforeAll(async () => {
  fixture = await startGoogleEmulateFixture();
});

test.afterAll(async () => {
  await fixture?.close();
});

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("http://localhost:3000/inspector");
  await page.evaluate(() => localStorage.clear());
});

function describeOAuthFlow(connectionMode: ConnectionMode): void {
  test.describe(`OAuth flow via emulate Google (${connectionMode})`, () => {
    test("completes OAuth and reaches ready state", async ({ page }) => {
      await page.getByTestId("connection-form-url-input").fill(fixture.mcpUrl);

      if (connectionMode !== "auto") {
        await page.getByTestId("connection-form-config-button").click();
        await page.getByTestId("config-dialog-connection-mode-select").click();
        await page.getByRole("option", { name: "Proxy" }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Save" })
          .click();
      }

      await page.getByTestId("connection-form-connect-button").click();

      await expect(
        page.getByRole("heading", { name: fixture.mcpUrl })
      ).toBeVisible({ timeout: 15_000 });

      const authenticateLink = page.getByTestId("server-tile-authenticate");
      await expect(authenticateLink).toBeVisible({ timeout: 15_000 });

      await authenticateLink.click();

      // emulate's authorize page renders one form per seeded user; pick ours by email.
      await page
        .locator("form.user-form")
        .filter({ hasText: GOOGLE_MOCK_USER.email })
        .locator("button[type=submit]")
        .click();

      await expect(page.getByTestId("tool-item-verify_auth")).toBeVisible({
        timeout: 30_000,
      });
    });
  });
}

describeOAuthFlow("auto");
describeOAuthFlow("proxy");
