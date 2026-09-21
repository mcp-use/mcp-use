/**
 * Mixed authentication: `allowAnonymous` plus per-tool `securitySchemes`.
 *
 * Exercises the HTTP gate over `server.fetch` with the stateless 2026-07-28
 * envelope: anonymous discovery, public/optional/protected tool policies,
 * scope step-up, both challenge representations, and the metadata emitted on
 * `tools/list`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer, type ToolSecurityScheme } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";
const resource = "https://shop.example.test/mcp";
const resourceMetadata =
  'resource_metadata="https://shop.example.test/.well-known/oauth-protected-resource/mcp"';

interface TestUser {
  id: string;
}

/**
 * Token vocabulary: `scopes:a,b` grants those scopes; `invalid` and `expired`
 * fail verification; anything else grants the provider baseline only.
 */
function provider(requiredScopes: readonly string[] = ["shop"]) {
  return oauthCustomProvider<TestUser>({
    resource,
    requiredScopes,
    scopesSupported: ["shop", "checkout", "profile"],
    createTokenVerifier: (boundResource) => ({
      verifyAccessToken: async (token) => {
        if (token === "invalid") {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "bad token");
        }
        const scopes = token.startsWith("scopes:")
          ? token.slice("scopes:".length).split(",").filter(Boolean)
          : [...requiredScopes];
        return {
          token,
          clientId: "client-1",
          scopes,
          expiresAt:
            token === "expired"
              ? Date.now() / 1000 - 60
              : Date.now() / 1000 + 600,
          resource: boundResource,
        };
      },
    }),
    oauthMetadata: { issuer } as OAuthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: { sub: "user-1" },
      permissions: [],
    }),
  });
}

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number | undefined = 1
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    ...(id !== undefined && { id }),
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

/**
 * POST a JSON-RPC body. The 2026-07-28 wire mirrors the method and subject
 * (tool name or resource URI) into `Mcp-*` headers; the SDK rejects requests
 * where they disagree.
 */
function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  const method = body["method"];
  const params = body["params"] as Record<string, unknown> | undefined;
  const modern = typeof method === "string" && method !== "initialize";
  const name = params?.["name"];
  const uri = params?.["uri"];
  return new Request(resource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(modern && {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof name === "string"
          ? { "mcp-name": name }
          : typeof uri === "string" && { "mcp-name": uri }),
      }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function call(
  name: string,
  headers: Record<string, string> = {},
  args: Record<string, unknown> = {}
): Request {
  return post(rpc("tools/call", { name, arguments: args }), headers);
}

function challenge(response: Response): string {
  const value = response.headers.get("www-authenticate");
  expect(value).not.toBeNull();
  return value!;
}

async function resultText(response: Response): Promise<string> {
  const body = (await response.json()) as {
    result: { content: Array<{ type: string; text: string }> };
  };
  return body.result.content[0]!.text;
}

function shopServer(
  options: {
    authChallenge?: "http" | "tool-result" | "auto";
    requiredScopes?: readonly string[];
  } = {}
) {
  const server = new MCPServer({
    name: "shop",
    version: "1.0.0",
    oauth: provider(options.requiredScopes),
    allowAnonymous: true,
    ...(options.authChallenge !== undefined && {
      authChallenge: options.authChallenge,
    }),
    logging: { enabled: false },
  });

  server.tool(
    {
      name: "browse_catalog",
      description: "Public catalog.",
      securitySchemes: [{ type: "noauth" }],
    },
    async (_args, ctx) => ({
      content: [
        { type: "text", text: `catalog:${ctx.auth?.user.id ?? "anonymous"}` },
      ],
    })
  );

  server.tool(
    {
      name: "create_checkout",
      description: "Protected checkout.",
      inputSchema: z.object({ productIds: z.array(z.string()) }),
      securitySchemes: [{ type: "oauth2", scopes: ["checkout"] }],
      authErrorMessage: "Sign in to complete your purchase.",
    },
    async ({ productIds }, ctx) => ({
      content: [
        {
          type: "text",
          text: `checkout:${ctx.auth?.user.id}:${productIds.join("+")}`,
        },
      ],
    })
  );

  server.tool(
    {
      name: "welcome",
      description: "Optional auth.",
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["profile"] },
      ],
    },
    async (_args, ctx) => ({
      content: [
        {
          type: "text",
          text: ctx.auth?.scopes.includes("profile")
            ? "welcome back"
            : "welcome stranger",
        },
      ],
    })
  );

  server.tool(
    { name: "account", description: "Inherits the provider policy." },
    async (_args, ctx) => ({
      content: [{ type: "text", text: `account:${ctx.auth?.user.id}` }],
    })
  );

  server.resource({ name: "secret", uri: "shop://secret" }, async (uri) => ({
    contents: [{ uri: uri.href, text: "secret" }],
  }));
  server.prompt({ name: "upsell" }, async () => ({
    messages: [{ role: "user", content: { type: "text", text: "buy more" } }],
  }));

  return server;
}

