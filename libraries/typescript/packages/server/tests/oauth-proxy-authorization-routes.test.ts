import {
  OAuthClientInformationFullSchema,
  OAuthClientRegistrationErrorSchema,
  OAuthErrorResponseSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthorizationCore } from "../src/oauth/proxy/authorization-core.js";
import {
  createOAuthAuthorizationRoutes,
  type OAuthAuthorizationRoutesOptions,
} from "../src/oauth/proxy/authorization-routes.js";
import { resolveOAuthProxyStore } from "../src/oauth/proxy/store.js";
import {
  UpstreamOAuthClient,
  type UpstreamOAuthClientOptions,
} from "../src/oauth/proxy/upstream-client.js";

const issuer = "https://mcp.example.test/oauth";
const resource = "https://mcp.example.test/mcp";
const redirectUri = "https://client.example.test/callback?existing=value";
const verifier = "v".repeat(43);
const fallback = new Response("fallback", { status: 418 });

interface Harness {
  readonly route: ReturnType<typeof createOAuthAuthorizationRoutes>;
  readonly core: OAuthAuthorizationCore;
  readonly fetch: ReturnType<typeof vi.fn<typeof fetch>>;
  readonly requests: Request[];
  readonly now: { value: number };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("base64url");
}

function createHarness(
  overrides: Partial<OAuthAuthorizationRoutesOptions> = {},
  tokenResponses: Array<Response | Error> = [],
  upstreamOverrides: Partial<UpstreamOAuthClientOptions> = {}
): Harness {
  const now = { value: 2_000_000_000_000 };
  const requests: Request[] = [];
  const recordingFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const next = tokenResponses.shift();
    if (next instanceof Error) throw next;
    return (
      next ??
      Response.json({
        access_token: "provider-access-secret",
        refresh_token: "provider-refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "profile",
      })
    );
  });
  const core = new OAuthAuthorizationCore({
    store: resolveOAuthProxyStore().store,
    now: () => now.value,
  });
  const upstreamClient = new UpstreamOAuthClient({
    authorizationEndpoint: "https://provider.example.test/authorize",
    tokenEndpoint: "https://provider.example.test/token",
    clientId: "shared-upstream-client",
    clientSecret: "shared-upstream-secret",
    tokenEndpointAuthMethod: "client_secret_basic",
    ...upstreamOverrides,
    fetch: recordingFetch,
  });
  return {
    core,
    fetch: recordingFetch,
    requests,
    now,
    route: createOAuthAuthorizationRoutes({
      issuer,
      resource,
      prefix: "/oauth",
      scopes: ["read", "write"],
      upstreamScopes: ["profile"],
      core,
      upstreamClient,
      now: () => now.value,
      verifyToken: () => ({ sub: "user-1" }),
      ...overrides,
    }),
  };
}

async function invoke(route: Harness["route"], request: Request) {
  return route(request, async () => fallback);
}

