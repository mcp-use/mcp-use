import { serve, type ServerType } from "@hono/node-server";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import { oauthCustomProvider } from "../src/oauth/index.js";

type IntrospectionPayload = Record<string, unknown>;

interface IntrospectionServer {
  readonly endpoint: URL;
  response: IntrospectionPayload;
  readonly receivedTokens: string[];
  close(): Promise<void>;
}

let introspection: IntrospectionServer;

beforeAll(async () => {
  introspection = await startIntrospectionServer();
});

afterAll(async () => {
  await introspection.close();
});

beforeEach(() => {
  introspection.response = activePayload();
  introspection.receivedTokens.length = 0;
});

describe("RFC 7662 custom-provider acceptance", () => {
  it("maps an active opaque token into authenticated tool context", async () => {
    const opaqueToken = "opaque-token-without-jwt-shape";
    introspection.response = activePayload({
      scope: "mcp   tools:read",
      permissions: ["tools:read", "widgets:write"],
      resource: "http://localhost/mcp",
    });

    await withMcpServer(async (url) => {
      const response = await callTool(url, opaqueToken);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                user: { id: "user-1", email: "user@example.test" },
                payload: introspection.response,
                permissions: ["tools:read", "widgets:write"],
                clientId: "client-1",
                scopes: ["mcp", "tools:read"],
                accessToken: opaqueToken,
                resource: "http://localhost/mcp",
              }),
            },
          ],
        },
      });
    });

    expect(introspection.receivedTokens).toEqual([opaqueToken]);
  });

  it("rejects inactive, expired, malformed, and resource-mismatched introspection responses", async () => {
    const invalidResponses: readonly IntrospectionPayload[] = [
      { active: false },
      activePayload({ exp: Math.floor(Date.now() / 1000) - 1 }),
      {
        active: true,
        client_id: "client-1",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      activePayload({ resource: "http://localhost:1/mcp" }),
    ];

    await withMcpServer(async (url) => {
      for (const payload of invalidResponses) {
        introspection.response = payload;
        const response = await callTool(url, "opaque-invalid-token");

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain(
          'error="invalid_token"'
        );
      }
    });
  });

  it("accepts active introspection responses without client_id", async () => {
    const opaqueToken = "opaque-token-without-client-id";
    introspection.response = activePayload({
      client_id: undefined,
      scope: "mcp tools:read",
      permissions: ["tools:read"],
      resource: "http://localhost/mcp",
    });
    delete introspection.response["client_id"];

    await withMcpServer(async (url) => {
      const response = await callTool(url, opaqueToken);

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> };
      };
      const auth = JSON.parse(body.result.content[0]!.text) as {
        user: { id: string };
        clientId?: string;
      };
      expect(auth.user.id).toBe("user-1");
      expect(auth.clientId).toBeUndefined();
    });
  });
});

describe("RFC 7662 introspection endpoint outages", () => {
  let outageIntrospection: IntrospectionServer;

  beforeAll(async () => {
    outageIntrospection = await startIntrospectionServer();
  });

  afterAll(async () => {
    await outageIntrospection.close();
  });

  it("surfaces introspection endpoint outages as server errors", async () => {
    await outageIntrospection.close();

    const server = new MCPServer({
      name: "introspection-acceptance",
      version: "1.0.0",
      oauth: introspectionProvider(outageIntrospection.endpoint),
    });
    server.tool({ name: "whoami" }, (_params, ctx) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            user: ctx.auth.user,
            payload: ctx.auth.payload,
            permissions: ctx.auth.permissions,
            clientId: ctx.auth.clientId,
            scopes: ctx.auth.scopes,
            accessToken: ctx.auth.accessToken,
            resource: ctx.auth.resource?.href,
          }),
        },
      ],
    }));

    const started = await server.listen(0);
    try {
      const url = new URL(`http://127.0.0.1:${started.port}/mcp`);
      const response = await callTool(url, "opaque-outage-token");

      expect(response.status).toBe(500);
      expect(response.headers.get("www-authenticate") ?? "").not.toContain(
        'error="invalid_token"'
      );
    } finally {
      await server.close();
    }
  });
});

function activePayload(
  overrides: IntrospectionPayload = {}
): IntrospectionPayload {
  return {
    active: true,
    client_id: "client-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    scope: "mcp tools:read",
    sub: "user-1",
    email: "user@example.test",
    permissions: ["tools:read"],
    ...overrides,
  };
}

