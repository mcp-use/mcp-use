import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { resolveInspectorBundleAssetUrls } from "../../src/server/bundle-assets.js";
import { registerInspectorShell } from "../../src/server/inspector-shell.js";

describe("Inspector shell", () => {
  it("loads the browser bundle from the installed package route", async () => {
    const app = new Hono();
    registerInspectorShell(
      app,
      {
        assetsPath: "/mcp/inspector/assets",
        inspectorMode: "standalone",
      },
      "/mcp"
    );

    const response = await app.request("http://localhost/mcp/inspector");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toMatch(
      /<script type="module" src="\/mcp\/inspector\/assets\/inspector\.js\?v=.+"><\/script>/
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/mcp\/inspector\/assets\/inspector\.css\?v=.+" \/>/
    );
    expect(html).toContain('window.__MCP_INSPECTOR_MODE__ = "standalone"');
  });

  it("versions both application assets from the installed package", () => {
    const assets = resolveInspectorBundleAssetUrls("/inspector/assets");

    expect(assets.jsUrl).toMatch(/^\/inspector\/assets\/inspector\.js\?v=.+$/);
    expect(assets.cssUrl).toMatch(
      /^\/inspector\/assets\/inspector\.css\?v=.+$/
    );
  });
});