async function registerClient(
  harness: Harness,
  metadata: Record<string, unknown> = {}
) {
  const response = await invoke(
    harness.route,
    new Request(`${issuer}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Test MCP Client",
        scope: "read write",
        ...metadata,
      }),
    })
  );
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  expect(OAuthClientInformationFullSchema.safeParse(body).success).toBe(true);
  return body as { client_id: string };
}

async function beginConsent(
  harness: Harness,
  clientId: string,
  query: Array<[string, string]> = [],
  headers?: HeadersInit
) {
  const challenge = await s256(verifier);
  const url = new URL(`${issuer}/authorize`);
  for (const [key, value] of [
    ["response_type", "code"],
    ["client_id", clientId],
    ["redirect_uri", redirectUri],
    ["state", "downstream-state"],
    ["resource", resource],
    ["scope", "read write"],
    ["code_challenge", challenge],
    ["code_challenge_method", "S256"],
    ...query,
  ] as Array<[string, string]>) {
    url.searchParams.append(key, value);
  }
  const response = await invoke(
    harness.route,
    new Request(url, headers === undefined ? undefined : { headers })
  );
  const html = await response.text();
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  return {
    response,
    html,
    cookie,
    transactionId: response.ok ? hidden(html, "transaction_id") : "",
    csrfToken: response.ok ? hidden(html, "csrf_token") : "",
    challenge,
  };
}

function hidden(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`, "u").exec(html);
  if (match === null) throw new Error(`missing ${name}`);
  return match[1]!;
}

async function approveConsent(
  harness: Harness,
  consent: Awaited<ReturnType<typeof beginConsent>>,
  decision = "approve"
) {
  return invoke(
    harness.route,
    new Request(`${issuer}/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: consent.cookie!,
      },
      body: new URLSearchParams({
        transaction_id: consent.transactionId,
        csrf_token: consent.csrfToken,
        decision,
      }),
    })
  );
}

async function authorizeThroughCallback(harness: Harness, clientId: string) {
  const consent = await beginConsent(harness, clientId);
  const approval = await approveConsent(harness, consent);
  const providerUrl = new URL(approval.headers.get("Location")!);
  const callbackUrl = new URL(`${issuer}/callback`);
  callbackUrl.searchParams.set("code", "provider-code-secret");
  callbackUrl.searchParams.set("state", providerUrl.searchParams.get("state")!);
  const callback = await invoke(
    harness.route,
    new Request(callbackUrl, { headers: { Cookie: consent.cookie! } })
  );
  const downstream = new URL(callback.headers.get("Location")!);
  return { consent, approval, providerUrl, callback, downstream };
}

async function exchangeCode(harness: Harness, clientId: string, code: string) {
  return invoke(
    harness.route,
    new Request(`${issuer}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource,
      }),
    })
  );
}

