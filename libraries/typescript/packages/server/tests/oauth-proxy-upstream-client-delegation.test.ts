import {
  exchangeAuthorization,
  refreshAuthorization,
  selectClientAuthMethod,
  startAuthorization,
  validateAuthorizationResponseIssuer,
} from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpstreamOAuthClient } from "../src/oauth/proxy/upstream-client.js";

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    exchangeAuthorization: vi.fn(actual.exchangeAuthorization),
    refreshAuthorization: vi.fn(actual.refreshAuthorization),
    selectClientAuthMethod: vi.fn(actual.selectClientAuthMethod),
    startAuthorization: vi.fn(actual.startAuthorization),
    validateAuthorizationResponseIssuer: vi.fn(
      actual.validateAuthorizationResponseIssuer
    ),
  };
});

const issuer = "https://issuer.example.test";
const redirectUri = "https://mcp.example.test/oauth/callback";

describe("UpstreamOAuthClient SDK delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates standard authorization, issuer, exchange, and refresh operations", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: "refresh",
        }),
        { headers: { "content-type": "application/json" } }
      ),
      new Response(
        JSON.stringify({ access_token: "next", token_type: "Bearer" }),
        { headers: { "content-type": "application/json" } }
      ),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (response === undefined) throw new Error("No queued response");
      return response;
    });
    const client = new UpstreamOAuthClient({
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      issuer,
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenEndpointAuthMethod: "client_secret_basic",
      fetch,
    });

    expect(selectClientAuthMethod).toHaveBeenCalledOnce();
    const created = await client.createAuthorizationRequest({ redirectUri });
    expect(startAuthorization).toHaveBeenCalledOnce();
    expect(vi.mocked(startAuthorization).mock.calls[0]?.[1]).toMatchObject({
      redirectUrl: redirectUri,
      state: created.transaction.state,
    });

    const tokens = await client.exchangeAuthorizationCode({
      authorizationResponse: new URLSearchParams({
        code: "code",
        state: created.transaction.state,
        iss: issuer,
      }),
      transaction: created.transaction,
    });
    expect(validateAuthorizationResponseIssuer).toHaveBeenCalledWith({
      iss: issuer,
      expectedIssuer: issuer,
      issParameterSupported: false,
    });
    expect(exchangeAuthorization).toHaveBeenCalledOnce();
    expect(tokens.refreshToken).toBe("refresh");

    const refreshed = await client.refreshToken({
      refreshToken: tokens.refreshToken!,
    });
    expect(refreshAuthorization).toHaveBeenCalledOnce();
    expect(refreshed).toMatchObject({
      accessToken: "next",
      refreshToken: "refresh",
    });
  });
});
