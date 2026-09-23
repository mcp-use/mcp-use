/**
 * OAuth provider `setup(host)` hook: the seam an authorization model such as
 * Lane uses to install middleware, provider-owned tools and resources, and
 * instructions text at mount time.
 *
 * Exercised over `server.fetch` on the stateless 2026-07-28 envelope.
 */
import { describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  oauthCustomProvider,
  type OAuthMetadata,
  type OAuthProviderHost,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";
const resource = "https://shop.example.test/mcp";

interface TestUser {
  id: string;
}

/** Any bearer verifies with the `shop` scope as user `user-1`. */
function provider(setup: (host: OAuthProviderHost<TestUser>) => void) {
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
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: {},
      permissions: [],
    }),
    setup,
  });
}

function server(
  setup: (host: OAuthProviderHost<TestUser>) => void,
  options: { instructions?: string } = {}
) {
  return new MCPServer({
    name: "shop",
    version: "1.0.0",
    oauth: provider(setup),
    logging: { enabled: false },
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

describe("OAuth provider setup hook", () => {
  it("runs once, before the first request, with the resolved host values", async () => {
    const setup = vi.fn((host: OAuthProviderHost<TestUser>) => {
      expect(host.resource.href).toBe(resource);
      expect(host.basePath).toBe("/mcp");
    });
    const app = server(setup);

    expect(setup).not.toHaveBeenCalled();
    await app.fetch(post("tools/list", {}, signedIn));
    await app.fetch(post("tools/list", {}, signedIn));
    expect(setup).toHaveBeenCalledOnce();
  });

  it("registers provider tools behind the bearer gate, with the mapped identity", async () => {
    const app = server((host) => {
      host.registerTool(
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

  it("registers provider resources", async () => {
    const app = server((host) => {
      host.registerResource(
        { name: "connection", uri: "provider://connection" },
        async (uri, ctx) => ({
          contents: [{ uri: uri.href, text: `conn:${ctx.auth.user.id}` }],
        })
      );
    });
    const { contents } = await result<{ contents: Array<{ text: string }> }>(
      await app.fetch(
        post("resources/read", { uri: "provider://connection" }, signedIn)
      )
    );
    expect(contents[0]!.text).toBe("conn:user-1");
  });

  it("refuses provider names the application already uses", async () => {
    const toolClash = server((host) => {
      host.registerTool({ name: "checkout" }, async () => ({ content: [] }));
    });
    toolClash.tool({ name: "checkout" }, async () => ({ content: [] }));
    await expect(
      toolClash.fetch(post("tools/list", {}, signedIn))
    ).rejects.toThrow('Tool "checkout" is reserved by the OAuth provider');

    const resourceClash = server((host) => {
      host.registerResource(
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
  });

  it("installs mcp: middleware that can refuse application tools", async () => {
    const registered = new Set<string>();
    const app = server((host) => {
      host.registerTool({ name: "register_session" }, async (_args, ctx) => {
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

  it("composes instructions transforms without mutating the config", async () => {
    const config = "Shop tools.";
    const app = server(
      (host) => {
        host.instructions((current) => `${current} First.`);
        host.instructions((current) => `${current} Second.`);
      },
      { instructions: config }
    );
    const discovered = await result<{ instructions?: string }>(
      await app.fetch(post("server/discover", {}, signedIn))
    );
    expect(discovered.instructions).toBe("Shop tools. First. Second.");
    expect(config).toBe("Shop tools.");
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

  it("fails closed when setup throws after a partial install", async () => {
    const app = server((host) => {
      host.registerTool({ name: "register_session" }, async () => ({
        content: [],
      }));
      throw new Error("connection store unavailable");
    });
    await expect(app.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
      "connection store unavailable"
    );
    // The retried mount re-runs setup, which collides with its own earlier
    // registration instead of serving without the provider's gate.
    await expect(app.fetch(post("tools/list", {}, signedIn))).rejects.toThrow(
      'Tool "register_session" is reserved by the OAuth provider'
    );
  });
});

describe("OAuth provider setup hook: types", () => {
  it("types ctx.auth with the provider's user", () => {
    server((host) => {
      host.registerTool({ name: "signed_in" }, async (_args, ctx) => {
        const id: string = ctx.auth.user.id;
        // @ts-expect-error TestUser has no email
        void ctx.auth.user.email;
        return { content: [{ type: "text", text: id }] };
      });
      host.registerResource(
        { name: "profile", uri: "provider://profile" },
        async (uri, ctx) => {
          const id: string = ctx.auth.user.id;
          return { contents: [{ uri: uri.href, text: id }] };
        }
      );
    });
  });
});
