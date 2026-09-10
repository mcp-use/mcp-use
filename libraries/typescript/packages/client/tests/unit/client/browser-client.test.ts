import { describe, expect, it } from "vitest";

import { BrowserMCPClient } from "../../../src/core/browser.js";
import { HttpConnector } from "../../../src/transport/http.js";

class ExposedBrowserMCPClient extends BrowserMCPClient {
  public exposeCreateConnectorFromConfig(serverConfig: Record<string, any>) {
    return this.createConnectorFromConfig(serverConfig);
  }
}

describe("BrowserMCPClient createConnectorFromConfig", () => {
  it("resolves capabilities.views shorthand into io.modelcontextprotocol/ui extension", () => {
    const client = new ExposedBrowserMCPClient({
      mcpServers: {
        uiServer: {
          url: "https://example.com/mcp",
          clientOptions: {
            capabilities: {
              views: true,
              experimental: { customFeature: true },
            },
          },
        },
      },
    });

    const connector = client.exposeCreateConnectorFromConfig({
      url: "https://example.com/mcp",
      clientOptions: {
        capabilities: {
          views: true,
          experimental: { customFeature: true },
        },
      },
    }) as HttpConnector & { opts: Record<string, any> };

    expect(connector).toBeInstanceOf(HttpConnector);
    expect(connector.opts.clientOptions).toEqual({
      capabilities: {
        experimental: { customFeature: true },
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
    });
  });

  it("forwards roots to connector and initializes rootsCache", () => {
    const client = new ExposedBrowserMCPClient();
    const roots = [{ uri: "file:///workspace", name: "Workspace Root" }];

    const connector = client.exposeCreateConnectorFromConfig({
      url: "https://example.com/mcp",
      roots,
    }) as HttpConnector & { opts: Record<string, any>; rootsCache: unknown[] };

    expect(connector.opts.roots).toEqual(roots);
    expect(connector.rootsCache).toEqual(roots);
  });

  it("forwards defaultRequestOptions to connector", () => {
    const client = new ExposedBrowserMCPClient();
    const defaultRequestOptions = {
      timeout: 15000,
    };

    const connector = client.exposeCreateConnectorFromConfig({
      url: "https://example.com/mcp",
      defaultRequestOptions,
    }) as HttpConnector & { opts: Record<string, any> };

    expect(connector.opts.defaultRequestOptions).toEqual(defaultRequestOptions);
  });

  it("preserves clientOptions when views capability is not requested", () => {
    const client = new ExposedBrowserMCPClient();
    const clientOptions = {
      capabilities: {
        tools: {},
      },
    };

    const connector = client.exposeCreateConnectorFromConfig({
      url: "https://example.com/mcp",
      clientOptions,
    }) as HttpConnector & { opts: Record<string, any> };

    expect(connector.opts.clientOptions).toEqual(clientOptions);
  });
});
