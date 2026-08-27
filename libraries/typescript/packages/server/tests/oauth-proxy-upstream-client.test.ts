import { describe, expect, it, vi } from "vitest";

import {
  UpstreamOAuthClient,
  UpstreamOAuthError,
  type UpstreamOAuthClientOptions,
} from "../src/oauth/proxy/upstream-client.js";

const issuer = "https://issuer.example.test";
const authorizationEndpoint = `${issuer}/authorize`;
const tokenEndpoint = `${issuer}/token`;
const revocationEndpoint = `${issuer}/revoke`;
const redirectUri = "https://mcp.example.test/oauth/callback";

type FetchCall = {
  url: string;
  init: RequestInit;
};

type ClientOverrides = Omit<
  Partial<UpstreamOAuthClientOptions>,
  "clientSecret" | "revocationEndpoint"
> & {
  clientSecret?: string | undefined;
  revocationEndpoint?: string | URL | undefined;
};

function recordingFetch(...responses: Response[]) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      init: init ?? {},
    });
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  });
  return { calls, fetch };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function formResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function createClient(
  fetch: typeof globalThis.fetch,
  overrides: ClientOverrides = {}
): UpstreamOAuthClient {
  return new UpstreamOAuthClient({
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
    issuer,
    clientId: "client-id",
    clientSecret: "client secret",
    tokenEndpointAuthMethod: "client_secret_basic",
    fetch,
    ...overrides,
  } as UpstreamOAuthClientOptions);
}

function bodyParams(call: FetchCall): URLSearchParams {
  expect(call.init.body).toBeInstanceOf(URLSearchParams);
  return call.init.body as URLSearchParams;
}

function headers(call: FetchCall): Headers {
  return new Headers(call.init.headers);
}

async function authorization(
  client: UpstreamOAuthClient,
  includeNonce = false
) {
  return client.createAuthorizationRequest({
    redirectUri,
    scopes: ["openid", "profile"],
    includeNonce,
  });
}

async function exchange(
  client: UpstreamOAuthClient,
  callback: Record<string, string> = {}
) {
  const created = await authorization(client);
  return client.exchangeAuthorizationCode({
    authorizationResponse: new URLSearchParams({
      code: "authorization-code",
      state: created.transaction.state,
      iss: issuer,
      ...callback,
    }),
    transaction: created.transaction,
  });
}

