/**
 * Mixed authentication: `mixedAuth` on the server plus `securitySchemes` on
 * tools. Resources and prompts always require sign-in.
 *
 * Exercises the HTTP gate over `server.fetch`, mostly on the stateless
 * 2026-07-28 envelope: signed-out discovery, every `securitySchemes` shape,
 * the advertised schemes, both challenge formats, and the configurations
 * that must throw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, type ToolSecurityScheme } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
} from "../src/oauth/index.js";
import { viewResourceUri } from "../src/views/constants.js";

const issuer = "https://issuer.example.test";
const resource = "https://shop.example.test/mcp";
const resourceMetadata =
  'resource_metadata="https://shop.example.test/.well-known/oauth-protected-resource/mcp"';
const chatgpt = { "user-agent": "ChatGPT/1.0 (+https://openai.com/bot)" };

interface TestUser {
  id: string;
}

/**
 * Token vocabulary: `scopes:a,b` grants exactly those scopes; `user:<id>`
 * grants the baseline as user `<id>`; `invalid` and `expired` fail
 * verification; anything else grants the baseline. Users default to `user-1`.
 */
function provider(requiredScopes: readonly string[] = ["shop"]) {
  return oauthCustomProvider<TestUser>({
    resource,
    requiredScopes,
    scopesSupported: ["shop", "checkout", "profile", "orders:read"],
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
    mapAuthInfo: (authInfo) => ({
      user: {
        id: authInfo.token.startsWith("user:")
          ? authInfo.token.slice("user:".length)
          : "user-1",
      },
      payload: {},
      permissions: [],
    }),
  });
}

const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number | undefined = 1
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    ...(id !== undefined && { id }),
    method,
    params: { ...params, _meta: ENVELOPE },
  };
}

/**
 * POST a JSON-RPC body. The 2026-07-28 wire mirrors the method and subject
 * (tool or prompt name, or resource URI) into `Mcp-*` headers; the SDK
 * rejects requests where they disagree. Legacy bodies carry no envelope and
 * no `Mcp-*` headers.
 */
function post(
  body: unknown,
  headers: Record<string, string> = {},
  options: { legacy?: boolean } = {}
): Request {
  const single =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  const method = single?.["method"];
  const params = single?.["params"] as Record<string, unknown> | undefined;
  const modern = options.legacy !== true && typeof method === "string";
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

function read(uri: string, headers: Record<string, string> = {}): Request {
  return post(rpc("resources/read", { uri }), headers);
}

function getPrompt(
  name: string,
  headers: Record<string, string> = {}
): Request {
  return post(rpc("prompts/get", { name }), headers);
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

async function resourceText(response: Response): Promise<string> {
  const body = (await response.json()) as {
    result: { contents: Array<{ text: string }> };
  };
  return body.result.contents[0]!.text;
}

function who(auth: { user: TestUser; scopes: string[] } | undefined): string {
  return auth === undefined ? "signed-out" : auth.user.id;
}

function shopServer(options: { requiredScopes?: readonly string[] } = {}) {
  const server = new MCPServer({
    name: "shop",
    version: "1.0.0",
    oauth: provider(options.requiredScopes),
    mixedAuth: true,
    logging: { enabled: false },
  });

  server.tool(
    {
      name: "browse_catalog",
      description: "Public.",
      securitySchemes: [{ type: "noauth" }],
    },
    async (_args, ctx) => ({
      content: [{ type: "text", text: `catalog:${who(ctx.auth)}` }],
    })
  );
  server.tool(
    {
      name: "recommend",
      description: "Optional.",
      securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [] }],
    },
    async (_args, ctx) => ({
      content: [{ type: "text", text: `recommend:${who(ctx.auth)}` }],
    })
  );
  server.tool(
    {
      name: "recommend_scoped",
      description: "Optional with scopes.",
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["orders:read"] },
      ],
    },
    async (_args, ctx) => ({
      content: [
        {
          type: "text",
          text: ctx.auth?.scopes.includes("orders:read")
            ? "personalized"
            : `bestsellers:${who(ctx.auth)}`,
        },
      ],
    })
  );
  server.tool(
    {
      name: "create_checkout",
      description: "Sign-in with an extra scope.",
      inputSchema: z.object({ productIds: z.array(z.string()) }),
      securitySchemes: [{ type: "oauth2", scopes: ["checkout"] }],
    },
    async ({ productIds }, ctx) => ({
      content: [
        {
          type: "text",
          text: `checkout:${ctx.auth.user.id}:${productIds.join("+")}`,
        },
      ],
    })
  );
  server.tool(
    { name: "order_history", description: "Sign-in, baseline scopes." },
    async (_args, ctx) => ({
      content: [{ type: "text", text: `orders:${ctx.auth.user.id}` }],
    })
  );

  server.resource(
    { name: "catalog", uri: "shop://catalog" },
    async (uri, ctx) => ({
      contents: [{ uri: uri.href, text: `catalog:${ctx.auth.user.id}` }],
    })
  );
  server.resource({ name: "profile", uri: "shop://me" }, async (uri, ctx) => ({
    contents: [{ uri: uri.href, text: `me:${ctx.auth.user.id}` }],
  }));
  server.resourceTemplate(
    {
      name: "product",
      uriTemplate: "shop://products/{id}",
      complete: { id: ["coffee", "tea"] },
    },
    async (uri, params) => ({
      contents: [{ uri: uri.href, text: `product:${String(params.id)}` }],
    })
  );
  server.resourceTemplate(
    {
      name: "invoice",
      uriTemplate: "shop://invoices/{id}",
      complete: { id: ["1", "2"] },
    },
    async (uri, params, ctx) => ({
      contents: [
        {
          uri: uri.href,
          text: `invoice:${String(params.id)}:${ctx.auth.user.id}`,
        },
      ],
    })
  );

  server.prompt({ name: "gift_ideas" }, async (_args, ctx) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `gifts:${ctx.auth.user.id}` },
      },
    ],
  }));
  server.prompt({ name: "upsell" }, async (_args, ctx) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `upsell:${ctx.auth.user.id}` },
      },
    ],
  }));

  return server;
}

