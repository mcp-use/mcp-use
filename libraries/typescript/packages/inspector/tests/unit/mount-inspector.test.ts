import express from "express";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountInspector } from "../../src/server/index.js";

describe("mountInspector", () => {
  it("returns a Fetch handler with a fully local, prefix-scoped Inspector", async () => {
    const inspector = mountInspector({
      basePath: "//tools//mcp/",
      autoConnectUrl: "http://localhost:3000/tools/mcp",
    });

    const shell = await inspector(
      new Request("http://localhost/tools/mcp/inspector")
    );
    const html = await shell.text();

    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-type")).toContain("text/html");
    expect(html).toMatch(/\/tools\/mcp\/inspector\/assets\/inspector\.js\?v=/);
    expect(html).toMatch(/\/tools\/mcp\/inspector\/assets\/inspector\.css\?v=/);
    expect(html).toContain(
      'href="/tools/mcp/inspector/assets/favicon-black.svg?v='
    );
    expect(html).toContain(
      'window.__MCP_PROXY_URL__ = "/tools/mcp/inspector/api/proxy"'
    );
    expect(html).toContain("window.__MCP_DEV_MODE__ = true");

    const config = await inspector(
      new Request("http://localhost/tools/mcp/inspector/config.json")
    );
    expect(await config.json()).toEqual({
      autoConnectUrl: "http://localhost:3000/tools/mcp",
    });

    const health = await inspector(
      new Request("http://localhost/tools/mcp/inspector/health")
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const proxy = await inspector(
      new Request("http://localhost/tools/mcp/inspector/api/proxy", {
        method: "POST",
      })
    );
    expect(proxy.status).toBe(400);
    expect(await proxy.json()).toMatchObject({
      error: "X-Target-URL header is required",
    });

    const oauthMetadata = await inspector(
      new Request("http://localhost/tools/mcp/inspector/api/oauth/metadata")
    );
    expect(oauthMetadata.status).toBe(400);
    expect(await oauthMetadata.json()).toHaveProperty("error");

    const stylesheet = await inspector(
      new Request("http://localhost/tools/mcp/inspector/assets/inspector.css")
    );
    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get("content-type")).toBe("text/css");
    expect(stylesheet.headers.get("cache-control")).toBe("no-cache");

    for (const pathname of [
      "/tools/mcp",
      "/tools/mcp/favicon-black.svg",
      "/tools/mcp/dist/app/inspector.js",
      "/unrelated",
    ]) {
      const response = await inspector(
        new Request(`http://localhost${pathname}`)
      );
      expect(response.status, pathname).toBe(404);
    }
  });

  it("can still register routes directly on a Hono app", async () => {
    const app = new Hono();
    app.get("/application", (c) => c.text("application route"));

    mountInspector(app, {
      basePath: "/custom",
      autoConnectUrl: null,
      oauthProxyAllowLoopback: false,
    });

    expect((await app.request("http://localhost/application")).status).toBe(
      200
    );
    expect(
      (await app.request("http://localhost/custom/inspector")).status
    ).toBe(200);
    expect(
      (
        await app.request(
          "http://localhost/custom/inspector/assets/inspector.css"
        )
      ).status
    ).toBe(200);
    expect(
      await (
        await app.request("http://localhost/custom/inspector/config.json")
      ).json()
    ).toEqual({ autoConnectUrl: null });
  });

  it("does not claim the application root when the MCP base path is empty", async () => {
    const inspector = mountInspector({ basePath: "" });

    expect((await inspector(new Request("http://localhost/"))).status).toBe(
      404
    );
    expect(
      (await inspector(new Request("http://localhost/inspector"))).status
    ).toBe(200);
    expect(
      (
        await inspector(
          new Request("http://localhost/inspector/assets/favicon-black.svg")
        )
      ).status
    ).toBe(200);
  });

  it("derives auto-connect from the public request origin", async () => {
    const inspector = mountInspector({ basePath: "/mcp" });

    const config = await inspector(
      new Request("https://public-inspector.example/mcp/inspector/config.json")
    );
    expect(await config.json()).toEqual({
      autoConnectUrl: "https://public-inspector.example/mcp",
    });
  });

  it("keeps the Express adapter scoped to Inspector routes", async () => {
    const app = express();
    mountInspector(app, { basePath: "/mcp" });
    app.get("/application", (_req, res) => res.send("application route"));
    app.post("/echo", express.text({ type: "*/*" }), (req, res) =>
      res.type("application/json").send(req.body)
    );
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Express test server did not bind a TCP port");
      }
      const origin = `http://127.0.0.1:${address.port}`;

      const application = await fetch(`${origin}/application`);
      expect(application.status).toBe(200);
      expect(await application.text()).toBe("application route");

      const shell = await fetch(`${origin}/mcp/inspector`);
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain(
        "/mcp/inspector/assets/inspector.js"
      );

      const proxy = await fetch(`${origin}/mcp/inspector/api/proxy`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-target-url": `${origin}/echo`,
        },
        body: '{"through":"express"}',
      });
      expect(proxy.status).toBe(200);
      expect(await proxy.json()).toEqual({ through: "express" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
