/**
 * OAuth provider `setup(host)` hook: the seam an authorization model such as
 * Lane uses to install middleware, provider-owned tools and resources, and
 * instructions text at mount time.
 *
 * Exercised over `server.fetch` on the stateless 2026-07-28 envelope.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { MCPServer } from "../src/index.js";
import {
  oauthCustomProvider,
  type OAuthAuthInfo,
  type OAuthAdmissionHook,
  type OAuthExtra,
  type OAuthMetadata,
  type OAuthProviderHost,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";
const resource = "https://shop.example.test/mcp";

interface TestUser {
  id: string;
}

/** Any bearer verifies with the `shop` scope as user `user-1`. */
function provider(
  setup: (host: OAuthProviderHost<TestUser>) => void,
  admit?: OAuthAdmissionHook,
  mapAuthInfo?: (authInfo: OAuthAuthInfo) => OAuthExtra<TestUser>
) {
  return oauthCustomProvider<TestUser>({
    resource,
    requiredScopes: ["shop"],
    createTokenVerifier: (boundResource) => ({
      verifyAccessToken: async (token) => ({
        token,
        clientId: "client-1",
        scopes: ["shop"],
        expiresAt: Date.now() / 1000 + 600,
        resource: boundResource,
      }),
    }),
    oauthMetadata: { issuer } as OAuthMetadata,
    mapAuthInfo:
      mapAuthInfo ??
      (() => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      })),
    ...(admit !== undefined && { admit }),
    setup,
  });
}

function server(
  setup: (host: OAuthProviderHost<TestUser>) => void,
  options: { instructions?: string; mixedAuth?: boolean } = {},
  admit?: OAuthAdmissionHook,
  mapAuthInfo?: (authInfo: OAuthAuthInfo) => OAuthExtra<TestUser>
) {
  return new MCPServer({
    name: "shop",
    version: "1.0.0",
    oauth: provider(setup, admit, mapAuthInfo),
    logging: { enabled: false },
    ...(options.mixedAuth !== undefined && { mixedAuth: options.mixedAuth }),
    ...(options.instructions !== undefined && {
      instructions: options.instructions,
    }),
  });
}

const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function post(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Request {
  const subject = params["name"] ?? params["uri"];
  return new Request(resource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof subject === "string" && { "mcp-name": subject }),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: ENVELOPE },
    }),
  });
}

const signedIn = { authorization: "Bearer token" };

function call(name: string, headers: Record<string, string> = {}): Request {
  return post("tools/call", { name, arguments: {} }, headers);
}

async function result<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: T }).result;
}

async function text(response: Response): Promise<string> {
  const { content } = await result<{
    content: Array<{ type: string; text: string }>;
  }>(response);
  return content[0]!.text;
}

/** A provider resource, resource template, and prompt that echo the user. */
function registerReadables(host: OAuthProviderHost<TestUser>): void {
  host.resource(
    { name: "connection", uri: "provider://connection" },
    async (uri, ctx) => ({
      contents: [{ uri: uri.href, text: `conn:${ctx.auth.user.id}` }],
    })
  );
  host.resourceTemplate(
    { name: "order", uriTemplate: "provider://orders/{id}" },
    async (uri, params, ctx) => ({
      contents: [
        { uri: uri.href, text: `order:${params.id}:${ctx.auth.user.id}` },
      ],
    })
  );
  host.prompt({ name: "checkout_help" }, async (_args, ctx) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `help:${ctx.auth.user.id}` },
      },
    ],
  }));
}

const readables = [
  ["resources/read", { uri: "provider://connection" }, "conn:user-1"],
  ["resources/read", { uri: "provider://orders/7" }, "order:7:user-1"],
  ["prompts/get", { name: "checkout_help" }, "help:user-1"],
] as const;

/** The text of a `resources/read` or `prompts/get` result. */
async function readText(response: Response): Promise<string> {
  const read = await result<{
    contents?: Array<{ text: string }>;
    messages?: Array<{ content: { text: string } }>;
  }>(response);
  return read.contents?.[0]?.text ?? read.messages![0]!.content.text;
}

