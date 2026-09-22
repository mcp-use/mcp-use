import { afterEach, describe, expect, it, vi } from "vitest";
import { symmetricDecrypt } from "better-auth/crypto";
import { decodeJwt } from "jose";
import { setTimeout as delay } from "node:timers/promises";
import { MCPClient, NodeOAuthClientProvider } from "@mcp-use/client";

import { createOAuthMcpAuth } from "../src/oauth/better-auth-mcp.js";
import {
  authorize,
  followAuthorization,
  OAuthBrowser,
  startBroker,
  tokens,
} from "./helpers/oauth-broker.js";
import { startOidcProvider } from "./helpers/oidc-provider.js";
import { listenFetch } from "./helpers/listen-fetch.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function upstreamBroker(
  authentication: "basic" | "post" = "post",
  discovery = true,
  accessTokenSeconds = 60,
  tokenType: "access_token" | "refresh_token" = "refresh_token",
  upstreamAccessSeconds?: number
) {
  const upstream = await startOidcProvider(
    authentication,
    upstreamAccessSeconds
  );
  cleanup.push(async () => {
    await upstream.close();
    expect(upstream.errors).toEqual([]);
  });
  const broker = await startBroker((options) =>
    createOAuthMcpAuth({
      ...options,
      sessionExpiresIn: 600,
      accessTokenExpiresIn: accessTokenSeconds,
      sessionPolicy: "strict",
      providers: {
        issuer: {
          ...(discovery
            ? {
                discoveryUrl: `${upstream.origin}/.well-known/openid-configuration`,
              }
            : {
                authorizationUrl: `${upstream.origin}/auth`,
                tokenUrl: `${upstream.origin}/token`,
                userInfoUrl: `${upstream.origin}/me`,
                accountSubject: ({ profile }) => String(profile.sub),
              }),
          clientId: upstream.clientId,
          clientSecret: upstream.clientSecret,
          authentication,
          scopes: ["openid", "profile", "email", "offline_access"],
          introspection: {
            url: `${upstream.origin}/token/introspection`,
            tokenType,
            authentication,
          },
        },
      },
    })
  );
  cleanup.push(broker.close);
  await upstream.register(broker.auth.upstreamProviders.issuer!.callbackUrl);
  return {
    broker,
    upstream,
    async login() {
      const browser = new OAuthBrowser([broker.origin, upstream.origin]);
      const grant = await authorize(broker, browser, (query) =>
        browser.request(`${broker.base}/sign-in/social`, {
          provider: broker.auth.upstreamProviders.issuer!.provider,
          callbackURL: `${broker.base}/oauth2/authorize?${query}`,
          oauth_query: query,
          additionalParams: { prompt: "consent" },
        })
      );
      return {
        grant,
        credentials: await tokens(await broker.token(grant.fields)),
      };
    },
    upstreamToken(accessToken: string) {
      const session = broker.session(accessToken);
      expect(session).toBeDefined();
      const binding = JSON.parse(String(session!.upstreamBinding)) as {
        token: string;
        subject: string;
      };
      expect(binding.subject).toBe("upstream-user");
      return symmetricDecrypt({ key: broker.secret, data: binding.token });
    },
  };
}

