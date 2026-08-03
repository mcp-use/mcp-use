import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerInspectorShell } from "../../src/server/inspector-shell.js";

describe("Inspector shell", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the browser bundle from the installed package route", async () => {
    const app = new Hono();
    registerInspectorShell(
      app,
      {
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

  it("enables dev CLI controls only for mcp-use dev", async () => {
    vi.stubEnv("MCP_USE_DEV_CLI", "1");
    const app = new Hono();
    registerInspectorShell(app);

    const response = await app.request("http://localhost/inspector");

    expect(await response.text()).toContain("window.__MCP_DEV_CLI__ = true");
  });
});
