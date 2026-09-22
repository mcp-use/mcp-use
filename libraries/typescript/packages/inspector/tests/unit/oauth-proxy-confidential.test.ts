import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOAuthProxy } from "../../src/server/proxy/oauth-proxy";
import type { OAuthProxyStateStore } from "../../src/server/proxy/oauth-state-store";

const inspectorOrigin = "https://inspector.example.com";
const serverUrl = "https://93.184.216.34/mcp";
const issuer = "https://93.184.216.35";
const issuer2 = "https://93.184.216.36";
const resourceMetadataUrl =
  "https://93.184.216.34/.well-known/oauth-protected-resource/mcp";
const authorizationMetadataUrl =
  "https://93.184.216.35/.well-known/oauth-authorization-server";
const authorizationMetadataUrl2 =
  "https://93.184.216.36/.well-known/oauth-authorization-server";
const registrationUrl = "https://93.184.216.35/oauth/register";
const tokenUrl = "https://93.184.216.35/oauth/token";
const tokenUrl2 = "https://93.184.216.36/oauth/token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function metadataRequest(url: string, headers: HeadersInit = {}): Request {
  return new Request(
    `${inspectorOrigin}/oauth/metadata?serverUrl=${encodeURIComponent(serverUrl)}&url=${encodeURIComponent(url)}`,
    { headers: { Origin: inspectorOrigin, ...headers } }
  );
}

