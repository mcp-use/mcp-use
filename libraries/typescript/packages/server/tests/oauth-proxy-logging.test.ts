import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import type { LogLevel } from "../src/logging.js";
import { oauthProxy, type OAuthProxyUser } from "../src/oauth/index.js";

const origin = "https://mcp.example.test";
const resource = `${origin}/mcp`;
const redirectUri = "https://client.example.test/callback";
const verifier = "v".repeat(43);

function createServer(
  level: LogLevel,
  prefix: string,
  proxyFactory = oauthProxy,
  allowedOrigins?: string[]
): MCPServer<OAuthProxyUser> {
  return new MCPServer({
    name: "oauth-logging-test",
    version: "1.0.0",
    logging: { level },
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    oauth: proxyFactory({
      resource,
      authorizationServerPath: prefix,
      authEndpoint: "https://provider.example.test/authorize",
      tokenEndpoint: "https://provider.example.test/token",
      clientId: "provider-app-id",
      clientSecret: "provider-app-secret",
      tokenEndpointAuthMethod: "client_secret_basic",
      scopes: ["read"],
      upstreamScopes: ["profile"],
      verifyToken: () => ({ payload: { sub: "provider-user-secret" } }),
      fetch: async () =>
        Response.json({
          access_token: "provider-access-secret",
          refresh_token: "provider-refresh-secret",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    }),
  });
}

function hidden(html: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]+)"`, "u").exec(html);
  if (value === null) throw new Error(`Missing consent input: ${name}`);
  return value[1]!;
}