describe("mixed auth: signed-out discovery", () => {
  it("serves initialize, ping, server/discover, and every list method without a token", async () => {
    const handler = shopServer().fetch;
    const initialize = await handler(
      post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
        {},
        { legacy: true }
      )
    );
    expect(initialize.status).toBe(200);
    // `ping` exists only on the 2025-era wire.
    const ping = await handler(
      post({ jsonrpc: "2.0", id: 2, method: "ping" }, {}, { legacy: true })
    );
    expect(ping.status).toBe(200);

    for (const method of [
      "server/discover",
      "tools/list",
      "resources/list",
      "resources/templates/list",
      "prompts/list",
    ]) {
      const response = await handler(post(rpc(method)));
      expect(response.status, method).toBe(200);
      const body = (await response.json()) as { error?: unknown };
      expect(body.error, method).toBeUndefined();
    }
  });

  it("requires sign-in for methods it does not know", async () => {
    const response = await shopServer().fetch(post(rpc("tasks/list")));
    expect(response.status).toBe(401);
    expect(challenge(response)).toContain('scope="shop"');
  });

  it("serves a mixedAuth server that has no public or optional items without warning", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const server = new MCPServer({
        name: "directory",
        version: "1.0.0",
        oauth: provider(),
        mixedAuth: true,
        logging: { enabled: false },
      });
      server.tool({ name: "private" }, async (_args, ctx) => ({
        content: [{ type: "text", text: ctx.auth.user.id }],
      }));
      expect((await server.fetch(post(rpc("tools/list")))).status).toBe(200);
      expect((await server.fetch(call("private"))).status).toBe(401);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("mixed auth: tools/list metadata", () => {
  it("advertises resolved securitySchemes at the top level and in _meta", async () => {
    const response = await shopServer().fetch(post(rpc("tools/list")));
    const body = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          securitySchemes?: unknown;
          _meta?: { securitySchemes?: unknown };
        }>;
      };
    };
    const byName = new Map(body.result.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("browse_catalog")?.securitySchemes).toEqual([
      { type: "noauth" },
    ]);
    expect(byName.get("recommend")?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["shop"] },
    ]);
    expect(byName.get("recommend_scoped")?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["shop", "orders:read"] },
    ]);
    expect(byName.get("create_checkout")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop", "checkout"] },
    ]);
    expect(byName.get("order_history")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop"] },
    ]);
    expect(body.result.tools).toHaveLength(5);
    for (const tool of body.result.tools) {
      expect(tool._meta?.securitySchemes, tool.name).toEqual(
        tool.securitySchemes
      );
    }
  });

  it("emits no auth metadata for resources or prompts", async () => {
    const handler = shopServer().fetch;
    for (const [method, key] of [
      ["resources/list", "resources"],
      ["resources/templates/list", "resourceTemplates"],
      ["prompts/list", "prompts"],
    ] as const) {
      const body = (await (await handler(post(rpc(method)))).json()) as {
        result: Record<string, Array<Record<string, unknown>>>;
      };
      for (const item of body.result[key]!) {
        expect(item["securitySchemes"], method).toBeUndefined();
        expect(
          (item["_meta"] as Record<string, unknown> | undefined)?.[
            "securitySchemes"
          ],
          method
        ).toBeUndefined();
      }
    }
  });
});

