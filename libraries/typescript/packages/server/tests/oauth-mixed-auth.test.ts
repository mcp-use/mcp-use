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

function oauthServer(
  options: { mixedAuth?: boolean; requiredScopes?: readonly string[] } = {}
) {
  return new MCPServer({
    name: "auth",
    version: "1.0.0",
    oauth: provider(options.requiredScopes),
    mixedAuth: options.mixedAuth ?? true,
    logging: { enabled: false },
  });
}

interface ListedTool {
  name: string;
  securitySchemes?: unknown;
  _meta?: Record<string, unknown>;
}

/** List tools with a baseline token, keyed by name. */
async function listTools(server: MCPServer<TestUser> | MCPServer) {
  const list = await server.fetch(post(rpc("tools/list"), bearer("ok")));
  const body = (await list.json()) as { result: { tools: ListedTool[] } };
  return new Map(body.result.tools.map((tool) => [tool.name, tool]));
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/**
 * One tool per `securitySchemes` shape, a noauth tool with a view, and one
 * resource, resource template, and prompt, which always require sign-in.
 */
function shopServer(options: { requiredScopes?: readonly string[] } = {}) {
  const server = oauthServer(options);

  server.tool(
    { name: "browse_catalog", securitySchemes: [{ type: "noauth" }] },
    async (_args, ctx) => text(`catalog:${who(ctx.auth)}`)
  );
  server.tool(
    {
      name: "recommend",
      securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [] }],
    },
    async (_args, ctx) => text(`recommend:${who(ctx.auth)}`)
  );
  server.tool(
    {
      name: "recommend_scoped",
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["orders:read"] },
      ],
    },
    async (_args, ctx) =>
      text(
        ctx.auth?.scopes.includes("orders:read")
          ? "personalized"
          : `bestsellers:${who(ctx.auth)}`
      )
  );
  server.tool(
    {
      name: "create_checkout",
      inputSchema: z.object({ productIds: z.array(z.string()) }),
      securitySchemes: [{ type: "oauth2", scopes: ["checkout"] }],
    },
    async ({ productIds }, ctx) =>
      text(`checkout:${ctx.auth.user.id}:${productIds.join("+")}`)
  );
  server.tool({ name: "order_history" }, async (_args, ctx) =>
    text(`orders:${ctx.auth.user.id}`)
  );
  server.tool(
    {
      name: "catalog_card",
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "catalog-card" },
      securitySchemes: [{ type: "noauth" }],
    },
    async () => ({ structuredContent: { ok: true }, content: [] })
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
  server.prompt({ name: "upsell" }, async (_args, ctx) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `upsell:${ctx.auth.user.id}` },
      },
    ],
  }));

  server.__primeViews({
    "catalog-card": { kind: "external", entry: "assets/card.js", css: [] },
  });
  server.__primeSkills(undefined);
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

  it("requires sign-in for unknown methods and unknown tools", async () => {
    const handler = shopServer().fetch;
    for (const request of [post(rpc("tasks/list")), call("missing")]) {
      const response = await handler(request);
      expect(response.status).toBe(401);
      expect(challenge(response)).toContain('scope="shop"');
    }
  });

  it("serves a mixedAuth server that has no noauth tools without warning", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const server = oauthServer();
      server.tool({ name: "private" }, async (_args, ctx) =>
        text(ctx.auth.user.id)
      );
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
    const tools = await listTools(shopServer());
    expect(
      Object.fromEntries(
        [...tools].map(([name, tool]) => [name, tool.securitySchemes])
      )
    ).toEqual({
      browse_catalog: [{ type: "noauth" }],
      recommend: [{ type: "noauth" }, { type: "oauth2", scopes: ["shop"] }],
      recommend_scoped: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["shop", "orders:read"] },
      ],
      create_checkout: [{ type: "oauth2", scopes: ["shop", "checkout"] }],
      order_history: [{ type: "oauth2", scopes: ["shop"] }],
      catalog_card: [{ type: "noauth" }],
    });
    for (const [name, tool] of tools) {
      expect(tool._meta?.["securitySchemes"], name).toEqual(
        tool.securitySchemes
      );
    }
  });
});