describe("UpstreamOAuthClient authorization", () => {
  it("constructs state-bound S256 PKCE authorization URLs with optional nonce", async () => {
    const { fetch } = recordingFetch();
    const client = createClient(fetch, {
      authorizationEndpoint: `${authorizationEndpoint}?tenant=acme`,
      authorizationParams: { access_type: "offline" },
    });
    const created = await client.createAuthorizationRequest({
      redirectUri,
      scopes: ["openid", "email"],
      includeNonce: true,
      resource: "https://api.example.test/upstream",
      extraParams: { prompt: "consent" },
    });
    const params = created.url.searchParams;

    expect(created.url.origin + created.url.pathname).toBe(
      authorizationEndpoint
    );
    expect(Object.fromEntries(params)).toMatchObject({
      tenant: "acme",
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
      client_id: "client-id",
      redirect_uri: redirectUri,
      scope: "openid email",
      state: created.transaction.state,
      code_challenge_method: "S256",
      nonce: created.transaction.nonce,
      resource: "https://api.example.test/upstream",
    });
    expect(created.transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.transaction.codeVerifier).toMatch(
      /^[A-Za-z0-9._~-]{43,128}$/
    );
    expect(created.transaction.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(created.transaction.codeVerifier)
    );
    const expectedChallenge = Buffer.from(digest).toString("base64url");
    expect(params.get("code_challenge")).toBe(expectedChallenge);
  });

  it("rejects reserved overrides and configured endpoint query collisions", async () => {
    const { fetch } = recordingFetch();
    expect(() =>
      createClient(fetch, {
        authorizationEndpoint: `${authorizationEndpoint}?client_id=attacker`,
      })
    ).toThrow(/reserved parameter client_id/);
    expect(() =>
      createClient(fetch, {
        tokenEndpoint: `${tokenEndpoint}?grant_type=client_credentials`,
      })
    ).toThrow(/reserved parameter grant_type/);

    const client = createClient(fetch, {
      authorizationEndpoint: `${authorizationEndpoint}?tenant=acme`,
    });
    await expect(
      client.createAuthorizationRequest({
        redirectUri,
        extraParams: { state: "attacker" },
      })
    ).rejects.toThrow(/reserved parameter state/);
    await expect(
      client.createAuthorizationRequest({
        redirectUri,
        extraParams: { tenant: "other" },
      })
    ).rejects.toThrow(/collides with configured parameters/);
  });

  it("requires an explicit, internally consistent client authentication method", () => {
    const { fetch } = recordingFetch();
    expect(() =>
      createClient(fetch, {
        tokenEndpointAuthMethod: "client_secret_post",
        clientSecret: undefined,
      })
    ).toThrow(/clientSecret/);
    expect(() =>
      createClient(fetch, {
        tokenEndpointAuthMethod: "none",
      })
    ).toThrow(/clientSecret must be omitted/);
    expect(() =>
      createClient(fetch, {
        tokenEndpointAuthMethod: "private_key_jwt" as never,
      })
    ).toThrow(/not supported/);
  });

  it("validates secure redirect URIs and OAuth scope syntax", async () => {
    const { fetch } = recordingFetch();
    const client = createClient(fetch);
    await expect(
      client.createAuthorizationRequest({
        redirectUri: "http://public.example.test/callback",
      })
    ).rejects.toThrow(/must use HTTPS/);
    await expect(
      client.createAuthorizationRequest({
        redirectUri,
        scopes: ["openid", "openid"],
      })
    ).rejects.toThrow(/duplicate/);
    await expect(
      client.createAuthorizationRequest({
        redirectUri,
        scopes: "openid  profile",
      })
    ).rejects.toThrow(/non-empty/);
  });

  it("preserves the lexical redirect URI including an explicit default port", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({ access_token: "access", token_type: "Bearer" })
    );
    const client = createClient(fetch);
    const lexicalRedirectUri =
      "https://mcp.example.test:443/oauth/callback?return=%2fhome";
    const created = await client.createAuthorizationRequest({
      redirectUri: lexicalRedirectUri,
    });

    expect(created.url.searchParams.get("redirect_uri")).toBe(
      lexicalRedirectUri
    );
    expect(created.transaction.redirectUri).toBe(lexicalRedirectUri);

    await client.exchangeAuthorizationCode({
      authorizationResponse: new URLSearchParams({
        code: "code",
        state: created.transaction.state,
        iss: issuer,
      }),
      transaction: created.transaction,
    });
    expect(bodyParams(calls[0]!).get("redirect_uri")).toBe(lexicalRedirectUri);
  });

  it("rejects timeout values outside the platform timer range", () => {
    const { fetch } = recordingFetch();

    expect(() => createClient(fetch, { timeoutMs: 2_147_483_648 })).toThrow(
      /must not exceed 2147483647/
    );
  });
});

