import {
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import { describe, expect, it, vi } from "vitest";

import {
  inMemoryOAuthStore,
  oauthProxy,
  type OAuthProxyOptions,
  type OAuthProxyStore,
} from "../src/oauth/index.js";

const resource = new URL("https://mcp.example.test/mcp");
const issuer = "https://mcp.example.test/oauth";
const redirectUri = "https://client.example.test/callback";
const verifier = "v".repeat(43);

function proxyOptions(
  overrides: Partial<OAuthProxyOptions> = {}
): OAuthProxyOptions {
  return {
    authEndpoint: "https://provider.example.test/authorize",
    tokenEndpoint: "https://provider.example.test/token",
    issuer: "https://provider.example.test",
    clientId: "shared-upstream-client",
    clientSecret: "shared-upstream-secret",
    tokenEndpointAuthMethod: "client_secret_basic",
    scopes: ["read", "write"],
    verifyToken: () => ({
      payload: {
        sub: "user-1",
        email: "user@example.test",
        permissions: ["repository:read"],
      },
    }),
    ...overrides,
  } as OAuthProxyOptions;
}

async function invoke(
  middleware: NonNullable<
    ReturnType<ReturnType<typeof oauthProxy>["bind"]>["middleware"]
  >,
  request: Request
): Promise<Response> {
  return middleware(
    request,
    async () => new Response("fallback", { status: 418 })
  );
}

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("base64url");
}

function hidden(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`, "u").exec(html);
  if (match === null) throw new Error(`missing ${name}`);
  return match[1]!;
}

async function register(
  middleware: Parameters<typeof invoke>[0]
): Promise<string> {
  const response = await invoke(
    middleware,
    new Request(`${issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "read write",
      }),
    })
  );
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  expect(OAuthClientInformationFullSchema.safeParse(body).success).toBe(true);
  return (body as { client_id: string }).client_id;
}

