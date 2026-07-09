/**
 * End-to-end tests for the views server core: wire metadata, capability
 * queries, binding validation, document/asset routes, and plain tool results.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews } from "../src/index.js";
import { synthesizeViewDocument } from "../src/views/document.js";

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
      kind: "inline",
      js: 'console.log("product-search-result");',
      css: ".results { color: red; }",
    },
    "orphan-view": {
      kind: "inline",
      js: 'console.log("orphan");',
      css: "",
    },
    "app-only-view": {
      kind: "inline",
      js: 'console.log("app-only");',
      css: "",
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
      inputSchema: z.object({
        query: z.string().optional(),
        fail: z.boolean().optional(),
      }),
      outputSchema: resultsSchema,
      view: {
        name: "product-search-result",
        description: "Product search results grid",
        csp: { resourceDomains: ["https://images.example.com"] },
        permissions: { clipboardWrite: {} },
        domain: "https://views.example.com",
        prefersBorder: true,
      },
    },
    async ({ query = "", fail = false }) => {
      if (fail) {
        return {
          isError: true,
          content: [{ type: "text", text: "search failed" }],
        };
      }
      return {
        structuredContent: { query, items: [{ id: "1", name: "apple" }] },
        content: [{ type: "text", text: "Found 1 fruit" }],
        _meta: { viewOnly: true },
      };
    }
  );

  server.tool(
    {
      name: "app-only-action",
      visibility: "app",
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "app-only-view" },
    },
    async () => ({
      structuredContent: { ok: true },
      content: [{ type: "text", text: "ok" }],
    })
  );

  server.tool(
    {
      name: "app-only-helper",
      visibility: "app",
      inputSchema: z.object({ n: z.number().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
    },
    async () => ({
      structuredContent: { ok: true },
      content: [{ type: "text", text: "helper ok" }],
    })
  );

  server.tool(
    {
      name: "supports-views-probe",
      outputSchema: z.object({ ui: z.boolean() }),
    },
    async (_params, ctx) => ({
      structuredContent: { ui: ctx.client.supportsViews() },
      content: [{ type: "text", text: String(ctx.client.supportsViews()) }],
    })
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

  it("emits ui meta on tools/list for view-bound tools", async () => {
    const { tools } = await uiClient.listTools();
    const search = tools.find((t) => t.name === "search-fruits");
    expect(search?._meta).toMatchObject({
      ui: { resourceUri: "ui://views/product-search-result.html" },
      "ui/resourceUri": "ui://views/product-search-result.html",
    });
    expect(search?._meta?.["ui"]).not.toHaveProperty("visibility");
  });

  it("emits ui meta on tools/list for plain clients too", async () => {
    const { tools } = await plainClient.listTools();
    const search = tools.find((t) => t.name === "search-fruits");
    expect(search?._meta).toMatchObject({
      ui: { resourceUri: "ui://views/product-search-result.html" },
      "ui/resourceUri": "ui://views/product-search-result.html",
    });
  });

  it("lists visibility:app tools for plain clients with ui.visibility", async () => {
    const { tools } = await plainClient.listTools();
    const appOnly = tools.find((t) => t.name === "app-only-action");
    expect(appOnly).toBeDefined();
    expect(appOnly?._meta?.["ui"]).toMatchObject({
      visibility: ["app"],
      resourceUri: "ui://views/app-only-view.html",
    });
  });

  it("emits ui.visibility without resourceUri for view-less visibility:app tools", async () => {
    const { tools } = await plainClient.listTools();
    const helper = tools.find((t) => t.name === "app-only-helper");
    expect(helper).toBeDefined();
    expect(helper?._meta).toEqual({
      ui: { visibility: ["app"] },
    });
    expect(helper?._meta).not.toHaveProperty("ui/resourceUri");

    const result = await plainClient.callTool({
      name: "app-only-helper",
      arguments: {},
    });
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it("emits no _meta.ui keys for tools with neither view nor visibility", async () => {
    const { tools } = await plainClient.listTools();
    const plain = tools.find((t) => t.name === "plain-tool");
    expect(plain).toBeDefined();
    expect(plain?._meta?.["ui"]).toBeUndefined();
    expect(plain?._meta?.["ui/resourceUri"]).toBeUndefined();
  });

  it("lists view resources with mimetype, description, and author _meta.ui", async () => {
    const { resources } = await uiClient.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    expect(view?.description).toBe("Product search results grid");
    expect(view?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [
          "https://images.example.com",
          expect.stringMatching(/^https?:\/\//),
        ],
      },
      permissions: { clipboardWrite: {} },
      domain: "https://views.example.com",
      prefersBorder: true,
    });
  });

  it("emits ui meta on resources/list for plain clients too", async () => {
    const { resources } = await plainClient.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    expect(view?.description).toBe("Product search results grid");
    expect(view?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [
          "https://images.example.com",
          expect.stringMatching(/^https?:\/\//),
        ],
      },
      permissions: { clipboardWrite: {} },
      domain: "https://views.example.com",
      prefersBorder: true,
    });
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
    expect(content.text).toContain('console.log("product-search-result");');
    expect(content.text).toContain("<style>.results { color: red; }</style>");
    expect(content.text).not.toMatch(/<script[^>]+src=/);
    expect(content.text).toContain("/mcp/_mcp-use/public/");
    expect(content._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [
          "https://images.example.com",
          expect.stringMatching(/^https?:\/\//),
        ],
      },
      permissions: { clipboardWrite: {} },
      domain: "https://views.example.com",
      prefersBorder: true,
    });
  });

  it("emits ui meta on resources/read content items for plain clients too", async () => {
    const read = await plainClient.readResource({
      uri: "ui://views/product-search-result.html",
    });
    const content = read.contents[0];
    expect(content?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [
          "https://images.example.com",
          expect.stringMatching(/^https?:\/\//),
        ],
      },
      permissions: { clipboardWrite: {} },
      domain: "https://views.example.com",
      prefersBorder: true,
    });
  });

  it("auto-appends the serving origin to csp.resourceDomains on resources/read", async () => {
    const read = await uiClient.readResource({
      uri: "ui://views/product-search-result.html",
    });
    const domains = (
      read.contents[0]?._meta?.["ui"] as
        | { csp?: { resourceDomains?: string[] } }
        | undefined
    )?.csp?.resourceDomains;
    expect(domains).toContain("https://images.example.com");
    expect(domains?.some((d) => d.includes("localhost"))).toBe(true);
  });

  it("omits unset resource facts from resources/read content _meta.ui", async () => {
    const read = await plainClient.readResource({
      uri: "ui://views/app-only-view.html",
    });
    const ui = read.contents[0]?._meta?.["ui"] as
      | Record<string, unknown>
      | undefined;
    expect(ui).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [expect.stringMatching(/^https?:\/\//)],
      },
    });
    expect(ui).not.toHaveProperty("permissions");
    expect(ui).not.toHaveProperty("domain");
    expect(ui).not.toHaveProperty("prefersBorder");
  });

  it("emits auto CSP only for unbound views on resources/read", async () => {
    const read = await uiClient.readResource({
      uri: "ui://views/orphan-view.html",
    });
    expect(read.contents[0]?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [expect.stringMatching(/^https?:\/\//)],
      },
    });
    const ui = read.contents[0]?._meta?.["ui"] as
      | Record<string, unknown>
      | undefined;
    expect(ui).not.toHaveProperty("permissions");
    expect(ui).not.toHaveProperty("domain");
    expect(ui).not.toHaveProperty("prefersBorder");
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

  it("omits unset resource facts from _meta.ui", async () => {
    const { resources } = await uiClient.listResources();
    const appOnly = resources.find(
      (r) => r.uri === "ui://views/app-only-view.html"
    );
    expect(appOnly?.description).toBeUndefined();
    const ui = appOnly?._meta?.["ui"] as Record<string, unknown> | undefined;
    expect(ui).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [expect.stringMatching(/^https?:\/\//)],
      },
    });
    expect(ui).not.toHaveProperty("permissions");
    expect(ui).not.toHaveProperty("domain");
    expect(ui).not.toHaveProperty("prefersBorder");
  });

  it("emits auto CSP only for unbound views", async () => {
    const { resources } = await uiClient.listResources();
    const orphan = resources.find(
      (r) => r.uri === "ui://views/orphan-view.html"
    );
    expect(orphan?.description).toBeUndefined();
    expect(orphan?._meta?.["ui"]).toMatchObject({
      csp: {
        connectDomains: [],
        resourceDomains: [expect.stringMatching(/^https?:\/\//)],
      },
    });
    const ui = orphan?._meta?.["ui"] as Record<string, unknown> | undefined;
    expect(ui).not.toHaveProperty("permissions");
    expect(ui).not.toHaveProperty("domain");
    expect(ui).not.toHaveProperty("prefersBorder");
  });

  it("separates structuredContent, content, and handler _meta on tool results", async () => {
    const result = await uiClient.callTool({
      name: "search-fruits",
      arguments: { query: "apple" },
    });
    expect(result.structuredContent).toEqual({
      query: "apple",
      items: [{ id: "1", name: "apple" }],
    });
    expect(result.content).toEqual([{ type: "text", text: "Found 1 fruit" }]);
    expect(result._meta).toEqual({
      viewOnly: true,
      "mcp-use/toolName": "search-fruits",
      ui: { resourceUri: "ui://views/product-search-result.html" },
      "ui/resourceUri": "ui://views/product-search-result.html",
    });
  });

  it("stamps ui resourceUri wire keys on view-bound tool results", async () => {
    const result = await uiClient.callTool({
      name: "search-fruits",
      arguments: { query: "pear" },
    });
    expect(result._meta?.["ui"]).toMatchObject({
      resourceUri: "ui://views/product-search-result.html",
    });
    expect(result._meta?.["ui/resourceUri"]).toBe(
      "ui://views/product-search-result.html"
    );
    expect(result._meta?.["mcp-use/toolName"]).toBe("search-fruits");
    expect(result._meta).toMatchObject({ viewOnly: true });
  });

  it("stamps ui wire keys on view-bound tool results for plain clients too", async () => {
    const result = await plainClient.callTool({
      name: "search-fruits",
      arguments: { query: "pear" },
    });
    expect(result._meta?.["ui"]).toMatchObject({
      resourceUri: "ui://views/product-search-result.html",
    });
    expect(result._meta?.["ui/resourceUri"]).toBe(
      "ui://views/product-search-result.html"
    );
    expect(result._meta?.["mcp-use/toolName"]).toBe("search-fruits");
    expect(result._meta).toMatchObject({ viewOnly: true });
  });

  it("does not stamp ui wire keys on error results from view-bound tools", async () => {
    const result = await uiClient.callTool({
      name: "search-fruits",
      arguments: { fail: true },
    });
    expect(result.isError).toBe(true);
    expect(result._meta?.["ui"]).toBeUndefined();
    expect(result._meta?.["ui/resourceUri"]).toBeUndefined();
    expect(result._meta?.["mcp-use/toolName"]).toBeUndefined();
  });

  it("omits ui.visibility on view-bound tool results", async () => {
    const result = await uiClient.callTool({
      name: "app-only-action",
      arguments: {},
    });
    expect(result._meta?.["ui"]).toMatchObject({
      resourceUri: "ui://views/app-only-view.html",
    });
    expect(result._meta?.["ui"]).not.toHaveProperty("visibility");
    expect(result._meta?.["mcp-use/toolName"]).toBe("app-only-action");
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
      "https://fruit-store.fly.dev/mcp/_mcp-use/public/"
    );
    expect(html).toContain('console.log("product-search-result");');
    expect(html).not.toMatch(/<script[^>]+src=/);
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

  /** Raw GET with unsanitized headers (fetch() sanitizes Origin). */
  async function rawGetStatus(
    target: string,
    headers: Record<string, string> = {}
  ): Promise<number> {
    const { request } = await import("node:http");
    const url = new URL(target);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "GET",
          headers,
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  /** Raw GET resolving status and response headers. */
  async function rawGet(
    target: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders }> {
    const { request } = await import("node:http");
    const url = new URL(target);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "GET",
          headers,
        },
        (res) => {
          res.resume();
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers })
          );
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("allows GET asset and view requests with Origin: null", async () => {
    const assetsDir = join(process.cwd(), ".mcp-use/build/views/assets");
    mkdirSync(assetsDir, { recursive: true });
    const fileName = "origin-null-abc123.js";
    const filePath = join(assetsDir, fileName);
    writeFileSync(filePath, "export {};\n");

    try {
      expect(
        await rawGetStatus(`${baseUrl}/mcp/_mcp-use/assets/${fileName}`, {
          origin: "null",
        })
      ).toBe(200);
      expect(
        await rawGetStatus(
          `${baseUrl}/mcp/_mcp-use/views/product-search-result.html`,
          { origin: "null" }
        )
      ).toBe(200);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("allows GET asset requests with an external Origin", async () => {
    const assetsDir = join(process.cwd(), ".mcp-use/build/views/assets");
    mkdirSync(assetsDir, { recursive: true });
    const fileName = "external-origin-abc123.js";
    const filePath = join(assetsDir, fileName);
    writeFileSync(filePath, "export {};\n");

    try {
      expect(
        await rawGetStatus(`${baseUrl}/mcp/_mcp-use/assets/${fileName}`, {
          origin: "https://claude.ai",
        })
      ).toBe(200);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("emits Access-Control-Allow-Origin: * on asset and public responses", async () => {
    const assetsDir = join(process.cwd(), ".mcp-use/build/views/assets");
    const publicDir = join(process.cwd(), ".mcp-use/build/views/public");
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    const fileName = "cors-asset-abc123.js";
    const assetPath = join(assetsDir, fileName);
    const publicPath = join(publicDir, "cors-fixture.txt");
    writeFileSync(assetPath, "export {};\n");
    writeFileSync(publicPath, "cors-fixture\n");

    try {
      const asset = await rawGet(`${baseUrl}/mcp/_mcp-use/assets/${fileName}`);
      expect(asset.status).toBe(200);
      expect(asset.headers["access-control-allow-origin"]).toBe("*");

      const publicFile = await rawGet(
        `${baseUrl}/mcp/_mcp-use/public/cors-fixture.txt`
      );
      expect(publicFile.status).toBe(200);
      expect(publicFile.headers["access-control-allow-origin"]).toBe("*");
    } finally {
      rmSync(assetPath, { force: true });
      rmSync(publicPath, { force: true });
    }
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

  it("allows multiple tools to bind the same view", async () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    const schema = z.object({ ok: z.boolean(), which: z.string() });
    server[registerViews]({
      "shared-view": { kind: "inline", js: "export {};", css: "" },
    });
    server.tool(
      {
        name: "first",
        outputSchema: schema,
        view: { name: "shared-view", description: "Shared view" },
      },
      async () => ({
        structuredContent: { ok: true, which: "first" },
        content: [{ type: "text", text: "first" }],
      })
    );
    server.tool(
      { name: "second", outputSchema: schema, view: { name: "shared-view" } },
      async () => ({
        structuredContent: { ok: true, which: "second" },
        content: [{ type: "text", text: "second" }],
      })
    );

    const { url } = await server.listen(0);
    const client = new Client(
      { name: "multi-bind", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const { tools } = await client.listTools();
      const first = tools.find((t) => t.name === "first");
      const second = tools.find((t) => t.name === "second");
      expect(first?._meta?.["ui"]).toMatchObject({
        resourceUri: "ui://views/shared-view.html",
      });
      expect(second?._meta?.["ui"]).toMatchObject({
        resourceUri: "ui://views/shared-view.html",
      });

      const firstResult = await client.callTool({
        name: "first",
        arguments: {},
      });
      expect(firstResult._meta?.["mcp-use/toolName"]).toBe("first");
      expect(firstResult._meta?.["ui"]).toMatchObject({
        resourceUri: "ui://views/shared-view.html",
      });

      const secondResult = await client.callTool({
        name: "second",
        arguments: {},
      });
      expect(secondResult._meta?.["mcp-use/toolName"]).toBe("second");
      expect(secondResult._meta?.["ui"]).toMatchObject({
        resourceUri: "ui://views/shared-view.html",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("throws when two tools declare resource facts for the same view", () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    const schema = z.object({ ok: z.boolean() });
    server.tool(
      {
        name: "first",
        outputSchema: schema,
        view: { name: "shared-view", description: "from first" },
      },
      async () => ({
        structuredContent: { ok: true },
        content: [{ type: "text", text: "ok" }],
      })
    );
    expect(() =>
      server.tool(
        {
          name: "second",
          outputSchema: schema,
          view: { name: "shared-view", description: "from second" },
        },
        async () => ({
          structuredContent: { ok: true },
          content: [{ type: "text", text: "ok" }],
        })
      )
    ).toThrow(/already has resource facts/);
  });

  it("uses resource facts from the facts-declaring binder regardless of order", async () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    const schema = z.object({ ok: z.boolean() });
    server[registerViews]({
      "shared-view": { kind: "inline", js: "export {};", css: "" },
    });
    server.tool(
      { name: "name-only", outputSchema: schema, view: { name: "shared-view" } },
      async () => ({
        structuredContent: { ok: true },
        content: [{ type: "text", text: "ok" }],
      })
    );
    server.tool(
      {
        name: "facts-owner",
        outputSchema: schema,
        view: {
          name: "shared-view",
          description: "Facts from second binder",
        },
      },
      async () => ({
        structuredContent: { ok: true },
        content: [{ type: "text", text: "ok" }],
      })
    );

    const { url } = await server.listen(0);
    const client = new Client(
      { name: "facts-order", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const { resources } = await client.listResources();
      const view = resources.find(
        (r) => r.uri === "ui://views/shared-view.html"
      );
      expect(view?.description).toBe("Facts from second binder");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("throws at mount when a tool binds a missing primed view", async () => {
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server[registerViews]({
      other: { kind: "inline", js: "export {};", css: "" },
    });
    server.tool(
      {
        name: "orphan-binding",
        outputSchema: z.object({}),
        view: { name: "missing-view" },
      },
      async () => ({
        structuredContent: {},
        content: [{ type: "text", text: "ok" }],
      })
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
      async () => ({
        structuredContent: {},
        content: [{ type: "text", text: "ok" }],
      })
    );
    await expect(server.listen(0)).rejects.toThrow(/no views were primed/);
  });

  it("warns for primed views no tool binds, but still mounts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new MCPServer({ name: "bind", version: "0.0.0" });
    server[registerViews]({
      "lonely-view": {
        kind: "inline",
        js: "export {};",
        css: "",
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
      a: { kind: "inline", js: "export {};", css: "" },
    });
    expect(() =>
      server[registerViews]({
        b: { kind: "inline", js: "export {};", css: "" },
      })
    ).toThrow(/already primed/);
  });
});

describe("views document synthesis", () => {
  it("inlines JS/CSS for production entries without external asset script tags", () => {
    const html = synthesizeViewDocument(
      {
        kind: "inline",
        js: 'console.log("hello");',
        css: "body{color:red}",
      },
      "https://example.com",
      "/mcp"
    );
    expect(html).toContain('<script type="module">console.log("hello");</script>');
    expect(html).toContain("<style>body{color:red}</style>");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).toContain("__mcpUseViewConfig");
  });

  it("escapes </script> inside inlined module source so the document does not terminate early", () => {
    const html = synthesizeViewDocument(
      {
        kind: "inline",
        js: 'const s = "</script>"; console.log(s);',
        css: "",
      },
      "https://example.com",
      "/mcp"
    );
    // Raw `</script>` must not appear inside the module body (would close the tag).
    const moduleMatch = html.match(
      /<script type="module">([\s\S]*?)<\/script>\s*<\/body>/
    );
    expect(moduleMatch).not.toBeNull();
    const body = moduleMatch![1]!;
    expect(body).not.toContain("</script>");
    expect(body).toContain("<\\/script>");
    expect(html).toContain('const s = "<\\/script>";');
  });

  it("keeps external script/link tags for dev entries", () => {
    const html = synthesizeViewDocument(
      {
        kind: "external",
        entry: "/@id/__x00__virtual:mcp-use/views/demo",
        css: [],
        scripts: ["/@vite/client"],
      },
      "http://localhost:3000",
      "/mcp"
    );
    expect(html).toContain(
      'src="http://localhost:3000/@id/__x00__virtual:mcp-use/views/demo"'
    );
    expect(html).toContain('src="http://localhost:3000/@vite/client"');
  });
});

describe("views dev CSP (e2e over HTTP)", () => {
  const server = new MCPServer({
    name: "views-dev-csp-test",
    version: "1.0.0",
    basePath: "/mcp",
  });

  server[registerViews](
    {
      "product-search-result": {
        kind: "external",
        entry: "/@id/__x00__virtual:mcp-use/views/product-search-result",
        css: [],
        scripts: ["/@vite/client"],
      },
    },
    { dev: true }
  );

  server.tool(
    {
      name: "search-fruits",
      inputSchema: z.object({ query: z.string().optional() }),
      outputSchema: resultsSchema,
      view: {
        name: "product-search-result",
        csp: {
          resourceDomains: ["https://images.example.com"],
          connectDomains: ["https://api.example.com"],
        },
      },
    },
    async ({ query = "" }) => ({
      structuredContent: { query, items: [{ id: "1", name: "apple" }] },
      content: [{ type: "text", text: "Found 1 fruit" }],
    })
  );

  let url: string;
  let client: Client;

  beforeAll(async () => {
    const started = await server.listen(0);
    url = started.url;

    client = new Client(
      { name: "dev-csp-client", version: "1.0.0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        capabilities: UI_CAPABILITIES,
      }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("appends the HMR websocket origin to csp.connectDomains on resources/list", async () => {
    const { resources } = await client.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    const connectDomains = (
      view?._meta?.["ui"] as { csp?: { connectDomains?: string[] } } | undefined
    )?.csp?.connectDomains;
    expect(connectDomains).toContain("https://api.example.com");
    expect(connectDomains?.some((d) => d.startsWith("ws://"))).toBe(true);
    expect(connectDomains?.some((d) => d.includes("localhost"))).toBe(true);
  });

  it("appends the HMR websocket origin to csp.connectDomains on resources/read", async () => {
    const read = await client.readResource({
      uri: "ui://views/product-search-result.html",
    });
    const connectDomains = (
      read.contents[0]?._meta?.["ui"] as
        | { csp?: { connectDomains?: string[] } }
        | undefined
    )?.csp?.connectDomains;
    expect(connectDomains).toContain("https://api.example.com");
    expect(connectDomains?.some((d) => d.startsWith("ws://"))).toBe(true);
    expect(connectDomains?.some((d) => d.includes("localhost"))).toBe(true);
  });
});

describe("views prod CSP (e2e over HTTP)", () => {
  it("does not append an HMR websocket origin when not dev-primed", async () => {
    const server = new MCPServer({
      name: "views-prod-csp-test",
      version: "1.0.0",
      basePath: "/mcp",
    });

    server[registerViews]({
      "product-search-result": {
        kind: "inline",
        js: 'console.log("prod");',
        css: "",
      },
    });

    server.tool(
      {
        name: "search-fruits",
        inputSchema: z.object({ query: z.string().optional() }),
        outputSchema: resultsSchema,
        view: {
          name: "product-search-result",
          csp: { connectDomains: ["https://api.example.com"] },
        },
      },
      async ({ query = "" }) => ({
        structuredContent: { query, items: [] },
        content: [{ type: "text", text: "ok" }],
      })
    );

    const started = await server.listen(0);
    const client = new Client(
      { name: "prod-csp-client", version: "1.0.0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        capabilities: UI_CAPABILITIES,
      }
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );

    const { resources } = await client.listResources();
    const view = resources.find(
      (r) => r.uri === "ui://views/product-search-result.html"
    );
    const connectDomains = (
      view?._meta?.["ui"] as { csp?: { connectDomains?: string[] } } | undefined
    )?.csp?.connectDomains;
    expect(connectDomains).toEqual(["https://api.example.com"]);

    await client.close();
    await server.close();
  });
});