async function withMcpServer(test: (url: URL) => Promise<void>): Promise<void> {
  const server = new MCPServer({
    name: "introspection-acceptance",
    version: "1.0.0",
    oauth: introspectionProvider(introspection.endpoint),
  });
  server.tool({ name: "whoami" }, (_params, ctx) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          user: ctx.auth.user,
          payload: ctx.auth.payload,
          permissions: ctx.auth.permissions,
          clientId: ctx.auth.clientId,
          scopes: ctx.auth.scopes,
          accessToken: ctx.auth.accessToken,
          resource: ctx.auth.resource?.href,
        }),
      },
    ],
  }));

  const started = await server.listen(0);
  try {
    await test(new URL(`http://127.0.0.1:${started.port}/mcp`));
  } finally {
    await server.close();
  }
}

function introspectionProvider(endpoint: URL) {
  return oauthCustomProvider({
    resource: "http://localhost/mcp",
    createTokenVerifier: (expectedResource) => ({
      verifyAccessToken: async (token) => {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token }).toString(),
          });
        } catch (error) {
          throw new Error("RFC 7662 introspection endpoint unavailable", {
            cause: error,
          });
        }
        if (!response.ok) {
          throw new Error(
            `RFC 7662 introspection endpoint returned ${response.status}`
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          throw invalidToken(
            "RFC 7662 introspection response was not JSON",
            error
          );
        }
        return authInfoFromIntrospection(token, payload, expectedResource);
      },
    }),
    oauthMetadata: { issuer: "https://issuer.example.test" } as OAuthMetadata,
    mapAuthInfo: (authInfo) => {
      const payload = authInfo.extra?.["introspection"];
      if (!isRecord(payload)) {
        throw invalidToken("RFC 7662 verified payload was missing");
      }
      const permissions = payload["permissions"];
      return {
        user: {
          id:
            typeof payload["sub"] === "string"
              ? payload["sub"]
              : authInfo.clientId,
          ...(typeof payload["email"] === "string" && {
            email: payload["email"],
          }),
        },
        payload,
        permissions: Array.isArray(permissions)
          ? permissions.filter(
              (permission): permission is string =>
                typeof permission === "string"
            )
          : [],
      };
    },
  });
}

function authInfoFromIntrospection(
  token: string,
  value: unknown,
  expectedResource: URL
): AuthInfo {
  if (!isRecord(value) || value["active"] !== true) {
    throw invalidToken("RFC 7662 token is inactive");
  }
  // client_id is optional per RFC 7662 §2.2 — use when present, else "".
  const rawClientId = value["client_id"];
  const clientId =
    typeof rawClientId === "string" && rawClientId.trim() !== ""
      ? rawClientId
      : "";
  const exp = value["exp"];
  if (
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp <= Date.now() / 1000
  ) {
    throw invalidToken("RFC 7662 response has invalid exp");
  }
  const scope = value["scope"];
  if (typeof scope !== "string") {
    throw invalidToken("RFC 7662 response has invalid scope");
  }

  const resource = value["resource"];
  if (typeof resource !== "string") {
    throw invalidToken("RFC 7662 response is missing a resource");
  }
  let parsedResource: URL;
  try {
    parsedResource = new URL(resource);
  } catch (error) {
    throw invalidToken("RFC 7662 response has invalid resource", error);
  }
  if (parsedResource.href !== expectedResource.href) {
    throw invalidToken("RFC 7662 response has the wrong resource");
  }

  return {
    token,
    clientId,
    scopes: scope.trim() === "" ? [] : scope.trim().split(/\s+/),
    expiresAt: exp,
    extra: { introspection: value },
    resource: expectedResource,
  };
}

async function callTool(url: URL, token: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "whoami",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "whoami",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "introspection-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function startIntrospectionServer(): Promise<IntrospectionServer> {
  const app = new Hono();
  const receivedTokens: string[] = [];
  const state = { response: activePayload() };
  app.post("/introspect", async (context) => {
    const body = await context.req.parseBody();
    const token = body["token"];
    if (typeof token === "string") receivedTokens.push(token);
    return context.json(state.response);
  });

  const { server, port } = await new Promise<{
    server: ServerType;
    port: number;
  }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        resolve({ server, port: info.port });
      }
    );
  });
  let closed = false;

  return {
    endpoint: new URL(`http://127.0.0.1:${port}/introspect`),
    get response() {
      return state.response;
    },
    set response(response) {
      state.response = response;
    },
    receivedTokens,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function invalidToken(message: string, cause?: unknown): OAuthError {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message);
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
