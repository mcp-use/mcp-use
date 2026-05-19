/**
 * Integration tests for NodeOAuthClientProvider.
 *
 * Drives the full two-call OAuth dance against an in-process fake
 * authorization server. The only mock is the browser opener — we capture
 * the URL the provider would have opened and `fetch` it ourselves to
 * simulate the user granting consent.
 *
 * Run with:
 *   pnpm --filter mcp-use test -- tests/integration/auth/node-provider-flow.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { NodeOAuthClientProvider } from "../../../src/auth/node-provider.js";

interface FakeAS {
  url: string;
  server: Server;
  close: () => Promise<void>;
  registered: { redirectUris: string[] }[];
  /** Last authorization URL captured (so the test can pretend the user accepted). */
  lastAuthorizeUrl: string | null;
  /** Last issued code. */
  lastCode: string | null;
  /** Count of /token POSTs by grant_type. */
  tokenGrants: { authorization_code: number; refresh_token: number };
}

async function startFakeAuthServer(): Promise<FakeAS> {
  const state: FakeAS = {
    url: "",
    server: undefined as unknown as Server,
    close: async () => {},
    registered: [],
    lastAuthorizeUrl: null,
    lastCode: null,
    tokenGrants: { authorization_code: 0, refresh_token: 0 },
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          resource: state.url,
          authorization_servers: [state.url],
        })
      );
      return;
    }

    if (
      url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/openid-configuration"
    ) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          issuer: state.url,
          authorization_endpoint: `${state.url}/authorize`,
          token_endpoint: `${state.url}/token`,
          registration_endpoint: `${state.url}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        })
      );
      return;
    }

    if (url.pathname === "/register" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      state.registered.push({ redirectUris: parsed.redirect_uris ?? [] });
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          client_id: "fake-client-id",
          redirect_uris: parsed.redirect_uris,
          token_endpoint_auth_method: "none",
        })
      );
      return;
    }

    if (url.pathname === "/authorize") {
      // The SDK builds the URL, our provider opens "the browser". The test
      // grabs it via openBrowser injection — we don't actually serve a UI.
      state.lastAuthorizeUrl = url.toString();
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("would render consent page");
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const grant = params.get("grant_type");
      if (grant === "refresh_token") {
        state.tokenGrants.refresh_token += 1;
      } else {
        state.tokenGrants.authorization_code += 1;
      }
      const suffix = state.tokenGrants.refresh_token;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          access_token:
            grant === "refresh_token"
              ? `test-access-token-refreshed-${suffix}`
              : "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end("{}");
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${addr.port}`;
  state.server = server;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

let baseDir: string;
let fakeAS: FakeAS;

beforeAll(async () => {
  fakeAS = await startFakeAuthServer();
});

afterAll(async () => {
  await fakeAS.close();
});

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "mcp-use-node-prov-"));
});