function proxyRequest(
  url: string,
  body: unknown,
  options: { headers?: HeadersInit; requestHeaders?: HeadersInit } = {}
): Request {
  return new Request(`${inspectorOrigin}/oauth/proxy`, {
    method: "POST",
    headers: {
      Origin: inspectorOrigin,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify({
      serverUrl,
      url,
      method: "POST",
      headers: {
        "content-type":
          url === registrationUrl
            ? "application/json"
            : "application/x-www-form-urlencoded",
        ...options.requestHeaders,
      },
      body,
    }),
  });
}

function sharedStateStore(): OAuthProxyStateStore {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Inspector OAuth BFF confidential clients", () => {
  it("accepts a matching public origin forwarded by a trusted proxy", async () => {
    const app = new Hono();
    mountOAuthProxy(app, { basePath: "/oauth", enableLogging: false });

    const response = await app.fetch(
      new Request("http://localhost:3006/oauth/proxy", {
        method: "OPTIONS",
        headers: {
          Origin: inspectorOrigin,
          "X-Forwarded-Host": "inspector.example.com",
          "X-Forwarded-Proto": "https",
          "Access-Control-Request-Headers": "x-inspector-relay-token",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      inspectorOrigin
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "DPoP"
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "X-Inspector-Relay-Token"
    );
  });

  it("keeps DCR secrets off the browser and restores client_secret_post", async () => {
    const authTargets: unknown[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      const upstreamHeaders = new Headers(init?.headers);
      expect(upstreamHeaders.get("x-inspector-relay-token")).toBeNull();
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: serverUrl,
          authorization_servers: [issuer],
        });
      }
      if (url === authorizationMetadataUrl) {
        return jsonResponse({
          issuer,
          registration_endpoint: registrationUrl,
          token_endpoint: tokenUrl,
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
      }
      if (url === registrationUrl) {
        expect(upstreamHeaders.get("authorization")).toBe(
          "Bearer upstream-token"
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          redirect_uris: [`${inspectorOrigin}/oauth/callback`],
        });
        return jsonResponse({
          client_id: "confidential-client",
          client_secret: "server-only-secret",
          client_secret_expires_at: 0,
          token_endpoint_auth_method: "client_secret_post",
        });
      }
      if (url === tokenUrl) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBeNull();
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("client_id")).toBe("confidential-client");
        expect(params.get("client_secret")).toBe("server-only-secret");
        return jsonResponse({ access_token: "redacted", token_type: "Bearer" });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFn);

    const app = new Hono();
    mountOAuthProxy(app, {
      basePath: "/oauth",
      enableLogging: false,
      authenticate: (c, target) => {
        authTargets.push(target);
        return c.req.header("X-Inspector-Relay-Token") === "relay-token";
      },
    });

    const relayHeaders = { "X-Inspector-Relay-Token": "relay-token" };
    expect(
      (await app.fetch(metadataRequest(resourceMetadataUrl, relayHeaders)))
        .status
    ).toBe(200);
    expect(
      (await app.fetch(metadataRequest(authorizationMetadataUrl, relayHeaders)))
        .status
    ).toBe(200);

    const registration = await app.fetch(
      proxyRequest(
        registrationUrl,
        {
          client_name: "Inspector",
          redirect_uris: [`${inspectorOrigin}/mcp/inspector/oauth/callback`],
          token_endpoint_auth_method: "none",
        },
        {
          headers: relayHeaders,
          requestHeaders: {
            Authorization: "Bearer upstream-token",
            "X-Inspector-Relay-Token": "nested-capability-must-not-forward",
          },
        }
      )
    );
    const registrationEnvelope = await registration.json();
    expect(registrationEnvelope).toMatchObject({
      status: 200,
      body: {
        client_id: "confidential-client",
        token_endpoint_auth_method: "none",
      },
    });
    expect(JSON.stringify(registrationEnvelope)).not.toContain(
      "server-only-secret"
    );

    const token = await app.fetch(
      proxyRequest(
        tokenUrl,
        {
          grant_type: "authorization_code",
          code: "redacted",
          client_id: "confidential-client",
        },
        { headers: relayHeaders }
      )
    );
    expect(await token.json()).toMatchObject({
      status: 200,
      body: { access_token: "redacted", token_type: "Bearer" },
    });
    expect(authTargets).toEqual([
      {
        origin: "https://93.184.216.34",
        pathname: "/.well-known/oauth-protected-resource/mcp",
        method: "GET",
      },
      {
        origin: "https://93.184.216.35",
        pathname: "/.well-known/oauth-authorization-server",
        method: "GET",
      },
      {
        origin: "https://93.184.216.35",
        pathname: "/oauth/register",
        method: "POST",
      },
      {
        origin: "https://93.184.216.35",
        pathname: "/oauth/token",
        method: "POST",
      },
    ]);
  });

  it("does not echo a secret from a malformed successful DCR response", async () => {
    const leakedSecret = "malformed-response-secret";
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: serverUrl,
          authorization_servers: [issuer],
        });
      }
      if (url === authorizationMetadataUrl) {
        return jsonResponse({
          issuer,
          registration_endpoint: registrationUrl,
        });
      }
      if (url === registrationUrl) {
        return new Response(`{"client_secret":"${leakedSecret}"`, {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFn);

    const app = new Hono();
    mountOAuthProxy(app, { basePath: "/oauth", enableLogging: false });
    expect((await app.fetch(metadataRequest(resourceMetadataUrl))).status).toBe(
      200
    );
    expect(
      (await app.fetch(metadataRequest(authorizationMetadataUrl))).status
    ).toBe(200);

    const response = await app.fetch(
      proxyRequest(registrationUrl, { client_name: "malformed" })
    );
    const responseBody = await response.text();
    expect(response.status).toBe(502);
    expect(responseBody).not.toContain(leakedSecret);
  });

  it("does not return array DCR error bodies containing a secret", async () => {
    const leakedSecret = "array-response-secret";
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: serverUrl,
          authorization_servers: [issuer],
        });
      }
      if (url === authorizationMetadataUrl) {
        return jsonResponse({
          issuer,
          registration_endpoint: registrationUrl,
        });
      }
      if (url === registrationUrl) {
        return jsonResponse([{ client_secret: leakedSecret }], 400);
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFn);

    const app = new Hono();
    mountOAuthProxy(app, { basePath: "/oauth", enableLogging: false });
    expect((await app.fetch(metadataRequest(resourceMetadataUrl))).status).toBe(
      200
    );
    expect(
      (await app.fetch(metadataRequest(authorizationMetadataUrl))).status
    ).toBe(200);

    const response = await app.fetch(
      proxyRequest(registrationUrl, { client_name: "array-error" })
    );
    const responseBody = await response.text();
    expect(response.status).toBe(502);
    expect(responseBody).not.toContain(leakedSecret);
  });

  it("shares bindings and DCR credentials across proxy replicas", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: serverUrl,
          authorization_servers: [issuer],
        });
      }
      if (url === authorizationMetadataUrl) {
        return jsonResponse({
          issuer,
          registration_endpoint: registrationUrl,
          token_endpoint: tokenUrl,
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
      }
      if (url === registrationUrl) {
        return jsonResponse({
          client_id: "shared-client",
          client_secret: "shared-secret",
          client_secret_expires_at: 0,
          token_endpoint_auth_method: "client_secret_post",
        });
      }
      if (url === tokenUrl) {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("client_secret")).toBe("shared-secret");
        return jsonResponse({ access_token: "shared-token" });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFn);

    const stateStore = sharedStateStore();
    const firstReplica = new Hono();
    const secondReplica = new Hono();
    mountOAuthProxy(firstReplica, {
      basePath: "/oauth",
      enableLogging: false,
      stateStore,
    });
    mountOAuthProxy(secondReplica, {
      basePath: "/oauth",
      enableLogging: false,
      stateStore,
    });

    expect(
      (await firstReplica.fetch(metadataRequest(resourceMetadataUrl))).status
    ).toBe(200);
    expect(
      (await firstReplica.fetch(metadataRequest(authorizationMetadataUrl)))
        .status
    ).toBe(200);

    const registration = await firstReplica.fetch(
      proxyRequest(registrationUrl, { client_name: "shared" })
    );
    expect((await registration.json()).body).toMatchObject({
      client_id: "shared-client",
      token_endpoint_auth_method: "none",
    });

    const token = await secondReplica.fetch(
      proxyRequest(tokenUrl, {
        grant_type: "authorization_code",
        client_id: "shared-client",
      })
    );
    expect(await token.json()).toMatchObject({
      status: 200,
      body: { access_token: "shared-token" },
    });
  });

  it("does not expose state-store error details in logs or responses", async () => {
    const secret = "redis-password-must-not-leak";
    const stateStore: OAuthProxyStateStore = {
      async get() {
        throw new Error(`connection failed: ${secret}`);
      },
      async set() {
        throw new Error(secret);
      },
      async delete() {
        throw new Error(secret);
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono();
    mountOAuthProxy(app, {
      basePath: "/oauth",
      stateStore,
      enableLogging: true,
    });

    const response = await app.fetch(metadataRequest(resourceMetadataUrl));
    const responseBody = await response.text();
    expect(response.status).toBe(503);
    expect(responseBody).not.toContain(secret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
    errorSpy.mockRestore();
  });

  it("does not delete a refreshed binding after stale cleanup loses its CAS", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const staleBinding = {
      authorizationServers: [issuer],
      endpoints: [[tokenUrl, { kind: "token", authorizationServer: issuer }]],
      tokenEndpointAuthMethods: [],
      revision: 1,
      updatedAt: now - 10 * 60 * 1000 - 1,
    };
    let durableBinding: unknown = staleBinding;
    const freshBinding = {
      ...staleBinding,
      revision: 2,
      updatedAt: now,
    };
    const deleteIfVersion = vi.fn(async () => {
      durableBinding = structuredClone(freshBinding);
      return false;
    });
    const deleteBinding = vi.fn(async () => {
      durableBinding = undefined;
    });
    const stateStore: OAuthProxyStateStore = {
      async get<T>() {
        return structuredClone(durableBinding) as T | undefined;
      },
      async set() {},
      async setIfNewer(_key, value) {
        durableBinding = structuredClone(value);
        return true;
      },
      async delete() {
        await deleteBinding();
      },
      deleteIfVersion,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (input.toString() === authorizationMetadataUrl) {
          return jsonResponse({ issuer, token_endpoint: tokenUrl });
        }
        return new Response("not found", { status: 404 });
      })
    );

    const app = new Hono();
    mountOAuthProxy(app, {
      basePath: "/oauth",
      enableLogging: false,
      stateStore,
    });

    const response = await app.fetch(metadataRequest(authorizationMetadataUrl));
    expect(response.status).toBe(200);
    expect(deleteIfVersion).toHaveBeenCalledOnce();
    expect(deleteBinding).not.toHaveBeenCalled();
    expect(durableBinding).toMatchObject({ revision: now, updatedAt: now });
  });

  it("adopts durable state after a rejected binding write before the next save", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: serverUrl,
          authorization_servers: [issuer],
        });
      }
      if (url === authorizationMetadataUrl) {
        return jsonResponse({
          issuer,
          token_endpoint: tokenUrl,
        });
      }
      if (url === authorizationMetadataUrl2) {
        return jsonResponse({
          issuer: issuer2,
          token_endpoint: tokenUrl2,
        });
      }
      if (url === tokenUrl2) return jsonResponse({ access_token: "second" });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFn);

    let bindingReads = 0;
    let durableBinding: unknown = {
      authorizationServers: [issuer2],
      endpoints: [[tokenUrl2, { kind: "token", authorizationServer: issuer2 }]],
      tokenEndpointAuthMethods: [],
      revision: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const casResults: boolean[] = [];
    let bindingSetCalls = 0;
    const setIfNewer = vi.fn(
      async (key: string, value: unknown): Promise<boolean> => {
        if (!key.startsWith("binding:")) {
          casResults.push(true);
          return true;
        }
        bindingSetCalls += 1;
        if (bindingSetCalls === 1) {
          casResults.push(false);
          return false;
        }
        durableBinding = structuredClone(value);
        casResults.push(true);
        return true;
      }
    );
    const stateStore: OAuthProxyStateStore = {
      async get<T>(key: string) {
        if (!key.startsWith("binding:")) return undefined;
        bindingReads += 1;
        if (bindingReads <= 2) return undefined;
        return structuredClone(durableBinding) as T;
      },
      async set<T>(key: string, value: T) {
        if (key.startsWith("binding:")) durableBinding = structuredClone(value);
      },
      setIfNewer,
      async delete() {},
    };
    const firstReplica = new Hono();
    const secondReplica = new Hono();
    mountOAuthProxy(firstReplica, {
      basePath: "/oauth",
      enableLogging: false,
      stateStore,
    });
    mountOAuthProxy(secondReplica, {
      basePath: "/oauth",
      enableLogging: false,
      stateStore,
    });

    expect(
      (await firstReplica.fetch(metadataRequest(authorizationMetadataUrl2)))
        .status
    ).toBe(200);
    expect(setIfNewer).toHaveBeenCalledTimes(2);
    expect(casResults).toEqual([false, true]);
    expect(durableBinding).toMatchObject({
      revision: 1_700_000_000_001,
      updatedAt: 1_700_000_000_000,
    });

    const token = await secondReplica.fetch(
      proxyRequest(tokenUrl2, { grant_type: "authorization_code" })
    );
    expect(token.status).toBe(200);
    expect(await token.json()).toMatchObject({
      status: 200,
      body: { access_token: "second" },
    });
  });
});