describe("mixed auth: anonymous discovery", () => {
  it("serves initialize and list requests without a token", async () => {
    const handler = shopServer().fetch;
    const initialize = await handler(
      post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      })
    );
    expect(initialize.status).toBe(200);

    for (const method of ["tools/list", "resources/list", "prompts/list"]) {
      const response = await handler(post(rpc(method)));
      expect(response.status, method).toBe(200);
    }
  });

  it("advertises securitySchemes on tools/list at the top level and in _meta", async () => {
    const response = await shopServer().fetch(post(rpc("tools/list")));
    const body = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          securitySchemes?: ToolSecurityScheme[];
          _meta?: { securitySchemes?: ToolSecurityScheme[] };
        }>;
      };
    };
    const byName = new Map(body.result.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("browse_catalog")?.securitySchemes).toEqual([
      { type: "noauth" },
    ]);
    // Tool scopes union with the provider baseline in both the advertised
    // metadata and the enforced requirement.
    expect(byName.get("create_checkout")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop", "checkout"] },
    ]);
    expect(byName.get("welcome")?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["shop", "profile"] },
    ]);
    // Undeclared tools inherit the provider policy and say so.
    expect(byName.get("account")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop"] },
    ]);
    for (const tool of body.result.tools) {
      expect(tool._meta?.securitySchemes).toEqual(tool.securitySchemes);
    }
  });

  it("keeps resources/read and prompts/get protected", async () => {
    const handler = shopServer().fetch;
    const read = await handler(
      post(rpc("resources/read", { uri: "shop://secret" }))
    );
    expect(read.status).toBe(401);
    expect(challenge(read)).toContain('error="invalid_token"');
    expect(challenge(read)).toContain(resourceMetadata);

    const prompt = await handler(post(rpc("prompts/get", { name: "upsell" })));
    expect(prompt.status).toBe(401);

    const authenticated = await handler(
      post(rpc("resources/read", { uri: "shop://secret" }), bearer("ok"))
    );
    expect(authenticated.status).toBe(200);
  });
});

describe("mixed auth: tool policies", () => {
  it("runs public tools anonymously and exposes identity when a token is supplied", async () => {
    const handler = shopServer().fetch;
    const anonymous = await handler(call("browse_catalog"));
    expect(anonymous.status).toBe(200);
    expect(await resultText(anonymous)).toBe("catalog:anonymous");

    const authenticated = await handler(call("browse_catalog", bearer("ok")));
    expect(authenticated.status).toBe(200);
    expect(await resultText(authenticated)).toBe("catalog:user-1");
  });

  it("challenges protected tools with 401 and the combined scope set", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", {}, { productIds: ["a"] })
    );
    expect(response.status).toBe(401);
    const header = challenge(response);
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('scope="shop checkout"');
    expect(header).toContain(resourceMetadata);
    expect(header).toContain(
      'error_description="Sign in to complete your purchase."'
    );
  });

  it("steps up with 403 insufficient_scope listing every required scope", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", bearer("scopes:shop"), { productIds: ["a"] })
    );
    expect(response.status).toBe(403);
    const header = challenge(response);
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="shop checkout"');
    expect(header).toContain(
      'error_description="Sign in to complete your purchase."'
    );
  });

  it("runs protected tools with a sufficiently scoped token", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", bearer("scopes:shop,checkout"), {
        productIds: ["a", "b"],
      })
    );
    expect(response.status).toBe(200);
    expect(await resultText(response)).toBe("checkout:user-1:a+b");
  });

  it("treats undeclared tools as protected with the provider baseline", async () => {
    const handler = shopServer().fetch;
    const anonymous = await handler(call("account"));
    expect(anonymous.status).toBe(401);
    expect(challenge(anonymous)).toContain('scope="shop"');
    expect(challenge(anonymous)).toContain(
      'error_description="Authentication is required for this request."'
    );

    const missingBaseline = await handler(
      call("account", bearer("scopes:profile"))
    );
    expect(missingBaseline.status).toBe(403);

    const authenticated = await handler(call("account", bearer("ok")));
    expect(await resultText(authenticated)).toBe("account:user-1");
  });

  it("lets optional-auth tools run anonymously and check scopes themselves", async () => {
    const handler = shopServer().fetch;
    expect(await resultText(await handler(call("welcome")))).toBe(
      "welcome stranger"
    );
    // A valid token without the optional scope still gets the public path.
    expect(
      await resultText(await handler(call("welcome", bearer("scopes:shop"))))
    ).toBe("welcome stranger");
    expect(
      await resultText(
        await handler(call("welcome", bearer("scopes:shop,profile")))
      )
    ).toBe("welcome back");
  });

  it("refuses invalid and expired tokens even on public tools", async () => {
    const handler = shopServer().fetch;
    for (const token of ["invalid", "expired"]) {
      const response = await handler(call("browse_catalog", bearer(token)));
      expect(response.status, token).toBe(401);
      expect(challenge(response)).toContain('error="invalid_token"');
    }
  });

  it("challenges calls to unknown tools", async () => {
    const response = await shopServer().fetch(call("missing"));
    expect(response.status).toBe(401);
  });
});

