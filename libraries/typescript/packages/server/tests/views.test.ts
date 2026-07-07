/**
 * End-to-end tests for the views server core: wire metadata, capability
 * gating, binding validation, document/asset routes, and the view() helper.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews, view } from "../src/index.js";

const UI_CAPABILITIES = {
  extensions: {
    "io.modelcontextprotocol/ui": {
      mimeTypes: ["text/html;profile=mcp-app"],
    },
  },
};

const resultsSchema = z.object({
  query: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

function primeViews(server: MCPServer): void {
  server[registerViews]({
    "product-search-result": {
      entry: "views/assets/product-search-result-D2f9a1Kc.js",
      css: ["views/assets/product-search-result-B99z1bQd.css"],
      metadata: {
        description: "Product search results grid",
        csp: {
          connectDomains: [],
          resourceDomains: ["https://images.example.com"],
        },
        prefersBorder: true,
      },
    },
    "orphan-view": {
      entry: "views/assets/orphan-D2f9a1Kc.js",
      css: [],
      metadata: { description: "No tool binds this view" },
    },
    "app-only-view": {
      entry: "views/assets/app-only-D2f9a1Kc.js",
      css: [],
      metadata: { description: "App-visible tool view" },
    },
  });
}

function buildViewsServer(): MCPServer {
  const server = new MCPServer({
    name: "views-test",
    version: "1.0.0",
    basePath: "/mcp",
  });

  primeViews(server);

  server.tool(
    {
      name: "search-fruits",
      schema: z.object({ query: z.string().optional() }),
      outputSchema: resultsSchema,
      view: { name: "product-search-result" },
    },
    async ({ query = "" }) =>
      view({
        props: { query, items: [{ id: "1", name: "apple" }] },
        content: "Found 1 fruit",
        meta: { viewOnly: true },
      })
  );

  server.tool(
    {
      name: "app-only-action",
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "app-only-view", visibility: "app" },
    },
    async () => view({ props: { ok: true } })
  );

  server.tool(
    {
      name: "supports-views-probe",
      outputSchema: z.object({ ui: z.boolean() }),
    },
    async (_params, ctx) =>
      view({ props: { ui: ctx.client.supportsViews() } })
  );

  server.tool({ name: "plain-tool" }, async () => ({
    content: [{ type: "text", text: "plain" }],
  }));

  return server;
}

describe("views server core (e2e over HTTP)", () => {
  const server = buildViewsServer();
  let url: string;
  let uiClient: Client;
  let plainClient: Client;

  beforeAll(async () => {
    const started = await server.listen(0);
    url = started.url;

    uiClient = new Client(
      { name: "ui-client", version: "1.0.0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        capabilities: UI_CAPABILITIES,
      }
    );
    await uiClient.connect(new StreamableHTTPClientTransport(new URL(url)));

    plainClient = new Client(
      { name: "plain-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await plainClient.connect(new StreamableHTTPClientTransport(new URL(url)));
  });

  afterAll(async () => {
    await uiClient.close();
    await plainClient.close();
    await server.close();
  });

  it("emits ui meta on tools/list for UI-capable clients", async () => {
    const { tools } = await uiClient.listTools();
    const search = tools.find((t) => t.name === "search-fruits");
    expect(search?._meta).toMatchObject({
      ui: { resourceUri: "ui://views/product-search-result.html" },
      "ui/resourceUri": "ui://views/product-search-result.html",
    });
    expect(search?._meta?.["ui"]).not.toHaveProperty("visibility");
  });

  it("omits ui meta on tools/list for plain clients", async () => {
    const { tools } = await plainClient.listTools();
    const search = tools.find((t) => t.name === "search-fruits");
    expect(search?._meta?.["ui"]).toBeUndefined();
    expect(search?._meta?.["ui/resourceUri"]).toBeUndefined();
  });

  it("hides visibility:app tools from plain clients", async () => {
    const { tools } = await plainClient.listTools();
    expect(tools.map((t) => t.name)).not.toContain("app-only-action");
  });

  it("lists view resources with mimetype and gated ui meta for UI clients", async () => {
    const { resources } = await uiClient.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    expect(view?.description).toBe("Product search results grid");
    expect(view?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: expect.arrayContaining([
          "https://images.example.com",
          expect.stringMatching(/^https?:\/\//),
        ]),
      },
      prefersBorder: true,
    });
  });

  it("omits ui meta on resources/list for plain clients", async () => {
    const { resources } = await plainClient.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    expect(view?._meta?.["ui"]).toBeUndefined();
  });

  it("reads a view resource as synthesized HTML via resources/read", async () => {
    const read = await uiClient.readResource({
      uri: "ui://views/product-search-result.html",
    });
    const content = read.contents[0];
    if (content === undefined || !("text" in content)) {
      throw new Error("expected text resource contents");
    }
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("<!doctype html>");
    expect(content.text).toContain('id="root"');
    expect(content.text).toContain("/mcp/_mcp-use/assets/product-search-result-D2f9a1Kc.js");
    expect(content.text).toContain("/mcp/_mcp-use/assets/product-search-result-B99z1bQd.css");
  });

  it("auto-appends the serving origin to csp.resourceDomains", async () => {
    const { resources } = await uiClient.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    const domains = (
      view?._meta?.["ui"] as { csp?: { resourceDomains?: string[] } } | undefined
    )?.csp?.resourceDomains;
    expect(domains).toContain("https://images.example.com");
    expect(domains?.some((d) => d.includes("localhost"))).toBe(true);
  });

  it("separates view() channels into structuredContent, content, and _meta", async () => {
    const result = await uiClient.callTool({
      name: "search-fruits",
      arguments: { query: "apple" },
    });
    expect(result.structuredContent).toEqual({
      query: "apple",
      items: [{ id: "1", name: "apple" }],
    });
    expect(result.content).toEqual([{ type: "text", text: "Found 1 fruit" }]);
    expect(result._meta).toEqual({ viewOnly: true });
  });

  it("reports ctx.client.supportsViews() per request", async () => {
    const uiResult = await uiClient.callTool({
      name: "supports-views-probe",
      arguments: {},
    });
    expect(uiResult.structuredContent).toEqual({ ui: true });

    const plainResult = await plainClient.callTool({
      name: "supports-views-probe",
      arguments: {},
    });
    expect(plainResult.structuredContent).toEqual({ ui: false });
  });

  it("serves MCP list/read with no assets directory on disk", async () => {
    const assetsDir = join(process.cwd(), ".mcp-use/build/views/assets");
    const hadAssets = existsSync(assetsDir);
    if (hadAssets) {
      rmSync(assetsDir, { recursive: true, force: true });
    }
    try {
      const { tools } = await uiClient.listTools();
      expect(tools.map((t) => t.name)).toContain("search-fruits");
      const read = await uiClient.readResource({
        uri: "ui://views/product-search-result.html",
      });
      expect(read.contents[0]).toMatchObject({
        mimeType: "text/html;profile=mcp-app",
      });
    } finally {
      if (hadAssets) {
        mkdirSync(assetsDir, { recursive: true });
      }
    }
  });
});

describe("views HTTP routes", () => {
  const server = buildViewsServer();
  let baseUrl: string;

  beforeAll(async () => {
    const started = await server.listen(0);
    baseUrl = started.url.replace(/\/mcp$/, "");
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns synthesized HTML from the document route with no-store caching", async () => {
    const response = await fetch(
      `${baseUrl}/mcp/_mcp-use/views/product-search-result.html`,
      {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "fruit-store.fly.dev",
        },
      }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain(
      "https://fruit-store.fly.dev/mcp/_mcp-use/assets/product-search-result-D2f9a1Kc.js"
    );
  });

  it("404s unknown view documents", async () => {
    const response = await fetch(`${baseUrl}/mcp/_mcp-use/views/missing.html`);
    expect(response.status).toBe(404);
  });

  it("serves built assets with immutable cache headers", async () => {
    const assetsDir = join(process.cwd(), ".mcp-use/build/views/assets");
    mkdirSync(assetsDir, { recursive: true });
    const fileName = "test-asset-abc123.js";
    const filePath = join(assetsDir, fileName);
    writeFileSync(filePath, "export {};\n");

    try {
      const response = await fetch(
        `${baseUrl}/mcp/_mcp-use/assets/${fileName}`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable"
      );
      expect(response.headers.get("content-type")).toBe(
        "application/javascript"
      );
      expect(await response.text()).toContain("export");
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("rejects path traversal on the asset route", async () => {
    const response = await fetch(
      `${baseUrl}/mcp/_mcp-use/assets/..%2F..%2Fpackage.json`
    );
    expect(response.status).toBe(404);
  });
});

describe("views binding validation", () => {
  it("throws when a view-bound tool lacks outputSchema at registration", () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    expect(() =>
      server.tool(
        { name: "bad", view: { name: "some-view" } },
        async () => ({ content: [{ type: "text", text: "x" }] })
      )
    ).toThrow(/no outputSchema/);
  });

  it("throws when two tools bind the same view at registration", () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    const schema = z.object({ ok: z.boolean() });
    server.tool(
      { name: "first", outputSchema: schema, view: { name: "shared-view" } },
      async () => view({ props: { ok: true } })
    );
    expect(() =>
      server.tool(
        { name: "second", outputSchema: schema, view: { name: "shared-view" } },
        async () => view({ props: { ok: true } })
      )
    ).toThrow(/already bound/);
  });

  it("throws at mount when a tool binds a missing primed view", async () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server[registerViews]({
      other: { entry: "views/assets/other.js", css: [], metadata: {} },
    });
    server.tool(
      {
        name: "orphan-binding",
        outputSchema: z.object({}),
        view: { name: "missing-view" },
      },
      async () => view({ props: {} })
    );
    await expect(server.listen(0)).rejects.toThrow(
      /not in the primed views registry/
    );
  });

  it("throws at mount when views were never primed but a tool declares view", async () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server.tool(
      {
        name: "unprimed",
        outputSchema: z.object({}),
        view: { name: "any-view" },
      },
      async () => view({ props: {} })
    );
    await expect(server.listen(0)).rejects.toThrow(/no views were primed/);
  });

  it("warns for primed views no tool binds, but still mounts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server[registerViews]({
      "lonely-view": {
        entry: "views/assets/lonely.js",
        css: [],
        metadata: {},
      },
    });
    const { port } = await server.listen(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('View "lonely-view" is registered but no tool binds it')
    );
    warn.mockRestore();
    await server.close();
    expect(port).toBeGreaterThan(0);
  });

  it("throws when priming views twice", () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server[registerViews]({
      a: { entry: "views/assets/a.js", css: [], metadata: {} },
    });
    expect(() =>
      server[registerViews]({
        b: { entry: "views/assets/b.js", css: [], metadata: {} },
      })
    ).toThrow(/already primed/);
  });
});