describe("mixed auth: tools", () => {
  it("runs public tools signed out and sets ctx.auth when a token is sent", async () => {
    const handler = shopServer().fetch;
    const signedOut = await handler(call("browse_catalog"));
    expect(signedOut.status).toBe(200);
    expect(await resultText(signedOut)).toBe("catalog:signed-out");

    const signedIn = await handler(call("browse_catalog", bearer("user:ada")));
    expect(await resultText(signedIn)).toBe("catalog:ada");
  });

  it("runs optional tools for both paths", async () => {
    const handler = shopServer().fetch;
    expect(await resultText(await handler(call("recommend")))).toBe(
      "recommend:signed-out"
    );
    expect(
      await resultText(await handler(call("recommend", bearer("user:ada"))))
    ).toBe("recommend:ada");
  });

  it("never refuses an optional tool for missing scopes", async () => {
    const handler = shopServer().fetch;
    expect(await resultText(await handler(call("recommend_scoped")))).toBe(
      "bestsellers:signed-out"
    );
    // Signed in without orders:read: the handler runs and falls back.
    const underScoped = await handler(
      call("recommend_scoped", bearer("user:ada"))
    );
    expect(underScoped.status).toBe(200);
    expect(await resultText(underScoped)).toBe("bestsellers:ada");
    expect(
      await resultText(
        await handler(
          call("recommend_scoped", bearer("scopes:shop,orders:read"))
        )
      )
    ).toBe("personalized");
  });

  it("challenges sign-in tools with 401 and the full scope set", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", {}, { productIds: ["a"] })
    );
    expect(response.status).toBe(401);
    const header = challenge(response);
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(
      'error_description="Authentication is required for this request."'
    );
    expect(header).toContain('scope="shop checkout"');
    expect(header).toContain(resourceMetadata);
  });

  it("steps up with 403 insufficient_scope, naming the missing scopes", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", bearer("scopes:shop"), { productIds: ["a"] })
    );
    expect(response.status).toBe(403);
    const header = challenge(response);
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain(
      'error_description="Additional permissions are required: checkout."'
    );
    expect(header).toContain('scope="shop checkout"');
  });

  it("runs sign-in tools with a sufficiently scoped token", async () => {
    const response = await shopServer().fetch(
      call("create_checkout", bearer("scopes:shop,checkout"), {
        productIds: ["a", "b"],
      })
    );
    expect(response.status).toBe(200);
    expect(await resultText(response)).toBe("checkout:user-1:a+b");
  });

  it("requires sign-in with the provider baseline when securitySchemes is omitted", async () => {
    const handler = shopServer().fetch;
    const signedOut = await handler(call("order_history"));
    expect(signedOut.status).toBe(401);
    expect(challenge(signedOut)).toContain('scope="shop"');

    const missingBaseline = await handler(
      call("order_history", bearer("scopes:profile"))
    );
    expect(missingBaseline.status).toBe(403);
    expect(challenge(missingBaseline)).toContain(
      'error_description="Additional permissions are required: shop."'
    );

    expect(
      await resultText(await handler(call("order_history", bearer("ok"))))
    ).toBe("orders:user-1");
  });

  it("refuses invalid and expired tokens on every request, public ones included", async () => {
    const handler = shopServer().fetch;
    const requests = (token: string) => [
      call("browse_catalog", bearer(token)),
      call("recommend", bearer(token)),
      post(rpc("tools/list"), bearer(token)),
      read("shop://catalog", bearer(token)),
      getPrompt("gift_ideas", bearer(token)),
    ];
    for (const token of ["invalid", "expired"]) {
      for (const request of requests(token)) {
        const response = await handler(request);
        expect(response.status, token).toBe(401);
        const header = challenge(response);
        expect(header).toContain('error="invalid_token"');
        // A bad token on a noauth tool still hints the baseline.
        expect(header).toContain('scope="shop"');
      }
    }
  });

  it("challenges calls to unknown tools", async () => {
    const response = await shopServer().fetch(call("missing"));
    expect(response.status).toBe(401);
    expect(challenge(response)).toContain('scope="shop"');
  });

  it("keeps identity isolated across concurrent signed-in and signed-out calls", async () => {
    const handler = shopServer().fetch;
    const calls = Array.from({ length: 12 }, (_, index) =>
      index % 3 === 0
        ? { expected: "recommend:signed-out", request: call("recommend") }
        : {
            expected: `recommend:u${index}`,
            request: call("recommend", bearer(`user:u${index}`)),
          }
    );
    const texts = await Promise.all(
      calls.map(async ({ request }) => resultText(await handler(request)))
    );
    expect(texts).toEqual(calls.map(({ expected }) => expected));
  });
});