describe("OAuth proxy authorization routes", () => {
  it("registers only public exact-redirect clients and returns MCP wire metadata", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    expect(client.client_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    for (const bad of [
      { token_endpoint_auth_method: "client_secret_post" },
      { redirect_uris: ["https://client.example.test/cb#fragment"] },
      { redirect_uris: ["http://public.example.test/cb"] },
      { redirect_uris: ["https://user:pass@client.example.test/cb"] },
      { redirect_uris: ["https://client.example.test/*"] },
      { redirect_uris: [redirectUri, redirectUri] },
    ]) {
      const response = await invoke(
        harness.route,
        new Request(`${issuer}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redirect_uris: [redirectUri], ...bad }),
        })
      );
      expect(response.status).toBe(400);
      expect(
        OAuthClientRegistrationErrorSchema.safeParse(await response.json())
          .success
      ).toBe(true);
    }
  });

  it("ignores unrecognized dynamic client registration metadata", async () => {
    const harness = createHarness();
    const client = await registerClient(harness, {
      vendor_metadata: { feature: "enabled" },
    });

    expect(client.client_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("defaults an omitted DCR scope to the configured local scope allowlist", async () => {
    const harness = createHarness();
    const client = await registerClient(harness, { scope: undefined });
    const consent = await beginConsent(harness, client.client_id);
    expect(consent.response.status).toBe(200);
    expect(consent.html).toContain("<li>read</li><li>write</li>");
  });

  it("bounds JSON/form bodies and rejects the wrong content type", async () => {
    const harness = createHarness({ maxBodyBytes: 128 });
    const wrongType = await invoke(
      harness.route,
      new Request(`${issuer}/register`, { method: "POST", body: "{}" })
    );
    expect(wrongType.status).toBe(415);

    const oversized = await invoke(
      harness.route,
      new Request(`${issuer}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          padding: "x".repeat(256),
        }),
      })
    );
    expect(oversized.status).toBe(413);

    const wrongTokenType = await invoke(
      harness.route,
      new Request(`${issuer}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    );
    expect(wrongTokenType.status).toBe(415);
  });

  it("strictly binds authorize requests and renders escaped, browser-bound consent", async () => {
    const harness = createHarness();
    const client = await registerClient(harness, {
      client_name: '<script>alert("x")</script>',
    });
    const consent = await beginConsent(harness, client.client_id);
    expect(consent.response.status).toBe(200);
    expect(consent.html).toContain("&lt;script&gt;");
    expect(consent.html).not.toContain('<script>alert("x")</script>');
    expect(consent.html).toContain(
      "https://client.example.test/callback?existing=value"
    );
    expect(consent.html).toContain("Only continue if you trust this address.");
    expect(consent.response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(consent.response.headers.get("Cache-Control")).toBe("no-store");
    expect(consent.response.headers.get("Set-Cookie")).toContain(
      "HttpOnly; SameSite=Lax; Secure"
    );
    expect(consent.response.headers.get("Set-Cookie")).toMatch(
      /^__Host-mcp_oauth_browser=[A-Za-z0-9_-]{43}; Path=\//u
    );

    for (const duplicate of [
      ["resource", resource],
      ["state", "other"],
      ["code_challenge", consent.challenge],
    ] as Array<[string, string]>) {
      const rejected = await beginConsent(harness, client.client_id, [
        duplicate,
      ]);
      expect(rejected.response.status).toBe(400);
      expect(
        OAuthErrorResponseSchema.safeParse(JSON.parse(rejected.html)).success
      ).toBe(true);
    }
  });

  it("ignores authorize extensions but still rejects duplicate recognized parameters", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id, [
      ["vendor_hint", "first"],
      ["vendor_hint", "second"],
    ]);

    expect(consent.response.status).toBe(200);
    const approval = await invoke(
      harness.route,
      new Request(`${issuer}/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: consent.cookie!,
        },
        body: new URLSearchParams([
          ["transaction_id", consent.transactionId],
          ["csrf_token", consent.csrfToken],
          ["decision", "approve"],
          ["vendor_hint", "first"],
          ["vendor_hint", "second"],
        ]),
      })
    );
    expect(approval.status).toBe(303);
  });

  it("derives browser cookie security from the canonical issuer behind a proxy", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const challenge = await s256(verifier);
    const internalUrl = new URL("http://internal.service/oauth/authorize");
    internalUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      state: "downstream-state",
      resource,
      scope: "read",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const response = await invoke(harness.route, new Request(internalUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(
      "HttpOnly; SameSite=Lax; Secure"
    );
  });

  it("does not reuse an unprefixed browser cookie injected by a sibling domain", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const injected = "a".repeat(43);
    const consent = await beginConsent(harness, client.client_id, [], {
      Cookie: `mcp_oauth_browser=${injected}`,
    });

    expect(consent.response.status).toBe(200);
    expect(consent.cookie).toMatch(/^__Host-mcp_oauth_browser=/u);
    expect(consent.cookie).not.toContain(injected);
    expect((await approveConsent(harness, consent)).status).toBe(303);
  });

  it("rejects authorize state, redirect, resource, scope, and PKCE mismatches", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const challenge = await s256(verifier);
    const valid = new URL(`${issuer}/authorize`);
    valid.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      state: "downstream-state",
      resource,
      scope: "read",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const mutations: Array<(url: URL) => void> = [
      (url) => url.searchParams.delete("state"),
      (url) =>
        url.searchParams.set(
          "redirect_uri",
          "https://client.example.test/other"
        ),
      (url) =>
        url.searchParams.set("resource", "https://other.example.test/mcp"),
      (url) => url.searchParams.set("scope", "admin"),
      (url) => url.searchParams.set("code_challenge_method", "plain"),
      (url) => url.searchParams.set("code_challenge", "short"),
    ];
    for (const mutate of mutations) {
      const url = new URL(valid);
      mutate(url);
      const response = await invoke(harness.route, new Request(url));
      expect(response.status).toBe(400);
      expect(
        OAuthErrorResponseSchema.safeParse(await response.json()).success
      ).toBe(true);
    }
  });

  it("one-time consumes consent, supports denial, and enforces CSRF/browser binding", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id);
    const denied = await approveConsent(harness, consent, "deny");
    expect(denied.status).toBe(303);
    const location = new URL(denied.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(
      "https://client.example.test/callback"
    );
    expect(location.searchParams.get("existing")).toBe("value");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("downstream-state");
    expect((await approveConsent(harness, consent)).status).toBe(400);

    const other = await beginConsent(harness, client.client_id);
    const wrongBrowser = await invoke(
      harness.route,
      new Request(`${issuer}/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "__Host-mcp_oauth_browser=" + "z".repeat(43),
        },
        body: new URLSearchParams({
          transaction_id: other.transactionId,
          csrf_token: other.csrfToken,
          decision: "approve",
        }),
      })
    );
    expect(wrongBrowser.status).toBe(400);
  });

  it("starts a separate upstream PKCE/state transaction without forwarding the MCP resource", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id);
    const approval = await approveConsent(harness, consent);
    expect(approval.status).toBe(303);
    const upstream = new URL(approval.headers.get("Location")!);
    expect(upstream.origin).toBe("https://provider.example.test");
    expect(upstream.searchParams.get("client_id")).toBe(
      "shared-upstream-client"
    );
    expect(upstream.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(upstream.searchParams.get("code_challenge")).not.toBe(
      consent.challenge
    );
    expect(upstream.searchParams.has("resource")).toBe(false);
    expect(upstream.searchParams.get("scope")).toBe("profile");
  });

  it("allows providers that use default permissions without explicit upstream scopes", async () => {
    const harness = createHarness({ upstreamScopes: [] });
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);

    expect(flow.approval.status).toBe(303);
    expect(flow.providerUrl.searchParams.has("scope")).toBe(false);
    expect(flow.downstream.searchParams.get("code")).toMatch(
      /^[A-Za-z0-9_-]{43}$/u
    );
  });

  it("ignores provider callback extensions without relaxing duplicate state validation", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id);
    const approval = await approveConsent(harness, consent);
    const providerUrl = new URL(approval.headers.get("Location")!);
    const callbackUrl = new URL(`${issuer}/callback`);
    callbackUrl.search = new URLSearchParams({
      state: providerUrl.searchParams.get("state")!,
      code: "provider-code-secret",
      scope: "profile",
      authuser: "0",
      prompt: "consent",
    }).toString();
    const duplicate = new URL(callbackUrl);
    duplicate.searchParams.append(
      "state",
      callbackUrl.searchParams.get("state")!
    );
    const rejected = await invoke(
      harness.route,
      new Request(duplicate, { headers: { Cookie: consent.cookie! } })
    );
    expect(rejected.status).toBe(400);
    expect(harness.fetch).not.toHaveBeenCalled();

    const callback = await invoke(
      harness.route,
      new Request(callbackUrl, { headers: { Cookie: consent.cookie! } })
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Referrer-Policy")).toBe("no-referrer");
    const downstream = new URL(callback.headers.get("Location")!);
    expect(downstream.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(downstream.searchParams.has("authuser")).toBe(false);
    expect(downstream.searchParams.has("scope")).toBe(false);
  });

  it("uses an explicit provider resource hook and validates only verified nonce claims", async () => {
    const nonceState: { expected?: string } = {};
    const verifyIdToken = vi.fn(async () => ({ nonce: nonceState.expected }));
    const harness = createHarness(
      {
        mapUpstreamResource: ({ phase }) =>
          phase === "authorization"
            ? "https://provider.example.test/api"
            : undefined,
        verifyIdToken,
      },
      [
        Response.json({
          access_token: "provider-access-secret",
          refresh_token: "provider-refresh-secret",
          token_type: "Bearer",
          id_token: "raw-provider-id-token",
          expires_in: 3600,
        }),
      ]
    );
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id);
    const approval = await approveConsent(harness, consent);
    const upstream = new URL(approval.headers.get("Location")!);
    nonceState.expected = upstream.searchParams.get("nonce")!;
    expect(upstream.searchParams.get("resource")).toBe(
      "https://provider.example.test/api"
    );
    const callbackUrl = new URL(`${issuer}/callback`);
    callbackUrl.searchParams.set("code", "provider-code");
    callbackUrl.searchParams.set("state", upstream.searchParams.get("state")!);
    const callback = await invoke(
      harness.route,
      new Request(callbackUrl, { headers: { Cookie: consent.cookie! } })
    );
    expect(callback.status).toBe(302);
    expect(verifyIdToken).toHaveBeenCalledWith(
      "raw-provider-id-token",
      expect.objectContaining({ accessToken: "provider-access-secret" })
    );
  });

  it("binds callbacks to state/browser/issuer and sanitizes upstream errors", async () => {
    const wrongStateHarness = createHarness();
    const wrongStateClient = await registerClient(wrongStateHarness);
    const unknownState = new URL(`${issuer}/callback`);
    unknownState.searchParams.set("state", "s".repeat(43));
    unknownState.searchParams.set("code", "provider-code");
    const unknown = await invoke(
      wrongStateHarness.route,
      new Request(unknownState, {
        headers: { Cookie: "__Host-mcp_oauth_browser=" + "b".repeat(43) },
      })
    );
    expect(wrongStateClient.client_id).toBeDefined();
    expect(unknown.status).toBe(400);

    const browserHarness = createHarness();
    const browserClient = await registerClient(browserHarness);
    const browserConsent = await beginConsent(
      browserHarness,
      browserClient.client_id
    );
    const browserApproval = await approveConsent(
      browserHarness,
      browserConsent
    );
    const browserCallback = new URL(`${issuer}/callback`);
    browserCallback.searchParams.set("code", "provider-code");
    browserCallback.searchParams.set(
      "state",
      new URL(browserApproval.headers.get("Location")!).searchParams.get(
        "state"
      )!
    );
    const wrongBrowser = await invoke(
      browserHarness.route,
      new Request(browserCallback, {
        headers: { Cookie: "__Host-mcp_oauth_browser=" + "z".repeat(43) },
      })
    );
    expect(wrongBrowser.status).toBe(400);

    const issuerHarness = createHarness({}, [], {
      issuer: "https://provider.example.test",
    });
    const issuerClient = await registerClient(issuerHarness);
    const issuerConsent = await beginConsent(
      issuerHarness,
      issuerClient.client_id
    );
    const issuerApproval = await approveConsent(issuerHarness, issuerConsent);
    const issuerCallback = new URL(`${issuer}/callback`);
    issuerCallback.searchParams.set("code", "provider-code");
    issuerCallback.searchParams.set(
      "state",
      new URL(issuerApproval.headers.get("Location")!).searchParams.get(
        "state"
      )!
    );
    issuerCallback.searchParams.set("iss", "https://evil.example.test");
    const issuerMismatch = await invoke(
      issuerHarness.route,
      new Request(issuerCallback, {
        headers: { Cookie: issuerConsent.cookie! },
      })
    );
    expect(issuerMismatch.status).toBe(302);
    const issuerDownstream = new URL(issuerMismatch.headers.get("Location")!);
    expect(issuerDownstream.searchParams.get("error")).toBe("server_error");
    expect(issuerDownstream.toString()).not.toContain("evil.example.test");

    const deniedHarness = createHarness();
    const deniedClient = await registerClient(deniedHarness);
    const deniedConsent = await beginConsent(
      deniedHarness,
      deniedClient.client_id
    );
    const deniedApproval = await approveConsent(deniedHarness, deniedConsent);
    const deniedCallback = new URL(`${issuer}/callback`);
    deniedCallback.searchParams.set("error", "access_denied");
    deniedCallback.searchParams.set(
      "error_description",
      "provider secret detail"
    );
    deniedCallback.searchParams.set(
      "state",
      new URL(deniedApproval.headers.get("Location")!).searchParams.get(
        "state"
      )!
    );
    const deniedResponse = await invoke(
      deniedHarness.route,
      new Request(deniedCallback, {
        headers: { Cookie: deniedConsent.cookie! },
      })
    );
    const deniedDownstream = new URL(deniedResponse.headers.get("Location")!);
    expect(deniedDownstream.searchParams.get("error")).toBe("access_denied");
    expect(deniedDownstream.toString()).not.toContain("provider+secret");
  });

  it("redirects sanitized callback completion failures to the bound client", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const harness = createHarness({
      verifyToken: () => {
        throw new Error("provider verification secret");
      },
    });
    const client = await registerClient(harness);
    const consent = await beginConsent(harness, client.client_id);
    const approval = await approveConsent(harness, consent);
    const callbackUrl = new URL(`${issuer}/callback`);
    callbackUrl.searchParams.set("code", "provider-code");
    callbackUrl.searchParams.set(
      "state",
      new URL(approval.headers.get("Location")!).searchParams.get("state")!
    );

    const callback = await invoke(
      harness.route,
      new Request(callbackUrl, { headers: { Cookie: consent.cookie! } })
    );

    expect(callback.status).toBe(302);
    const downstream = new URL(callback.headers.get("Location")!);
    expect(downstream.origin + downstream.pathname).toBe(
      "https://client.example.test/callback"
    );
    expect(downstream.searchParams.get("error")).toBe("server_error");
    expect(downstream.searchParams.get("state")).toBe("downstream-state");
    expect(downstream.toString()).not.toContain("verification");
    expect(errorSpy).toHaveBeenCalledWith(
      "[mcp-use] OAuth proxy callback failed (internal_error)"
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
      "provider verification secret"
    );
  });

  it("exchanges upstream code but returns only local opaque code and tokens downstream", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    expect(flow.callback.status).toBe(302);
    expect(flow.downstream.searchParams.get("state")).toBe("downstream-state");
    const code = flow.downstream.searchParams.get("code")!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(flow.downstream.toString()).not.toContain("provider-access-secret");

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]!.headers.get("Authorization")).toMatch(
      /^Basic /u
    );
    expect(await harness.requests[0]!.text()).toContain("code_verifier=");

    const response = await exchangeCode(harness, client.client_id, code);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(OAuthTokensSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toContain("provider-access-secret");
    expect(body).toMatchObject({ token_type: "Bearer", scope: "read write" });
  });

  it("ignores token extensions but rejects duplicate recognized parameters", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const code = flow.downstream.searchParams.get("code")!;
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    });
    form.append("client_id", client.client_id);

    const duplicate = await invoke(
      harness.route,
      new Request(`${issuer}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      })
    );
    expect(duplicate.status).toBe(400);

    form.delete("client_id");
    form.set("client_id", client.client_id);
    form.append("vendor_hint", "first");
    form.append("vendor_hint", "second");
    const extended = await invoke(
      harness.route,
      new Request(`${issuer}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      })
    );
    expect(extended.status).toBe(200);
  });

  it("narrows refresh scope locally and leaves the token usable after invalid scope", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const exchanged = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const initial = (await exchanged.json()) as { refresh_token: string };

    const narrowed = await invoke(
      harness.route,
      refreshRequest(client.client_id, initial.refresh_token, {
        scope: "read",
        vendor_hint: "ignored",
      })
    );
    expect(narrowed.status).toBe(200);
    const narrowedTokens = (await narrowed.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
    expect(narrowedTokens.scope).toBe("read");
    await expect(
      harness.core.validateAccessToken(narrowedTokens.access_token, resource)
    ).resolves.toMatchObject({ scopes: ["read"] });

    const broader = await invoke(
      harness.route,
      refreshRequest(client.client_id, narrowedTokens.refresh_token, {
        scope: "write",
      })
    );
    expect(broader.status).toBe(400);
    expect(await broader.json()).toEqual({ error: "invalid_scope" });

    const retry = await invoke(
      harness.route,
      refreshRequest(client.client_id, narrowedTokens.refresh_token, {
        scope: "read",
      })
    );
    expect(retry.status).toBe(200);
  });

  it("rotates locally, performs one reserved upstream refresh, and makes failures terminal", async () => {
    const harness = createHarness({}, [
      Response.json({
        access_token: "short-provider-access",
        refresh_token: "rotating-provider-refresh",
        token_type: "Bearer",
        expires_in: 2,
      }),
      new Error("network secret must not escape"),
    ]);
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const codeResponse = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const initial = (await codeResponse.json()) as { refresh_token: string };
    harness.now.value += 3_000;

    const firstRefresh = await invoke(
      harness.route,
      refreshRequest(client.client_id, initial.refresh_token)
    );
    expect(firstRefresh.status).toBe(502);
    expect(await firstRefresh.json()).toEqual({ error: "server_error" });
    const upstreamRefreshRequest = harness.requests[1]!;
    const upstreamForm = new URLSearchParams(
      await upstreamRefreshRequest.text()
    );
    expect(upstreamForm.get("refresh_token")).toBe("rotating-provider-refresh");

    const replay = await invoke(
      harness.route,
      refreshRequest(client.client_id, initial.refresh_token)
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_grant" });
    expect(harness.requests).toHaveLength(2);
  });

  it("omits scope on refresh and preserves omitted upstream rotation values", async () => {
    const harness = createHarness({}, [
      Response.json({
        access_token: "short-provider-access",
        refresh_token: "provider-refresh-to-preserve",
        token_type: "Bearer",
        expires_in: 2,
        scope: "read:user",
      }),
      Response.json({
        access_token: "rotated-provider-access-1",
        token_type: "Bearer",
        expires_in: 2,
      }),
      Response.json({
        access_token: "rotated-provider-access-2",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    ]);
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const codeResponse = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const issued = (await codeResponse.json()) as { refresh_token: string };

    const localRotation = await invoke(
      harness.route,
      refreshRequest(client.client_id, issued.refresh_token)
    );
    expect(localRotation.status).toBe(200);
    expect(harness.requests).toHaveLength(1);
    const localTokens = (await localRotation.json()) as {
      refresh_token: string;
    };

    harness.now.value += 3_000;
    const upstreamRotation = await invoke(
      harness.route,
      refreshRequest(client.client_id, localTokens.refresh_token, {
        scope: "read",
      })
    );
    expect(upstreamRotation.status).toBe(200);
    const upstreamTokens = (await upstreamRotation.json()) as {
      refresh_token: string;
      scope: string;
    };
    expect(upstreamTokens.scope).toBe("read");
    const firstUpstreamForm = new URLSearchParams(
      await harness.requests[1]!.text()
    );
    expect(firstUpstreamForm.get("refresh_token")).toBe(
      "provider-refresh-to-preserve"
    );
    expect(firstUpstreamForm.has("scope")).toBe(false);

    harness.now.value += 3_000;
    const secondUpstreamRotation = await invoke(
      harness.route,
      refreshRequest(client.client_id, upstreamTokens.refresh_token)
    );
    expect(secondUpstreamRotation.status).toBe(200);
    const finalTokens = (await secondUpstreamRotation.json()) as {
      refresh_token: string;
      scope: string;
    };
    expect(finalTokens.scope).toBe("read");
    const secondUpstreamForm = new URLSearchParams(
      await harness.requests[2]!.text()
    );
    expect(secondUpstreamForm.get("refresh_token")).toBe(
      "provider-refresh-to-preserve"
    );
    expect(secondUpstreamForm.has("scope")).toBe(false);

    const preserved = await harness.core.beginUpstreamRefresh({
      refreshToken: finalTokens.refresh_token,
      clientId: client.client_id,
      resource,
    });
    expect(preserved.upstreamTokens.refreshToken).toBe(
      "provider-refresh-to-preserve"
    );
    expect(preserved.upstreamTokens.scope).toBe("read:user");
    expect(preserved.scopes).toEqual(["read"]);
  });

  it.each(["different-user", undefined])(
    "rejects an upstream refresh that changes or removes the verified subject: %s",
    async (refreshedSubject) => {
      const harness = createHarness(
        {
          verifyToken: (accessToken) =>
            accessToken === "initial-provider-access"
              ? { sub: "initial-user" }
              : refreshedSubject === undefined
                ? { name: "Subject missing" }
                : { sub: refreshedSubject },
        },
        [
          Response.json({
            access_token: "initial-provider-access",
            refresh_token: "provider-refresh",
            token_type: "Bearer",
            expires_in: 2,
          }),
          Response.json({
            access_token: "refreshed-provider-access",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        ]
      );
      const client = await registerClient(harness);
      const flow = await authorizeThroughCallback(harness, client.client_id);
      const exchanged = await exchangeCode(
        harness,
        client.client_id,
        flow.downstream.searchParams.get("code")!
      );
      const tokens = (await exchanged.json()) as { refresh_token: string };
      harness.now.value += 3_000;

      const refreshed = await invoke(
        harness.route,
        refreshRequest(client.client_id, tokens.refresh_token)
      );
      expect(refreshed.status).toBe(400);
      expect(await refreshed.json()).toEqual({ error: "invalid_grant" });
      const replay = await invoke(
        harness.route,
        refreshRequest(client.client_id, tokens.refresh_token)
      );
      expect(replay.status).toBe(400);
      expect(harness.requests).toHaveLength(2);
    }
  );

  it("supports custom verified identity payloads without imposing a subject field", async () => {
    const harness = createHarness(
      { verifyToken: () => ({ accountId: "custom-account" }) },
      [
        Response.json({
          access_token: "initial-provider-access",
          refresh_token: "provider-refresh",
          token_type: "Bearer",
          expires_in: 2,
        }),
        Response.json({
          access_token: "refreshed-provider-access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      ]
    );
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const exchanged = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const tokens = (await exchanged.json()) as { refresh_token: string };
    harness.now.value += 3_000;

    const refreshed = await invoke(
      harness.route,
      refreshRequest(client.client_id, tokens.refresh_token)
    );
    expect(refreshed.status).toBe(200);
    expect(harness.requests).toHaveLength(2);
  });

  it("revokes without enumeration and ignores incorrect token hints", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const codeResponse = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const tokens = (await codeResponse.json()) as { refresh_token: string };
    const revoked = await invoke(
      harness.route,
      new Request(`${issuer}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: tokens.refresh_token,
          token_type_hint: "access_token",
          client_id: client.client_id,
          extension_parameter: "ignored",
        }),
      })
    );
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("Pragma")).toBe("no-cache");
    const refresh = await invoke(
      harness.route,
      refreshRequest(client.client_id, tokens.refresh_token)
    );
    expect(refresh.status).toBe(400);

    const malformed = await invoke(
      harness.route,
      new Request(`${issuer}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not a token",
      })
    );
    expect(malformed.status).toBe(200);
  });

  it("does not revoke a token for missing, malformed, unknown, or unrelated clients", async () => {
    const harness = createHarness();
    const client = await registerClient(harness);
    const otherClient = await registerClient(harness);
    const flow = await authorizeThroughCallback(harness, client.client_id);
    const codeResponse = await exchangeCode(
      harness,
      client.client_id,
      flow.downstream.searchParams.get("code")!
    );
    const tokens = (await codeResponse.json()) as { refresh_token: string };

    for (const clientId of [
      undefined,
      "malformed",
      "u".repeat(43),
      otherClient.client_id,
    ]) {
      const response = await invoke(
        harness.route,
        new Request(`${issuer}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: tokens.refresh_token,
            ...(clientId === undefined ? {} : { client_id: clientId }),
          }),
        })
      );
      expect(response.status).toBe(200);
    }
    const refreshed = await invoke(
      harness.route,
      refreshRequest(client.client_id, tokens.refresh_token)
    );
    expect(refreshed.status).toBe(200);
  });

  it("returns 405 for matched paths and falls through for unowned paths", async () => {
    const harness = createHarness();
    const method = await invoke(
      harness.route,
      new Request(`${issuer}/token`, { method: "GET" })
    );
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("POST");
    const unowned = await invoke(
      harness.route,
      new Request(`${issuer}/not-owned`)
    );
    expect(unowned.status).toBe(418);
    expect(await unowned.text()).toBe("fallback");
  });
});

function refreshRequest(
  clientId: string,
  refreshToken: string,
  extra: Record<string, string> = {}
): Request {
  return new Request(`${issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      resource,
      ...extra,
    }),
  });
}