describe("UpstreamOAuthClient token operations", () => {
  it("exchanges a code and parses JSON using client_secret_basic", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-token",
        scope: "openid profile",
        id_token: "signed-id-token",
        provider_field: true,
      })
    );
    const client = createClient(fetch);
    const tokens = await exchange(client);

    expect(tokens).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      refreshToken: "refresh-token",
      scope: "openid profile",
      idToken: "signed-id-token",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(tokenEndpoint);
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.credentials).toBe("omit");
    expect(headers(calls[0]!).get("authorization")).toBe(
      `Basic ${Buffer.from("client-id:client+secret").toString("base64")}`
    );
    expect(Object.fromEntries(bodyParams(calls[0]!))).toMatchObject({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: redirectUri,
    });
    expect(bodyParams(calls[0]!).has("client_id")).toBe(false);
    expect(bodyParams(calls[0]!).has("resource")).toBe(false);
  });

  it("parses form responses and authenticates public clients with none", async () => {
    const { calls, fetch } = recordingFetch(
      formResponse(
        "access_token=form-token&token_type=bearer&expires_in=120&scope=read+write"
      )
    );
    const client = createClient(fetch, {
      tokenEndpointAuthMethod: "none",
      clientSecret: undefined,
    });
    const created = await client.createAuthorizationRequest({
      redirectUri,
      resource: "https://api.example.test/upstream",
    });
    const tokens = await client.exchangeAuthorizationCode({
      authorizationResponse: new URLSearchParams({
        code: "code",
        state: created.transaction.state,
        iss: issuer,
      }),
      transaction: created.transaction,
      resource: "https://api.example.test/upstream",
    });

    expect(tokens).toMatchObject({
      accessToken: "form-token",
      expiresIn: 120,
      scope: "read write",
    });
    expect(headers(calls[0]!).has("authorization")).toBe(false);
    expect(Object.fromEntries(bodyParams(calls[0]!))).toMatchObject({
      client_id: "client-id",
      resource: "https://api.example.test/upstream",
    });
  });

  it("uses client_secret_post only when explicitly configured", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({ access_token: "access", token_type: "Bearer" })
    );
    const client = createClient(fetch, {
      tokenEndpointAuthMethod: "client_secret_post",
    });
    await exchange(client);

    expect(headers(calls[0]!).has("authorization")).toBe(false);
    expect(Object.fromEntries(bodyParams(calls[0]!))).toMatchObject({
      client_id: "client-id",
      client_secret: "client secret",
    });
  });

  it("forwards provider token parameters but rejects reserved overrides", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({ access_token: "access", token_type: "Bearer" }),
      jsonResponse({ access_token: "next", token_type: "Bearer" })
    );
    const client = createClient(fetch);
    const created = await authorization(client);

    await client.exchangeAuthorizationCode({
      authorizationResponse: new URLSearchParams({
        code: "code",
        state: created.transaction.state,
        iss: issuer,
      }),
      transaction: created.transaction,
      extraParams: { audience: "provider-api" },
    });
    await client.refreshToken({
      refreshToken: "refresh",
      extraParams: { audience: "provider-api" },
    });

    expect(bodyParams(calls[0]!).get("audience")).toBe("provider-api");
    expect(bodyParams(calls[1]!).get("audience")).toBe("provider-api");
    await expect(
      client.refreshToken({
        refreshToken: "refresh",
        extraParams: { grant_type: "client_credentials" },
      })
    ).rejects.toThrow(/reserved parameter grant_type/);
  });

  it("does not auto-forward an authorization resource into token exchange", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({ access_token: "access", token_type: "Bearer" })
    );
    const client = createClient(fetch);
    const created = await client.createAuthorizationRequest({
      redirectUri,
      resource: "https://api.example.test/upstream",
    });
    await expect(
      client.exchangeAuthorizationCode({
        authorizationResponse: new URLSearchParams({
          code: "code",
          state: created.transaction.state,
          iss: issuer,
        }),
        transaction: created.transaction,
      })
    ).rejects.toMatchObject({ code: "resource_mismatch" });
    expect(fetch).not.toHaveBeenCalled();

    await client.exchangeAuthorizationCode({
      authorizationResponse: new URLSearchParams({
        code: "code",
        state: created.transaction.state,
        iss: issuer,
      }),
      transaction: created.transaction,
      resource: "https://api.example.test/upstream",
    });

    expect(created.url.searchParams.has("resource")).toBe(true);
    expect(bodyParams(calls[0]!).get("resource")).toBe(
      "https://api.example.test/upstream"
    );
  });

  it("preserves omitted refresh tokens and scopes and accepts rotation", async () => {
    const { calls, fetch } = recordingFetch(
      jsonResponse({ access_token: "next-access", token_type: "Bearer" }),
      formResponse(
        "access_token=rotated-access&token_type=Bearer&refresh_token=rotated-refresh&scope=read"
      )
    );
    const client = createClient(fetch);
    const preserved = await client.refreshToken({
      refreshToken: "previous-refresh",
      scope: "read write",
    });
    const rotated = await client.refreshToken({
      refreshToken: preserved.refreshToken!,
      ...(preserved.scope !== undefined && { scope: preserved.scope }),
    });

    expect(preserved).toMatchObject({
      refreshToken: "previous-refresh",
      scope: "read write",
    });
    expect(rotated).toMatchObject({
      refreshToken: "rotated-refresh",
      scope: "read",
    });
    expect(Object.fromEntries(bodyParams(calls[0]!))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "previous-refresh",
      scope: "read write",
    });
  });

  it("supports RFC 7009 revocation and rejects absent configuration", async () => {
    const { calls, fetch } = recordingFetch(
      new Response(null, { status: 200 })
    );
    const client = createClient(fetch, {
      tokenEndpointAuthMethod: "client_secret_post",
    });
    await expect(
      client.revokeToken({
        token: "token-to-revoke",
        tokenTypeHint: "refresh_token",
      })
    ).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe(revocationEndpoint);
    expect(Object.fromEntries(bodyParams(calls[0]!))).toMatchObject({
      token: "token-to-revoke",
      token_type_hint: "refresh_token",
      client_id: "client-id",
      client_secret: "client secret",
    });

    const withoutRevocation = createClient(fetch, {
      revocationEndpoint: undefined,
    });
    await expect(
      withoutRevocation.revokeToken({ token: "token" })
    ).rejects.toMatchObject({ code: "revocation_not_configured" });
  });
});