describe("mixed auth: challenge representation", () => {
  const chatgpt = { "user-agent": "ChatGPT/1.0 (+https://openai.com/bot)" };

  it("returns a tool-result challenge to ChatGPT user agents by default", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", chatgpt, { productIds: ["a"] })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("www-authenticate")).toBeNull();
    const body = (await response.json()) as {
      id: number;
      result: {
        resultType?: string;
        isError: boolean;
        content: Array<{ type: string; text: string }>;
        _meta: Record<string, string[]>;
      };
    };
    expect(body.id).toBe(1);
    expect(body.result.resultType).toBe("complete");
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe(
      "Sign in to complete your purchase."
    );
    const [header] = body.result._meta["mcp/www_authenticate"]!;
    expect(header).toContain("Bearer ");
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('scope="shop checkout"');
    expect(header).toContain(resourceMetadata);
  });

  it("uses insufficient_scope inside the tool-result challenge on step-up", async () => {
    const response = await shopServer().fetch(
      call(
        "create_checkout",
        { ...chatgpt, ...bearer("scopes:shop") },
        {
          productIds: ["a"],
        }
      )
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { _meta: Record<string, string[]> };
    };
    expect(body.result._meta["mcp/www_authenticate"]![0]).toContain(
      'error="insufficient_scope"'
    );
  });

  it("keeps HTTP challenges for other user agents and non-tool requests", async () => {
    const handler = shopServer().fetch;
    const claude = await handler(
      call(
        "create_checkout",
        { "user-agent": "Claude-User/1.0" },
        {
          productIds: ["a"],
        }
      )
    );
    expect(claude.status).toBe(401);

    const prompt = await handler(
      post(rpc("prompts/get", { name: "upsell" }), chatgpt)
    );
    expect(prompt.status).toBe(401);
  });

  it("honors an explicit authChallenge override", async () => {
    const http = await shopServer({ authChallenge: "http" }).fetch(
      call("create_checkout", chatgpt, { productIds: ["a"] })
    );
    expect(http.status).toBe(401);

    const toolResult = await shopServer({ authChallenge: "tool-result" }).fetch(
      call("create_checkout", {}, { productIds: ["a"] })
    );
    expect(toolResult.status).toBe(200);
    expect(await resultText(toolResult)).toBe(
      "Sign in to complete your purchase."
    );
  });
});

