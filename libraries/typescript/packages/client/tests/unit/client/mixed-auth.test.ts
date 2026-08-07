import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    discoverOAuthProtectedResourceMetadata: vi.fn(),
  };
});

import {
  discoverOAuthProtectedResourceMetadata,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { HttpConnector } from "../../../src/transport/http.js";

function createProvider(
  overrides: Partial<OAuthClientProvider & { hasPendingFlow: boolean }> = {}
): OAuthClientProvider {
  return {
    tokens: vi.fn(async () => undefined),
    redirectToAuthorization: vi.fn(async () => {}),
    hasPendingFlow: true,
    getAuthorizationResponse: vi.fn(async () => ({
      code: "authorization-code",
      iss: "https://auth.example.com",
    })),
    ...overrides,
  } as unknown as OAuthClientProvider;
}

function attachConnectedClient(
  connector: HttpConnector,
  client: Record<string, unknown>,
  transport: { finishAuth: ReturnType<typeof vi.fn> }
): void {
  Object.assign(connector as object, {
    client,
    connected: true,
    streamableTransport: transport,
  });
}

describe("mixed OAuth authorization", () => {
  beforeEach(() => {
    vi.mocked(discoverOAuthProtectedResourceMetadata).mockReset();
  });

  it("classifies an anonymous connection from official RFC 9728 metadata", async () => {
    vi.mocked(discoverOAuthProtectedResourceMetadata).mockResolvedValue({
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["search", "build"],
    });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider(),
    });
    attachConnectedClient(
      connector,
      {
        getServerCapabilities: () => ({ tools: {} }),
        getServerVersion: () => ({ name: "mixed", version: "1.0.0" }),
        getNegotiatedProtocolVersion: () => "2025-11-25",
        getProtocolEra: () => "legacy",
        listTools: vi.fn(async () => ({ tools: [{ name: "search" }] })),
      },
      { finishAuth: vi.fn(async () => {}) }
    );

    await connector.initialize();

    expect(discoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
      "https://mcp.example.com/mcp",
      { protocolVersion: "2025-11-25" },
      undefined
    );
    expect(connector.authorization).toEqual({
      mode: "mixed",
      authenticated: false,
      resource: "https://mcp.example.com/mcp",
      scopesSupported: ["search", "build"],
    });
  });

  it("finishes SDK-started OAuth and retries a protected operation once", async () => {
    const provider = createProvider();
    const finishAuth = vi.fn(async () => {});
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new UnauthorizedError("Authentication required"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "built" }],
      });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: provider,
      detectMixedAuth: false,
    });
    attachConnectedClient(connector, { callTool }, { finishAuth });

    await expect(connector.callTool("build", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "built" }],
    });

    expect(finishAuth).toHaveBeenCalledWith(
      "authorization-code",
      "https://auth.example.com"
    );
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("leaves a protected operation pending when automatic auth is disabled", async () => {
    const finishAuth = vi.fn(async () => {});
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider({ preventAutoAuth: true } as never),
      detectMixedAuth: false,
    });
    attachConnectedClient(
      connector,
      {
        callTool: vi.fn(async () => {
          throw new UnauthorizedError("Authentication required");
        }),
      },
      { finishAuth }
    );

    await expect(connector.callTool("build", {})).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    expect(finishAuth).not.toHaveBeenCalled();
  });
});
