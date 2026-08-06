/**
 * Unit tests for dev-only inspector API route interception.
 */
import { describe, expect, it, vi } from "vitest";

import { createDevApiHandler } from "../../src/cli/dev-api.js";
import type { TunnelManager } from "@mcp-use/tunnel";

function fakeTunnel(initialUrl: string | null = null): {
  manager: TunnelManager;
  setUrl: (url: string | null) => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  let url = initialUrl;
  const start = vi.fn(async () => {
    url = "https://happy-cat.local.mcp-use.run";
    return { url, subdomain: "happy-cat" };
  });
  const stop = vi.fn(async () => {
    url = null;
  });
  const manager: TunnelManager = {
    start,
    stop,
    status: () => ({ url }),
  };
  return {
    manager,
    setUrl: (next) => {
      url = next;
    },
    start,
    stop,
  };
}

describe("createDevApiHandler", () => {
  const basePath = "/mcp";
  const port = 4242;
  const origin = "http://127.0.0.1:4242";

  it("returns dev info with fromCli and no tunnel by default", async () => {
    const tunnel = fakeTunnel();
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      async () => new Response("fallback", { status: 418 })
    );

    const res = await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/info`)
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      mcpUrl: null,
      port,
      fromCli: true,
      tunnelUrl: null,
    });
  });

  it("includes tunnel URLs in dev info when a tunnel is active", async () => {
    const tunnel = fakeTunnel("https://happy-cat.local.mcp-use.run");
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      async () => new Response("fallback")
    );

    const res = await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/info`)
    );
    await expect(res.json()).resolves.toEqual({
      mcpUrl: "https://happy-cat.local.mcp-use.run/mcp",
      port,
      fromCli: true,
      tunnelUrl: "https://happy-cat.local.mcp-use.run",
    });
  });

  it("starts the tunnel via POST start-tunnel without restarting", async () => {
    const tunnel = fakeTunnel();
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      async () => new Response("fallback")
    );

    const res = await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/start-tunnel`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, restarting: false });
    expect(tunnel.start).toHaveBeenCalledWith(port);
  });

  it("returns 500 when start-tunnel fails", async () => {
    const tunnel = fakeTunnel();
    tunnel.start.mockRejectedValueOnce(new Error("tunnel setup timed out"));
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      async () => new Response("fallback")
    );

    const res = await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/start-tunnel`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "tunnel setup timed out",
    });
  });

  it("stops the tunnel via POST stop-tunnel", async () => {
    const tunnel = fakeTunnel("https://happy-cat.local.mcp-use.run");
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      async () => new Response("fallback")
    );

    const res = await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/stop-tunnel`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(tunnel.stop).toHaveBeenCalled();
  });

  it("delegates non-matching paths to the fallback handler", async () => {
    const tunnel = fakeTunnel();
    const fallback = vi.fn(async () => new Response("mcp"));
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      fallback
    );

    const res = await handler(new Request(`${origin}${basePath}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("mcp");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not match similar paths with extra segments", async () => {
    const tunnel = fakeTunnel();
    const fallback = vi.fn(async () => new Response("ok"));
    const handler = createDevApiHandler(
      { getBasePath: () => basePath, port, tunnel: tunnel.manager },
      fallback
    );

    await handler(
      new Request(`${origin}${basePath}/inspector/api/dev/info/extra`)
    );
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("uses the current base path from getBasePath on each request", async () => {
    const tunnel = fakeTunnel();
    let currentBasePath = "/mcp";
    const handler = createDevApiHandler(
      {
        getBasePath: () => currentBasePath,
        port,
        tunnel: tunnel.manager,
      },
      async () => new Response("fallback")
    );

    await handler(new Request(`${origin}/api/inspector/api/dev/info`));
    currentBasePath = "/api";
    const res = await handler(
      new Request(`${origin}/api/inspector/api/dev/info`)
    );
    expect(res.status).toBe(200);
  });
});