describe("mixed auth: configuration", () => {
  function configured(
    securitySchemes: unknown,
    options: {
      oauth?: boolean;
      allowAnonymous?: boolean;
      requiredScopes?: readonly string[];
      _meta?: Record<string, unknown>;
      authErrorMessage?: string;
    } = {}
  ) {
    const server =
      options.oauth === false
        ? new MCPServer({ name: "plain", version: "1.0.0" })
        : new MCPServer({
            name: "auth",
            version: "1.0.0",
            oauth: provider(options.requiredScopes),
            allowAnonymous: options.allowAnonymous ?? true,
          });
    server.tool(
      {
        name: "t",
        ...(securitySchemes !== undefined && {
          securitySchemes: securitySchemes as ToolSecurityScheme[],
        }),
        ...(options._meta !== undefined && { _meta: options._meta }),
        ...(options.authErrorMessage !== undefined && {
          authErrorMessage: options.authErrorMessage,
        }),
      },
      async () => ({ content: [] })
    );
    return server;
  }

  it("rejects allowAnonymous and authChallenge without an OAuth provider", () => {
    expect(
      () =>
        new MCPServer({
          name: "plain",
          version: "1.0.0",
          ...({ allowAnonymous: true } as object),
        })
    ).toThrow(/allowAnonymous requires an OAuth provider/);
    expect(
      () =>
        new MCPServer({
          name: "plain",
          version: "1.0.0",
          ...({ authChallenge: "http" } as object),
        })
    ).toThrow(/authChallenge requires an OAuth provider/);
    expect(
      () =>
        new MCPServer({
          name: "auth",
          version: "1.0.0",
          oauth: provider(),
          ...({ authChallenge: "sometimes" } as object),
        })
    ).toThrow(/authChallenge must be/);
  });

  it("rejects malformed scheme declarations", () => {
    expect(() => configured([])).toThrow(/non-empty array/);
    expect(() => configured([{ type: "basic" }])).toThrow(
      /unsupported security scheme type "basic"/
    );
    expect(() => configured([{ type: "noauth" }, { type: "noauth" }])).toThrow(
      /more than one noauth/
    );
    expect(() =>
      configured([
        { type: "oauth2", scopes: ["a"] },
        { type: "oauth2", scopes: ["b"] },
      ])
    ).toThrow(/more than one oauth2/);
    expect(() => configured([{ type: "oauth2", scopes: [""] }])).toThrow(
      /non-empty strings/
    );
    expect(() => configured([{ type: "oauth2" }])).toThrow(/scopes must be/);
  });

  it("rejects declarations that contradict the server configuration", () => {
    expect(() =>
      configured([{ type: "oauth2", scopes: ["a"] }], { oauth: false })
    ).toThrow(/no OAuth provider/);
    expect(() =>
      configured([{ type: "noauth" }], { allowAnonymous: false })
    ).toThrow(/set allowAnonymous: true/);
    expect(() =>
      configured([{ type: "oauth2", scopes: [] }], { requiredScopes: [] })
    ).toThrow(/declare at least one scope/);
    // An empty tool scope list is fine when the provider supplies a baseline.
    expect(() => configured([{ type: "oauth2", scopes: [] }])).not.toThrow();
    // noauth on a server without OAuth is descriptive and allowed.
    expect(() =>
      configured([{ type: "noauth" }], { oauth: false })
    ).not.toThrow();
  });

  it("guards the legacy _meta.securitySchemes field", () => {
    expect(() =>
      configured([{ type: "noauth" }], {
        _meta: { securitySchemes: [{ type: "noauth" }] },
      })
    ).toThrow(/both securitySchemes and _meta.securitySchemes/);
    expect(() =>
      configured(undefined, {
        _meta: { securitySchemes: [{ type: "noauth" }] },
      })
    ).toThrow(/descriptive only/);
    // Without allowAnonymous the legacy field passes through untouched.
    expect(() =>
      configured(undefined, {
        allowAnonymous: false,
        _meta: { securitySchemes: [{ type: "noauth" }] },
      })
    ).not.toThrow();
  });

  it("requires a single-line authErrorMessage", () => {
    expect(() =>
      configured([{ type: "noauth" }], { authErrorMessage: "line\nbreak" })
    ).toThrow(/single-line/);
    expect(() =>
      configured([{ type: "noauth" }], { authErrorMessage: "   " })
    ).toThrow(/single-line/);
  });
});

describe("endpoint-wide OAuth with tool scopes", () => {
  it("adds declared oauth2 scopes to the baseline requirement", async () => {
    const server = new MCPServer({
      name: "strict",
      version: "1.0.0",
      oauth: provider(["shop"]),
      logging: { enabled: false },
    });
    server.tool(
      {
        name: "admin",
        securitySchemes: [{ type: "oauth2", scopes: ["admin"] }],
      },
      async () => ({ content: [{ type: "text", text: "ok" }] })
    );
    server.tool({ name: "plain" }, async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const handler = server.fetch;

    expect((await handler(post(rpc("tools/list")))).status).toBe(401);

    const underScoped = await handler(call("admin", bearer("scopes:shop")));
    expect(underScoped.status).toBe(403);
    expect(challenge(underScoped)).toContain('scope="shop admin"');

    const scoped = await handler(call("admin", bearer("scopes:shop,admin")));
    expect(scoped.status).toBe(200);

    // Undeclared tools advertise nothing and keep the baseline-only check.
    const list = await handler(post(rpc("tools/list"), bearer("ok")));
    const body = (await list.json()) as {
      result: { tools: Array<{ name: string; securitySchemes?: unknown }> };
    };
    const byName = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("plain")?.securitySchemes).toBeUndefined();
    expect(byName.get("admin")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop", "admin"] },
    ]);
  });
});
