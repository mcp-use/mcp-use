import {
  bearerTokenOf,
  displayClaim,
  tokenDisplayMetadata,
  tokenIdentityHash,
} from "../src/identity.js";

/**
 * Vectors computed by running the gateway's own `tokenIdentityHash` and
 * `tokenDisplayMetadata` (gateway.mcp-use/src/utils/mcp-classify.ts) on these
 * tokens. They must never change: the hash is the actor id shared by gateway
 * and SDK rows.
 */
const GATEWAY_VECTORS = [
  {
    name: "opaque token: sha256 of the token",
    token: "opaque-access-token-123",
    hash: "ccc4887895febd5f05e05990f5c7b0f7329d9647ea2a1427293eb946d3668cee",
    display: {},
  },
  {
    name: "JWT with iss and sub: sha256(iss \\0 sub)",
    token:
      "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20vIiwic3ViIjoidXNlcl80MiIsIm5hbWUiOiJBZGEgTG92ZWxhY2UiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSJ9.c2ln",
    hash: "238d30d483c596fd0d193f5776289c3f3056c95a6f581b822ea297ae2ec9a0f7",
    display: { name: "Ada Lovelace", email: "ada@example.com" },
  },
  {
    name: "JWT with non-ASCII claims: identity keeps the gateway's binary decoding",
    token:
      "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lkcC5leGFtcGxlIiwic3ViIjoidXPDqXItw7wiLCJuYW1lIjoiWm_DqyJ9.c2ln",
    hash: "9628420f73a574acfb8a2e4179b512ef17b697e050c8aba747d9be31a2d0c051",
    display: { name: "Zoë" },
  },
  {
    name: "JWT without sub: sha256 of the token",
    token: "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lkcC5leGFtcGxlIn0.c2ln",
    hash: "e13d7440420e6ad8e6c0dd83634f655741fd68114d684e74651c25533a629acf",
    display: {},
  },
  {
    name: "three segments that are not JSON: sha256 of the token",
    token: "aaa.bbb.ccc",
    hash: "ce887a8eece06ba329c188b9cf872bd8a70a0c354275fe3c435450024784c9de",
    display: {},
  },
] as const;

describe("tokenIdentityHash", () => {
  it.each(GATEWAY_VECTORS)("$name", async ({ token, hash, display }) => {
    expect(await tokenIdentityHash(token)).toBe(hash);
    expect(tokenDisplayMetadata(token)).toEqual(display);
  });
});

describe("sha256 without a global crypto (Node 18)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to node:crypto's webcrypto", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await tokenIdentityHash(GATEWAY_VECTORS[0].token)).toBe(
      GATEWAY_VECTORS[0].hash
    );
  });
});

describe("bearerTokenOf", () => {
  it("prefers the Authorization Bearer token", () => {
    expect(bearerTokenOf("Bearer abc", "other")).toBe("abc");
  });

  it("falls back to the verified authInfo token", () => {
    expect(bearerTokenOf(undefined, "from-auth-info")).toBe("from-auth-info");
    expect(bearerTokenOf("Basic dXNlcjpwYXNz", "from-auth-info")).toBe(
      "from-auth-info"
    );
  });

  it("skips Manufact API keys like the gateway", () => {
    expect(bearerTokenOf("Bearer mcp_live_123", undefined)).toBeUndefined();
    expect(bearerTokenOf(undefined, "mcp_live_123")).toBeUndefined();
  });

  it("returns undefined without a token", () => {
    expect(bearerTokenOf(undefined, undefined)).toBeUndefined();
    expect(bearerTokenOf("Bearer ", 42)).toBeUndefined();
  });
});

describe("displayClaim", () => {
  it("strips control characters and enforces the length limit", () => {
    expect(displayClaim(" Ada\u0000 ", 10)).toBe("Ada");
    expect(displayClaim("x".repeat(11), 10)).toBeUndefined();
    expect(displayClaim(5, 10)).toBeUndefined();
  });
});