describe("mixed auth: challenge format", () => {
  it("returns a tool-result challenge to ChatGPT user agents", async () => {
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
      "Authentication is required for this request."
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
        { productIds: ["a"] }
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

  it("answers the in-band challenge on the 2025-era wire without resultType", async () => {
    const response = await shopServer().fetch(
      post(
        {
          jsonrpc: "2.0",
          id: "legacy-7",
          method: "tools/call",
          params: { name: "order_history", arguments: {} },
        },
        chatgpt,
        { legacy: true }
      )
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      result: { resultType?: string; isError: boolean };
    };
    expect(body.id).toBe("legacy-7");
    expect(body.result.isError).toBe(true);
    expect(body.result.resultType).toBeUndefined();
  });

  it("keeps HTTP challenges for other or missing user agents", async () => {
    const handler = shopServer().fetch;
    for (const headers of [{ "user-agent": "Claude-User/1.0" }, {}]) {
      const response = await handler(
        call("create_checkout", headers, { productIds: ["a"] })
      );
      expect(response.status).toBe(401);
    }
  });

  it("always refuses resources and prompts over HTTP, even for ChatGPT", async () => {
    const handler = shopServer().fetch;
    expect((await handler(read("shop://me", chatgpt))).status).toBe(401);
    expect((await handler(getPrompt("upsell", chatgpt))).status).toBe(401);
  });

  it("refuses JSON-RPC batches over HTTP when any element needs sign-in", async () => {
    const handler = shopServer().fetch;
    const batch = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "browse_catalog", arguments: {} },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_checkout", arguments: { productIds: ["a"] } },
      },
    ];
    const signedOut = await handler(post(batch, chatgpt, { legacy: true }));
    expect(signedOut.status).toBe(401);
    expect(challenge(signedOut)).toContain('scope="shop checkout"');

    const underScoped = await handler(
      post(batch, bearer("scopes:shop"), { legacy: true })
    );
    expect(underScoped.status).toBe(403);
  });
});

