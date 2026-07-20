import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveInspectorAssetUrls } from "../../src/server/asset-urls.js";
import { registerInspectorCdnShell } from "../../src/server/cdn-shell.js";

const VERSION_RESOLVER_URL =
  "https://data.jsdelivr.com/v1/packages/npm/@mcp-use/inspector/resolved?specifier=beta";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function inspectorShell(
  inspectorMode: "embedded" | "standalone" = "embedded"
): Promise<string> {
  const app = new Hono();
  registerInspectorCdnShell(app, { inspectorMode }, "/mcp");
  const response = await app.request("http://localhost/mcp/inspector");
  expect(response.status).toBe(200);
  return response.text();
}

describe("inspector CDN shell", () => {
  it("resolves the beta tag once before loading immutable CDN assets", async () => {
    const html = await inspectorShell();

    expect(html).toContain(`const resolverUrl = "${VERSION_RESOLVER_URL}"`);
    expect(html).toContain("const controller = new AbortController()");
    expect(html).toContain("setTimeout(() => controller.abort(), 10_000)");
    expect(html).toContain("fetch(resolverUrl, { signal: controller.signal })");
    expect(html).toContain("clearTimeout(timeout)");
    expect(html).toContain('resolved?.name !== "@mcp-use/inspector"');
    expect(html).toMatch(
      /const assetBase = `\$\{packageUrl\}@\$\{version\}\/dist\/cdn`;/
    );
    expect(html).toMatch(
      /stylesheet\.href = `\$\{assetBase\}\/inspector\.css`;/
    );
    expect(html).toMatch(/await import\(`\$\{assetBase\}\/inspector\.js`\);/);
    expect(html).not.toContain("?cb=");
  });

  it("loads an environment override directly without resolving beta", async () => {
    vi.stubEnv(
      "MCP_USE_INSPECTOR_ASSETS_URL",
      "http://127.0.0.1:4173/inspector.js"
    );

    const html = await inspectorShell();

    expect(html).toContain(
      '<script type="module" src="http://127.0.0.1:4173/inspector.js">'
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="http://127.0.0.1:4173/inspector.css" />'
    );
    expect(html).not.toContain(VERSION_RESOLVER_URL);
  });

  it("keeps standalone assets local without resolving beta", () => {
    expect(resolveInspectorAssetUrls("standalone", "/mcp")).toEqual({
      jsUrl: "/mcp/dist/cdn/inspector.js",
      cssUrl: "/mcp/dist/cdn/inspector.css",
      useLocal: true,
      resolveLatest: false,
    });
  });
});
