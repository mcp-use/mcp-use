import { describe, expect, it } from "vitest";
import { BrowserMCPClient } from "../../../src/core/browser.js";
import type { BaseConnector } from "../../../src/transport/base.js";

class TestBrowserClient extends BrowserMCPClient {
  createConnector(config: Record<string, any>): BaseConnector {
    return this.createConnectorFromConfig(config);
  }
}

describe("BrowserMCPClient.createConnectorFromConfig", () => {
  it("expands the capabilities.views shorthand into the MCP Apps extension", () => {
    const client = new TestBrowserClient({});
    const connector = client.createConnector({
      url: "https://mcp.example.com",
      clientOptions: {
        capabilities: { views: true },
      },
    });

    const options = (connector as unknown as { opts: Record<string, any> })
      .opts;
    expect(options.clientOptions.capabilities.extensions).toEqual({
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    });
  });

  it("preserves other capabilities when expanding the views shorthand", () => {
    const client = new TestBrowserClient({});
    const connector = client.createConnector({
      url: "https://mcp.example.com",
      clientOptions: {
        capabilities: { roots: { listChanged: true }, views: true },
      },
    });

    const options = (connector as unknown as { opts: Record<string, any> })
      .opts;
    expect(options.clientOptions.capabilities).toEqual({
      roots: { listChanged: true },
      extensions: {
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      },
    });
  });

  it("forwards roots to the connector", () => {
    const client = new TestBrowserClient({});
    const connector = client.createConnector({
      url: "https://mcp.example.com",
      roots: [{ uri: "app://workspace", name: "Workspace" }],
    });

    expect(connector.getRoots()).toEqual([
      { uri: "app://workspace", name: "Workspace" },
    ]);
  });

  it("forwards defaultRequestOptions to the connector", () => {
    const client = new TestBrowserClient({});
    const connector = client.createConnector({
      url: "https://mcp.example.com",
      defaultRequestOptions: { timeout: 15000 },
    });

    const options = (connector as unknown as { opts: Record<string, any> })
      .opts;
    expect(options.defaultRequestOptions).toEqual({ timeout: 15000 });
  });
});
