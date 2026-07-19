/**
 * Tests for the inspector CDN shell route: default-enabled mounting at
 * `${basePath}/inspector`, the `inspector` config forms (`{ enabled: false }`,
 * `{ assetsUrl }`), script-injection escaping, and coexistence with the MCP
 * endpoint — driven through `getHandler()`, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import type { ServerConfig } from "../src/index.js";

const DEFAULT_CDN_SCRIPT_RE =
  /<script type="module" src="https:\/\/cdn\.jsdelivr\.net\/npm\/@mcp-use\/inspector@beta\/dist\/cdn\/inspector\.js\?cb=[0-9a-f-]{36}">/;

const DEFAULT_CDN_STYLES_RE =
  /<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@mcp-use\/inspector@beta\/dist\/cdn\/inspector\.css\?cb=[0-9a-f-]{36}" \/>/;

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeServer(config: Partial<ServerConfig> = {}): MCPServer {
  const server = new MCPServer({
    name: "shell-test",
    version: "1.0.0",
    ...config,
  });
  server.tool({ name: "ping" }, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  return server;
}

/** GET the given path through the server's web-standard handler. */
async function get(
  server: MCPServer,
  path: string,
  method = "GET"
): Promise<Response> {
  return server.getHandler()(
    new Request(`http://localhost${path}`, { method })
  );
}