describe("generic MCP broker with an independent OAuth issuer", () => {
  it("keeps rotated upstream credentials when their subsequent introspection is unavailable", async () => {
    const f = await upstreamBroker("post", true, 60, "access_token", 2);
    const first = await f.login();
    const before = f.broker.session(
      first.credentials.access_token
    )!.upstreamBinding;
    const expiry = JSON.parse(String(before)).tokenExpiresAt as number;
    await delay(Math.max(0, expiry * 1000 - Date.now()) + 25);
    f.upstream.control.failIntrospectionAfterToken = true;
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      503
    );
    expect(f.broker.executions).toBe(0);
    expect(
      f.broker.session(first.credentials.access_token)!.upstreamBinding
    ).not.toBe(before);
    const calls = f.upstream.tokenCalls;
    f.upstream.control.failIntrospectionAfterToken = false;
    f.upstream.control.fault = "none";
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      200
    );
    expect(f.upstream.tokenCalls).toBe(calls);
  });

  it("cancels upstream renewal without letting a late rejection delete the session", async () => {
    const f = await upstreamBroker("post", true, 60, "access_token", 2);
    const first = await f.login();
    const before = f.broker.session(
      first.credentials.access_token
    )!.upstreamBinding;
    const expiry = JSON.parse(String(before)).tokenExpiresAt as number;
    await delay(Math.max(0, expiry * 1000 - Date.now()) + 25);
    let release!: () => void;
    f.upstream.control.tokenWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.upstream.control.tokenFault = "invalid_grant";
    const calls = f.upstream.tokenCalls;
    const controller = new AbortController();
    const pending = f.broker.integration.requestAuth.authenticate(
      new Request(f.broker.resource, {
        headers: { authorization: `Bearer ${first.credentials.access_token}` },
        signal: controller.signal,
      })
    );
    try {
      await vi.waitFor(() => expect(f.upstream.tokenCalls).toBe(calls + 1));
      controller.abort();
      expect(await pending).toMatchObject({ status: 503 });
      await vi.waitFor(() =>
        expect(
          f.broker.session(first.credentials.access_token)!.upstreamBinding
        ).toBe(before)
      );
    } finally {
      release();
      f.upstream.control.tokenWait = undefined;
      f.upstream.control.tokenFault = "none";
    }
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      200
    );
  });

  it.each(["basic", "post"] as const)(
    "renews expired upstream access with %s authentication and keeps logins isolated",
    async (authentication) => {
      const f = await upstreamBroker(
        authentication,
        true,
        60,
        "access_token",
        2
      );
      const first = await f.login();
      const second = await f.login();
      const before = f.broker.session(
        first.credentials.access_token
      )!.upstreamBinding;
      const secondBefore = f.broker.session(
        second.credentials.access_token
      )!.upstreamBinding;
      const expiry = (JSON.parse(String(before)) as { tokenExpiresAt: number })
        .tokenExpiresAt;
      await delay(Math.max(0, expiry * 1000 - Date.now()) + 25);
      const calls = f.upstream.tokenCalls;
      const responses = await Promise.all([
        f.broker.tool(first.credentials.access_token),
        f.broker.tool(first.credentials.access_token),
      ]);
      expect(responses.some((response) => response.status === 200)).toBe(true);
      expect(
        responses.every((response) => [200, 503].includes(response.status))
      ).toBe(true);
      expect(f.upstream.tokenCalls).toBe(calls + 1);
      expect(
        f.broker.session(first.credentials.access_token)!.upstreamBinding
      ).not.toBe(before);
      expect(
        f.broker.session(second.credentials.access_token)!.upstreamBinding
      ).toBe(secondBefore);
      expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
        200
      );
    }
  );

  it("preserves an expired upstream session during a refresh outage and recovers with the same MCP token", async () => {
    const f = await upstreamBroker("post", false, 60, "access_token", 2);
    const first = await f.login();
    const before = f.broker.session(
      first.credentials.access_token
    )!.upstreamBinding;
    const expiry = JSON.parse(String(before)).tokenExpiresAt as number;
    await delay(Math.max(0, expiry * 1000 - Date.now()) + 25);
    f.upstream.control.tokenFault = "unavailable";
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      503
    );
    expect(
      f.broker.session(first.credentials.access_token)!.upstreamBinding
    ).toBe(before);
    f.upstream.control.tokenFault = "none";
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      200
    );
  });

  it("ends the local session when upstream refresh credentials are rejected", async () => {
    const f = await upstreamBroker("post", true, 60, "access_token", 2);
    const first = await f.login();
    const expiry = JSON.parse(
      String(f.broker.session(first.credentials.access_token)!.upstreamBinding)
    ).tokenExpiresAt as number;
    await delay(Math.max(0, expiry * 1000 - Date.now()) + 25);
    f.upstream.control.tokenFault = "invalid_grant";
    expect((await f.broker.tool(first.credentials.access_token)).status).toBe(
      401
    );
    expect(f.broker.session(first.credentials.access_token)).toBeUndefined();
    const rejected = await f.broker.token({
      grant_type: "refresh_token",
      client_id: first.grant.clientId,
      refresh_token: first.credentials.refresh_token,
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("lets the actual client discover, register, authorize and automatically renew after expiry", async () => {
    const { broker, upstream } = await upstreamBroker("post", true, 2);
    const reservation = await listenFetch(async () => new Response(null));
    const callbackPort = reservation.port;
    await reservation.close();
    const storage = new Map<string, string>();
    let authorizationFlows = 0;
    let browserFlow: Promise<void> | undefined;
    let failBrowser!: (error: unknown) => void;
    const browserFailure = new Promise<never>((_resolve, reject) => {
      failBrowser = reject;
    });
    const authProvider: NodeOAuthClientProvider =
      await NodeOAuthClientProvider.create(broker.resource, {
        preferredPort: callbackPort,
        authTimeoutMs: 10_000,
        scope: "mcp:read offline_access",
        kvStore: {
          get: (key) => storage.get(key) ?? null,
          set: (key, value) => {
            storage.set(key, value);
          },
          remove: (key) => {
            storage.delete(key);
          },
          keys: () => [...storage.keys()],
        },
        openBrowser: (url) => {
          authorizationFlows++;
          // Opening a browser returns before the user finishes authorization.
          // Keep that ordering and propagate driver failures to the test.
          browserFlow = (async () => {
            const browser = new OAuthBrowser([
              broker.origin,
              upstream.origin,
              new URL(authProvider.redirectUrl).origin,
            ]);
            const callback = await followAuthorization(
              broker,
              browser,
              url,
              String(authProvider.redirectUrl),
              (query) =>
                browser.request(`${broker.base}/sign-in/social`, {
                  provider: broker.auth.upstreamProviders.issuer!.provider,
                  callbackURL: `${broker.base}/oauth2/authorize?${query}`,
                  oauth_query: query,
                  additionalParams: { prompt: "consent" },
                })
            );
            const response = await browser.request(callback.href);
            expect(response.status).toBe(200);
            await response.body?.cancel();
          })();
          void browserFlow.catch(failBrowser);
        },
      });
    cleanup.push(async () => authProvider.dispose());
    expect(await authProvider.tokens()).toBeUndefined();
    expect(await authProvider.clientInformation()).toBeUndefined();
    const client = new MCPClient({
      mcpServers: {
        broker: {
          url: broker.resource,
          authProvider,
          protocolNegotiation: { pin: "2026-07-28" },
        },
      },
    });
    cleanup.push(() => client.closeAllSessions());
    const connection = await Promise.race([
      client.createSession("broker"),
      browserFailure,
    ]);
    await browserFlow;
    const firstResult = await connection.callTool("identity", {});
    expect(firstResult.isError).not.toBe(true);
    const first = (await authProvider.tokens())!;
    const firstClaims = decodeJwt(first.access_token);
    const originalGrant = broker.refreshRows()[0]!;
    expect(typeof originalGrant.authorizationCodeId).toBe("string");
    await delay(2100);
    expect(firstClaims.exp).toBeLessThanOrEqual(Date.now() / 1000);
    upstream.control.fault = "unavailable";
    await expect(connection.callTool("identity", {})).rejects.toThrow();
    expect((await authProvider.tokens())?.refresh_token).toBe(
      first.refresh_token
    );
    upstream.control.fault = "none";
    const secondResult = await connection.callTool("identity", {});
    expect(secondResult.isError).not.toBe(true);
    expect(secondResult.content).toEqual(firstResult.content);
    const renewed = (await authProvider.tokens())!;
    expect(renewed.access_token).not.toBe(first.access_token);
    expect(renewed.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(renewed.access_token).sid).toBe(firstClaims.sid);
    const activeGrants = broker.refreshRows().filter((row) => !row.revoked);
    expect(activeGrants).toHaveLength(1);
    expect(activeGrants[0]!.authorizationCodeId).toBe(
      originalGrant.authorizationCodeId
    );
    expect(authorizationFlows).toBe(1);
    expect(broker.executions).toBe(2);
  });

  it.each([
    ["basic", "access_token"],
    ["post", "refresh_token"],
  ] as const)(
    "supports a pre-registered %s client and checks %s revocation before renewal",
    async (authentication, tokenType) => {
      const fixture = await upstreamBroker(authentication, true, 60, tokenType);
      const { broker, upstream } = fixture;
      const metadata = await fetch(
        `${upstream.origin}/.well-known/openid-configuration`
      ).then((response) => response.json());
      expect(metadata).not.toHaveProperty("registration_endpoint");
      const { grant, credentials } = await fixture.login();
      expect((await broker.tool(credentials.access_token)).status).toBe(200);
      expect(broker.executions).toBe(1);
      const upstreamToken = await fixture.upstreamToken(
        credentials.access_token
      );
      expect(
        String(broker.session(credentials.access_token)!.upstreamBinding)
      ).not.toContain(upstreamToken);
      expect(JSON.stringify(decodeJwt(credentials.access_token))).not.toContain(
        upstreamToken
      );
      expect((await upstream.revoke(upstreamToken, tokenType)).status).toBe(
        200
      );
      expect(decodeJwt(credentials.access_token).exp).toBeGreaterThan(
        Date.now() / 1000
      );
      // Renewal is the first operation after revocation; a prior protected
      // request must not be needed to invalidate the session.
      const renewal = await broker.token({
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: credentials.refresh_token,
      });
      expect(renewal.status).toBe(400);
      expect(await renewal.json()).toMatchObject({ error: "invalid_grant" });
      expect(broker.session(credentials.access_token)).toBeUndefined();
      expect((await broker.tool(credentials.access_token)).status).toBe(401);
      expect(broker.executions).toBe(1);
    }
  );

  it("keeps the first login bound to its original upstream token after a second login", async () => {
    const fixture = await upstreamBroker();
    const { broker, upstream } = fixture;
    const first = await fixture.login();
    const firstBinding = broker.session(
      first.credentials.access_token
    )!.upstreamBinding;
    const firstToken = await fixture.upstreamToken(
      first.credentials.access_token
    );
    const second = await fixture.login();
    expect(decodeJwt(second.credentials.access_token).sid).not.toBe(
      decodeJwt(first.credentials.access_token).sid
    );
    expect(
      await fixture.upstreamToken(second.credentials.access_token)
    ).not.toBe(firstToken);
    expect(
      broker.session(first.credentials.access_token)!.upstreamBinding
    ).toBe(firstBinding);
    expect((await upstream.revoke(firstToken, "refresh_token")).status).toBe(
      200
    );
    expect((await broker.tool(first.credentials.access_token)).status).toBe(
      401
    );
    expect(broker.executions).toBe(0);
    expect((await broker.tool(second.credentials.access_token)).status).toBe(
      200
    );
    expect(broker.executions).toBe(1);
    expect(broker.session(first.credentials.access_token)).toBeUndefined();
    expect(broker.session(second.credentials.access_token)).toBeDefined();
  });

  it.each(["unavailable", "unauthorized", "malformed"] as const)(
    "fails closed on %s introspection without consuming refresh state",
    async (fault) => {
      const { broker, upstream, login } = await upstreamBroker();
      const { grant, credentials } = await login();
      const refresh = {
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: credentials.refresh_token,
      };
      const before = broker.refreshRows();
      upstream.control.fault = fault;
      expect((await broker.tool(credentials.access_token)).status).toBe(503);
      const rejected = await broker.token(refresh);
      expect(rejected.status).toBe(503);
      expect(await rejected.json()).toMatchObject({
        error: "temporarily_unavailable",
      });
      expect(broker.executions).toBe(0);
      expect(broker.refreshRows()).toEqual(before);
      expect(broker.session(credentials.access_token)).toBeDefined();
      upstream.control.fault = "none";
      const calls = upstream.introspectionCalls;
      expect((await broker.tool(credentials.access_token)).status).toBe(200);
      expect((await broker.tool(credentials.access_token)).status).toBe(200);
      expect(upstream.introspectionCalls).toBe(calls + 2);
      const recovered = await tokens(await broker.token(refresh));
      expect(recovered.refresh_token).not.toBe(credentials.refresh_token);
    }
  );

  it("performs plain OAuth login and strict checks without OIDC discovery", async () => {
    const { broker, login } = await upstreamBroker("post", false);
    const { grant, credentials } = await login();
    const response = await broker.tool(credentials.access_token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining('"subject":"upstream-user"'),
          },
        ],
      },
    });
    const renewed = await tokens(
      await broker.token({
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: credentials.refresh_token,
      })
    );
    expect((await broker.tool(renewed.access_token)).status).toBe(200);
  });
});