describe("oauthProxy", () => {
  it("requires explicit coherent upstream client authentication", () => {
    expect(() =>
      oauthProxy(
        proxyOptions({
          tokenEndpointAuthMethod: "none",
          clientSecret: "must-not-be-used",
        } as never)
      )
    ).toThrow(/clientSecret must be omitted/u);
    expect(() =>
      oauthProxy(
        proxyOptions({
          tokenEndpointAuthMethod: "client_secret_post",
          clientSecret: undefined,
        } as never)
      )
    ).toThrow(/clientSecret/u);
    expect(() =>
      oauthProxy(
        proxyOptions({
          extraAuthorizeParams: { state: "reserved" },
        })
      )
    ).toThrow(/reserved/u);
    expect(() =>
      oauthProxy(proxyOptions({ scopes: ["read"], requiredScopes: ["write"] }))
    ).toThrow(/requiredScopes/u);

    const persistentPlaintextStore: OAuthProxyStore = {
      capabilities: {
        persistence: "persistent",
        secretProtection: "none",
      },
      create: async () => ({ status: "created" }),
      read: async () => ({ status: "missing" }),
      replace: async () => ({ status: "missing" }),
      consume: async () => ({ status: "missing" }),
      transaction: async (_keys, work) => work(persistentPlaintextStore),
    };
    expect(() =>
      oauthProxy(proxyOptions({ store: persistentPlaintextStore }))
    ).toThrow(/require SDK encryption/u);
    expect(() =>
      oauthProxy(
        proxyOptions({
          store: persistentPlaintextStore,
          encryption: {
            primaryKeyId: "current",
            keys: [{ id: "current", key: new Uint8Array(32) }],
          },
        })
      )
    ).not.toThrow();
    expect(() =>
      oauthProxy(
        proxyOptions({
          store: {
            ...persistentPlaintextStore,
            capabilities: {
              persistence: "persistent",
              secretProtection: "store-encrypted",
            },
          },
        })
      )
    ).not.toThrow();
  });

  it("publishes a local public-client authorization server and binds once", () => {
    expect(inMemoryOAuthStore().capabilities).toEqual({
      persistence: "process-local",
      secretProtection: "none",
    });
    const provider = oauthProxy(proxyOptions());
    const binding = provider.bind(resource);

    expect(binding.oauthMetadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["read", "write"],
    });
    expect(binding.middleware).toBeTypeOf("function");
    expect(() =>
      provider.bind(new URL("https://mcp.example.test/other"))
    ).toThrow(/multiple MCP resources/u);
    expect(() =>
      oauthProxy(proxyOptions()).bind(
        new URL("https://mcp.example.test/oauth/token")
      )
    ).toThrow(/cannot overlap/u);
  });

  it("keeps downstream tokens local while mapping the provider token explicitly", async () => {
    const upstreamRequests: Request[] = [];
    const upstreamFetch = vi.fn<typeof fetch>(async (input, init) => {
      upstreamRequests.push(new Request(input, init));
      return Response.json({
        access_token: "provider-access-secret",
        refresh_token: "provider-refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "profile",
      });
    });
    const extraAuthorizeParams = { prompt: "consent" };
    const provider = oauthProxy(
      proxyOptions({
        fetch: upstreamFetch,
        extraAuthorizeParams,
      })
    );
    extraAuthorizeParams.prompt = "mutated-after-construction";
    const binding = provider.bind(resource);
    const middleware = binding.middleware!;
    const clientId = await register(middleware);
    const authorizeUrl = new URL(`${issuer}/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "downstream-state",
      resource: resource.href,
      scope: "read write",
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
    }).toString();
    const consent = await invoke(middleware, new Request(authorizeUrl));
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const cookie = consent.headers.get("Set-Cookie")!.split(";", 1)[0]!;
    const approval = await invoke(
      middleware,
      new Request(`${issuer}/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
        body: new URLSearchParams({
          transaction_id: hidden(html, "transaction_id"),
          csrf_token: hidden(html, "csrf_token"),
          decision: "approve",
        }),
      })
    );
    const upstreamAuthorization = new URL(approval.headers.get("Location")!);
    expect(upstreamAuthorization.searchParams.get("prompt")).toBe("consent");
    expect(upstreamAuthorization.searchParams.has("resource")).toBe(false);

    const callbackUrl = new URL(`${issuer}/callback`);
    callbackUrl.searchParams.set("code", "provider-code");
    callbackUrl.searchParams.set(
      "state",
      upstreamAuthorization.searchParams.get("state")!
    );
    const callback = await invoke(
      middleware,
      new Request(callbackUrl, { headers: { Cookie: cookie } })
    );
    const downstream = new URL(callback.headers.get("Location")!);
    const localCode = downstream.searchParams.get("code")!;
    expect(localCode).not.toContain("provider");

    const tokenResponse = await invoke(
      middleware,
      new Request(`${issuer}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code: localCode,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          resource: resource.href,
        }),
      })
    );
    expect(tokenResponse.status).toBe(200);
    const localTokenBody: unknown = await tokenResponse.json();
    expect(OAuthTokensSchema.safeParse(localTokenBody).success).toBe(true);
    const localTokens = localTokenBody as {
      access_token: string;
      refresh_token: string;
    };
    expect(JSON.stringify(localTokens)).not.toContain("provider-access-secret");
    expect(localTokens.access_token).not.toBe("provider-access-secret");

    const authInfo = await binding.tokenVerifier.verifyAccessToken(
      localTokens.access_token
    );
    expect(authInfo.token).toBe(localTokens.access_token);
    expect(authInfo.resource).toEqual(resource);
    const mapped = binding.mapAuthInfo(authInfo);
    expect(mapped).toEqual({
      user: { id: "user-1", email: "user@example.test" },
      payload: {
        sub: "user-1",
        email: "user@example.test",
        permissions: ["repository:read"],
      },
      permissions: ["repository:read"],
      providerAccessToken: "provider-access-secret",
    });
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]!.headers.get("Authorization")).toMatch(
      /^Basic /u
    );
  });

  it("uses an isolated private in-memory store for each omitted store", async () => {
    const first = oauthProxy(proxyOptions()).bind(resource);
    const second = oauthProxy(proxyOptions()).bind(resource);
    const clientId = await register(first.middleware!);
    const challenge = await s256(verifier);
    const authorizeUrl = new URL(`${issuer}/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "downstream-state",
      resource: resource.href,
      scope: "read",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const response = await invoke(
      second.middleware!,
      new Request(authorizeUrl)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_client" });
  });
});
