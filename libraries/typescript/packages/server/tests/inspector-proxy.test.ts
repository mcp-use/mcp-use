import { afterEach, describe, expect, it, vi } from "vitest";

import { createInspectorProxyHandler } from "../src/inspector-proxy.js";

const inspectorOrigin = "http://localhost:8080";
const proxyUrl = `${inspectorOrigin}/mcp/inspector/api/proxy`;
const oauthUrl = `${inspectorOrigin}/mcp/inspector/api/oauth`;

afterEach(() => {
  vi.unstubAllEnvs();
});

function proxyRequest(target: string, init: RequestInit = {}): Request {
  return new Request(proxyUrl, {
    ...init,
    method: init.method ?? "POST",
    headers: {
      Origin: inspectorOrigin,
      Referer: `${inspectorOrigin}/mcp/inspector`,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      "X-Target-URL": target,
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
    body: init.body ?? "{}",
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetch-native Inspector proxy", () => {
  it("accepts the explicit public MCP_URL used by hosted deployments", async () => {
    vi.stubEnv("MCP_URL", "https://inspector.example.com/mcp");
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["93.184.216.34"],
      },
    });

    const response = await handler(
      new Request(proxyUrl, {
        method: "POST",
        headers: {
          Origin: "https://inspector.example.com",
          "Content-Type": "application/json",
          "X-Target-URL": "https://remote.example/mcp",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects a browser origin that differs from the public MCP_URL", async () => {
    vi.stubEnv("MCP_URL", "https://inspector.example.com/mcp");
    const fetchFn = vi.fn<typeof fetch>();
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["93.184.216.34"],
      },
    });

    const response = await handler(
      new Request(proxyUrl, {
        method: "POST",
        headers: {
          Origin: "https://other.example.com",
          "Content-Type": "application/json",
          "X-Target-URL": "https://remote.example/mcp",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("accepts the public same origin forwarded by a trusted deployment proxy", async () => {
    const publicOrigin = "https://inspector.example.com";
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["93.184.216.34"],
      },
    });

    const response = await handler(
      new Request(proxyUrl, {
        method: "POST",
        headers: {
          Origin: publicOrigin,
          "Content-Type": "application/json",
          "X-Forwarded-Host": "inspector.example.com",
          "X-Forwarded-Proto": "https",
          "X-Target-URL": "https://remote.example/mcp",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      publicOrigin
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("relays MCP while stripping browser origin headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("origin")).toBeNull();
      expect(headers.get("referer")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("proxy-authorization")).toBeNull();
      expect(headers.get("sec-fetch-site")).toBeNull();
      expect(headers.get("authorization")).toBe("Bearer test-token");
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
          "access-control-allow-origin": "https://remote.example",
          "content-type": "application/json",
          "set-cookie": "upstream_session=secret; Secure; HttpOnly",
          "strict-transport-security": "max-age=31536000",
          "www-authenticate":
            'Bearer resource_metadata="https://remote.example/.well-known/oauth-protected-resource/mcp"',
        },
      });
    });
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["93.184.216.34"],
      },
    });

    const response = await handler(
      proxyRequest("https://remote.example/mcp", {
        headers: {
          Authorization: "Bearer test-token",
          Cookie: "inspector_session=must-not-leak",
          "Proxy-Authorization": "Basic must-not-leak",
        },
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      inspectorOrigin
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource"
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("drops bearer authorization before following a cross-origin redirect", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: "https://other.example/mcp" },
        })
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return jsonResponse({ ok: true });
      });
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["93.184.216.34"],
      },
    });

    const response = await handler(
      proxyRequest("https://remote.example/mcp", {
        headers: { Authorization: "Bearer must-not-leak" },
      })
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects targets resolving to private addresses", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const handler = createInspectorProxyHandler({
      basePath: "/mcp",
      runtime: {
        fetch: fetchFn,
        resolveHostname: async () => ["10.0.0.8"],
      },
    });

    const response = await handler(proxyRequest("https://private.example/mcp"));

    expect(response.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(["client_secret_basic", "client_secret_post"] as const)(
    "keeps confidential DCR secrets server-side and proxies the OAuth chain with %s",
    async (authMethod) => {
      const serverUrl = "https://remote.example/mcp";
      const resourceMetadataUrl =
        "https://remote.example/.well-known/oauth-protected-resource/mcp";
      const authorizationMetadataUrl =
        "https://auth.example/.well-known/oauth-authorization-server";
      const tokenUrl = "https://auth.example/oauth/token";
      const registrationUrl = "https://auth.example/oauth/register";
      const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
        const url = input.toString();
        if (url === resourceMetadataUrl) {
          return jsonResponse({
            resource: serverUrl,
            authorization_servers: ["https://auth.example"],
          });
        }
        if (url === authorizationMetadataUrl) {
          return jsonResponse({
            issuer: "https://auth.example",
            token_endpoint: tokenUrl,
            registration_endpoint: registrationUrl,
            token_endpoint_auth_methods_supported: [
              "client_secret_basic",
              "client_secret_post",
            ],
          });
        }
        if (url === tokenUrl) {
          const headers = new Headers(init?.headers);
          const params = new URLSearchParams(String(init?.body));
          expect(params.get("client_id")).toBe("registered-client");
          if (authMethod === "client_secret_basic") {
            expect(headers.get("authorization")).toBe(
              `Basic ${Buffer.from("registered-client:server-only-secret").toString("base64")}`
            );
            expect(params.get("client_secret")).toBeNull();
          } else {
            expect(headers.get("authorization")).toBeNull();
            expect(params.get("client_secret")).toBe("server-only-secret");
          }
          return jsonResponse({
            access_token: "redacted",
            token_type: "Bearer",
          });
        }
        if (url === registrationUrl) {
          expect(new Headers(init?.headers).get("content-type")).toBe(
            "application/json"
          );
          expect(init?.body).toBe(
            JSON.stringify({
              client_name: "Inspector",
              redirect_uris: [
                `${inspectorOrigin}/mcp/inspector/oauth/callback`,
              ],
            })
          );
          return jsonResponse({
            client_id: "registered-client",
            client_secret: "server-only-secret",
            token_endpoint_auth_method: authMethod,
          });
        }
        return new Response("not found", { status: 404 });
      });
      const handler = createInspectorProxyHandler({
        basePath: "/mcp",
        runtime: {
          fetch: fetchFn,
          resolveHostname: async () => ["93.184.216.34"],
        },
      });
      const metadataRequest = (url: string) =>
        new Request(
          `${oauthUrl}/metadata?serverUrl=${encodeURIComponent(serverUrl)}&url=${encodeURIComponent(url)}`,
          { headers: { Origin: inspectorOrigin } }
        );

      const protectedResource = await handler(
        metadataRequest(resourceMetadataUrl)
      );
      expect(protectedResource.status).toBe(200);
      const authorizationMetadata = await handler(
        metadataRequest(authorizationMetadataUrl)
      );
      expect(authorizationMetadata.status).toBe(200);

      const registrationBody = JSON.stringify({
        client_name: "Inspector",
        redirect_uris: [`${inspectorOrigin}/legacy/inspector/oauth/callback`],
      });
      const registration = await handler(
        new Request(`${oauthUrl}/proxy`, {
          method: "POST",
          headers: {
            Origin: inspectorOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            serverUrl,
            url: registrationUrl,
            method: "POST",
            headers: {},
            body: registrationBody,
          }),
        })
      );
      expect(registration.status).toBe(200);
      const registrationPayload = await registration.json();
      expect(registrationPayload).toMatchObject({
        status: 200,
        body: {
          client_id: "registered-client",
          token_endpoint_auth_method: "none",
        },
      });
      expect(JSON.stringify(registrationPayload)).not.toContain(
        "server-only-secret"
      );

      const token = await handler(
        new Request(`${oauthUrl}/proxy`, {
          method: "POST",
          headers: {
            Origin: inspectorOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            serverUrl,
            url: tokenUrl,
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: {
              grant_type: "authorization_code",
              code: "redacted",
              client_id: "registered-client",
            },
          }),
        })
      );

      expect(token.status).toBe(200);
      expect(await token.json()).toMatchObject({
        status: 200,
        body: { access_token: "redacted", token_type: "Bearer" },
      });
    }
  );
});