describe("UpstreamOAuthClient response validation", () => {
  it("normalizes non-2xx and 2xx OAuth errors from JSON and form bodies", async () => {
    const { fetch } = recordingFetch(
      jsonResponse(
        {
          error: "invalid_grant",
          error_description: "The authorization code is invalid",
        },
        400
      ),
      formResponse(
        "error=temporarily_unavailable&error_description=Try+again",
        200
      )
    );
    const client = createClient(fetch);

    await expect(exchange(client)).rejects.toMatchObject({
      name: "UpstreamOAuthError",
      code: "invalid_grant",
      status: 400,
      description: "The authorization code is invalid",
    });
    await expect(
      client.refreshToken({ refreshToken: "refresh" })
    ).rejects.toMatchObject({
      code: "temporarily_unavailable",
      status: 200,
      description: "Try again",
    });
  });

  it("normalizes HTTP and malformed token responses", async () => {
    const { fetch } = recordingFetch(
      new Response("gateway failed", { status: 502 }),
      new Response("{bad json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      jsonResponse({ access_token: "missing-token-type" }),
      jsonResponse({
        access_token: "access",
        token_type: "Bearer",
        expires_in: "not-a-number",
      })
    );
    const client = createClient(fetch);

    await expect(exchange(client)).rejects.toMatchObject({
      code: "upstream_http_error",
      status: 502,
    });
    await expect(exchange(client)).rejects.toMatchObject({
      code: "malformed_response",
    });
    await expect(exchange(client)).rejects.toMatchObject({
      code: "malformed_response",
    });
    await expect(exchange(client)).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("never leaks configured or transaction secrets in normalized errors", async () => {
    const basicAuthorization = `Basic ${Buffer.from(
      "client-id:client+secret"
    ).toString("base64")}`;
    const { fetch } = recordingFetch(
      jsonResponse(
        {
          error: "invalid_client",
          error_description: `client secret, authorization-code, and ${basicAuthorization} must not escape`,
        },
        401
      )
    );
    const client = createClient(fetch, { clientSecret: "client secret" });
    let thrown: unknown;
    try {
      await exchange(client);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UpstreamOAuthError);
    expect(JSON.stringify(thrown)).not.toContain("client secret");
    expect(String(thrown)).not.toContain("client secret");
    expect((thrown as UpstreamOAuthError).description).toBe(
      "[REDACTED], [REDACTED], and [REDACTED] must not escape"
    );
  });

  it("rejects redirects because every upstream POST uses manual redirect mode", async () => {
    const { calls, fetch } = recordingFetch(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/token" },
      })
    );
    const client = createClient(fetch);

    await expect(exchange(client)).rejects.toMatchObject({
      code: "redirect_not_allowed",
      status: 302,
    });
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  it("times out the full request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const client = createClient(fetch, { timeoutMs: 10 });

    await expect(exchange(client)).rejects.toMatchObject({ code: "timeout" });
  });

  it("times out a stalled synthetic response-body read", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel() {
        cancelled = true;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const client = createClient(fetch, { timeoutMs: 10 });

    await expect(exchange(client)).rejects.toMatchObject({ code: "timeout" });
    expect(cancelled).toBe(true);
  });

  it("composes caller cancellation with the internal timeout", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const client = createClient(fetch, { timeoutMs: 1_000 });
    const controller = new AbortController();
    const pending = client.refreshToken({
      refreshToken: "refresh",
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("normalizes invalid UTF-8 as a malformed response", async () => {
    const { fetch } = recordingFetch(
      new Response(Uint8Array.from([0xc3, 0x28]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const client = createClient(fetch);

    await expect(exchange(client)).rejects.toMatchObject({
      code: "malformed_response",
      status: 200,
    });
  });

  it("enforces streaming response-size caps without buffering beyond the limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("access_token=12345&"));
        controller.enqueue(new TextEncoder().encode("token_type=Bearer"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = recordingFetch(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      })
    );
    const client = createClient(fetch, { maxResponseBytes: 20 });

    await expect(exchange(client)).rejects.toMatchObject({
      code: "response_too_large",
    });
    expect(cancelled).toBe(true);
  });
});

describe("UpstreamOAuthClient callback bindings", () => {
  it("accepts a missing iss by default but can require RFC 9207 issuer", async () => {
    const { fetch } = recordingFetch(
      jsonResponse({ access_token: "access", token_type: "Bearer" })
    );
    const compatibleClient = createClient(fetch);
    const compatible = await authorization(compatibleClient);
    await expect(
      compatibleClient.exchangeAuthorizationCode({
        authorizationResponse: new URLSearchParams({
          code: "code",
          state: compatible.transaction.state,
        }),
        transaction: compatible.transaction,
      })
    ).resolves.toMatchObject({ accessToken: "access" });

    const requiredClient = createClient(fetch, {
      requireAuthorizationResponseIssuer: true,
    });
    const required = await authorization(requiredClient);
    await expect(
      requiredClient.exchangeAuthorizationCode({
        authorizationResponse: new URLSearchParams({
          code: "code",
          state: required.transaction.state,
        }),
        transaction: required.transaction,
      })
    ).rejects.toMatchObject({ code: "issuer_mismatch" });
  });

  it("rejects state, issuer, duplicate parameter, and authorization errors", async () => {
    const { fetch } = recordingFetch();
    const client = createClient(fetch);
    const created = await authorization(client);
    const base = {
      transaction: created.transaction,
    };

    await expect(
      client.exchangeAuthorizationCode({
        ...base,
        authorizationResponse: new URLSearchParams({
          code: "code",
          state: "wrong",
          iss: issuer,
        }),
      })
    ).rejects.toMatchObject({ code: "state_mismatch" });
    await expect(
      client.exchangeAuthorizationCode({
        ...base,
        authorizationResponse: new URLSearchParams({
          code: "code",
          state: created.transaction.state,
          iss: "https://other.example.test",
        }),
      })
    ).rejects.toMatchObject({ code: "issuer_mismatch" });
    const duplicate = new URLSearchParams({
      code: "code",
      state: created.transaction.state,
      iss: issuer,
    });
    duplicate.append("state", created.transaction.state);
    await expect(
      client.exchangeAuthorizationCode({
        ...base,
        authorizationResponse: duplicate,
      })
    ).rejects.toMatchObject({ code: "invalid_authorization_response" });
    await expect(
      client.exchangeAuthorizationCode({
        ...base,
        authorizationResponse: new URLSearchParams({
          error: "access_denied",
          error_description: "User denied access",
          state: created.transaction.state,
          iss: issuer,
        }),
      })
    ).rejects.toMatchObject({
      code: "access_denied",
      description: "User denied access",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates nonce only against explicitly supplied verified claims", async () => {
    const { fetch } = recordingFetch();
    const client = createClient(fetch);
    const created = await authorization(client, true);

    expect(() =>
      client.validateVerifiedIdTokenClaims(created.transaction, {
        nonce: created.transaction.nonce,
      })
    ).not.toThrow();
    expect(() =>
      client.validateVerifiedIdTokenClaims(created.transaction, {
        nonce: "wrong",
      })
    ).toThrow(expect.objectContaining({ code: "nonce_mismatch" }));
    expect(() =>
      client.validateVerifiedIdTokenClaims(created.transaction, {
        id_token: `header.${Buffer.from(
          JSON.stringify({ nonce: created.transaction.nonce })
        ).toString("base64url")}.signature`,
      })
    ).toThrow(expect.objectContaining({ code: "nonce_mismatch" }));
  });
});
