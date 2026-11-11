import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { ResourceLinkSchema } from "@modelcontextprotocol/core";
import {
  MCPServer,
  type ResourceLink,
  type MentionSearchParams,
  type MentionSearchResult,
  type ToolRef,
} from "../src/index.js";
import { oauthCustomProvider, type OAuthMetadata } from "../src/oauth/index.js";

async function request(
  server: Pick<MCPServer, "fetch">,
  method: string,
  params: Record<string, unknown> = {},
  version = "2026-07-28",
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {}
) {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      ...(options.signal && { signal: options.signal }),
      headers: {
        ...options.headers,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": version,
        "mcp-method": method,
        ...(typeof params["name"] === "string" && {
          "mcp-name": params["name"],
        }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientInfo": {
              name: "settings-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    })
  );
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : body;
  return { httpStatus: response.status, ...JSON.parse(data || "{}") };
}

const servers: MCPServer[] = [];
function create() {
  const server = new MCPServer({ name: "mentions-test", version: "1" });
  servers.push(server);
  return server;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const link: ResourceLink = {
  type: "resource_link",
  uri: "workspace://files/roadmap",
  name: "roadmap.md",
  title: "Roadmap",
  description: "Plans",
  mimeType: "text/markdown",
  size: 10,
  icons: [{ src: "https://example.com/file.png", sizes: ["32x32"] }],
  annotations: {
    audience: ["user"],
    priority: 0.5,
    lastModified: "2026-10-07T00:00:00Z",
  },
  _meta: { custom: "preserved" },
};

describe("composer mentions", () => {
  it("replays the exact generated contract without views or host capabilities", async () => {
    const server = create();
    const search = vi.fn(() => ({ items: [link] }));
    const ref = server.mentions({
      name: "workspace.mentions",
      title: "Workspace",
      description: "Search",
      search,
    });
    expectTypeOf(ref).toEqualTypeOf<
      ToolRef<"workspace.mentions", MentionSearchParams, MentionSearchResult>
    >();
    expect(Object.isFrozen(ref)).toBe(true);
    expect(search).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const [tool] = (await request(server, "tools/list")).result.tools;
      expect(tool).toMatchObject({
        name: ref.name,
        title: "Workspace",
        description: "Search",
        annotations: { readOnlyHint: true },
      });
      expect(tool.inputSchema).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
      expect(tool.outputSchema.type).toBe("object");
      expect(tool.outputSchema.required).toEqual(["items"]);
      expect(tool.outputSchema.properties.items.type).toBe("array");
      expect(tool.outputSchema.properties.items.items).toEqual(
        ResourceLinkSchema["~standard"].jsonSchema.output({
          target: "draft-2020-12",
        })
      );
      expect(tool._meta).toEqual({
        "openai/extensions": { "mentions/search": {} },
        ui: { visibility: ["app"] },
      });
    }
    expect(
      JSON.stringify(await request(server, "server/discover"))
    ).not.toContain("openai/mentions");
    expect((await request(server, "resources/list")).result.resources).toEqual(
      []
    );
    const result = await request(server, "tools/call", {
      name: ref.name,
      arguments: { query: "road" },
    });
    expect(result.result.content).toEqual([]);
    expect(result.result.structuredContent).toEqual({ items: [link] });
    expect(result.result._meta?.ui).toBeUndefined();
  });

  it.each([
    { raw: undefined, top: undefined, expected: ["app"] },
    { raw: ["model"], top: undefined, expected: ["model", "app"] },
    {
      raw: ["app", "model", "app", "model"],
      top: undefined,
      expected: ["app", "model"],
    },
    { raw: ["model"], top: "app" as const, expected: ["app"] },
    { raw: ["app"], top: "model" as const, expected: ["model", "app"] },
  ])(
    "preserves siblings and immutable inputs with visibility $expected",
    async ({ raw, top, expected }) => {
      const server = create();
      const meta = {
        custom: { unchanged: true },
        "openai/extensions": {
          other: { enabled: true },
          "mentions/search": { ignored: true },
        },
        "ui/resourceUri": "ui://raw/view.html",
        ui: {
          resourceUri: "ui://raw/view.html",
          customUi: "kept",
          ...(raw !== undefined && { visibility: raw }),
        },
      };
      const before = structuredClone(meta);
      server.mentions({
        name: "search",
        _meta: meta,
        ...(top !== undefined && { visibility: top }),
        annotations: { title: "Annotation", readOnlyHint: false },
        search: () => ({ items: [] }),
      });
      const [tool] = (await request(server, "tools/list")).result.tools;
      expect(meta).toEqual(before);
      expect(tool._meta).toEqual({
        custom: { unchanged: true },
        "openai/extensions": {
          other: { enabled: true },
          "mentions/search": {},
        },
        ui: { customUi: "kept", visibility: expected },
      });
      expect(tool.annotations).toMatchObject({
        title: "Annotation",
        readOnlyHint: false,
      });
    }
  );

  it("passes empty and whitespace queries unchanged with independent contexts and cancellation signals", async () => {
    const server = create();
    const search = vi.fn((params, ctx) => {
      expect(ctx.request.raw.url).toBe("http://localhost/mcp");
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
      expect(ctx.client.info().name).toBe("settings-test");
      expect(ctx.auth).toBeUndefined();
      return { items: [] };
    });
    server.mentions({ name: "search", search });
    for (const query of ["", " \t ", "Road"]) {
      const result = await request(server, "tools/call", {
        name: "search",
        arguments: { query },
      });
      expect(result.result.content).toEqual([]);
      expect(result.result.structuredContent).toEqual({ items: [] });
    }
    expect(search.mock.calls.map(([params]) => params.query)).toEqual([
      "",
      " \t ",
      "Road",
    ]);
    expect(search.mock.calls[0]?.[1]).not.toBe(search.mock.calls[1]?.[1]);
    expect(search.mock.calls[0]?.[1].signal).not.toBe(
      search.mock.calls[1]?.[1].signal
    );
    for (const args of [{}, { query: 42 }, { query: null }, { query: [] }]) {
      const result = await request(server, "tools/call", {
        name: "search",
        arguments: args,
      });
      expect(result.error ?? result.result?.isError).toBeTruthy();
    }
    expect(search).toHaveBeenCalledTimes(3);
  });

  it.each([
    {},
    { items: null },
    { items: ["bad"] },
    { items: [{ uri: "workspace://x", name: "x" }] },
    { items: [{ type: "text", uri: "workspace://x", name: "x" }] },
    { items: [{ type: "resource_link", name: "x" }] },
    { items: [{ type: "resource_link", uri: "x" }] },
    { items: [{ ...link, annotations: { priority: 2 } }] },
  ])(
    "validates malformed callback output %# through SDK errors",
    async (value) => {
      const server = create();
      server.mentions({
        name: "search",
        search: () => value as MentionSearchResult,
      });
      expect(
        (
          await request(server, "tools/call", {
            name: "search",
            arguments: { query: "" },
          })
        ).result.isError
      ).toBe(true);
    }
  );

  it("keeps callback failures as errors", async () => {
    const server = create();
    server.mentions({
      name: "search",
      search: () => {
        throw new Error("Access denied");
      },
    });
    const result = await request(server, "tools/call", {
      name: "search",
      arguments: { query: "" },
    });
    expect(result.result.isError).toBe(true);
    expect(JSON.stringify(result.result)).toContain("Access denied");
    expect(result.result.structuredContent).toBeUndefined();
  });

  it("passes request cancellation to an in-flight search", async () => {
    const server = create();
    const controller = new AbortController();
    const entered = Promise.withResolvers<AbortSignal>();
    const cancelled = Promise.withResolvers<void>();
    server.mentions({
      name: "search",
      search: async (_params, ctx) => {
        entered.resolve(ctx.signal);
        await new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => {
              cancelled.resolve();
              reject(new Error("Search cancelled"));
            },
            { once: true }
          );
        });
        return { items: [] };
      },
    });
    const invocation = request(
      server,
      "tools/call",
      { name: "search", arguments: { query: "" } },
      "2026-07-28",
      { signal: controller.signal }
    );
    const signal = await entered.promise;
    expect(signal.aborted).toBe(false);
    controller.abort();
    await cancelled.promise;
    expect(signal.aborted).toBe(true);
    expect((await invocation).httpStatus).toBe(499);
  });

  it("rejects invalid names, callbacks, collisions and registration after startup without replacing tools", async () => {
    const server = create();
    const search = vi.fn(() => ({ items: [] }));
    for (const name of ["", " "])
      expect(() => server.mentions({ name, search })).toThrow(/non-blank/);
    expect(() =>
      server.mentions({ name: "bad", search: null as never })
    ).toThrow(/callback/);
    server.tool({ name: "existing" }, async () => ({ content: [] }));
    expect(() => server.mentions({ name: "existing", search })).toThrow(
      /already registered/
    );
    server.mentions({ name: "search", search });
    expect(() => server.mentions({ name: "search", search })).toThrow(
      /already registered/
    );
    await request(server, "tools/list");
    expect(() => server.mentions({ name: "late", search })).toThrow(/start/i);
    expect(
      (await request(server, "tools/list")).result.tools.map(
        (tool: { name: string }) => tool.name
      )
    ).toEqual(["existing", "search"]);
    expect(
      (await request(server, "tools/call", { name: "existing", arguments: {} }))
        .result.content
    ).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("uses normal OAuth sign-in defaults and verified request identity", async () => {
    const oauth = oauthCustomProvider<{ id: string }>({
      resource: "http://localhost/mcp",
      requiredScopes: ["search"],
      createTokenVerifier: (resource) => ({
        verifyAccessToken: async (token) => ({
          token,
          clientId: "client",
          scopes: ["search"],
          expiresAt: Date.now() / 1000 + 600,
          resource,
        }),
      }),
      oauthMetadata: { issuer: "https://issuer.example.test" } as OAuthMetadata,
      mapAuthInfo: () => ({
        user: { id: "caller" },
        payload: {},
        permissions: ["read"],
      }),
    });
    const server = new MCPServer({
      name: "auth-mentions",
      version: "1",
      oauth,
    });
    const search = vi.fn();
    server.mentions({
      name: "search",
      search: (_params, ctx) => {
        expectTypeOf(ctx.auth.user).toEqualTypeOf<{ id: string }>();
        expect(ctx.auth.user.id).toBe("caller");
        search(ctx);
        return { items: [link] };
      },
    });
    const denied = await request(server, "tools/call", {
      name: "search",
      arguments: { query: "" },
    });
    expect(denied.error ?? denied.result?.isError).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
    const signedIn = await request(
      server,
      "tools/call",
      { name: "search", arguments: { query: "" } },
      "2026-07-28",
      { headers: { authorization: "Bearer verified" } }
    );
    expect(signedIn.result.structuredContent).toEqual({ items: [link] });
    expect(search).toHaveBeenCalledOnce();
    await server.close();
  });
});
