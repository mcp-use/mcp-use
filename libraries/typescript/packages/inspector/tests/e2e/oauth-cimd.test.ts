import { expect, test } from "@playwright/test";
import { getInspectorClientMetadataUrl } from "../../src/shared/oauth-metadata.js";
import {
  startCimdFixture,
  startInspectorFixture,
} from "./fixtures/cimd-server.js";
import { fillOAuthClientCredentials } from "./helpers/auth.js";

for (const mode of ["cimd", "dcr", "static"] as const) {
  for (const connectionMode of ["auto", "proxy"] as const) {
    test(`${mode} OAuth via ${connectionMode}, callback, reload and refresh`, async ({
      page,
    }) => {
      const fixture = await startCimdFixture(mode);
      try {
        await page.goto("/inspector");
        if (mode === "static") {
          await fillOAuthClientCredentials(page, {
            clientId: "static-client",
            scope: "read",
          });
        } else {
          // A scope-only config must not erase the application's CIMD default.
          await fillOAuthClientCredentials(page, {
            clientId: "",
            scope: "read",
          });
        }
        await page
          .getByTestId("connection-form-url-input")
          .fill(fixture.mcpUrl);
        if (connectionMode === "proxy") {
          await page.getByTestId("connection-form-config-button").click();
          await page
            .getByTestId("config-dialog-connection-mode-select")
            .click();
          await page
            .getByRole("option", { name: "Proxy", exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Save", exact: true })
            .click();
        }
        await page.getByTestId("connection-form-connect-button").click();
        await page.getByTestId("server-tile-authenticate").click();
        await expect(page.getByTestId("tool-item-verify_auth")).toBeVisible({
          timeout: 30_000,
        });

        const callback = `${new URL(page.url()).origin}/inspector/oauth/callback`;
        expect(fixture.observations).toMatchObject({
          metadataFetches: mode === "cimd" ? 1 : 0,
          tokenExchanges: 1,
          clientId:
            mode === "cimd"
              ? getInspectorClientMetadataUrl(callback)
              : mode === "dcr"
                ? "dcr-client"
                : "static-client",
          redirectUri: callback,
          scope: "read",
        });
        if (mode === "dcr") {
          expect(fixture.observations.registrations).toBeGreaterThan(0);
        } else {
          expect(fixture.observations.registrations).toBe(0);
        }

        // Restore the saved connection and force the resource to reject its
        // access token. A successful tool call must use the refreshed token.
        fixture.expireAccessTokens();
        await page.reload();
        await expect(page.getByTestId("tool-item-verify_auth")).toBeVisible({
          timeout: 30_000,
        });
        await page.getByTestId("tool-item-verify_auth").click();
        await page.getByTestId("tool-execution-execute-button").click();
        await expect(
          page
            .getByText("Authenticated tool call succeeded", { exact: true })
            .first()
        ).toBeVisible();
        expect(fixture.observations.refreshes).toBeGreaterThanOrEqual(1);
        expect(fixture.observations.toolCalls).toBe(1);
        expect(fixture.observations.tokenExchanges).toBe(1);
      } finally {
        await fixture.close();
      }
    });
  }
}

for (const location of ["loopback", "https"] as const) {
  test(`CIMD with a custom mount path on ${location}`, async ({ page }) => {
    const basePath = "/custom/mcp";
    const inspector = await startInspectorFixture(basePath);
    const fixture = await startCimdFixture();
    const origin =
      location === "loopback"
        ? inspector.origin
        : "https://inspector.example.com";
    try {
      if (location === "https") {
        // Playwright routing does not intercept the second request of a
        // redirect chain. Start a fresh navigation to the exact OAuth callback
        // so the test's synthetic HTTPS hostname stays inside this fixture.
        await page.route(
          `${new URL(fixture.mcpUrl).origin}/authorize?**`,
          async (route) => {
            const response = await route.fetch({ maxRedirects: 0 });
            expect(response.status()).toBe(302);
            await route.fulfill({
              status: 200,
              contentType: "text/html",
              body: `<script>location.replace(${JSON.stringify(response.headers().location)})</script>`,
            });
          }
        );
        // Model HTTPS termination without a public deployment or external DNS.
        // The browser keeps the public origin while the built server handles
        // every UI, callback and proxy request on its local listener.
        await page.route(`${origin}/**`, async (route) => {
          const request = route.request();
          const response = await route.fetch({
            url: request.url().replace(origin, inspector.origin),
            headers: {
              ...request.headers(),
              "x-forwarded-host": "inspector.example.com",
              "x-forwarded-proto": "https",
              host: "inspector.example.com",
            },
          });
          await route.fulfill({ response });
        });
      }
      await page.goto(`${origin}${basePath}/inspector`);
      await page.getByTestId("connection-form-url-input").fill(fixture.mcpUrl);
      await page.getByTestId("connection-form-config-button").click();
      await page.getByTestId("config-dialog-connection-mode-select").click();
      await page.getByRole("option", { name: "Proxy", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await page.getByTestId("connection-form-connect-button").click();
      await page.getByTestId("server-tile-authenticate").click();
      await expect(page.getByTestId("tool-item-verify_auth")).toBeVisible({
        timeout: 30_000,
      });
      const callback = `${origin}${basePath}/inspector/oauth/callback`;
      expect(fixture.observations).toMatchObject({
        clientId: getInspectorClientMetadataUrl(callback),
        redirectUri: callback,
        registrations: 0,
        tokenExchanges: 1,
      });
    } finally {
      await fixture.close();
      await inspector.close();
    }
  });
}
