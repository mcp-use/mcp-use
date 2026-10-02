import { describe, expect, it, vi } from "vitest";
import { BrowserMCPClient } from "../../../src/core/browser.js";
import type { BaseConnector } from "../../../src/transport/base.js";

class TestBrowserMCPClient extends BrowserMCPClient {
  createConnector(serverConfig: Record<string, unknown>): BaseConnector {
    return this.createConnectorFromConfig(serverConfig);
  }
}

describe("BrowserMCPClient OAuth proxy fetch", () => {
  it("passes the configured fetch through the OAuth provider scoped proxy", () => {
    const baseFetch = vi.fn() as unknown as typeof fetch;
    const proxiedFetch = vi.fn() as unknown as typeof fetch;
    const getProxyFetch = vi.fn(() => proxiedFetch);
    const authProvider = { getProxyFetch };

    const client = new TestBrowserMCPClient();
    const connector = client.createConnector({
      url: "https://mcp.example.com/mcp",
      fetch: baseFetch,
      authProvider,
    });

    expect(getProxyFetch).toHaveBeenCalledOnce();
    expect(getProxyFetch).toHaveBeenCalledWith(baseFetch);
    expect(
      (connector as unknown as { customFetch?: typeof fetch }).customFetch
    ).toBe(proxiedFetch);
  });

  it("keeps the configured fetch when the OAuth provider has no scoped proxy", () => {
    const baseFetch = vi.fn() as unknown as typeof fetch;
    const client = new TestBrowserMCPClient();
    const connector = client.createConnector({
      url: "https://mcp.example.com/mcp",
      fetch: baseFetch,
      authProvider: {},
    });

    expect(
      (connector as unknown as { customFetch?: typeof fetch }).customFetch
    ).toBe(baseFetch);
  });
});
