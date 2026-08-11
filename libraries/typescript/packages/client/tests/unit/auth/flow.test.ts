// @vitest-environment jsdom

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

vi.mock("../../../src/auth/popup.js", () => ({
  runAuthPopup: vi.fn(),
}));

import { auth, UnauthorizedError } from "@modelcontextprotocol/client";
import { completeOAuthFlow, isUnauthorized } from "../../../src/auth/flow.js";
import { runAuthPopup } from "../../../src/auth/popup.js";

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
    vi.mocked(runAuthPopup).mockReset();
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

  it("finishes a pending flow through the official transport callback", async () => {
    const finishAuthorization = vi.fn(async () => {});
    const provider = {
      hasPendingFlow: true,
      getAuthorizationResponse: vi.fn(async () => ({
        code: "auth-code",
        iss: "https://auth.example.com",
      })),
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp", {
      finishAuthorization,
    });

    expect(finishAuthorization).toHaveBeenCalledWith(
      "auth-code",
      "https://auth.example.com"
    );
    expect(auth).not.toHaveBeenCalled();
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

  it("does not relaunch a browser flow already started by the transport", async () => {
    vi.mocked(runAuthPopup).mockResolvedValue({ kind: "success" });
    const markFlowComplete = vi.fn();
    const provider = {
      hasPendingFlow: true,
      getKey: () => "mcp:auth_server_tokens",
      getLastAttemptedAuthUrl: () =>
        "https://auth.example.com/authorize?state=stored-state",
      markFlowComplete,
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp");

    expect(auth).not.toHaveBeenCalled();
    expect(runAuthPopup).toHaveBeenCalledWith(
      expect.objectContaining({ state: "stored-state" })
    );
    expect(markFlowComplete).toHaveBeenCalledOnce();
  });

  it("launches a prepared browser flow after explicit authentication", async () => {
    vi.mocked(runAuthPopup).mockResolvedValue({ kind: "success" });
    const startAuthorization = vi.fn();
    const provider = {
      hasPendingFlow: true,
      preventAutoAuth: true,
      startAuthorization,
      getKey: () => "mcp:auth_server_tokens",
      getLastAttemptedAuthUrl: () =>
        "https://auth.example.com/authorize?state=stored-state",
    } as unknown as OAuthClientProvider;

    await completeOAuthFlow(provider, "https://example.com/mcp");

    expect(auth).not.toHaveBeenCalled();
    expect(startAuthorization).toHaveBeenCalledOnce();
    expect(runAuthPopup).toHaveBeenCalledOnce();
  });

  it("does not resolve a full-page redirect flow before navigation", async () => {
    const provider = {
      hasPendingFlow: true,
      useRedirectFlow: true,
    } as unknown as OAuthClientProvider;
    let settled = false;

    void completeOAuthFlow(provider, "https://example.com/mcp").finally(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(auth).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });
});