/** Synthetic 2026-07-28 tools/list request against the MCP endpoint. */
function toolsListRequest(basePath: string): Request {
  return new Request(`http://localhost${basePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "raw-request",
            version: "0.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

describe("inspector shell route", () => {
  it("serves the CDN shell at basePath + /inspector by default", async () => {
    const server = makeServer();
    const response = await get(server, "/mcp/inspector");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^text\/html;\s*charset=utf-8$/i
    );

    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    // The bundle loads from the public CDN with a per-request cache-bust param.
    expect(html).toMatch(DEFAULT_CDN_SCRIPT_RE);
    expect(html).toMatch(DEFAULT_CDN_STYLES_RE);
    // Serialized runtime config: basePath from the server, autoConnectUrl
    // derived client-side from the page's own origin (no host guessing).
    expect(html).toContain("window.__MCP_USE_INSPECTOR__");
    expect(html).not.toContain("__MCP_DEV_CLI__");
    expect(html).toContain('var basePath = "/mcp";');
    expect(html).toContain("window.location.origin + basePath");
    // Browser polyfill for the bundle's Node-flavored module-scope code.
    expect(html).toContain("window.process = {");
    // Root node for the bundle to mount into, with the inspector's neutral
    // background applied before the UI paints and a boot spinner placeholder.
    expect(html).toContain('<div id="root">');
    expect(html).toContain('class="mcp-boot"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Connecting to MCP server...");
    expect(html).toContain("background-color: #f3f3f3");
    // The server name appears (escaped) in the title.
    expect(html).toContain("<title>shell-test — MCP Inspector</title>");
    await server.close();
  });

  it("serves the trailing-slash variant and answers HEAD", async () => {
    const server = makeServer();
    const withSlash = await get(server, "/mcp/inspector/");
    expect(withSlash.status).toBe(200);
    expect(await withSlash.text()).toContain("window.__MCP_USE_INSPECTOR__");

    // Hono answers HEAD from the GET handler with an empty body.
    const head = await get(server, "/mcp/inspector", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toMatch(/text\/html/i);
    expect(await head.text()).toBe("");
    await server.close();
  });

  it("treats {} and { enabled: true } the same as the default (enabled)", async () => {
    for (const inspector of [{}, { enabled: true }] as const) {
      const server = makeServer({ inspector });
      const response = await get(server, "/mcp/inspector");
      expect(response.status).toBe(200);
      expect(await response.text()).toMatch(DEFAULT_CDN_SCRIPT_RE);
      await server.close();
    }
  });

  it("uses a fresh cache-bust param on each shell response", async () => {
    const server = makeServer();
    const html1 = await (await get(server, "/mcp/inspector")).text();
    const html2 = await (await get(server, "/mcp/inspector")).text();
    const match1 = html1.match(/inspector\.js\?cb=([0-9a-f-]{36})/);
    const match2 = html2.match(/inspector\.js\?cb=([0-9a-f-]{36})/);
    expect(match1).not.toBeNull();
    expect(match2).not.toBeNull();
    expect(match1![1]).not.toBe(match2![1]);
    await server.close();
  });

  it("does not cache-bust custom or local asset URLs", async () => {
    vi.stubEnv(
      "MCP_USE_INSPECTOR_ASSETS_URL",
      "http://127.0.0.1:4173/inspector.js"
    );
    const server = makeServer();
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).not.toContain("cb=");
    await server.close();
  });

  it("returns 404 when the inspector is disabled", async () => {
    const server = makeServer({ inspector: { enabled: false } });
    expect((await get(server, "/mcp/inspector")).status).toBe(404);
    expect((await get(server, "/mcp/inspector/")).status).toBe(404);
    // The MCP endpoint itself is unaffected.
    const mcp = await server.getHandler()(toolsListRequest("/mcp"));
    expect(mcp.status).toBe(200);
    await server.close();
  });

  it("follows a custom basePath", async () => {
    const server = makeServer({ basePath: "/api/mcp" });
    const response = await get(server, "/api/mcp/inspector");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('var basePath = "/api/mcp";');
    // Not mounted at the default location.
    expect((await get(server, "/mcp/inspector")).status).toBe(404);
    await server.close();
  });

  it("loads the bundle from assetsUrl when provided", async () => {
    const assetsUrl = "https://intranet.example.com/vendor/inspector.js";
    const server = makeServer({ inspector: { assetsUrl } });
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).toContain(`<script type="module" src="${assetsUrl}">`);
    // The stylesheet follows the custom bundle URL too.
    expect(html).toContain(
      '<link rel="stylesheet" href="https://intranet.example.com/vendor/inspector.css" />'
    );
    // The default CDN URL is fully replaced, not merely preferred.
    expect(html).not.toContain("cdn.jsdelivr.net");
    await server.close();
  });

  it("supports a local assets URL through the environment", async () => {
    vi.stubEnv(
      "MCP_USE_INSPECTOR_ASSETS_URL",
      "http://127.0.0.1:4173/inspector.js"
    );
    const server = makeServer();
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).toContain(
      '<script type="module" src="http://127.0.0.1:4173/inspector.js">'
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="http://127.0.0.1:4173/inspector.css" />'
    );
    await server.close();
  });

  it("prefers configured assetsUrl over the environment", async () => {
    vi.stubEnv(
      "MCP_USE_INSPECTOR_ASSETS_URL",
      "http://127.0.0.1:4173/inspector.js"
    );
    const server = makeServer({
      inspector: { assetsUrl: "https://configured.example/inspector.js" },
    });
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).toContain("https://configured.example/inspector.js");
    expect(html).not.toContain("127.0.0.1:4173");
    await server.close();
  });

  it("never emits user-provided values with an unescaped <", async () => {
    const server = makeServer({
      name: 'evil</title><script>alert("pwned")</script>',
      inspector: { assetsUrl: 'https://x.test/a.js"></script><script>hack()' },
    });
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).not.toContain("</title><script>");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<script>hack");
    expect(html).toContain("evil&lt;/title&gt;");
    await server.close();
  });

  it("serves the SPA shell for client-side routes like Manufact auth callback", async () => {
    const server = makeServer();
    const response = await get(
      server,
      "/mcp/inspector/auth/callback?code=test&state=abc"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/i);
    expect(await response.text()).toContain("window.__MCP_USE_INSPECTOR__");
    await server.close();
  });

  it("does not capture inspector API paths", async () => {
    const server = makeServer();
    expect((await get(server, "/mcp/inspector/api/dev/info")).status).toBe(404);
    await server.close();
  });

  it("injects __MCP_DEV_CLI__ only when MCP_USE_DEV_CLI is set", async () => {
    vi.stubEnv("MCP_USE_DEV_CLI", "1");
    const server = makeServer();
    const html = await (await get(server, "/mcp/inspector")).text();
    expect(html).toContain("window.__MCP_DEV_CLI__ = true;");
    await server.close();
  });

  it("keeps the MCP endpoint working with the shell enabled", async () => {
    const server = makeServer();
    const handler = server.getHandler();
    const response = await handler(toolsListRequest("/mcp"));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      result: { tools: [{ name: "ping" }] },
    });
    // And the shell is live on the same handler.
    const shell = await handler(new Request("http://localhost/mcp/inspector"));
    expect(shell.status).toBe(200);
    await server.close();
  });
});
