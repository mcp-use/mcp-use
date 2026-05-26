/**
 * Integration tests for tool-level securitySchemes (SEP-1488 / OpenAI Apps SDK).
 *
 * Verifies that per-tool and server-default securitySchemes survive the
 * upstream SDK's tool serialization and appear as a top-level field on each
 * Tool object in the `tools/list` response.
 *
 * Uses raw HTTP fetch (not the upstream SDK Client) because the SDK's
 * `ToolSchema` Zod validator strips unknown fields like `securitySchemes`
 * on the way in. ChatGPT and other JSON consumers see the field; the SDK
 * client just doesn't expose it. Once the SDK adopts SEP-1488 we can switch
 * back to the typed client.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MCPServer } from "../../src/server/index.js";
import { oauthCustomProvider } from "../../src/server/oauth/providers.js";
import type { SecurityScheme } from "../../src/server/types/index.js";
import {
  text,
  authenticationRequired,
} from "../../src/server/utils/response-helpers.js";

type ToolWithSchemes = Tool & { securitySchemes?: SecurityScheme[] };
type ToolsListResult = { tools: ToolWithSchemes[] };
type CallToolResultWithMeta = {
  isError?: boolean;
  _meta?: { "mcp/www_authenticate"?: string[] };
};

type RpcHandler = (req: Request) => Promise<Response>;

const TEST_URL = "http://localhost/mcp";
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeAll(() => {
  // Force the lightweight production widget path so these transport tests
  // don't depend on the dev HMR port scanner.
  process.env.NODE_ENV = "production";
});

afterAll(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

/**
 * Minimal in-process MCP/JSON-RPC client that preserves unknown fields.
 * Returns the parsed JSON-RPC result object.
 */
async function rawRpc<TResult = unknown>(
  handler: RpcHandler,
  sessionId: string | undefined,
  body: { method: string; params?: Record<string, unknown>; id: number }
): Promise<{ result: TResult; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await handler(
    new Request(TEST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    })
  );

  const returnedSessionId = res.headers.get("mcp-session-id") ?? undefined;
  const contentType = res.headers.get("content-type") ?? "";

  let payload: { result?: TResult } | undefined;
  if (contentType.includes("text/event-stream")) {
    // Parse the first SSE event's data field.
    const txt = await res.text();
    const dataLine = txt
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();
    payload = dataLine ? JSON.parse(dataLine) : undefined;
  } else {
    payload = (await res.json()) as { result?: TResult };
  }

  return { result: payload?.result as TResult, sessionId: returnedSessionId };
}

async function openSession(handler: RpcHandler): Promise<string> {
  const { sessionId } = await rawRpc(handler, undefined, {
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "raw-test", version: "0.0.0" },
    },
  });
  if (!sessionId) throw new Error("Expected mcp-session-id header on initialize");

  // Send the initialized notification (no id, no response).
  await handler(
    new Request(TEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    })
  );

  return sessionId;
}