describe("mixed auth: resources and prompts", () => {
  it("requires sign-in with the provider baseline for every resource", async () => {
    const handler = shopServer().fetch;
    for (const uri of [
      "shop://catalog",
      "shop://me",
      "shop://products/1",
      "shop://invoices/9",
      "shop://nowhere",
    ]) {
      const response = await handler(read(uri));
      expect(response.status, uri).toBe(401);
      expect(challenge(response)).toContain('scope="shop"');
      expect(challenge(response)).toContain(resourceMetadata);
    }

    expect(
      await resourceText(await handler(read("shop://me", bearer("user:ada"))))
    ).toBe("me:ada");
    expect(
      await resourceText(await handler(read("shop://invoices/9", bearer("ok"))))
    ).toBe("invoice:9:user-1");
    expect(
      (await handler(read("shop://catalog", bearer("scopes:profile")))).status
    ).toBe(403);
  });

  it("requires sign-in for prompts/get", async () => {
    const handler = shopServer().fetch;
    for (const name of ["gift_ideas", "upsell", "missing"]) {
      expect((await handler(getPrompt(name))).status, name).toBe(401);
    }
    const gifts = await handler(getPrompt("gift_ideas", bearer("user:ada")));
    expect(gifts.status).toBe(200);
    const body = (await gifts.json()) as {
      result: { messages: Array<{ content: { text: string } }> };
    };
    expect(body.result.messages[0]?.content.text).toBe("gifts:ada");
  });

  it("requires sign-in for completion/complete", async () => {
    const handler = shopServer().fetch;
    const complete = (
      ref: Record<string, unknown>,
      headers: Record<string, string> = {}
    ) =>
      handler(
        post(
          rpc("completion/complete", {
            ref,
            argument: { name: "id", value: "" },
          }),
          headers
        )
      );
    const productRef = { type: "ref/resource", uri: "shop://products/{id}" };
    expect(
      (await complete({ type: "ref/prompt", name: "gift_ideas" })).status
    ).toBe(401);
    expect((await complete(productRef)).status).toBe(401);

    const product = await complete(productRef, bearer("ok"));
    expect(product.status).toBe(200);
    const body = (await product.json()) as {
      result: { completion: { values: string[] } };
    };
    expect(body.result.completion.values).toEqual(["coffee", "tea"]);
  });

  it("requires sign-in for legacy resources/subscribe", async () => {
    const response = await shopServer().fetch(
      post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "resources/subscribe",
          params: { uri: "shop://catalog" },
        },
        {},
        { legacy: true }
      )
    );
    expect(response.status).toBe(401);
  });

  it("opens subscriptions/listen signed out only without resource subscriptions", async () => {
    const handler = shopServer().fetch;
    const listen = (notifications: Record<string, unknown>) =>
      handler(post(rpc("subscriptions/listen", { notifications })));

    const refused = await listen({
      toolsListChanged: true,
      resourceSubscriptions: ["shop://catalog"],
    });
    expect(refused.status).toBe(401);

    for (const notifications of [
      { toolsListChanged: true },
      { toolsListChanged: true, resourceSubscriptions: [] },
    ]) {
      const listChanged = await listen(notifications);
      expect(listChanged.status).toBe(200);
      await listChanged.body?.cancel();
    }
  });

  it("requires sign-in for views, whatever their tool's securitySchemes", async () => {
    const server = new MCPServer({
      name: "views",
      version: "1.0.0",
      oauth: provider(),
      mixedAuth: true,
      logging: { enabled: false },
    });
    const outputSchema = z.object({ ok: z.boolean() });
    server.tool(
      {
        name: "public-card",
        outputSchema,
        view: { name: "public-card" },
        securitySchemes: [{ type: "noauth" }],
      },
      async () => ({ structuredContent: { ok: true }, content: [] })
    );
    server.tool(
      { name: "private-card", outputSchema, view: { name: "private-card" } },
      async () => ({ structuredContent: { ok: true }, content: [] })
    );
    server.__primeViews({
      "public-card": { kind: "external", entry: "assets/a.js", css: [] },
      "private-card": { kind: "external", entry: "assets/c.js", css: [] },
    });
    server.__primeSkills(undefined);

    for (const view of ["public-card", "private-card"]) {
      expect((await server.fetch(read(viewResourceUri(view)))).status).toBe(
        401
      );
      expect(
        (await server.fetch(read(viewResourceUri(view), bearer("ok")))).status
      ).toBe(200);
    }
  });
});

