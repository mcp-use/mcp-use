import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOAuthProxy } from "../../src/server/proxy/oauth-proxy";

const inspectorOrigin = "https://inspector.example.com";
const serverUrl = "https://93.184.216.34/mcp";
const issuer = "https://93.184.216.35";
const resourceMetadataUrl =
  "https://93.184.216.34/.well-known/oauth-protected-resource/mcp";
const authorizationMetadataUrl =
  "https://93.184.216.35/.well-known/oauth-authorization-server";
const registrationUrl = "https://93.184.216.35/oauth/register";
const tokenUrl = "https://93.184.216.35/oauth/token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function metadataRequest(url: string): Request {
  return new Request(
    `${inspectorOrigin}/oauth/metadata?serverUrl=${encodeURIComponent(serverUrl)}&url=${encodeURIComponent(url)}`,
    { headers: { Origin: inspectorOrigin } }
  );
}

function proxyRequest(url: string, body: unknown): Request {
  return new Request(`${inspectorOrigin}/oauth/proxy`, {
    method: "POST",
    headers: {
      Origin: inspectorOrigin,
      "Content-Type": "application/json",
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
      },
      body,
    }),
  });
}

afterEach(() => {
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
        },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      inspectorOrigin
    );
  });

  it("keeps DCR secrets off the browser and restores client_secret_post", async () => {
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
    mountOAuthProxy(app, { basePath: "/oauth", enableLogging: false });

    expect((await app.fetch(metadataRequest(resourceMetadataUrl))).status).toBe(
      200
    );
    expect(
      (await app.fetch(metadataRequest(authorizationMetadataUrl))).status
    ).toBe(200);

    const registration = await app.fetch(
      proxyRequest(registrationUrl, {
        client_name: "Inspector",
        redirect_uris: [`${inspectorOrigin}/mcp/inspector/oauth/callback`],
        token_endpoint_auth_method: "none",
      })
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
      proxyRequest(tokenUrl, {
        grant_type: "authorization_code",
        code: "redacted",
        client_id: "confidential-client",
      })
    );
    expect(await token.json()).toMatchObject({
      status: 200,
      body: { access_token: "redacted", token_type: "Bearer" },
    });
  });
});