function formRequest(
  prefix: string,
  route: string,
  values: Record<string, string>,
  cookie?: string
): Request {
  return new Request(`${origin}${prefix}/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: new URLSearchParams(values),
  });
}

describe("OAuth proxy request logging privacy", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("MCP_USE_LOG_LEVEL", "");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function logged(): string {
    return (logSpy.mock.calls as unknown[][])
      .map((call) => call.map(String).join(" "))
      .join("\n");
  }

  it.each(["/oauth", "/custom/login"])(
    "keeps the complete OAuth flow summary-only at trace level for %s",
    async (prefix) => {
      const server = createServer("trace", prefix);
      try {
        const registration = await server.fetch(
          new Request(`${origin}${prefix}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              redirect_uris: [redirectUri],
              client_name: "private-client-name",
              token_endpoint_auth_method: "none",
            }),
          })
        );
        expect(registration.status).toBe(201);
        const client = (await registration.json()) as { client_id: string };
        const challenge = Buffer.from(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier)
          )
        ).toString("base64url");
        const authorizationUrl = new URL(`${origin}${prefix}/authorize`);
        authorizationUrl.search = new URLSearchParams({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: redirectUri,
          state: "downstream-state-secret",
          resource,
          scope: "read",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        const consent = await server.fetch(new Request(authorizationUrl));
        expect(consent.status).toBe(200);
        const html = await consent.text();
        const cookie = consent.headers.get("Set-Cookie")!.split(";", 1)[0]!;
        const transactionId = hidden(html, "transaction_id");
        const csrfToken = hidden(html, "csrf_token");
        const approval = await server.fetch(
          formRequest(
            prefix,
            "authorize",
            {
              transaction_id: transactionId,
              csrf_token: csrfToken,
              decision: "approve",
            },
            cookie
          )
        );
        expect(approval.status).toBe(303);
        const upstreamUrl = new URL(approval.headers.get("Location")!);
        const upstreamState = upstreamUrl.searchParams.get("state")!;
        const callbackUrl = new URL(`${origin}${prefix}/callback`);
        callbackUrl.search = new URLSearchParams({
          code: "provider-code-secret",
          state: upstreamState,
        }).toString();
        const callback = await server.fetch(
          new Request(callbackUrl, {
            headers: { Cookie: cookie },
          })
        );
        expect(callback.status).toBe(302);
        const localCode = new URL(
          callback.headers.get("Location")!
        ).searchParams.get("code")!;
        const exchanged = await server.fetch(
          formRequest(prefix, "token", {
            grant_type: "authorization_code",
            client_id: client.client_id,
            code: localCode,
            redirect_uri: redirectUri,
            code_verifier: verifier,
            resource,
          })
        );
        expect(exchanged.status).toBe(200);
        const tokens = (await exchanged.json()) as {
          access_token: string;
          refresh_token: string;
        };
        const refreshed = await server.fetch(
          formRequest(prefix, "token", {
            grant_type: "refresh_token",
            client_id: client.client_id,
            refresh_token: tokens.refresh_token,
            resource,
          })
        );
        expect(refreshed.status).toBe(200);
        const rotated = (await refreshed.json()) as { refresh_token: string };
        const revoked = await server.fetch(
          formRequest(prefix, "revoke", {
            client_id: client.client_id,
            token: rotated.refresh_token,
          })
        );
        expect(revoked.status).toBe(200);

        const output = logged();
        for (const secret of [
          "private-client-name",
          client.client_id,
          transactionId,
          csrfToken,
          cookie,
          "downstream-state-secret",
          upstreamState,
          localCode,
          tokens.access_token,
          tokens.refresh_token,
          rotated.refresh_token,
          "provider-code-secret",
          "provider-app-secret",
          "provider-access-secret",
          "provider-refresh-secret",
          "provider-user-secret",
          verifier,
        ])
          expect(output).not.toContain(secret);
        expect(output).not.toContain("[TRACE]");
        const lines = output.split("\n");
        expect(lines).toHaveLength(7);
        for (const line of lines) {
          expect(line).toMatch(
            /^(?:GET|POST) \/\S+ (?:200|201|302|303) \d+ms$/u
          );
        }
        for (const response of [
          registration,
          consent,
          approval,
          callback,
          exchanged,
          refreshed,
          revoked,
        ]) {
          expect([...response.headers.keys()].join(" ")).not.toMatch(
            /log.*privacy|sensitive/iu
          );
        }
      } finally {
        await server.close();
      }
    }
  );

  it.each(["info", "debug", "trace"] as const)(
    "suppresses MCP-shaped attacker input on malformed OAuth requests at %s level",
    async (level) => {
      const prefix = "/custom/login";
      const server = createServer(level, prefix);
      try {
        for (const route of [
          "register",
          "authorize",
          "callback",
          "token",
          "revoke",
        ]) {
          await server.fetch(
            new Request(`${origin}${prefix}/${route}?code=query-secret`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Private-Value": "header-secret",
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                  name: "method-subject-secret",
                  arguments: { secret: "argument-secret" },
                },
              }),
            })
          );
        }
        const output = logged();
        expect(output.split("\n")).toHaveLength(5);
        expect(output).not.toMatch(/secret|tools\/call|TRACE/u);
        expect(output).toContain("POST /custom/login/callback 405");
      } finally {
        await server.close();
      }
    }
  );

  it("shares privacy marking across separately loaded server and OAuth module graphs", async () => {
    vi.resetModules();
    const separateOAuthModule = await import("../src/oauth/index.js");
    const server = createServer(
      "trace",
      "/oauth",
      separateOAuthModule.oauthProxy
    );
    try {
      await server.fetch(
        new Request(`${origin}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_value: "separate-module-secret" }),
        })
      );
      expect(logged()).not.toContain("separate-module-secret");
      expect(logged().split("\n")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("keeps rejected-origin requests private before OAuth middleware executes", async () => {
    const server = createServer("trace", "/custom/login", oauthProxy, [
      "allowed.example.test",
    ]);
    try {
      const response = await server.fetch(
        new Request(`${origin}/custom/login/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.example.test",
            "X-Private-Value": "header-secret",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "subject-secret",
              arguments: { token: "token-secret" },
            },
          }),
        })
      );
      expect(response.status).toBe(403);
      expect(logged()).not.toMatch(/secret|tools\/call|TRACE/u);
      expect(logged().split("\n")).toHaveLength(1);
      expect(logged()).toContain("POST /custom/login/token 403");
    } finally {
      await server.close();
    }
  });

  it("keeps malformed JSON private without the generic body parser intercepting it", async () => {
    const server = createServer("trace", "/oauth");
    try {
      const response = await server.fetch(
        new Request(`${origin}/oauth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{ malformed-json-secret",
        })
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_client_metadata",
      });
      expect(logged()).not.toMatch(/secret|TRACE/u);
      expect(logged().split("\n")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("does not suppress unowned paths or accept a privacy marker over HTTP", async () => {
    const server = createServer("trace", "/custom/login");
    try {
      const response = await server.fetch(
        new Request(`${origin}/custom/login/unowned`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "mcp-use.sensitive-http-request": "true",
          },
          body: JSON.stringify({ diagnostic: "normal-request-details" }),
        })
      );
      expect(response.status).toBe(404);
      expect(logged()).toContain("[TRACE] Request Details");
      expect(logged()).toContain("normal-request-details");
    } finally {
      await server.close();
    }
  });

  // Opt in after building: this intentionally resolves the actual package
  // exports in Node, rather than Vitest's transformed source module graph.
  it.runIf(process.env["MCP_USE_TEST_BUILT_PACKAGE"] === "1")(
    "keeps the separately bundled published Node and OAuth entrypoints private",
    () => {
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
          import assert from "node:assert/strict";
          import { MCPServer } from "mcp-use";
          import { oauthProxy } from "mcp-use/oauth";

          const lines = [];
          console.log = (...values) => lines.push(values.map(String).join(" "));
          const server = new MCPServer({
            name: "published-oauth-logging-test",
            version: "1.0.0",
            logging: { level: "trace" },
            allowedOrigins: ["allowed.example.test"],
            oauth: oauthProxy({
              resource: "https://mcp.example.test/mcp",
              authorizationServerPath: "/custom/login",
              authEndpoint: "https://provider.example.test/authorize",
              tokenEndpoint: "https://provider.example.test/token",
              clientId: "provider-app-id",
              tokenEndpointAuthMethod: "none",
              scopes: ["read"],
              verifyToken: () => ({ payload: { sub: "user" } }),
            }),
          });
          try {
            const registered = await server.fetch(new Request(
              "https://mcp.example.test/custom/login/register",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Origin: "https://allowed.example.test",
                },
                body: JSON.stringify({
                  redirect_uris: ["https://client.example.test/callback"],
                  client_name: "published-private-client-name",
                }),
              }
            ));
            assert.equal(registered.status, 201);
            const rejected = await server.fetch(new Request(
              "https://mcp.example.test/custom/login/token",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Origin: "https://attacker.example.test",
                  "X-Private-Value": "published-header-secret",
                },
                body: JSON.stringify({
                  jsonrpc: "2.0", id: 1, method: "tools/call",
                  params: { name: "published-subject-secret" },
                }),
              }
            ));
            assert.equal(rejected.status, 403);
            assert.equal(lines.length, 2);
            assert.doesNotMatch(lines.join("\\n"), /private|secret|TRACE|tools\\/call/);
            assert.match(lines[0], /POST \\/custom\\/login\\/register 201/);
            assert.match(lines[1], /POST \\/custom\\/login\\/token 403/);
            process.stdout.write("published OAuth logging privacy passed\\n");
          } finally {
            await server.close();
          }
        `,
        ],
        {
          cwd: new URL("..", import.meta.url),
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1", MCP_USE_LOG_LEVEL: "" },
        }
      );
      expect(output).toContain("published OAuth logging privacy passed");
    }
  );
});
