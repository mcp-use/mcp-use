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

  it("detects structured status and statusCode properties", () => {
    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(isUnauthorized({ status: "401" })).toBe(true);
    expect(isUnauthorized({ statusCode: 401 })).toBe(true);
    expect(isUnauthorized({ statusCode: "401" })).toBe(true);
    expect(
      isUnauthorized(
        Object.assign(new Error("Custom message"), { status: 401 })
      )
    ).toBe(true);
    expect(
      isUnauthorized(
        Object.assign(new Error("Custom message"), { statusCode: 401 })
      )
    ).toBe(true);
  });

  it("detects case-insensitive unauthorized and HTTP 401 message patterns", () => {
    expect(isUnauthorized(new Error("401 Unauthorized"))).toBe(true);
    expect(isUnauthorized(new Error("Server returned 401"))).toBe(true);
    expect(isUnauthorized(new Error("unauthorized request"))).toBe(true);
    expect(isUnauthorized(new Error("Status: 401"))).toBe(true);
    expect(isUnauthorized(new Error("Error 401: Invalid token"))).toBe(true);
  });

  it("does not false-positive on network connection errors on port 4010-4019 or port 401", () => {
    const wrappedRefusal = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4010"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(isUnauthorized(wrappedRefusal)).toBe(false);

    const directRefusal = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:4010"),
      { code: "ECONNREFUSED" }
    );
    expect(isUnauthorized(directRefusal)).toBe(false);

    const refusalOnPort401 = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:401"),
      { code: "ECONNREFUSED" }
    );
    expect(isUnauthorized(refusalOnPort401)).toBe(false);

    const unencodedRefusalWithoutCode = new Error(
      "connect ECONNREFUSED 127.0.0.1:4010"
    );
    expect(isUnauthorized(unencodedRefusalWithoutCode)).toBe(false);

    const dnsFailure = Object.assign(
      new Error("getaddrinfo ENOTFOUND server-4010.local"),
      { code: "ENOTFOUND" }
    );
    expect(isUnauthorized(dnsFailure)).toBe(false);

    const timeoutNetwork = Object.assign(
      new Error("connect ETIMEDOUT 192.168.40.10:4010"),
      { code: "ETIMEDOUT" }
    );
    expect(isUnauthorized(timeoutNetwork)).toBe(false);

    const dnsAgainFailure = Object.assign(
      new Error("getaddrinfo EAI_AGAIN server401.example.com"),
      { code: "EAI_AGAIN" }
    );
    expect(isUnauthorized(dnsAgainFailure)).toBe(false);

    const messageOnlyDnsAgain = new Error(
      "getaddrinfo EAI_AGAIN server401.example.com"
    );
    expect(isUnauthorized(messageOnlyDnsAgain)).toBe(false);

    // Non-network application codes like ERR_UNAUTHORIZED must not be suppressed
    const appUnauthorized = Object.assign(
      new Error("Unauthorized access to resource"),
      { code: "ERR_UNAUTHORIZED" }
    );
    expect(isUnauthorized(appUnauthorized)).toBe(true);
  });

  it("does not false-positive on duration timeouts or port strings", () => {
    expect(isUnauthorized(new Error("Request timed out after 401ms"))).toBe(
      false
    );
    expect(isUnauthorized(new Error("Request timed out after 401 ms"))).toBe(
      false
    );
    expect(isUnauthorized(new Error("Operation timed out after 401s"))).toBe(
      false
    );
    expect(
      isUnauthorized(new Error("Operation timed out after 401 minutes"))
    ).toBe(false);
    expect(
      isUnauthorized(new Error("Operation timed out after 401 minute"))
    ).toBe(false);
    expect(isUnauthorized(new Error("connect to port 401 failed"))).toBe(false);
    expect(
      isUnauthorized(new Error("Connection failed to 127.0.0.1:401"))
    ).toBe(false);
    expect(
      isUnauthorized(new Error("Connection failed to 192.168.1.100:401"))
    ).toBe(false);
    expect(
      isUnauthorized(new Error("Connection failed to [2001:db8::1]:401"))
    ).toBe(false);
    expect(isUnauthorized(new Error("Connection failed to [::1]:401"))).toBe(
      false
    );
    expect(
      isUnauthorized(new Error("Failed to reach api.service.internal:401"))
    ).toBe(false);
    expect(isUnauthorized(new Error("Failed to reach singlehost:401"))).toBe(
      false
    );
    expect(
      isUnauthorized(new Error("Failed to fetch https://remote.host:401/api"))
    ).toBe(false);
    expect(
      isUnauthorized(new Error("connect EADDRNOTAVAIL 2001:db8::5:401"))
    ).toBe(false);
    expect(isUnauthorized(new Error("connect EAGAIN myhost:401"))).toBe(false);
    expect(isUnauthorized(new Error("connect EHOSTDOWN 10.0.0.1:401"))).toBe(
      false
    );
    expect(isUnauthorized(new Error("connect EPROTO server:401"))).toBe(false);
    expect(isUnauthorized(new Error("connect EWOULDBLOCK myhost:401"))).toBe(
      false
    );
  });

  it("prioritizes HTTP 401 status when URL/host also uses port 401 or includes durations", () => {
    expect(
      isUnauthorized(
        new Error("Request to http://localhost:401 failed with status 401")
      )
    ).toBe(true);
    expect(
      isUnauthorized(
        new Error(
          "Request to http://localhost:401/callback returned HTTP status 401"
        )
      )
    ).toBe(true);
    expect(
      isUnauthorized(
        new Error("Request to [::1]:401 failed with status code: 401")
      )
    ).toBe(true);
    expect(
      isUnauthorized(new Error("Failed to fetch from http://api:401: HTTP 401"))
    ).toBe(true);
    expect(
      isUnauthorized(new Error("Request to myhost:401 failed (401)"))
    ).toBe(true);
    expect(
      isUnauthorized(
        new Error(
          "Operation timed out after 401ms on http://localhost:401, server returned 401"
        )
      )
    ).toBe(true);
    expect(isUnauthorized(new Error("Server returned code:401"))).toBe(true);
    expect(isUnauthorized(new Error("HTTP response:401"))).toBe(true);
    expect(isUnauthorized(new Error("status:401"))).toBe(true);
  });

  it("handles duration after error and message-only UnauthorizedError without false triggers", () => {
    // Duration immediately following error prefix must not trigger 401
    expect(isUnauthorized(new Error("Error: 401 ms elapsed"))).toBe(false);
    expect(isUnauthorized(new Error("Error: 401ms timeout"))).toBe(false);
    expect(isUnauthorized(new Error("error 401 seconds elapsed"))).toBe(false);

    // Message-only UnauthorizedError (e.g. across process/serialization boundary)
    expect(isUnauthorized(new Error("UnauthorizedError: token expired"))).toBe(
      true
    );
    expect(
      isUnauthorized(new Error("UnauthorizedException: access denied"))
    ).toBe(true);

    // Constructor name carrying 401 prefix
    class HTTP401Error extends Error {
      constructor() {
        super("request failed");
        this.name = "HTTP401Error";
      }
    }
    expect(isUnauthorized(new HTTP401Error())).toBe(true);

    // Custom error whose toString() throws must not break isUnauthorized
    const throwingToStringError = new Error("unauthorized request");
    throwingToStringError.toString = () => {
      throw new Error("poisoned toString");
    };
    expect(isUnauthorized(throwingToStringError)).toBe(true);

    const nonAuthThrowingToString = new Error(
      "connect ECONNREFUSED 127.0.0.1:4010"
    );
    nonAuthThrowingToString.toString = () => {
      throw new Error("poisoned toString");
    };
    expect(isUnauthorized(nonAuthThrowingToString)).toBe(false);
  });

  it("recursively inspects cause, data.cause, and response", () => {
    expect(
      isUnauthorized(new Error("Top-level wrapper", { cause: { status: 401 } }))
    ).toBe(true);

    expect(
      isUnauthorized({
        data: { cause: new UnauthorizedError("nested SDK error") },
      })
    ).toBe(true);

    expect(isUnauthorized({ response: { status: 401 } })).toBe(true);

    // Deep recursion safeguard (depth <= 5 is detected, depth > 5 returns false)
    let atDepth5: unknown = { status: 401 };
    for (let i = 0; i < 5; i++) {
      atDepth5 = new Error(`wrapper ${i}`, { cause: atDepth5 });
    }
    expect(isUnauthorized(atDepth5)).toBe(true);

    let atDepth6: unknown = { status: 401 };
    for (let i = 0; i < 6; i++) {
      atDepth6 = new Error(`wrapper ${i}`, { cause: atDepth6 });
    }
    expect(isUnauthorized(atDepth6)).toBe(false);
  });

  it("safely handles nullish and non-error inputs", () => {
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
    expect(isUnauthorized(0)).toBe(false);
    expect(isUnauthorized("")).toBe(false);
    expect(isUnauthorized({})).toBe(false);
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