describe("mixed auth: tools", () => {
  it("runs noauth and optional tools signed out, with ctx.auth when a token is sent", async () => {
    const handler = shopServer().fetch;
    for (const name of ["browse_catalog", "recommend"]) {
      const prefix = name === "browse_catalog" ? "catalog" : "recommend";
      const signedOut = await handler(call(name));
      expect(signedOut.status).toBe(200);
      expect(await resultText(signedOut)).toBe(`${prefix}:signed-out`);
      expect(
        await resultText(await handler(call(name, bearer("user:ada"))))
      ).toBe(`${prefix}:ada`);
    }
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

  it("challenges sign-in tools with 401, steps up with 403, and runs with enough scopes", async () => {
    const handler = shopServer().fetch;
    const cases = [
      {
        name: "create_checkout",
        args: { productIds: ["a", "b"] },
        scope: "shop checkout",
        underScoped: "scopes:shop",
        missing: "checkout",
        enough: "scopes:shop,checkout",
        result: "checkout:user-1:a+b",
      },
      {
        name: "order_history",
        args: {},
        scope: "shop",
        underScoped: "scopes:profile",
        missing: "shop",
        enough: "ok",
        result: "orders:user-1",
      },
    ];
    for (const c of cases) {
      const signedOut = await handler(call(c.name, {}, c.args));
      expect(signedOut.status, c.name).toBe(401);
      const header = challenge(signedOut);
      expect(header).toContain('error="invalid_token"');
      expect(header).toContain(
        'error_description="Authentication is required for this request."'
      );
      expect(header).toContain(`scope="${c.scope}"`);
      expect(header).toContain(resourceMetadata);

      const stepUp = await handler(call(c.name, bearer(c.underScoped), c.args));
      expect(stepUp.status, c.name).toBe(403);
      expect(challenge(stepUp)).toContain('error="insufficient_scope"');
      expect(challenge(stepUp)).toContain(
        `error_description="Additional permissions are required: ${c.missing}."`
      );
      expect(challenge(stepUp)).toContain(`scope="${c.scope}"`);

      const allowed = await handler(call(c.name, bearer(c.enough), c.args));
      expect(allowed.status, c.name).toBe(200);
      expect(await resultText(allowed)).toBe(c.result);
    }
  });

  it("refuses invalid and expired tokens on every request, noauth tools included", async () => {
    const handler = shopServer().fetch;
    const requests = (token: string) => [
      call("browse_catalog", bearer(token)),
      call("recommend", bearer(token)),
      post(rpc("tools/list"), bearer(token)),
      read("shop://me", bearer(token)),
      getPrompt("upsell", bearer(token)),
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
    const handler = shopServer().fetch;
    const response = await handler(
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

    // Step-up uses insufficient_scope inside the same format.
    const stepUp = await handler(
      call(
        "create_checkout",
        { ...chatgpt, ...bearer("scopes:shop") },
        { productIds: ["a"] }
      )
    );
    expect(stepUp.status).toBe(200);
    const stepUpBody = (await stepUp.json()) as {
      result: { _meta: Record<string, string[]> };
    };
    expect(stepUpBody.result._meta["mcp/www_authenticate"]![0]).toContain(
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

  it("uses HTTP challenges for other user agents, and for resources and prompts from ChatGPT", async () => {
    const handler = shopServer().fetch;
    for (const request of [
      call(
        "create_checkout",
        { "user-agent": "Claude-User/1.0" },
        {
          productIds: ["a"],
        }
      ),
      call("create_checkout", {}, { productIds: ["a"] }),
      read("shop://me", chatgpt),
      getPrompt("upsell", chatgpt),
    ]) {
      expect((await handler(request)).status).toBe(401);
    }
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

describe("mixed auth: resources, prompts, and views", () => {
  const complete = (ref: Record<string, unknown>, token?: string) =>
    post(
      rpc("completion/complete", { ref, argument: { name: "id", value: "" } }),
      token === undefined ? {} : bearer(token)
    );
  const productRef = { type: "ref/resource", uri: "shop://products/{id}" };
  const catalogView = viewResourceUri("catalog-card");

  it("requires sign-in with the provider baseline for everything but views", async () => {
    const handler = shopServer().fetch;
    const subscribe = post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "resources/subscribe",
        params: { uri: "shop://me" },
      },
      {},
      { legacy: true }
    );
    for (const [label, request] of [
      ["static resource", read("shop://me")],
      ["template resource", read("shop://products/1")],
      ["unknown resource", read("shop://nowhere")],
      ["prompt", getPrompt("upsell")],
      ["unknown prompt", getPrompt("missing")],
      ["prompt completion", complete({ type: "ref/prompt", name: "upsell" })],
      ["resource completion", complete(productRef)],
      ["legacy subscribe", subscribe],
      [
        "resource subscription stream",
        post(
          rpc("subscriptions/listen", {
            notifications: { resourceSubscriptions: ["shop://me"] },
          })
        ),
      ],
    ] as const) {
      const response = await handler(request);
      expect(response.status, label).toBe(401);
      expect(challenge(response), label).toContain('scope="shop"');
    }
    expect(
      (await handler(read("shop://me", bearer("scopes:profile")))).status
    ).toBe(403);
  });

  it("serves them with a baseline token", async () => {
    const handler = shopServer().fetch;
    expect(
      await resourceText(await handler(read("shop://me", bearer("user:ada"))))
    ).toBe("me:ada");
    expect((await handler(read(catalogView, bearer("ok")))).status).toBe(200);

    const upsell = await handler(getPrompt("upsell", bearer("user:ada")));
    const prompt = (await upsell.json()) as {
      result: { messages: Array<{ content: { text: string } }> };
    };
    expect(prompt.result.messages[0]?.content.text).toBe("upsell:ada");

    const completion = await handler(complete(productRef, "ok"));
    const values = (await completion.json()) as {
      result: { completion: { values: string[] } };
    };
    expect(values.result.completion.values).toEqual(["coffee", "tea"]);
  });

  it("serves every tool's view signed out, whatever the tool declares", async () => {
    // ChatGPT reads every view while an app is created, before sign-in.
    expect((await shopServer().fetch(read(catalogView))).status).toBe(200);

    // A view of a tool that requires sign-in loads signed out too.
    const server = oauthServer();
    server.tool(
      {
        name: "private_card",
        outputSchema: z.object({ ok: z.boolean() }),
        view: { name: "private-card" },
      },
      async () => ({ structuredContent: { ok: true }, content: [] })
    );
    server.__primeViews({
      "private-card": { kind: "external", entry: "assets/p.js", css: [] },
      // No tool binds this view, so it stays behind sign-in.
      orphan: { kind: "external", entry: "assets/o.js", css: [] },
    });
    server.__primeSkills(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      (await server.fetch(read(viewResourceUri("private-card")))).status
    ).toBe(200);
    expect((await server.fetch(read(viewResourceUri("orphan")))).status).toBe(
      401
    );
    warn.mockRestore();
    // The tool behind the view still requires sign-in.
    expect((await server.fetch(call("private_card"))).status).toBe(401);
  });

  it("opens subscriptions/listen signed out only without resource subscriptions", async () => {
    const handler = shopServer().fetch;
    for (const notifications of [
      { toolsListChanged: true },
      { toolsListChanged: true, resourceSubscriptions: [] },
    ]) {
      const listen = await handler(
        post(rpc("subscriptions/listen", { notifications }))
      );
      expect(listen.status).toBe(200);
      await listen.body?.cancel();
    }
  });
});

describe("mixed auth: invalid configurations", () => {
  function registerTool(
    server: MCPServer<TestUser> | MCPServer,
    securitySchemes: unknown
  ) {
    server.tool(
      { name: "t", securitySchemes: securitySchemes as ToolSecurityScheme[] },
      async () => ({ content: [] })
    );
  }

  it("rejects mixedAuth without a valid OAuth provider or as a non-boolean", () => {
    const construct = (config: object) => () =>
      new MCPServer({ name: "x", version: "1.0.0", ...config });
    expect(construct({ oauth: provider(), mixedAuth: "yes" })).toThrow(
      /mixedAuth must be a boolean/
    );
    for (const oauth of [
      undefined,
      null,
      {},
      { createTokenVerifier: () => ({}) },
    ]) {
      expect(
        construct({ oauth, mixedAuth: true }),
        JSON.stringify(oauth)
      ).toThrow(/mixedAuth requires an OAuth provider/);
    }
  });

  it("rejects schemes the server cannot honor", () => {
    const plain = () => new MCPServer({ name: "plain", version: "1.0.0" });
    const strict = () => oauthServer({ mixedAuth: false });
    const noBaseline = () => oauthServer({ requiredScopes: [] });
    const noauth = { type: "noauth" };
    const cases: Array<
      [() => MCPServer<TestUser> | MCPServer, unknown, RegExp]
    > = [
      [strict, [noauth], /^Tool "t": noauth requires mixedAuth: true on/],
      [
        strict,
        [noauth, { type: "oauth2", scopes: ["a"] }],
        /noauth requires mixedAuth/,
      ],
      [plain, [noauth], /noauth requires an OAuth provider with mixedAuth/],
      [
        plain,
        [{ type: "oauth2", scopes: ["a"] }],
        /oauth2 requires an OAuth provider/,
      ],
      [
        noBaseline,
        [{ type: "oauth2", scopes: [] }],
        /ChatGPT ignores an oauth2 scheme/,
      ],
      [noBaseline, [noauth, { type: "oauth2", scopes: [] }], /ChatGPT ignores/],
    ];
    for (const [server, schemes, message] of cases) {
      expect(
        () => registerTool(server(), schemes),
        JSON.stringify(schemes)
      ).toThrow(message);
    }
    // Empty scopes are fine when the provider has a baseline.
    expect(() =>
      registerTool(oauthServer(), [noauth, { type: "oauth2", scopes: [] }])
    ).not.toThrow();
  });

  it("rejects malformed securitySchemes", () => {
    const cases: Array<[unknown, RegExp]> = [
      [[], /securitySchemes must be a non-empty array/],
      ["noauth", /securitySchemes must be a non-empty array/],
      [[null], /each security scheme must be/],
      [[{ type: "basic" }], /unsupported security scheme type "basic"/],
      [[{ type: "oauth2" }], /oauth2 scopes must be an array/],
      [[{ type: "oauth2", scopes: "a" }], /oauth2 scopes must be an array/],
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
    // Each scope must be one printable-ASCII RFC 6749 scope token.
    for (const scope of ["", " ", "a\tb", 'a"b', "a\\b", "café", 1]) {
      cases.push([
        [{ type: "oauth2", scopes: [scope] }],
        /invalid oauth2 scope/,
      ]);
    }
    cases.push([
      [{ type: "oauth2", scopes: ["shop check"] }],
      /invalid oauth2 scope "shop check"; each scope must be one non-empty token/,
    ]);
    for (const [schemes, message] of cases) {
      expect(
        () => registerTool(oauthServer(), schemes),
        JSON.stringify(schemes)
      ).toThrow(message);
    }
    // Scope tokens may contain punctuation such as ":" and ",".
    expect(() =>
      registerTool(oauthServer(), [
        { type: "oauth2", scopes: ["orders:read", "a,b"] },
      ])
    ).not.toThrow();
  });

  it("lists noauth first whatever the declared order", async () => {
    const server = oauthServer();
    registerTool(server, [
      { type: "oauth2", scopes: ["checkout"] },
      { type: "noauth" },
    ]);
    expect((await listTools(server)).get("t")?.securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["shop", "checkout"] },
    ]);
  });
});

describe("hand-written _meta.securitySchemes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through untouched on tools without securitySchemes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schemes = [{ type: "oauth2", scopes: ["legacy"] }];
    for (const server of [
      new MCPServer({ name: "plain", version: "1.0.0" }),
      oauthServer({ mixedAuth: false }),
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

  it("warns when unenforced on a mixedAuth server or replaced by a different declaration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = oauthServer();
    const noauth = [{ type: "noauth" }] as const;
    server.tool(
      { name: "legacy", _meta: { securitySchemes: noauth } },
      async () => ({ content: [] })
    );
    server.tool(
      {
        name: "replaced",
        securitySchemes: noauth,
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["legacy"] }] },
      },
      async () => ({ content: [] })
    );
    server.tool(
      {
        name: "same",
        securitySchemes: noauth,
        _meta: { securitySchemes: noauth },
      },
      async () => ({ content: [] })
    );
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringMatching(
        /"legacy": _meta.securitySchemes is advertised but not enforced/
      ),
      expect.stringMatching(/"replaced": _meta.securitySchemes is replaced/),
    ]);

    const tools = await listTools(server);
    // Unenforced: left in _meta only, and the tool still requires sign-in.
    expect(tools.get("legacy")?.securitySchemes).toBeUndefined();
    expect(tools.get("legacy")?._meta?.["securitySchemes"]).toEqual(noauth);
    expect((await server.fetch(call("legacy"))).status).toBe(401);
    for (const name of ["replaced", "same"]) {
      expect(tools.get(name)?.securitySchemes).toEqual(noauth);
      expect(tools.get(name)?._meta?.["securitySchemes"]).toEqual(noauth);
    }
  });
});

describe("endpoint-wide OAuth (no mixedAuth)", () => {
  it("keeps every request behind a token and enforces declared scopes", async () => {
    const server = oauthServer({ mixedAuth: false });
    server.tool(
      {
        name: "admin",
        securitySchemes: [{ type: "oauth2", scopes: ["admin"] }],
      },
      async (_args, ctx) => text(ctx.auth.user.id)
    );
    server.tool({ name: "plain" }, async () => text("ok"));
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
    const tools = await listTools(server);
    expect(tools.get("plain")?.securitySchemes).toBeUndefined();
    expect(tools.get("plain")?._meta?.["securitySchemes"]).toBeUndefined();
    expect(tools.get("admin")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["shop", "admin"] },
    ]);
  });
});