describe("securitySchemes — integration", () => {
  let server: MCPServer;
  let handler: RpcHandler;
  let sessionId: string;

  beforeAll(async () => {
    server = new MCPServer({
      name: "security-schemes-test",
      version: "1.0.0",
    });

    server.tool(
      {
        name: "public_search",
        description: "Anonymous search",
        schema: z.object({ q: z.string() }),
        securitySchemes: [{ type: "noauth" }],
      },
      async ({ q }) => text(`results for ${q}`)
    );

    server.tool(
      {
        name: "browse_catalog",
        description: "Browse catalog; richer if signed in",
        schema: z.object({ q: z.string() }),
        securitySchemes: [
          { type: "noauth" },
          { type: "oauth2", scopes: ["catalog.read"] },
        ],
      },
      async ({ q }) => text(`catalog: ${q}`)
    );

    server.tool(
      {
        name: "create_doc",
        description: "Create a document (requires auth)",
        schema: z.object({ title: z.string() }),
        securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
      },
      async ({ title }, ctx) => {
        if (!ctx.auth) {
          return authenticationRequired({
            scopes: ["docs.write"],
            errorDescription: "You need to login to continue",
          });
        }
        return text(`created: ${title}`);
      }
    );

    server.tool(
      {
        name: "no_schemes",
        description: "No securitySchemes declared",
        schema: z.object({}),
      },
      async () => text("ok")
    );

    handler = await server.getHandler();
    sessionId = await openSession(handler);
  });

  afterAll(async () => {
    await server.close();
  });

  it("emits per-tool securitySchemes as a top-level field on tools/list", async () => {
    const { result } = await rawRpc<ToolsListResult>(handler, sessionId, {
      id: 2,
      method: "tools/list",
    });
    const byName = new Map<string, ToolWithSchemes>(
      result.tools.map((t) => [t.name, t])
    );

    expect(byName.get("public_search")?.securitySchemes).toEqual([
      { type: "noauth" },
    ]);
    expect(byName.get("browse_catalog")?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["catalog.read"] },
    ]);
    expect(byName.get("create_doc")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["docs.write"] },
    ]);
  });

  it("omits securitySchemes when neither tool nor server default declared it", async () => {
    const { result } = await rawRpc<ToolsListResult>(handler, sessionId, {
      id: 3,
      method: "tools/list",
    });
    const tool = result.tools.find((t) => t.name === "no_schemes");
    expect(tool).toBeDefined();
    expect(tool?.securitySchemes).toBeUndefined();
  });

  it("auth-gated tool returns mcp/www_authenticate when called without a token", async () => {
    const { result } = await rawRpc<CallToolResultWithMeta>(
      handler,
      sessionId,
      {
        id: 4,
        method: "tools/call",
        params: { name: "create_doc", arguments: { title: "draft" } },
      }
    );

    expect(result.isError).toBe(true);
    const challenges = result._meta?.["mcp/www_authenticate"];
    expect(Array.isArray(challenges)).toBe(true);
    expect(challenges?.[0]).toContain('error="invalid_token"');
    expect(challenges?.[0]).toContain('scope="docs.write"');
    expect(challenges?.[0]).toContain(
      'error_description="You need to login to continue"'
    );
  });
});

describe("defaultSecuritySchemes — integration", () => {
  let server: MCPServer;
  let handler: RpcHandler;
  let sessionId: string;

  beforeAll(async () => {
    server = new MCPServer({
      name: "default-security-test",
      version: "1.0.0",
      defaultSecuritySchemes: [{ type: "oauth2", scopes: ["read"] }],
    });

    server.tool(
      { name: "inherits", schema: z.object({}) },
      async () => text("ok")
    );

    server.tool(
      {
        name: "overrides",
        schema: z.object({}),
        securitySchemes: [{ type: "noauth" }],
      },
      async () => text("ok")
    );

    handler = await server.getHandler();
    sessionId = await openSession(handler);
  });

  afterAll(async () => {
    await server.close();
  });

  it("tools without securitySchemes inherit the server default", async () => {
    const { result } = await rawRpc<ToolsListResult>(handler, sessionId, {
      id: 2,
      method: "tools/list",
    });
    const tool = result.tools.find((t) => t.name === "inherits");
    expect(tool?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["read"] },
    ]);
  });

  it("tool-level securitySchemes overrides the server default", async () => {
    const { result } = await rawRpc<ToolsListResult>(handler, sessionId, {
      id: 3,
      method: "tools/list",
    });
    const tool = result.tools.find((t) => t.name === "overrides");
    expect(tool?.securitySchemes).toEqual([{ type: "noauth" }]);
  });
});

