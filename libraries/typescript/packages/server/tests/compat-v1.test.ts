import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getAuth,
  hasAnyScope,
  hasScope,
  MCPServer,
  object,
  text,
  widget,
} from "../src/compat-v1.js";

describe("temporary v1 compatibility entry", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanup.splice(0).map((close) => close()));
  });

  it("preserves the common v1 OAuth scope helpers", () => {
    const auth = {
      user: { userId: "user-1" },
      payload: {},
      accessToken: "token",
      scopes: ["read:data"],
      permissions: ["admin"],
    };
    const context = { auth } as never;
    expect(getAuth(context)).toBe(auth);
    expect(hasScope(context, ["read:data", "admin"])).toBe(true);
    expect(hasAnyScope(context, ["missing", "admin"])).toBe(true);
  });

  it("runs common inline v1 tools, resources, templates, and prompts over v2", async () => {
    const server = new MCPServer({
      name: "v1-compat",
      version: "1.0.0",
      stateless: true,
    });
    server.tool({
      name: "greet",
      schema: z.object({ name: z.string() }),
      cb: async ({ name }, ctx) =>
        text(
          `${name}:${String(ctx.client.supportsApps())}:${String(
            typeof ctx.log === "function"
          )}`
        ),
    });
    server.resource({
      name: "settings",
      uri: "config://settings",
      mimeType: "application/json",
      readCallback: async (ctx) =>
        object({ request: ctx.req !== undefined || ctx.request !== undefined }),
    });
    server.resourceTemplate({
      name: "person",
      resourceTemplate: {
        uriTemplate: "people://{id}",
        mimeType: "text/plain",
      },
      readCallback: async (uri, params) => ({
        contents: [{ uri: uri.href, text: String(params.id) }],
      }),
    });
    server.prompt({
      name: "hello",
      schema: z.object({ name: z.string() }),
      cb: async ({ name }) => ({
        messages: [
          { role: "user", content: { type: "text", text: `Hello ${name}` } },
        ],
      }),
    });

    const started = await server.listen(0);
    if (started === undefined) throw new Error("expected standalone listener");
    const client = new Client({ name: "compat-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const called = await client.callTool({
      name: "greet",
      arguments: { name: "Ada" },
    });
    expect(called.content).toEqual([{ type: "text", text: "Ada:false:true" }]);

    const resource = await client.readResource({ uri: "config://settings" });
    expect(resource.contents[0]).toMatchObject({
      uri: "config://settings",
      text: expect.stringContaining('"request": true'),
    });

    const templated = await client.readResource({ uri: "people://42" });
    expect(templated.contents[0]).toMatchObject({ text: "42" });

    const prompt = await client.getPrompt({
      name: "hello",
      arguments: { name: "Ada" },
    });
    expect(prompt.messages[0]).toMatchObject({
      content: { type: "text", text: "Hello Ada" },
    });
  });

  it("binds an unchanged legacy widget through the v2 view manifest", async () => {
    const server = new MCPServer({ name: "widget-compat", version: "1.0.0" });
    server.tool({
      name: "show-card",
      schema: z.object({ message: z.string() }),
      widget: { name: "card", invoking: "Opening card" },
      cb: async ({ message }) => widget({ props: { message } }),
    });
    server.__registerLegacyViews({
      card: {
        widgetMetadata: {
          description: "Legacy card",
          props: z.object({ message: z.string() }),
          metadata: { prefersBorder: true, autoResize: false },
        },
      },
    });
    server.__primeViews({
      card: { kind: "inline", js: "export {};", css: "" },
    });

    const started = await server.listen(0);
    if (started === undefined) throw new Error("expected standalone listener");
    const client = new Client({ name: "compat-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === "show-card");
    expect(tool?._meta).toMatchObject({
      "openai/toolInvocation/invoking": "Opening card",
      ui: { resourceUri: "ui://views/card.html" },
    });

    const result = await client.callTool({
      name: "show-card",
      arguments: { message: "hello" },
    });
    expect(result.structuredContent).toEqual({ message: "hello" });
    expect(result._meta).toMatchObject({
      ui: { resourceUri: "ui://views/card.html" },
    });

    const resources = await client.listResources();
    const view = resources.resources.find(
      (entry) => entry.uri === "ui://views/card.html"
    );
    expect(view).toMatchObject({
      description: "Legacy card",
      mimeType: "text/html;profile=mcp-app",
      _meta: { ui: { prefersBorder: true } },
    });
  });

  it("auto-registers a legacy widget tool only when explicitly requested", async () => {
    const server = new MCPServer({ name: "widget-auto", version: "1.0.0" });
    server.__registerLegacyViews({
      implicit: { widgetMetadata: { description: "resource only" } },
      explicit: {
        widgetMetadata: {
          description: "tool and resource",
          exposeAsTool: true,
        },
      },
    });
    server.__primeViews({
      implicit: { kind: "inline", js: "export {};", css: "" },
      explicit: { kind: "inline", js: "export {};", css: "" },
    });

    const started = await server.listen(0);
    if (started === undefined) throw new Error("expected standalone listener");
    const client = new Client({ name: "compat-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("explicit");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("implicit");
  });

  it("rejects binding one legacy view to multiple tools", () => {
    const server = new MCPServer({ name: "widget-compat", version: "1.0.0" });
    server.tool({
      name: "first",
      widget: { name: "shared" },
      cb: async () => text("one"),
    });
    expect(() =>
      server.tool({
        name: "second",
        widget: { name: "shared" },
        cb: async () => text("two"),
      })
    ).toThrow(/multiple tools.*one tool per view/);
  });

  it("rejects a second tool after the first legacy binding is flushed", () => {
    const server = new MCPServer({ name: "widget-compat", version: "1.0.0" });
    server.tool({
      name: "first",
      widget: { name: "shared" },
      cb: async () => text("one"),
    });
    server.__registerLegacyViews({ shared: { widgetMetadata: {} } });

    expect(() =>
      server.tool({
        name: "second",
        widget: { name: "shared" },
        cb: async () => text("two"),
      })
    ).toThrow(/multiple tools.*one tool per view/);
  });

  it("keeps the v1 OpenAPI constructor on the deprecated entry", async () => {
    const server = MCPServer.fromOpenAPI({
      spec: {
        openapi: "3.0.0",
        info: { title: "Pet API", version: "1.0.0" },
        servers: [{ url: "https://example.com" }],
        paths: {
          "/pets": {
            get: { operationId: "listPets", responses: { "200": {} } },
          },
        },
      },
    });

    const started = await server.listen(0);
    if (started === undefined) throw new Error("expected standalone listener");
    const client = new Client({ name: "compat-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("listPets");
  });

  it("rejects the intentionally unsupported stateful v1 configuration", () => {
    expect(
      () =>
        new MCPServer({
          name: "stateful",
          version: "1.0.0",
          stateless: false,
        })
    ).toThrow(/stateless: false.*v2 is stateless/);
  });
});
