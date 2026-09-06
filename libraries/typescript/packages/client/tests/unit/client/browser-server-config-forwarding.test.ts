import { describe, expect, it } from "vitest";

import { BrowserMCPClient } from "../../../src/core/browser.js";

/**
 * `roots` and `defaultRequestOptions` are declared on the shared
 * `BaseServerConfig`, so both environments accept them. The Node path forwards
 * them through `createConnectorFromConfig`; the browser client builds its own
 * connector options and used to drop both without a word.
 */
describe("BrowserMCPClient server configuration", () => {
  it("forwards roots and defaultRequestOptions to the connector", () => {
    const client = new BrowserMCPClient({}) as unknown as {
      createConnectorFromConfig(config: Record<string, unknown>): {
        opts: Record<string, unknown>;
      };
    };

    const connector = client.createConnectorFromConfig({
      url: "https://api.example.com/mcp",
      roots: [{ uri: "file:///work", name: "work" }],
      defaultRequestOptions: { timeout: 1234 },
    });

    expect(connector.opts).toMatchObject({
      roots: [{ uri: "file:///work", name: "work" }],
      defaultRequestOptions: { timeout: 1234 },
    });
  });
});
