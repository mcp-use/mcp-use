/**
 * MCPClient auto-OAuth: provisions createDefaultOAuthProvider for HTTP servers
 * and completes the 401 dance once before retrying.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import { BaseMCPClient } from "../../../src/core/base.js";
import type { BaseConnector } from "../../../src/transport/base.js";
import type {
  AutoOAuthOptions,
  ServerConfig,
} from "../../../src/core/config.js";
import { shouldAutoProvisionOAuth } from "../../../src/core/config.js";
import * as flow from "../../../src/auth/flow.js";

vi.mock("../../../src/auth/flow.js", async (importOriginal) => {
  const actual = await importOriginal<typeof flow>();
  return {
    ...actual,
    completeOAuthFlow: vi.fn(async () => {}),
  };
});

function makeConnector(connectImpl: () => Promise<void>): BaseConnector {
  let connected = false;
  return {
    connect: vi.fn(async () => {
      await connectImpl();
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    initialize: vi.fn(async () => {}),
    // Session uses isClientConnected (not isConnected) to decide auto-connect.
    get isClientConnected() {
      return connected;
    },
    clientInfo: { name: "test", version: "0.0.0" },
  } as unknown as BaseConnector;
}

class TestClient extends BaseMCPClient {
  createDefaultOAuthProvider = vi.fn(
    async (_url: string, _options?: AutoOAuthOptions) =>
      ({
        serverUrl: _url,
        getAuthorizationCode: vi.fn(async () => "code"),
      }) as unknown as OAuthClientProvider
  );

  createConnectorFromConfig = vi.fn((_config: ServerConfig): BaseConnector => {
    throw new Error("override in test");
  });
}

describe("shouldAutoProvisionOAuth", () => {
  it("returns true for plain HTTP url configs", () => {
    expect(shouldAutoProvisionOAuth({ url: "https://example.com/mcp" })).toBe(
      true
    );
  });

  it("returns false when authProvider, authToken, Authorization, or oauth:false", () => {
    expect(
      shouldAutoProvisionOAuth({
        url: "https://example.com/mcp",
        authProvider: {} as OAuthClientProvider,
      })
    ).toBe(false);
    expect(
      shouldAutoProvisionOAuth({
        url: "https://example.com/mcp",
        authToken: "tok",
      })
    ).toBe(false);
    expect(
      shouldAutoProvisionOAuth({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      })
    ).toBe(false);
    expect(
      shouldAutoProvisionOAuth({
        url: "https://example.com/mcp",
        oauth: false,
      })
    ).toBe(false);
  });

  it("returns false for stdio configs", () => {
    expect(
      shouldAutoProvisionOAuth({
        command: "node",
        args: ["server.js"],
      })
    ).toBe(false);
  });
});

describe("BaseMCPClient auto-OAuth createSession", () => {
  beforeEach(() => {
    vi.mocked(flow.completeOAuthFlow).mockClear();
  });

  it("calls createDefaultOAuthProvider for HTTP without bearer", async () => {
    const client = new TestClient({
      mcpServers: { demo: { url: "https://example.com/mcp" } },
    });
    const provider = { server: "provider" } as unknown as OAuthClientProvider;
    client.createDefaultOAuthProvider.mockResolvedValue(provider);

    let seenAuthProvider: unknown;
    client.createConnectorFromConfig.mockImplementation((config) => {
      seenAuthProvider = (config as { authProvider?: unknown }).authProvider;
      return makeConnector(async () => {});
    });

    await client.createSession("demo");

    expect(client.createDefaultOAuthProvider).toHaveBeenCalledWith(
      "https://example.com/mcp",
      {}
    );
    expect(seenAuthProvider).toBe(provider);
  });

  it("forwards oauth options and skips when oauth: false", async () => {
    const withOpts = new TestClient({
      mcpServers: {
        demo: {
          url: "https://example.com/mcp",
          oauth: { clientName: "app", scope: "openid" },
        },
      },
    });
    withOpts.createConnectorFromConfig.mockReturnValue(
      makeConnector(async () => {})
    );
    await withOpts.createSession("demo");
    expect(withOpts.createDefaultOAuthProvider).toHaveBeenCalledWith(
      "https://example.com/mcp",
      { clientName: "app", scope: "openid" }
    );

    const disabled = new TestClient({
      mcpServers: {
        demo: { url: "https://example.com/mcp", oauth: false },
      },
    });
    disabled.createConnectorFromConfig.mockReturnValue(
      makeConnector(async () => {})
    );
    await disabled.createSession("demo");
    expect(disabled.createDefaultOAuthProvider).not.toHaveBeenCalled();
  });

  it("skips auto-provision when authToken is set", async () => {
    const client = new TestClient({
      mcpServers: {
        demo: { url: "https://example.com/mcp", authToken: "secret" },
      },
    });
    client.createConnectorFromConfig.mockReturnValue(
      makeConnector(async () => {})
    );
    await client.createSession("demo");
    expect(client.createDefaultOAuthProvider).not.toHaveBeenCalled();
  });

  it("on 401 runs completeOAuthFlow and retries once", async () => {
    const client = new TestClient({
      mcpServers: { demo: { url: "https://example.com/mcp" } },
    });
    const provider = {
      getAuthorizationCode: vi.fn(async () => "code"),
    } as unknown as OAuthClientProvider;
    client.createDefaultOAuthProvider.mockResolvedValue(provider);

    const unauthorized = Object.assign(new Error("Unauthorized"), {
      code: 401,
    });
    let attempts = 0;
    client.createConnectorFromConfig.mockImplementation(() =>
      makeConnector(async () => {
        attempts += 1;
        if (attempts === 1) throw unauthorized;
      })
    );

    await client.createSession("demo");

    expect(flow.completeOAuthFlow).toHaveBeenCalledWith(
      provider,
      "https://example.com/mcp"
    );
    expect(attempts).toBe(2);
  });

  it("does not retry non-401 errors", async () => {
    const client = new TestClient({
      mcpServers: { demo: { url: "https://example.com/mcp" } },
    });
    client.createDefaultOAuthProvider.mockResolvedValue(
      {} as OAuthClientProvider
    );
    client.createConnectorFromConfig.mockReturnValue(
      makeConnector(async () => {
        throw new Error("boom");
      })
    );

    await expect(client.createSession("demo")).rejects.toThrow("boom");
    expect(flow.completeOAuthFlow).not.toHaveBeenCalled();
  });
});
