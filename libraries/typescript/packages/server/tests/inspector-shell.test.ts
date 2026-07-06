/**
 * Tests for the inspector CDN shell route: default-enabled mounting at
 * `${basePath}/inspector`, the `inspector` config forms (`false`,
 * `{ assetsUrl }`), script-injection escaping, and coexistence with the MCP
 * endpoint — driven through `getHandler()`, no network.
 */
import { describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import type { ServerConfig } from "../src/index.js";

const DEFAULT_CDN_URL =
  "https://pub-5337e54ad50f432cab3e646138da1efc.r2.dev/inspector@11.0.0.js";

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
    // The bundle loads from the version-pinned public CDN, together with its
    // companion stylesheet (same basename, .css suffix).
    expect(html).toContain(`<script type="module" src="${DEFAULT_CDN_URL}">`);
    expect(html).toContain(
      `<link rel="stylesheet" href="${DEFAULT_CDN_URL.replace(/\.js$/, ".css")}" />`
    );
    // Serialized runtime config: basePath from the server, autoConnectUrl
    // derived client-side from the page's own origin (no host guessing).
    expect(html).toContain("window.__MCP_USE_INSPECTOR__");
    expect(html).toContain('var basePath = "/mcp";');
    expect(html).toContain("window.location.origin + basePath");
    // Browser polyfill for the bundle's Node-flavored module-scope code.
    expect(html).toContain("window.process = {");
    // Root node for the bundle to mount into, and a dark background so the
    // page doesn't flash white before the UI paints.
    expect(html).toContain('<div id="root">');
    expect(html).toContain("background-color: #0c0c0d");
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

  it("treats true and {} the same as the default (enabled)", async () => {
    for (const inspector of [true, {}] as const) {
      const server = makeServer({ inspector });
      const response = await get(server, "/mcp/inspector");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(DEFAULT_CDN_URL);
      await server.close();
    }
  });

  it("returns 404 when inspector is false", async () => {
    const server = makeServer({ inspector: false });
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
    expect(html).not.toContain("r2.dev");
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