describe("OAuth provider setup hook", () => {
  it("runs once, before the first request, with the resolved host values", async () => {
    const setup = vi.fn((host: OAuthProviderHost<TestUser>) => {
      expect(host.resourceUrl.href).toBe(resource);
      expect(host.basePath).toBe("/mcp");
      expect(host.mixedAuth).toBe(false);
    });
    const app = server(setup);

    expect(setup).not.toHaveBeenCalled();
    await app.fetch(post("tools/list", {}, signedIn));
    await app.fetch(post("tools/list", {}, signedIn));
    expect(setup).toHaveBeenCalledOnce();
  });

  it("uses the custom admission hook through server.fetch", async () => {
    const admit = vi.fn(
      async (_request: Request, messages: JSONRPCMessage[]) => {
        expect(messages).toMatchObject([{ method: "tools/list" }]);
        return new Response("fetch admitted", { status: 202 });
      }
    );
    const app = server(() => {}, {}, admit);
    const response = await app.fetch(post("tools/list"));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("fetch admitted");
    expect(admit).toHaveBeenCalledOnce();
    await app.close();
  });

  it("uses the same admission hook through server.listen", async () => {
    const admit = vi.fn(
      async (_request: Request, messages: JSONRPCMessage[]) => {
        expect(messages).toMatchObject([{ method: "tools/list" }]);
        return new Response("listener admitted", { status: 202 });
      }
    );
    const app = server(() => {}, {}, admit);
    try {
      const listening = await app.listen(0, { host: "127.0.0.1" });
      const response = await fetch(listening.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      expect(response.status).toBe(202);
      expect(await response.text()).toBe("listener admitted");
      expect(admit).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("preserves the mixed-auth policy through fetch and listen when admission defers", async () => {
    const admit: OAuthAdmissionHook = async () => ({ type: "defer" });
    const register = (host: OAuthProviderHost<TestUser>) => {
      host.tool(
        { name: "browse", securitySchemes: [{ type: "noauth" }] },
        async () => ({ content: [{ type: "text", text: "public" }] })
      );
      host.tool({ name: "private" }, async (_args, ctx) => ({
        content: [{ type: "text", text: ctx.auth.user.id }],
      }));
    };
    const createApp = () => server(register, { mixedAuth: true }, admit);
    const app = createApp();

    try {
      const fetchResponses = await Promise.all([
        app.fetch(post("tools/list")),
        app.fetch(call("browse")),
        app.fetch(call("private")),
      ]);
      expect(fetchResponses.map((response) => response.status)).toEqual([
        200, 200, 401,
      ]);
    } finally {
      await app.close();
    }

    const listeningApp = createApp();
    try {
      const listening = await listeningApp.listen(0, { host: "127.0.0.1" });
      const send = async (request: Request) =>
        fetch(listening.url, {
          method: request.method,
          headers: request.headers,
          body: await request.text(),
        });
      const listenResponses = await Promise.all([
        send(post("tools/list")),
        send(call("browse")),
        send(call("private")),
      ]);
      expect(listenResponses.map((response) => response.status)).toEqual([
        200, 200, 401,
      ]);
    } finally {
      await listeningApp.close();
    }
  });

  it("rejects an empty bearer returned by admission as an OAuth authentication failure", async () => {
    const authInfo: OAuthAuthInfo = {
      token: "adapter-token",
      clientId: "adapter-client",
      scopes: ["shop"],
      expiresAt: Date.now() / 1000 + 60,
      resource: new URL(resource),
    };
    const admit: OAuthAdmissionHook = async () => ({
      bearer: " ",
      authInfo,
    });
    const app = server(() => {}, {}, admit);

    try {
      const response = await app.fetch(post("tools/list"));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'error="invalid_token"'
      );
      expect(response.headers.get("www-authenticate")).toContain(
        "non-empty bearer token"
      );
    } finally {
      await app.close();
    }
  });

  it("returns OAuth authentication challenges for invalid admitted AuthInfo and identity mapping failures", async () => {
    const validAuthInfo: OAuthAuthInfo = {
      token: "adapter-token",
      clientId: "adapter-client",
      scopes: ["shop"],
      expiresAt: Date.now() / 1000 + 60,
      resource: new URL(resource),
    };
    const cases: Array<{
      authInfo: OAuthAuthInfo;
      mapAuthInfo?: (authInfo: OAuthAuthInfo) => OAuthExtra<TestUser>;
      description: string;
    }> = [
      {
        authInfo: { ...validAuthInfo, expiresAt: 0 },
        description:
          "Token verifier returned invalid authentication information",
      },
      {
        authInfo: {
          ...validAuthInfo,
          resource: new URL("https://other.example.test/mcp"),
        },
        description: "Token resource does not match the protected resource",
      },
      {
        authInfo: validAuthInfo,
        mapAuthInfo: () => {
          throw new Error("mapper failed");
        },
        description: "Token identity mapping failed",
      },
    ];

    for (const testCase of cases) {
      const admit: OAuthAdmissionHook = async () => ({
        bearer: "adapter-token",
        authInfo: testCase.authInfo,
      });
      const app = server(() => {}, {}, admit, testCase.mapAuthInfo);

      try {
        const response = await app.fetch(post("tools/list"));

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain(
          'error="invalid_token"'
        );
        expect(response.headers.get("www-authenticate")).toContain(
          `error_description="${testCase.description}"`
        );
      } finally {
        await app.close();
      }
    }
  });

  it("registers provider tools behind the bearer gate, with the mapped identity", async () => {
    const app = server((host) => {
      host.tool(
        { name: "register_session", description: "Step up." },
        async (_args, ctx) => ({
          content: [{ type: "text", text: `session:${ctx.auth.user.id}` }],
        })
      );
    });

    expect((await app.fetch(call("register_session"))).status).toBe(401);
    expect(
      await text(await app.fetch(call("register_session", signedIn)))
    ).toBe("session:user-1");

    const { tools } = await result<{ tools: Array<{ name: string }> }>(
      await app.fetch(post("tools/list", {}, signedIn))
    );
    expect(tools.map((tool) => tool.name)).toEqual(["register_session"]);
  });

  it("registers provider resources, resource templates, and prompts", async () => {
    const app = server(registerReadables);
    for (const [method, params, expected] of readables) {
      expect(
        await readText(await app.fetch(post(method, params, signedIn)))
      ).toBe(expected);
    }
  });

  it("refuses provider names the application already uses", async () => {
    const toolClash = server((host) => {
      host.tool({ name: "checkout" }, async () => ({ content: [] }));
    });
    toolClash.tool({ name: "checkout" }, async () => ({ content: [] }));
    await expect(
      toolClash.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow('Tool "checkout" is reserved by the OAuth provider');

    const resourceClash = server((host) => {
      host.resource(
        { name: "connection", uri: "provider://connection" },
        async (uri) => ({ contents: [{ uri: uri.href, text: "" }] })
      );
    });
    resourceClash.resource(
      { name: "connection", uri: "app://connection" },
      async (uri) => ({ contents: [{ uri: uri.href, text: "" }] })
    );
    await expect(
      resourceClash.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow(
      'Resource "connection" is reserved by the OAuth provider'
    );

    const templateClash = server((host) => {
      host.resourceTemplate(
        { name: "order", uriTemplate: "provider://orders/{id}" },
        async (uri) => ({ contents: [{ uri: uri.href, text: "" }] })
      );
    });
    templateClash.resourceTemplate(
      { name: "order", uriTemplate: "app://orders/{id}" },
      async (uri) => ({ contents: [{ uri: uri.href, text: "" }] })
    );
    await expect(
      templateClash.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow(
      'Resource template "order" is reserved by the OAuth provider'
    );

    const promptClash = server((host) => {
      host.prompt({ name: "checkout_help" }, async () => ({ messages: [] }));
    });
    promptClash.prompt({ name: "checkout_help" }, async () => ({
      messages: [],
    }));
    await expect(
      promptClash.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow(
      'Prompt "checkout_help" is reserved by the OAuth provider'
    );
  });

  it("installs mcp: middleware that can refuse application tools", async () => {
    const registered = new Set<string>();
    const app = server((host) => {
      host.tool({ name: "register_session" }, async (_args, ctx) => {
        registered.add(ctx.auth.clientId!);
        return { content: [{ type: "text", text: "registered" }] };
      });
      host.use("mcp:tools/call", async (ctx, next) => {
        if (
          ctx.params.name !== "register_session" &&
          !registered.has(ctx.auth!.clientId)
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: "register first" }],
          };
        }
        return next();
      });
    });
    app.tool({ name: "buy" }, async () => ({
      content: [{ type: "text", text: "bought" }],
    }));

    expect(await text(await app.fetch(call("buy", signedIn)))).toBe(
      "register first"
    );
    await app.fetch(call("register_session", signedIn));
    expect(await text(await app.fetch(call("buy", signedIn)))).toBe("bought");
  });

  it("lists application tools for validation", async () => {
    const requireTags = (host: OAuthProviderHost<TestUser>) => {
      for (const tool of host.listTools()) {
        if (tool.annotations?.destructiveHint && !tool._meta?.["shop/tags"]) {
          throw new Error(`destructive tool "${tool.name}" needs shop/tags`);
        }
      }
    };

    const seen = vi.fn();
    const app = server((host) => {
      seen(host.listTools().map(({ name }) => name));
      requireTags(host);
    });
    app.tool(
      {
        name: "buy",
        annotations: { destructiveHint: true },
        _meta: { "shop/tags": ["purchase"] },
      },
      async () => ({ content: [] })
    );
    app.tool({ name: "orders" }, async () => ({ content: [] }));
    await app.fetch(post("tools/list", {}, signedIn));
    expect(seen).toHaveBeenCalledWith(["buy", "orders"]);

    const unsafe = server(requireTags);
    unsafe.tool(
      { name: "refund", annotations: { destructiveHint: true } },
      async () => ({ content: [] })
    );
    await expect(
      unsafe.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow('destructive tool "refund" needs shop/tags');
  });

  it("composes instructions transforms once, without mutating the config", async () => {
    const config = {
      name: "shop",
      version: "1.0.0",
      oauth: provider((host) => {
        host.instructions((current) => `${current} First.`);
        host.instructions((current) => `${current} Second.`);
      }),
      logging: { enabled: false },
      instructions: "Shop tools.",
    };
    const app = new MCPServer(config);
    for (let request = 0; request < 2; request++) {
      const discovered = await result<{ instructions?: string }>(
        await app.fetch(post("server/discover", {}, signedIn))
      );
      expect(discovered.instructions).toBe("Shop tools. First. Second.");
    }
    expect(config.instructions).toBe("Shop tools.");
  });

  it("rejects host calls after setup returns", async () => {
    let saved: OAuthProviderHost<TestUser> | undefined;
    const app = server((host) => {
      saved = host;
    });
    await app.fetch(post("tools/list", {}, signedIn));
    expect(() => saved!.instructions(() => "late")).toThrow(
      "called after the provider's setup hook returned"
    );
    expect(() => saved!.listTools()).toThrow(
      "called after the provider's setup hook returned"
    );
  });

  it("fails closed and never re-runs setup after it throws", async () => {
    let attempts = 0;
    const setup = vi.fn((host: OAuthProviderHost<TestUser>) => {
      host.use("mcp:tools/call", async (_ctx, next) => next());
      host.instructions((current) => `${current ?? ""} Gated.`);
      // A transient failure: a re-run would succeed with the middleware and
      // the instructions transform applied twice.
      if (attempts++ === 0) throw new Error("connection store unavailable");
    });
    const app = server(setup);

    for (let request = 0; request < 2; request++) {
      await expect(app.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
        "connection store unavailable"
      );
    }
    expect(setup).toHaveBeenCalledOnce();
  });

  it("rejects an async setup hook instead of serving without its late registrations", async () => {
    const late = vi.fn();
    const app = server(async (host) => {
      await Promise.resolve();
      late();
      host.use("mcp:tools/call", async () => ({
        isError: true,
        content: [{ type: "text", text: "gated" }],
      }));
    });
    app.tool({ name: "buy" }, async () => ({ content: [] }));

    for (let request = 0; request < 2; request++) {
      await expect(app.fetch(call("buy", signedIn))).rejects.toThrow(
        "setup hook must be synchronous"
      );
    }
    // Let the hook resume: its late host call rejects, and that rejection
    // is handled rather than reported as unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late).toHaveBeenCalledOnce();
  });
});

describe("OAuth provider setup hook: routes", () => {
  it("exposes the mount mode", async () => {
    let mode: string | undefined;
    let listenHost: string | undefined = "unset";
    await server((host) => {
      mode = host.mode;
      listenHost = host.listenHost;
    }).fetch(post("tools/list", {}, signedIn));
    expect(mode).toBe("handler");
    expect(listenHost).toBeUndefined();
  });

  it("exposes the listen() bind address", async () => {
    let mode: string | undefined;
    let listenHost: string | undefined;
    const app = server((host) => {
      mode = host.mode;
      listenHost = host.listenHost;
    });
    try {
      await app.listen(0, { host: "127.0.0.1" });
      expect(mode).toBe("listen");
      expect(listenHost).toBe("127.0.0.1");
    } finally {
      await app.close();
    }
  });

  it("serves provider routes ahead of the gate and application routes", async () => {
    const app = server((host) => {
      host.route("GET", "/mcp/oauth/ping", (c) => c.text("provider"));
      host.route("POST", "/mcp/oauth/echo", async (c) =>
        c.json(await c.req.parseBody())
      );
    });
    app.get("/mcp/oauth/ping", (c) => c.text("application"));

    const ping = await app.fetch(new Request(`${resource}/oauth/ping`));
    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("provider");

    const echo = await app.fetch(
      new Request(`${resource}/oauth/echo`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a=1",
      })
    );
    expect(await echo.json()).toEqual({ a: "1" });
  });

  it("exempts provider routes from the Origin allowlist", async () => {
    const app = new MCPServer({
      name: "shop",
      version: "1.0.0",
      oauth: provider((host) => {
        host.route("POST", "/mcp/oauth/token", (c) => c.text("ok"));
      }),
      allowedOrigins: ["shop.example.test"],
      logging: { enabled: false },
    });
    const response = await app.fetch(
      new Request(`${resource}/oauth/token`, {
        method: "POST",
        headers: { origin: "https://client.example.test" },
      })
    );
    expect(response.status).toBe(200);
    const blocked = await app.fetch(
      new Request(resource, {
        method: "POST",
        headers: {
          origin: "https://client.example.test",
          "content-type": "application/json",
        },
        body: "{}",
      })
    );
    expect(blocked.status).toBe(403);
  });

  it("refuses provider routes outside the base path or registered twice", async () => {
    for (const path of [
      "/oauth/token",
      "/mcp",
      "/mcp/",
      "/mcp/../token",
      "/mcp/:id",
    ]) {
      const app = server((host) => {
        host.route("GET", path, (c) => c.text(""));
      });
      await expect(app.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
        "must be a literal pathname under /mcp/"
      );
    }
    const twice = server((host) => {
      host.route("GET", "/mcp/oauth/a", (c) => c.text(""));
      host.route("GET", "/mcp/oauth/a", (c) => c.text(""));
    });
    await expect(twice.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
      "is already registered"
    );
  });

  it("computes metadata from the resolved resource", async () => {
    const computed = vi.fn((boundResource: URL) => ({
      issuer: boundResource.origin,
      authorization_endpoint: `${boundResource.href}/oauth/authorize`,
      token_endpoint: `${boundResource.href}/oauth/token`,
      response_types_supported: ["code"],
    }));
    const app = new MCPServer({
      name: "shop",
      version: "1.0.0",
      oauth: oauthCustomProvider<TestUser, (resource: URL) => OAuthMetadata>({
        resource,
        createTokenVerifier: () => ({
          verifyAccessToken: async () => {
            throw new Error("unused");
          },
        }),
        oauthMetadata: computed,
        mapAuthInfo: () => ({
          user: { id: "u" },
          payload: {},
          permissions: [],
        }),
      }),
      logging: { enabled: false },
    });
    const metadata = await app.fetch(
      new Request(
        "https://shop.example.test/.well-known/oauth-authorization-server"
      )
    );
    expect(await metadata.json()).toMatchObject({
      issuer: "https://shop.example.test",
      token_endpoint: "https://shop.example.test/mcp/oauth/token",
    });
    const prm = await app.fetch(
      new Request(
        "https://shop.example.test/.well-known/oauth-protected-resource/mcp"
      )
    );
    expect(await prm.json()).toMatchObject({
      authorization_servers: ["https://shop.example.test"],
    });
    expect(computed).toHaveBeenCalledOnce();
  });
});

describe("OAuth provider setup hook: mixedAuth", () => {
  it("exposes mixedAuth so a provider can require anonymous discovery", async () => {
    const requireMixedAuth = (host: OAuthProviderHost<TestUser>) => {
      if (!host.mixedAuth) throw new Error("provider needs mixedAuth: true");
    };

    await expect(
      server(requireMixedAuth).fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow("provider needs mixedAuth: true");

    const app = server(requireMixedAuth, { mixedAuth: true });
    expect((await app.fetch(post("tools/list"))).status).toBe(200);
  });

  it("applies securitySchemes to provider tools", async () => {
    const app = server(
      (host) => {
        host.tool(
          { name: "browse", securitySchemes: [{ type: "noauth" }] },
          async (_args, ctx) => ({
            content: [
              { type: "text", text: `browse:${ctx.auth?.user.id ?? "guest"}` },
            ],
          })
        );
        host.tool({ name: "register_session" }, async () => ({
          content: [{ type: "text", text: "registered" }],
        }));
      },
      { mixedAuth: true }
    );

    expect(await text(await app.fetch(call("browse")))).toBe("browse:guest");
    expect(await text(await app.fetch(call("browse", signedIn)))).toBe(
      "browse:user-1"
    );
    expect((await app.fetch(call("register_session"))).status).toBe(401);

    const { tools } = await result<{
      tools: Array<{ name: string; securitySchemes?: unknown }>;
    }>(await app.fetch(post("tools/list")));
    expect(tools).toEqual([
      expect.objectContaining({
        name: "browse",
        securitySchemes: [{ type: "noauth" }],
      }),
      expect.objectContaining({
        name: "register_session",
        securitySchemes: [{ type: "oauth2", scopes: ["shop"] }],
      }),
    ]);
  });

  it("keeps provider resources, resource templates, and prompts behind sign-in", async () => {
    const app = server(registerReadables, { mixedAuth: true });
    for (const [method, params, expected] of readables) {
      expect((await app.fetch(post(method, params))).status).toBe(401);
      expect(
        await readText(await app.fetch(post(method, params, signedIn)))
      ).toBe(expected);
    }
  });

  it("runs provider middleware on signed-out noauth calls without ctx.auth", async () => {
    const seen: Array<string | undefined> = [];
    const app = server(
      (host) => {
        host.use("mcp:tools/call", async (ctx, next) => {
          seen.push(ctx.auth?.clientId);
          return next();
        });
      },
      { mixedAuth: true }
    );
    app.tool(
      { name: "catalog", securitySchemes: [{ type: "noauth" }] },
      async () => ({ content: [{ type: "text", text: "catalog" }] })
    );

    await app.fetch(call("catalog"));
    await app.fetch(call("catalog", signedIn));
    expect(seen).toEqual([undefined, "client-1"]);
  });

  it("rejects a provider noauth tool on a server without mixedAuth", async () => {
    const app = server((host) => {
      host.tool(
        { name: "browse", securitySchemes: [{ type: "noauth" }] },
        async () => ({ content: [] })
      );
    });
    await expect(app.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
      'Tool "browse": noauth requires mixedAuth: true'
    );
  });
});

describe("OAuth provider setup hook: types", () => {
  it("types ctx.auth with the provider's user", () => {
    server((host) => {
      host.tool({ name: "signed_in" }, async (_args, ctx) => {
        const id: string = ctx.auth.user.id;
        // @ts-expect-error TestUser has no email
        void ctx.auth.user.email;
        return { content: [{ type: "text", text: id }] };
      });
      host.tool(
        { name: "browse", securitySchemes: [{ type: "noauth" }] },
        async (_args, ctx) => {
          // @ts-expect-error ctx.auth is optional on a noauth tool
          void ctx.auth.user.id;
          const id: string | undefined = ctx.auth?.user.id;
          return { content: [{ type: "text", text: id ?? "guest" }] };
        }
      );
      host.tool(
        {
          name: "orders",
          securitySchemes: [{ type: "oauth2", scopes: ["orders"] }],
        },
        async (_args, ctx) => {
          const id: string = ctx.auth.user.id;
          return { content: [{ type: "text", text: id }] };
        }
      );
      host.resource(
        { name: "profile", uri: "provider://profile" },
        async (uri, ctx) => {
          const id: string = ctx.auth.user.id;
          return { contents: [{ uri: uri.href, text: id }] };
        }
      );
      host.resourceTemplate(
        { name: "order", uriTemplate: "provider://orders/{id}" },
        async (uri, params, ctx) => {
          const orderId: string | string[] = params.id;
          // @ts-expect-error the template has no {sku} variable
          void params.sku;
          const id: string = ctx.auth.user.id;
          return { contents: [{ uri: uri.href, text: `${orderId}:${id}` }] };
        }
      );
      host.prompt(
        { name: "reorder", schema: z.object({ orderId: z.string() }) },
        async ({ orderId }, ctx) => {
          const id: string = ctx.auth.user.id;
          return {
            messages: [
              {
                role: "user",
                content: { type: "text", text: `${orderId}:${id}` },
              },
            ],
          };
        }
      );
    });
  });
});
