/**
 * OAuth proxy acceptance coverage with the official SDK and real loopback HTTP.
 * Only the upstream identity provider and browser interaction are simulated.
 * Both source and built public entrypoints must support the same complete flow.
 */
import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { MCPServer as PackagedMCPServer } from "mcp-use";
import { oauthProxy as packagedOAuthProxy } from "mcp-use/oauth";
import { describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import { oauthProxy } from "../src/oauth/index.js";
import { listenFetch } from "./helpers/listen-fetch.js";

function hiddenInput(html: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]+)"`, "u").exec(html);
  if (value === null) throw new Error(`Missing consent input: ${name}`);
  return value[1]!;
}

function location(response: Response): URL {
  const value = response.headers.get("location");
  if (value === null) throw new Error("Missing OAuth redirect location");
  return new URL(value);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return Buffer.from(digest).toString("base64url");
}

function postForm(url: string | URL, body: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    redirect: "manual",
  });
}

describe.each([
  { entrypoint: "source", Server: MCPServer, createOAuthProxy: oauthProxy },
  {
    entrypoint: "built public package",
    Server: PackagedMCPServer,
    createOAuthProxy: packagedOAuthProxy,
  },
])(
  "OAuth proxy authorization ($entrypoint, official client e2e)",
  ({ Server, createOAuthProxy }) => {
    it("brokers a non-DCR provider, rotates tokens, and rejects replay and revoked credentials", async () => {
      // Advance only the clock, not network timers, to exercise upstream expiry
      // without sleeping or replacing any HTTP requests with in-process calls.
      let now = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      const upstreamClientId = "pre-registered-provider-app";
      const upstreamClientSecret = "provider-app-secret";
      const downstreamState = "official-client-browser-state";
      const redirectUri = "http://127.0.0.1:43210/callback";
      const identity = {
        sub: "user_ada",
        email: "ada@example.test",
        permissions: ["tools:call"],
      };
      let resourceUrl = "";
      let upstreamIssuer = "";
      let tokenGeneration = 0;
      let authorizationGeneration = 0;
      const authorizationCodes = new Map<string, URL>();
      const upstreamAccessTokens = new Set<string>();
      const upstreamRefreshTokens = new Set<string>();
      const upstreamTokenRequests: URLSearchParams[] = [];
      const proxyRequestPaths: string[] = [];
      const downstreamTokenRequests: URLSearchParams[] = [];
      const observedAuth: {
        accessToken: string;
        providerAccessToken: string | undefined;
        userId: string;
        resource: string | undefined;
        scopes: readonly string[];
      }[] = [];

      function issueUpstreamTokens(): Response {
        tokenGeneration += 1;
        const accessToken = `upstream-access-secret-${tokenGeneration}`;
        const refreshToken = `upstream-refresh-secret-${tokenGeneration}`;
        upstreamAccessTokens.add(accessToken);
        upstreamRefreshTokens.add(refreshToken);
        return Response.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "profile",
        });
      }

      const upstream = await listenFetch(async (request) => {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/authorize") {
          expect(url.searchParams.get("client_id")).toBe(upstreamClientId);
          expect(url.searchParams.get("redirect_uri")).toBe(
            `${new URL(resourceUrl).origin}/oauth/callback`
          );
          expect(url.searchParams.get("code_challenge_method")).toBe("S256");
          expect(url.searchParams.get("scope")).toBe("profile");
          expect(url.searchParams.has("resource")).toBe(false);
          expect(url.searchParams.get("state")).not.toBe(downstreamState);
          authorizationGeneration += 1;
          const code = `upstream-authorization-code-${authorizationGeneration}`;
          authorizationCodes.set(code, url);
          const callback = new URL(url.searchParams.get("redirect_uri")!);
          callback.searchParams.set("state", url.searchParams.get("state")!);
          callback.searchParams.set("code", code);
          callback.searchParams.set("iss", upstreamIssuer);
          return Response.redirect(callback, 302);
        }
        if (request.method === "POST" && url.pathname === "/token") {
          expect(request.headers.get("authorization")).toBe(
            `Basic ${Buffer.from(`${upstreamClientId}:${upstreamClientSecret}`).toString("base64")}`
          );
          const params = new URLSearchParams(await request.text());
          upstreamTokenRequests.push(params);
          expect(params.has("resource")).toBe(false);
          if (params.get("grant_type") === "authorization_code") {
            const code = params.get("code")!;
            const authorization = authorizationCodes.get(code);
            if (
              authorization === undefined ||
              params.get("redirect_uri") !==
                authorization.searchParams.get("redirect_uri") ||
              (await s256(params.get("code_verifier") ?? "")) !==
                authorization.searchParams.get("code_challenge")
            ) {
              return Response.json({ error: "invalid_grant" }, { status: 400 });
            }
            authorizationCodes.delete(code);
            return issueUpstreamTokens();
          }
          if (
            params.get("grant_type") === "refresh_token" &&
            upstreamRefreshTokens.delete(params.get("refresh_token")!)
          ) {
            return issueUpstreamTokens();
          }
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        if (request.method === "GET" && url.pathname === "/userinfo") {
          const token = request.headers.get("authorization")?.slice(7) ?? "";
          return upstreamAccessTokens.has(token)
            ? Response.json(identity)
            : Response.json({ error: "invalid_token" }, { status: 401 });
        }
        // In particular, this provider does not implement /register.
        return new Response("Not Found", { status: 404 });
      });
      upstreamIssuer = upstream.url;

      let mcpHandler: (request: Request) => Promise<Response> = async () =>
        new Response("starting", { status: 503 });
      const mcpHost = await listenFetch(async (request) => {
        const path = new URL(request.url).pathname;
        proxyRequestPaths.push(`${request.method} ${path}`);
        if (request.method === "POST" && path === "/oauth/token") {
          downstreamTokenRequests.push(
            new URLSearchParams(await request.clone().text())
          );
        }
        return mcpHandler(request);
      });
      resourceUrl = `${mcpHost.url}/mcp`;

      async function providerIdentity(accessToken: string) {
        const response = await fetch(`${upstream.url}/userinfo`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error("Upstream token is not valid");
        return (await response.json()) as typeof identity;
      }

      const server = new Server({
        name: "oauth-proxy-acceptance",
        version: "1.0.0",
        oauth: createOAuthProxy({
          resource: resourceUrl,
          authEndpoint: `${upstream.url}/authorize`,
          tokenEndpoint: `${upstream.url}/token`,
          issuer: upstreamIssuer,
          requireAuthorizationResponseIssuer: true,
          clientId: upstreamClientId,
          clientSecret: upstreamClientSecret,
          tokenEndpointAuthMethod: "client_secret_basic",
          scopes: ["tools:call"],
          requiredScopes: ["tools:call"],
          upstreamScopes: ["profile"],
          verifyToken: async (token) => ({
            payload: await providerIdentity(token),
          }),
        }),
      });
      server.tool({ name: "whoami" }, async (_params, ctx) => {
        observedAuth.push({
          accessToken: ctx.auth.accessToken,
          providerAccessToken: ctx.auth.providerAccessToken,
          userId: ctx.auth.user.id,
          resource: ctx.auth.resource?.href,
          scopes: ctx.auth.scopes,
        });
        // The server uses the upstream token for provider APIs, while the MCP
        // client receives only its own local token and this non-secret result.
        const user = await providerIdentity(ctx.auth.providerAccessToken!);
        return { content: [{ type: "text", text: user.sub }] };
      });
      mcpHandler = server.fetch;

      let clientInformation: StoredOAuthClientInformation | undefined;
      let savedTokens: StoredOAuthTokens | undefined;
      let discovery: OAuthDiscoveryState | undefined;
      let authorizeUrl: URL | undefined;
      let codeVerifier = "";
      const provider: OAuthClientProvider = {
        redirectUrl: redirectUri,
        clientMetadata: {
          client_name: "Official SDK acceptance client",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "tools:call",
        },
        state: () => downstreamState,
        clientInformation: () => clientInformation,
        saveClientInformation: (value) => {
          clientInformation = value;
        },
        tokens: () => savedTokens,
        saveTokens: (value) => {
          savedTokens = value;
        },
        redirectToAuthorization: (value) => {
          authorizeUrl = value;
        },
        saveCodeVerifier: (value) => {
          codeVerifier = value;
        },
        codeVerifier: () => codeVerifier,
        saveDiscoveryState: (value) => {
          discovery = value;
        },
        discoveryState: () => discovery,
      };
      let client: Client | undefined;

      async function browserAuthorization(): Promise<URL> {
        expect(
          await auth(provider, {
            serverUrl: resourceUrl,
            forceReauthorization: true,
          })
        ).toBe("REDIRECT");
        expect(authorizeUrl?.searchParams.get("resource")).toBe(resourceUrl);
        expect(authorizeUrl?.searchParams.get("code_challenge")).toBe(
          await s256(codeVerifier)
        );
        const consent = await fetch(authorizeUrl!, { redirect: "manual" });
        expect(consent.status).toBe(200);
        const html = await consent.text();
        expect(html).toContain("Official SDK acceptance client");
        expect(html).toContain("tools:call");
        const setCookie = consent.headers.get("set-cookie")!;
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Lax");
        const cookie = setCookie.split(";", 1)[0]!;
        const approval = await fetch(`${mcpHost.url}/oauth/authorize`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
          },
          body: new URLSearchParams({
            transaction_id: hiddenInput(html, "transaction_id"),
            csrf_token: hiddenInput(html, "csrf_token"),
            decision: "approve",
          }),
          redirect: "manual",
        });
        expect(approval.status).toBe(303);
        const upstreamAuthorize = location(approval);
        expect(upstreamAuthorize.origin).toBe(upstream.url);
        expect(upstreamAuthorize.searchParams.get("code_challenge")).not.toBe(
          authorizeUrl?.searchParams.get("code_challenge")
        );
        const upstreamRedirect = await fetch(upstreamAuthorize, {
          redirect: "manual",
        });
        expect(upstreamRedirect.status).toBe(302);
        const callback = location(upstreamRedirect);
        const withoutCookie = await fetch(callback, { redirect: "manual" });
        expect(withoutCookie.status).toBe(400);
        const tamperedCallback = new URL(callback);
        tamperedCallback.searchParams.set("state", "x".repeat(43));
        const wrongState = await fetch(tamperedCallback, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(wrongState.status).toBe(400);
        const completed = await fetch(callback, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(completed.status).toBe(302);
        const downstream = location(completed);
        expect(`${downstream.origin}${downstream.pathname}`).toBe(redirectUri);
        expect(downstream.searchParams.get("state")).toBe(downstreamState);
        expect(downstream.searchParams.has("error")).toBe(false);
        expect(downstream.searchParams.get("code")).not.toBe(
          callback.searchParams.get("code")
        );
        const replay = await fetch(callback, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(replay.status).toBe(400);
        return downstream;
      }

      async function assertRejectedAccess(token: string): Promise<void> {
        const response = await fetch(resourceUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain(
          'error="invalid_token"'
        );
      }

      try {
        const unauthenticated = await fetch(resourceUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get("www-authenticate")).toContain(
          `resource_metadata="${mcpHost.url}/.well-known/oauth-protected-resource/mcp"`
        );
        expect((await fetch(`${upstream.url}/register`)).status).toBe(404);

        const callback = await browserAuthorization();
        expect(discovery?.resourceMetadata?.resource).toBe(resourceUrl);
        expect(discovery?.authorizationServerMetadata).toMatchObject({
          issuer: `${mcpHost.url}/oauth`,
          authorization_endpoint: `${mcpHost.url}/oauth/authorize`,
          registration_endpoint: `${mcpHost.url}/oauth/register`,
          token_endpoint: `${mcpHost.url}/oauth/token`,
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
        expect(proxyRequestPaths).toContain("POST /oauth/register");
        expect(clientInformation?.client_id).not.toBe(upstreamClientId);
        expect(clientInformation?.client_secret).toBeUndefined();
        expect(
          await auth(provider, {
            serverUrl: resourceUrl,
            authorizationCode: callback.searchParams.get("code")!,
          })
        ).toBe("AUTHORIZED");
        const initialTokens = { ...savedTokens! };
        expect(initialTokens.access_token).not.toBe("upstream-access-secret-1");
        expect(initialTokens.refresh_token).not.toBe(
          "upstream-refresh-secret-1"
        );
        expect(JSON.stringify(initialTokens)).not.toContain("upstream-");
        expect(downstreamTokenRequests[0]?.get("code_verifier")).toBe(
          codeVerifier
        );
        expect(downstreamTokenRequests[0]?.get("resource")).toBe(resourceUrl);
        expect(upstreamTokenRequests[0]?.get("code_verifier")).not.toBe(
          codeVerifier
        );

        const codeReplay = await postForm(`${mcpHost.url}/oauth/token`, {
          grant_type: "authorization_code",
          code: callback.searchParams.get("code")!,
          client_id: clientInformation!.client_id,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          resource: resourceUrl,
        });
        expect(codeReplay.status).toBe(400);
        expect(await codeReplay.json()).toMatchObject({
          error: "invalid_grant",
        });
        await assertRejectedAccess("invalid-credential");
        await assertRejectedAccess("upstream-access-secret-1");
        const localTokenAtProvider = await fetch(`${upstream.url}/userinfo`, {
          headers: { authorization: `Bearer ${initialTokens.access_token}` },
        });
        expect(localTokenAtProvider.status).toBe(401);

        client = new Client(
          { name: "official-proxy-client", version: "1.0.0" },
          { versionNegotiation: { mode: { pin: "2026-07-28" } } }
        );
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resourceUrl), {
            authProvider: provider,
          })
        );
        expect(
          (await client.listTools()).tools.map((tool) => tool.name)
        ).toContain("whoami");
        expect(
          (await client.callTool({ name: "whoami", arguments: {} })).content
        ).toEqual([{ type: "text", text: identity.sub }]);
        expect(observedAuth.at(-1)).toEqual({
          accessToken: initialTokens.access_token,
          providerAccessToken: "upstream-access-secret-1",
          userId: identity.sub,
          resource: resourceUrl,
          scopes: ["tools:call"],
        });

        // A healthy provider token allows local rotation without another
        // provider request; expiry triggers an actual upstream refresh.
        expect(await auth(provider, { serverUrl: resourceUrl })).toBe(
          "AUTHORIZED"
        );
        const localRotation = { ...savedTokens! };
        expect(localRotation.refresh_token).not.toBe(
          initialTokens.refresh_token
        );
        expect(upstreamTokenRequests).toHaveLength(1);
        now += 3_600_001;
        await assertRejectedAccess(localRotation.access_token);
        expect(await auth(provider, { serverUrl: resourceUrl })).toBe(
          "AUTHORIZED"
        );
        const refreshed = { ...savedTokens! };
        expect(upstreamTokenRequests).toHaveLength(2);
        expect(upstreamTokenRequests[1]?.get("grant_type")).toBe(
          "refresh_token"
        );
        expect(upstreamTokenRequests[1]?.get("refresh_token")).toBe(
          "upstream-refresh-secret-1"
        );
        expect(refreshed.access_token).not.toBe(localRotation.access_token);
        expect(refreshed.refresh_token).not.toBe(localRotation.refresh_token);
        expect(JSON.stringify(refreshed)).not.toContain("upstream-");
        expect(
          (await client.callTool({ name: "whoami", arguments: {} })).content
        ).toEqual([{ type: "text", text: identity.sub }]);
        expect(observedAuth.at(-1)?.accessToken).toBe(refreshed.access_token);
        expect(observedAuth.at(-1)?.providerAccessToken).toBe(
          "upstream-access-secret-2"
        );

        const refreshReplay = await postForm(`${mcpHost.url}/oauth/token`, {
          grant_type: "refresh_token",
          client_id: clientInformation!.client_id,
          refresh_token: localRotation.refresh_token!,
          resource: resourceUrl,
        });
        expect(refreshReplay.status).toBe(400);
        expect(await refreshReplay.json()).toMatchObject({
          error: "invalid_grant",
        });
        await assertRejectedAccess(refreshed.access_token);
        expect(upstreamTokenRequests).toHaveLength(2);

        // A separate authorization proves explicit logout/revocation too.
        const nextCallback = await browserAuthorization();
        expect(
          await auth(provider, {
            serverUrl: resourceUrl,
            authorizationCode: nextCallback.searchParams.get("code")!,
          })
        ).toBe("AUTHORIZED");
        const active = { ...savedTokens! };
        expect(
          (await client.callTool({ name: "whoami", arguments: {} })).content
        ).toEqual([{ type: "text", text: identity.sub }]);
        const revocation = await postForm(`${mcpHost.url}/oauth/revoke`, {
          token: active.refresh_token!,
          token_type_hint: "refresh_token",
          client_id: clientInformation!.client_id,
        });
        expect(revocation.status).toBe(200);
        await assertRejectedAccess(active.access_token);
        const revokedRefresh = await postForm(`${mcpHost.url}/oauth/token`, {
          grant_type: "refresh_token",
          client_id: clientInformation!.client_id,
          refresh_token: active.refresh_token!,
          resource: resourceUrl,
        });
        expect(revokedRefresh.status).toBe(400);
        expect(await revokedRefresh.json()).toMatchObject({
          error: "invalid_grant",
        });
      } finally {
        await client?.close();
        await server.close();
        await mcpHost.close();
        await upstream.close();
        clock.mockRestore();
      }
    });
  }
);