describe("mixed auth: invalid configurations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function oauthServer(
    options: { mixedAuth?: boolean; requiredScopes?: readonly string[] } = {}
  ) {
    return new MCPServer({
      name: "auth",
      version: "1.0.0",
      oauth: provider(options.requiredScopes),
      mixedAuth: options.mixedAuth ?? true,
    });
  }

  function plainServer(): MCPServer {
    return new MCPServer({ name: "plain", version: "1.0.0" });
  }

  function registerTool(
    server: MCPServer<TestUser> | MCPServer,
    securitySchemes: unknown
  ) {
    server.tool(
      {
        name: "t",
        securitySchemes: securitySchemes as ToolSecurityScheme[],
      },
      async () => ({ content: [] })
    );
  }

  it("rejects mixedAuth without an OAuth provider or as a non-boolean", () => {
    expect(
      () =>
        new MCPServer({
          name: "plain",
          version: "1.0.0",
          ...({ mixedAuth: true } as object),
        })
    ).toThrow(/mixedAuth requires an OAuth provider/);
    expect(
      () =>
        new MCPServer({
          name: "auth",
          version: "1.0.0",
          oauth: provider(),
          ...({ mixedAuth: "yes" } as object),
        })
    ).toThrow(/mixedAuth must be a boolean/);
    for (const oauth of [null, {}, { createTokenVerifier: () => ({}) }]) {
      expect(
        () =>
          new MCPServer({
            name: "malformed",
            version: "1.0.0",
            ...({ oauth, mixedAuth: true } as object),
          }),
        JSON.stringify(oauth)
      ).toThrow(/mixedAuth requires an OAuth provider/);
    }
  });

  it("rejects noauth without mixedAuth", () => {
    for (const schemes of [
      [{ type: "noauth" }],
      [{ type: "noauth" }, { type: "oauth2", scopes: ["a"] }],
    ]) {
      expect(() =>
        registerTool(oauthServer({ mixedAuth: false }), schemes)
      ).toThrow(/^Tool "t": noauth requires mixedAuth: true on the server/);
      expect(() => registerTool(plainServer(), schemes)).toThrow(
        /noauth requires an OAuth provider with mixedAuth: true/
      );
    }
  });

  it("rejects oauth2 without an OAuth provider", () => {
    expect(() =>
      registerTool(plainServer(), [{ type: "oauth2", scopes: ["a"] }])
    ).toThrow(/oauth2 requires an OAuth provider/);
  });

  it("rejects empty oauth2 scopes only when the provider has no requiredScopes", () => {
    for (const schemes of [
      [{ type: "oauth2", scopes: [] }],
      [{ type: "noauth" }, { type: "oauth2", scopes: [] }],
    ]) {
      expect(() =>
        registerTool(oauthServer({ requiredScopes: [] }), schemes)
      ).toThrow(/ChatGPT ignores an oauth2 scheme without scopes/);
      expect(() => registerTool(oauthServer(), schemes)).not.toThrow();
    }
  });

  it("rejects malformed securitySchemes", () => {
    const cases: Array<[unknown, RegExp]> = [
      [[], /securitySchemes must be a non-empty array/],
      ["noauth", /securitySchemes must be a non-empty array/],
      [[null], /each security scheme must be/],
      [[{ type: "basic" }], /unsupported security scheme type "basic"/],
      [[{ type: "oauth2" }], /oauth2 scopes must be an array/],
      [[{ type: "oauth2", scopes: "a" }], /oauth2 scopes must be an array/],
      [[{ type: "oauth2", scopes: [""] }], /invalid oauth2 scope ""/],
      [[{ type: "oauth2", scopes: [" "] }], /invalid oauth2 scope " "/],
      [
        [{ type: "oauth2", scopes: ["shop check"] }],
        /invalid oauth2 scope "shop check"; each scope must be one/,
      ],
      [[{ type: "oauth2", scopes: ['a"b'] }], /invalid oauth2 scope/],
      [[{ type: "oauth2", scopes: [1] }], /invalid oauth2 scope 1/],
      [
        [{ type: "oauth2", scope: ["a"] }],
        /unknown security scheme field "scope"/,
      ],
      [
        [{ type: "noauth", scopes: ["a"] }],
        /unknown security scheme field "scopes"/,
      ],
      [[{ type: "noauth" }, { type: "noauth" }], /more than one noauth/],
      [
        [
          { type: "oauth2", scopes: ["a"] },
          { type: "oauth2", scopes: ["b"] },
        ],
        /more than one oauth2/,
      ],
    ];
    // RFC 6749 scope tokens may contain punctuation such as ":" and ",".
    expect(() =>
      registerTool(oauthServer(), [
        { type: "oauth2", scopes: ["orders:read", "a,b"] },
      ])
    ).not.toThrow();
    for (const [schemes, message] of cases) {
      expect(
        () => registerTool(oauthServer(), schemes),
        JSON.stringify(schemes)
      ).toThrow(message);
    }
  });

  it("lists noauth first whatever the declared order", async () => {
    const server = oauthServer();
    registerTool(server, [
      { type: "oauth2", scopes: ["checkout"] },
      { type: "noauth" },
    ]);
    const body = (await (
      await server.fetch(post(rpc("tools/list")))
    ).json()) as {
      result: { tools: Array<{ securitySchemes?: unknown }> };
    };
    expect(body.result.tools[0]?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["shop", "checkout"] },
    ]);
  });
});

