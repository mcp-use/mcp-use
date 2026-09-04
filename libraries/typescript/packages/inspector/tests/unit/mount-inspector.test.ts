import express from "express";
import { Hono } from "hono";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { mountInspector } from "../../src/server/index.js";

// Bound a wait without leaving the timer pending when the wait wins:
// a live timer keeps the vitest worker alive for its full duration.
async function raceWithTimeout(
  promise: Promise<void>,
  ms: number,
  message: string
): Promise<void> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

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
    expect(html).toContain('window.__MCP_INSPECTOR_MODE__ = "embedded"');
    expect(html).toContain(
      'window.__MCP_SANDBOX_ORIGIN__ = "http://127.0.0.1"'
    );

    const sandbox = await inspector(
      new Request(
        "http://127.0.0.1/tools/mcp/inspector/sandbox?csp_mode=widget-declared"
      )
    );
    expect(sandbox.status).toBe(200);
    expect(await sandbox.text()).toContain("sandbox-proxy-ready");

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

  it("blocks loopback proxy targets by default and allows them on explicit opt-in", async () => {
    const secure = mountInspector({ basePath: "" });
    const blocked = await secure(
      new Request("http://localhost/inspector/api/proxy", {
        method: "POST",
        headers: { "X-Target-URL": "http://127.0.0.1:8080/" },
      })
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      error: "Invalid target URL",
    });

    // Explicit opt-in (local dev tooling): the request proceeds to the fetch
    // layer and fails to connect (port 1 refuses) instead of being rejected.
    const permissive = mountInspector({
      basePath: "",
      oauthProxyAllowLoopback: true,
    });
    const attempted = await permissive(
      new Request("http://localhost/inspector/api/proxy", {
        method: "POST",
        headers: { "X-Target-URL": "http://127.0.0.1:1/" },
      })
    );
    expect(attempted.status).not.toBe(403);
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

  it("normalizes long repeated and trailing slash input", async () => {
    const repeated = "/".repeat(20_000);
    const inspector = mountInspector({
      basePath: `${repeated}deep${repeated}mcp${repeated}`,
    });

    expect(
      (
        await inspector(
          new Request("http://localhost/deep/mcp/inspector/health")
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
    // Loopback opt-in: this test proxies to its own 127.0.0.1 echo server.
    mountInspector(app, { basePath: "/mcp", oauthProxyAllowLoopback: true });
    app.get("/application", (_req, res) => res.send("application route"));
    app.post("/echo", express.text({ type: "*/*" }), (_req, res) =>
      res.type("text/plain").send("through-express")
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
      expect(await proxy.text()).toBe("through-express");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("releases the upstream stream when the Express client disconnects mid-response", async () => {
    // Upstream MCP-style SSE server: writes an initial chunk immediately, then
    // keeps the connection open indefinitely with periodic pings, and reports
    // when the *inbound* request (the proxy's fetch to it) is closed.
    let upstreamRequestClosed = false;
    let resolveUpstreamClosed: () => void = () => {};
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });
    let upstreamInterval: ReturnType<typeof setInterval> | undefined;

    const upstream = http.createServer((req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.write(": ping\n\n");
      upstreamInterval = setInterval(() => {
        res.write(": ping\n\n");
      }, 20);
      req.on("close", () => {
        upstreamRequestClosed = true;
        resolveUpstreamClosed();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));

    const app = express();
    // Loopback opt-in: this test proxies to its own 127.0.0.1 SSE server.
    mountInspector(app, { basePath: "/mcp", oauthProxyAllowLoopback: true });
    const server = app.listen(0);

    let controller: AbortController | undefined;
    try {
      const upstreamAddress = upstream.address();
      const appAddress = server.address();
      if (
        !upstreamAddress ||
        typeof upstreamAddress === "string" ||
        !appAddress ||
        typeof appAddress === "string"
      ) {
        throw new Error("Test servers did not bind TCP ports");
      }
      const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
      const appOrigin = `http://127.0.0.1:${appAddress.port}`;

      controller = new AbortController();
      const response = await fetch(`${appOrigin}/mcp/inspector/api/proxy`, {
        headers: { "x-target-url": `${upstreamOrigin}/stream` },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      if (!response.body) {
        throw new Error("Proxied response had no body");
      }

      // Prove the stream is actually flowing end-to-end before disconnecting.
      const reader = response.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);

      // Simulate the Express client disconnecting mid-stream.
      controller.abort();

      // A fixed middleware releases the upstream promptly; an unfixed one
      // never does, so bound the wait instead of hanging the suite.
      await raceWithTimeout(
        upstreamClosed,
        3000,
        "upstream connection was not released after client disconnect"
      );

      expect(upstreamRequestClosed).toBe(true);
    } finally {
      if (upstreamInterval) clearInterval(upstreamInterval);
      controller?.abort();
      server.closeAllConnections();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 10000);

  it("releases the upstream when the client disconnects before response headers", async () => {
    // The upstream accepts the request and never responds, so the abort
    // has to travel through the outbound fetch itself. Cancelling the
    // response reader cannot help here: there is no response yet.
    let upstreamRequestClosed = false;
    let resolveUpstreamClosed: () => void = () => {};
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });
    let sawRequest: () => void = () => {};
    const requestArrived = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });

    const upstream = http.createServer((req) => {
      sawRequest();
      req.on("close", () => {
        upstreamRequestClosed = true;
        resolveUpstreamClosed();
      });
      // Deliberately never write a status line or headers.
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));

    const app = express();
    mountInspector(app, { basePath: "/mcp", oauthProxyAllowLoopback: true });
    const server = app.listen(0);

    let controller: AbortController | undefined;
    try {
      const upstreamAddress = upstream.address();
      const appAddress = server.address();
      if (
        !upstreamAddress ||
        typeof upstreamAddress === "string" ||
        !appAddress ||
        typeof appAddress === "string"
      ) {
        throw new Error("Test servers did not bind TCP ports");
      }
      const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
      const appOrigin = `http://127.0.0.1:${appAddress.port}`;

      controller = new AbortController();
      const pending = fetch(`${appOrigin}/mcp/inspector/api/proxy`, {
        headers: { "x-target-url": `${upstreamOrigin}/stream` },
        signal: controller.signal,
      }).catch(() => undefined);

      // Only abort once the upstream is actually holding the request open.
      await raceWithTimeout(
        requestArrived,
        3000,
        "upstream never received the proxied request"
      );
      controller.abort();
      await pending;

      await raceWithTimeout(
        upstreamClosed,
        3000,
        "upstream connection was not released after a pre-header disconnect"
      );
      expect(upstreamRequestClosed).toBe(true);
    } finally {
      controller?.abort();
      server.closeAllConnections();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 10000);
});
