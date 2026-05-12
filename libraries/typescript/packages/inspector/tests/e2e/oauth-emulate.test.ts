/**
 * The authorize redirect is top-level navigation in both Direct and Via Proxy
 * modes (useRedirectFlow: true), so the user-picker page is driven identically;
 * the difference is whether OAuth metadata + token-exchange fetches go through
 * the inspector backend.
 */

import { expect, test } from "@playwright/test";
import {
  GOOGLE_MOCK_USER,
  startGoogleEmulateFixture,
  type GoogleEmulateHandle,
} from "./fixtures/google-emulate-server.js";

type ConnectionType = "Direct" | "Via Proxy";

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

for (const connectionType of ["Direct", "Via Proxy"] as ConnectionType[]) {
  test.describe(`OAuth flow via emulate Google (${connectionType})`, () => {
    test("completes OAuth and reaches ready state", async ({ page }) => {
      await page.getByTestId("connection-form-url-input").fill(fixture.mcpUrl);

      if (connectionType !== "Direct") {
        await page.getByTestId("connection-form-type-select").click();
        await page.getByRole("option", { name: connectionType }).click();
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
