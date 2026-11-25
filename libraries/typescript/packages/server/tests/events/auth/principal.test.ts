import { describe, expect, it } from "vitest";
import { wrapOAuthTokenVerifier } from "../../../src/oauth/internal.js";

const RESOURCE = new URL("https://mcp.example.com/mcp");

function provider(principal?: (a: unknown) => string | undefined) {
  return {
    createTokenVerifier: () => ({
      verifyAccessToken: async (token: string) => ({
        token,
        clientId: "client-1",
        scopes: ["notes:read"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resource: RESOURCE,
      }),
    }),
    oauthMetadata: { issuer: "https://auth.example.com" },
    mapAuthInfo: () => ({
      user: { id: "u1" },
      payload: { iss: "https://auth.example.com/", sub: "user-42" },
      permissions: [],
    }),
    ...(principal !== undefined && { principal }),
  };
}

describe("Events principal (D13)", () => {
  it("defaults to iss|sub, computed once into authInfo.extra", async () => {
    const verifier = wrapOAuthTokenVerifier(provider() as never, RESOURCE);
    const info = await verifier.verifyAccessToken("t");
    expect(info.extra?.principal).toBe("https://auth.example.com/|user-42");
  });

  it("uses the provider's principal() when defined", async () => {
    const verifier = wrapOAuthTokenVerifier(
      provider(() => "org:7|user-42") as never,
      RESOURCE
    );
    const info = await verifier.verifyAccessToken("t");
    expect(info.extra?.principal).toBe("org:7|user-42");
  });
});
