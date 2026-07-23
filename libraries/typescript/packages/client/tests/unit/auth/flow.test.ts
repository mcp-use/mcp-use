import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    auth: vi.fn(),
  };
});

import { auth, UnauthorizedError } from "@modelcontextprotocol/client";
import { completeOAuthFlow, isUnauthorized } from "../../../src/auth/flow.js";

describe("isUnauthorized", () => {
  it("detects UnauthorizedError, code 401, and message wrappers", () => {
    expect(isUnauthorized(new UnauthorizedError("nope"))).toBe(true);
    expect(isUnauthorized(Object.assign(new Error("x"), { code: 401 }))).toBe(
      true
    );
    expect(isUnauthorized(new Error("HTTP 401 from server"))).toBe(true);
    expect(isUnauthorized(new Error("other"))).toBe(false);
  });
});

describe("completeOAuthFlow", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
  });

  it("returns early when auth() yields AUTHORIZED", async () => {
    vi.mocked(auth).mockResolvedValueOnce("AUTHORIZED");
    const provider = {} as OAuthClientProvider;
    await completeOAuthFlow(provider, "https://example.com/mcp");
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("exchanges code from getAuthorizationCode on REDIRECT", async () => {
    vi.mocked(auth)
      .mockResolvedValueOnce("REDIRECT")
      .mockResolvedValueOnce("AUTHORIZED");
    const getAuthorizationCode = vi.fn(async () => "auth-code");
    const provider = {
      getAuthorizationCode,
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp");

    expect(getAuthorizationCode).toHaveBeenCalledOnce();
    expect(auth).toHaveBeenCalledTimes(2);
    expect(auth).toHaveBeenLastCalledWith(
      provider,
      expect.objectContaining({
        serverUrl: "https://example.com/mcp",
        authorizationCode: "auth-code",
      })
    );
  });

  it("preserves the callback issuer from getAuthorizationResponse", async () => {
    vi.mocked(auth)
      .mockResolvedValueOnce("REDIRECT")
      .mockResolvedValueOnce("AUTHORIZED");
    const getAuthorizationResponse = vi.fn(async () => ({
      code: "auth-code",
      iss: "https://auth.example.com",
    }));
    const provider = {
      getAuthorizationResponse,
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp");

    expect(getAuthorizationResponse).toHaveBeenCalledOnce();
    expect(auth).toHaveBeenLastCalledWith(
      provider,
      expect.objectContaining({
        serverUrl: "https://example.com/mcp",
        authorizationCode: "auth-code",
        iss: "https://auth.example.com",
      })
    );
  });

  it("skips the first auth() when hasPendingFlow is set", async () => {
    vi.mocked(auth).mockResolvedValueOnce("AUTHORIZED");
    const getAuthorizationCode = vi.fn(async () => "auth-code");
    const provider = {
      hasPendingFlow: true,
      getAuthorizationCode,
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp");

    expect(getAuthorizationCode).toHaveBeenCalledOnce();
    expect(auth).toHaveBeenCalledTimes(1);
    expect(auth).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({ authorizationCode: "auth-code" })
    );
  });
});