describe("NodeOAuthClientProvider — full flow", () => {
  it("redirectToAuthorization → loopback → getAuthorizationCode → token exchange", async () => {
    let openedUrl: string | null = null;
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33518, // avoid clashing with default in case the dev box has one running
      openBrowser: (url) => {
        openedUrl = url;
      },
    });

    const port = provider.callbackPort;
    expect(port).toBeGreaterThanOrEqual(33518);

    // Step 1: kick off the flow. SDK does discovery + DCR + builds authorize URL,
    // then calls our redirectToAuthorization which binds loopback + invokes opener.
    const result1 = await auth(provider, { serverUrl: fakeAS.url });
    expect(result1).toBe("REDIRECT");
    expect(openedUrl).toBeTruthy();

    // The opened URL should target the fake AS's /authorize and contain state.
    const opened = new URL(openedUrl!);
    expect(opened.toString()).toContain(`${fakeAS.url}/authorize`);
    const stateParam = opened.searchParams.get("state");
    expect(stateParam).toBeTruthy();
    // Redirect URI registered by DCR matches our loopback.
    expect(fakeAS.registered).toHaveLength(1);
    expect(fakeAS.registered[0].redirectUris).toEqual([
      `http://127.0.0.1:${port}/callback`,
    ]);

    // Step 2: simulate the AS redirecting the user back to our loopback.
    const callbackResp = await fetch(
      `http://127.0.0.1:${port}/callback?code=fake-code&state=${stateParam}`
    );
    expect(callbackResp.status).toBe(200);
    const html = await callbackResp.text();
    expect(html).toContain("Authentication complete");

    // Step 3: orchestrator awaits the code.
    const code = await provider.getAuthorizationCode();
    expect(code).toBe("fake-code");

    // Step 4: exchange the code for tokens.
    const result2 = await auth(provider, {
      serverUrl: fakeAS.url,
      authorizationCode: code,
    });
    expect(result2).toBe("AUTHORIZED");

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe("test-access-token");
    expect(tokens?.refresh_token).toBe("test-refresh-token");
  });

  it("rejects with OAuthFlowError on ?error= callbacks", async () => {
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33528,
      openBrowser: () => {},
    });

    await auth(provider, { serverUrl: fakeAS.url });

    const port = provider.callbackPort;
    await fetch(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=user+said+no`
    );

    await expect(provider.getAuthorizationCode()).rejects.toMatchObject({
      name: "OAuthFlowError",
      code: "access_denied",
    });
  });

  it("times out cleanly if no callback arrives", async () => {
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33538,
      authTimeoutMs: 100,
      openBrowser: () => {},
    });
    await auth(provider, { serverUrl: fakeAS.url });

    await expect(provider.getAuthorizationCode()).rejects.toMatchObject({
      name: "OAuthFlowError",
      code: "timeout",
    });
  });

  it("persists the chosen port across instances", async () => {
    const a = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33548,
      openBrowser: () => {},
    });
    expect(a.callbackPort).toBe(33548);

    const b = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33999, // user passes a different preference, but disk wins
      openBrowser: () => {},
    });
    expect(b.callbackPort).toBe(33548);
  });

  it("hasPendingFlow tracks the redirect → callback lifecycle", async () => {
    let openedUrl: string | null = null;
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33568,
      openBrowser: (url) => {
        openedUrl = url;
      },
    });

    expect(provider.hasPendingFlow).toBe(false);

    // SDK auth() invokes redirectToAuthorization → loopback bound, pending set.
    const result = await auth(provider, { serverUrl: fakeAS.url });
    expect(result).toBe("REDIRECT");
    expect(provider.hasPendingFlow).toBe(true);

    // Callback resolves the flow → pending cleared.
    const stateParam = new URL(openedUrl!).searchParams.get("state");
    await fetch(
      `http://127.0.0.1:${provider.callbackPort}/callback?code=c&state=${stateParam}`
    );
    await provider.getAuthorizationCode();
    expect(provider.hasPendingFlow).toBe(false);
  });

  it("forceRefresh exchanges the refresh_token for a new access token", async () => {
    let openedUrl: string | null = null;
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33578,
      openBrowser: (url) => {
        openedUrl = url;
      },
    });

    // Drive the initial flow so tokens + refresh_token are persisted.
    await auth(provider, { serverUrl: fakeAS.url });
    const stateParam = new URL(openedUrl!).searchParams.get("state");
    await fetch(
      `http://127.0.0.1:${provider.callbackPort}/callback?code=fake-code&state=${stateParam}`
    );
    const code = await provider.getAuthorizationCode();
    await auth(provider, { serverUrl: fakeAS.url, authorizationCode: code });

    const initial = await provider.tokens();
    expect(initial?.access_token).toBe("test-access-token");
    const grantsBefore = fakeAS.tokenGrants.refresh_token;

    const refreshed = await provider.forceRefresh();
    expect(refreshed).not.toBeNull();
    expect(refreshed!.access_token).toMatch(/^test-access-token-refreshed-/);
    expect(fakeAS.tokenGrants.refresh_token).toBe(grantsBefore + 1);

    // Persisted tokens reflect the refreshed value.
    const persisted = await provider.tokens();
    expect(persisted?.access_token).toBe(refreshed!.access_token);
  });

  it("forceRefresh returns null when no refresh_token is stored", async () => {
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33588,
      openBrowser: () => {},
    });
    expect(await provider.forceRefresh()).toBeNull();
  });

  it("escapes HTML in the loopback failure page", async () => {
    const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
      baseDir,
      preferredPort: 33598,
      openBrowser: () => {},
    });
    await auth(provider, { serverUrl: fakeAS.url });

    const port = provider.callbackPort;
    const payload = "<script>alert(1)</script>";
    const resp = await fetch(
      `http://127.0.0.1:${port}/callback?error=${encodeURIComponent(
        payload
      )}&error_description=${encodeURIComponent(payload)}`
    );
    const html = await resp.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    await expect(provider.getAuthorizationCode()).rejects.toMatchObject({
      name: "OAuthFlowError",
    });
  });

  it("walks the port range when the preferred port is taken", async () => {
    const blocker = createServer().listen(33558, "127.0.0.1");
    try {
      await new Promise<void>((r) => blocker.once("listening", r));
      const provider = await NodeOAuthClientProvider.create(fakeAS.url, {
        baseDir,
        preferredPort: 33558,
        portRange: 5,
        openBrowser: () => {},
      });
      expect(provider.callbackPort).toBeGreaterThan(33558);
      expect(provider.callbackPort).toBeLessThan(33558 + 5);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