describe("hand-written _meta.securitySchemes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  type ListedTool = {
    name: string;
    securitySchemes?: unknown;
    _meta?: Record<string, unknown>;
  };

  async function listTools(server: MCPServer<TestUser> | MCPServer) {
    const list = await server.fetch(post(rpc("tools/list"), bearer("ok")));
    const body = (await list.json()) as { result: { tools: ListedTool[] } };
    return new Map(body.result.tools.map((tool) => [tool.name, tool]));
  }

  it("passes through untouched on tools without securitySchemes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schemes = [{ type: "oauth2", scopes: ["legacy"] }];
    for (const server of [
      new MCPServer({ name: "plain", version: "1.0.0" }),
      new MCPServer({
        name: "strict",
        version: "1.0.0",
        oauth: provider(),
        logging: { enabled: false },
      }),
    ]) {
      server.tool(
        { name: "legacy", _meta: { securitySchemes: schemes, "x/y": 1 } },
        async () => ({ content: [] })
      );
      const tool = (await listTools(server)).get("legacy");
      expect(tool?.securitySchemes).toBeUndefined();
      expect(tool?._meta?.["securitySchemes"]).toEqual(schemes);
      expect(tool?._meta?.["x/y"]).toBe(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on a mixedAuth server, where the tool still requires sign-in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new MCPServer({
      name: "mixed",
      version: "1.0.0",
      oauth: provider(),
      mixedAuth: true,
      logging: { enabled: false },
    });
    const schemes = [{ type: "noauth" }];
    server.tool(
      { name: "legacy", _meta: { securitySchemes: schemes } },
      async () => ({ content: [] })
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /"legacy": _meta.securitySchemes is advertised but not enforced/
      )
    );
    const tool = (await listTools(server)).get("legacy");
    expect(tool?.securitySchemes).toBeUndefined();
    expect(tool?._meta?.["securitySchemes"]).toEqual(schemes);
    expect((await server.fetch(call("legacy"))).status).toBe(401);
  });

  it("is replaced by top-level securitySchemes, with a warning when they differ", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new MCPServer({
      name: "mixed",
      version: "1.0.0",
      oauth: provider(),
      mixedAuth: true,
      logging: { enabled: false },
    });
    server.tool(
      {
        name: "replaced",
        securitySchemes: [{ type: "noauth" }],
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["legacy"] }] },
      },
      async () => ({ content: [] })
    );
    server.tool(
      {
        name: "same",
        securitySchemes: [{ type: "noauth" }],
        _meta: { securitySchemes: [{ type: "noauth" }] },
      },
      async () => ({ content: [] })
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/"replaced": _meta.securitySchemes is replaced/)
    );
    const tools = await listTools(server);
    for (const name of ["replaced", "same"]) {
      expect(tools.get(name)?.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(tools.get(name)?._meta?.["securitySchemes"]).toEqual([
        { type: "noauth" },
      ]);
    }
  });
});

describe("endpoint-wide OAuth (no mixedAuth)", () => {
  it("keeps every request behind a token and enforces declared scopes", async () => {
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
      async (_args, ctx) => ({
        content: [{ type: "text", text: ctx.auth.user.id }],
      })
    );
    server.tool({ name: "plain" }, async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    server.resource({ name: "ledger", uri: "shop://ledger" }, async (uri) => ({
      contents: [{ uri: uri.href, text: "ledger" }],
    }));
    const handler = server.fetch;

    for (const request of [
      post(rpc("tools/list")),
      post(rpc("server/discover")),
      call("plain"),
    ]) {
      expect((await handler(request)).status).toBe(401);
    }

    const underScoped = await handler(call("admin", bearer("scopes:shop")));
    expect(underScoped.status).toBe(403);
    expect(challenge(underScoped)).toContain('scope="shop admin"');
    expect(
      (await handler(call("admin", bearer("scopes:shop,admin")))).status
    ).toBe(200);
    // Resources need only the provider baseline.
    expect(
      (await handler(read("shop://ledger", bearer("scopes:shop")))).status
    ).toBe(200);

    // Only tools that declare securitySchemes advertise them.
    const list = await handler(post(rpc("tools/list"), bearer("ok")));
    const body = (await list.json()) as {
      result: {
        tools: Array<{
          name: string;
          securitySchemes?: unknown;
          _meta?: { securitySchemes?: unknown };
        }>;
      };
    };
    const byName = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("plain")?.securitySchemes).toBeUndefined();
    expect(byName.get("plain")?._meta?.securitySchemes).toBeUndefined();
    expect(byName.get("admin")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop", "admin"] },
    ]);
  });
});