describe("mixed-auth transport — integration", () => {
  // SEP-1488: when at least one tool advertises `{ type: "noauth" }`, the
  // bearer middleware must let unauthenticated requests through so ChatGPT
  // (and other Apps SDK clients) can run `initialize` + `tools/list` and
  // call public tools before signing in. Auth-required tools self-gate
  // by returning authenticationRequired() from the handler.

  function makeStubProvider(opts: { acceptAnyToken: boolean }) {
    return oauthCustomProvider({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/authorize",
      tokenEndpoint: "https://issuer.example.com/token",
      verifyToken: async () => {
        if (!opts.acceptAnyToken) throw new Error("bad token");
        return { payload: { sub: "user-1", scope: "docs.write" } };
      },
      getUserInfo: () => ({ userId: "user-1", email: "user@example.com" }),
    });
  }

  async function postRpc(
    handler: (req: Request) => Promise<Response>,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    return handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...extraHeaders,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
      })
    );
  }

  it("allows initialize and tools/list without an Authorization header when a tool declares noauth", async () => {
    const server = new MCPServer({
      name: "mixed-auth-server",
      version: "1.0.0",
      oauth: makeStubProvider({ acceptAnyToken: true }),
    });

    server.tool(
      {
        name: "public_search",
        schema: z.object({ q: z.string() }),
        securitySchemes: [{ type: "noauth" }],
      },
      async ({ q }) => text(`hits for ${q}`)
    );
    server.tool(
      {
        name: "create_doc",
        schema: z.object({ title: z.string() }),
        securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
      },
      async ({ title }) => text(`created ${title}`)
    );

    const handler = await server.getHandler();

    const initResp = await postRpc(handler, {
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });
    expect(initResp.status).toBe(200);

    await server.close();
  });

  it("falls back to strict bearer auth when no tool declares noauth", async () => {
    const server = new MCPServer({
      name: "strict-auth-server",
      version: "1.0.0",
      oauth: makeStubProvider({ acceptAnyToken: true }),
    });

    // Only oauth2-required tools (no noauth anywhere) — strict mode should
    // remain the default so existing OAuth servers don't suddenly open up.
    server.tool(
      {
        name: "create_doc",
        schema: z.object({ title: z.string() }),
        securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
      },
      async ({ title }) => text(`created ${title}`)
    );

    const handler = await server.getHandler();

    const unauth = await postRpc(handler, {
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });
    expect(unauth.status).toBe(401);

    await server.close();
  });

  it("still rejects invalid tokens with 401 in mixed-auth mode", async () => {
    const server = new MCPServer({
      name: "mixed-auth-bad-token",
      version: "1.0.0",
      oauth: makeStubProvider({ acceptAnyToken: false }),
    });

    server.tool(
      {
        name: "public_search",
        schema: z.object({ q: z.string() }),
        securitySchemes: [{ type: "noauth" }],
      },
      async ({ q }) => text(`hits for ${q}`)
    );

    const handler = await server.getHandler();

    const badToken = await postRpc(
      handler,
      {
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      },
      { Authorization: "Bearer not-a-real-token" }
    );
    expect(badToken.status).toBe(401);

    await server.close();
  });
});

describe("defaultSecuritySchemes: [] — integration", () => {
  let server: MCPServer;
  let handler: RpcHandler;
  let sessionId: string;

  beforeAll(async () => {
    server = new MCPServer({
      name: "empty-default-security-test",
      version: "1.0.0",
      defaultSecuritySchemes: [],
    });

    server.tool(
      { name: "plain", schema: z.object({}) },
      async () => text("ok")
    );

    handler = await server.getHandler();
    sessionId = await openSession(handler);
  });

  afterAll(async () => {
    await server.close();
  });

  it("does not emit securitySchemes when the server default is an empty array", async () => {
    const { result } = await rawRpc<ToolsListResult>(handler, sessionId, {
      id: 2,
      method: "tools/list",
    });
    const tool = result.tools.find((t) => t.name === "plain");
    expect(tool).toBeDefined();
    expect(tool?.securitySchemes).toBeUndefined();
  });
});
