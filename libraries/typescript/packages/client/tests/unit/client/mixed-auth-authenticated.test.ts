import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";

// Token store the provider mock reads, and the interactive flow mock writes —
// the same effect finishAuth() has on a real OAuthClientProvider.
const providerState = vi.hoisted(() => ({
  token: undefined as string | undefined,
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    discoverOAuthProtectedResourceMetadata: vi.fn(),
  };
});

vi.mock("../../../src/auth/flow.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/auth/flow.js")>();
  return {
    ...actual,
    completeOAuthFlow: vi.fn(async () => {
      providerState.token = "access-token";
    }),
  };
});

import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import { HttpConnector } from "../../../src/transport/http.js";

const metadata = {
  resource: "https://mcp.example.com/mcp",
  authorization_servers: ["https://auth.example.com"],
  scopes_supported: ["search", "build"],
};

function createProvider(
  overrides: Partial<OAuthClientProvider> = {}
): OAuthClientProvider {
  return {
    tokens: vi.fn(async () =>
      providerState.token
        ? { access_token: providerState.token, token_type: "Bearer" }
        : undefined
    ),
    redirectToAuthorization: vi.fn(async () => {}),
    hasPendingFlow: true,
    getAuthorizationResponse: vi.fn(async () => ({
      code: "authorization-code",
      iss: "https://auth.example.com",
    })),
    ...overrides,
  } as unknown as OAuthClientProvider;
}

function attachConnectedClient(connector: HttpConnector): void {
  Object.assign(connector as object, {
    client: { getProtocolEra: () => "modern" },
    connected: true,
    streamableTransport: { finishAuth: vi.fn(async () => {}) },
  });
}

const metaMock = vi.mocked(discoverOAuthProtectedResourceMetadata);

describe("mixed-auth authorization state after authenticate()", () => {
  beforeEach(() => {
    providerState.token = undefined;
    metaMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies again after authenticate() and reports authenticated", async () => {
    metaMock.mockResolvedValue(metadata);
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider(),
    });
    attachConnectedClient(connector);

    await connector.discoverAuthorization();
    expect(connector.authorization?.authenticated).toBe(false);

    await connector.authenticate();
    expect(connector.authorization?.authenticated).toBe(true);

    // The first classification is cached for the connection, so signing in has
    // to invalidate it; otherwise this call resolves with the pre-login object.
    await expect(connector.discoverAuthorization()).resolves.toMatchObject({
      authenticated: true,
      resource: metadata.resource,
      scopesSupported: metadata.scopes_supported,
    });
    expect(metaMock).toHaveBeenCalledTimes(2);
  });

  it("an in-flight discovery does not reset authenticated to false", async () => {
    let resolveMetadata: (value: typeof metadata) => void = () => {};
    metaMock.mockImplementation(
      () => new Promise((resolve) => (resolveMetadata = resolve))
    );
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider(),
    });
    attachConnectedClient(connector);

    const discovery = connector.discoverAuthorization();
    await connector.authenticate();
    expect(connector.authorization?.authenticated).toBe(true);

    // The metadata response arrives after sign-in: it must not overwrite the
    // now-authenticated state with the pre-authentication classification.
    resolveMetadata(metadata);
    await expect(discovery).resolves.toMatchObject({ authenticated: true });
    expect(connector.authorization?.authenticated).toBe(true);
  });

  it("a token read issued before sign-in cannot undo it afterwards", async () => {
    // The token store is read after the metadata fetch. If that read was
    // issued before finishAuth() persisted the token, it resolves with an
    // empty snapshot *after* authenticate() already succeeded; the stale
    // snapshot must not downgrade the state.
    metaMock.mockResolvedValue(metadata);
    let resolveTokenRead: (value: undefined) => void = () => {};
    let firstRead = true;
    const tokens = vi.fn(() => {
      if (firstRead) {
        firstRead = false;
        return new Promise<undefined>(
          (resolve) => (resolveTokenRead = resolve)
        );
      }
      return Promise.resolve({
        access_token: "access-token",
        token_type: "Bearer",
      });
    });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider({ tokens } as Partial<OAuthClientProvider>),
    });
    attachConnectedClient(connector);

    const discovery = connector.discoverAuthorization();
    await vi.waitFor(() => expect(tokens).toHaveBeenCalled());
    await connector.authenticate();
    expect(connector.authorization?.authenticated).toBe(true);

    resolveTokenRead(undefined);
    await expect(discovery).resolves.toMatchObject({ authenticated: true });
    expect(connector.authorization?.authenticated).toBe(true);
  });

  it("keeps the fetched metadata when the token read fails", async () => {
    // A token store that throws must not cost us the RFC 9728 classification;
    // the fallback is the last known auth state.
    metaMock.mockResolvedValue(metadata);
    const tokens = vi.fn(async () => {
      throw new Error("token storage unavailable");
    });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      authProvider: createProvider({ tokens } as Partial<OAuthClientProvider>),
    });
    attachConnectedClient(connector);

    const result = await connector.discoverAuthorization();

    // The store really was read; otherwise a hardcoded `false` would pass too.
    expect(tokens).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      authenticated: false,
      resource: metadata.resource,
      scopesSupported: metadata.scopes_supported,
    });
    expect(connector.authorization?.resource).toBe(metadata.resource);
  });

  it("bounds the token read by the discovery timeout", async () => {
    vi.useFakeTimers();
    try {
      metaMock.mockResolvedValue(metadata);
      const tokens = vi.fn(() => new Promise<undefined>(() => {}));
      const connector = new HttpConnector("https://mcp.example.com/mcp", {
        authProvider: createProvider({
          tokens,
        } as Partial<OAuthClientProvider>),
      });
      attachConnectedClient(connector);

      const discovery = connector.discoverAuthorization();
      await vi.advanceTimersByTimeAsync(2000);

      // A token store that never settles must not keep discovery pending; the
      // deadline falls back to the last known state.
      await expect(discovery).resolves.toMatchObject({ authenticated: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
