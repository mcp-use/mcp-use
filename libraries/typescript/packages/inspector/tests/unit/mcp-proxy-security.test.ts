import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountMcpProxy } from "../../src/server/proxy/mcp-proxy";

const proxyUrl = "http://localhost/inspector/api/proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inspector MCP proxy request isolation", () => {
  it("allows only configured browser origins and MCP protocol headers", async () => {
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
      allowedOrigins: ["https://manufact.com", "https://mochipi.dev"],
    });

    const allowed = await app.fetch(
      new Request(proxyUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "https://mochipi.dev",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "mcp-method, x-target-url",
        },
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://mochipi.dev",
    );
    expect(allowed.headers.get("access-control-allow-headers")).toContain(
      "Mcp-Method",
    );

    const denied = await app.fetch(
      new Request(proxyUrl, {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(denied.headers.get("access-control-allow-origin")).not.toBe(
      "https://attacker.example",
    );
  });

  it("does not forward Inspector cookies or browser-origin headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer mcp-token");
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("origin")).toBeNull();
      expect(headers.get("referer")).toBeNull();
      expect(headers.get("sec-fetch-site")).toBeNull();
      return new Response("ok", {
        headers: { "Set-Cookie": "upstream=must-not-reach-browser" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });

    const response = await app.fetch(
      new Request(proxyUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer mcp-token",
          Cookie: "inspector_session=must-not-leak",
          Origin: "http://localhost",
          Referer: "http://localhost/inspector",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
          "X-Target-URL": "https://93.184.216.34/mcp",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("removes bearer authorization across a cross-origin redirect", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer must-not-leak"
        );
        return new Response(null, {
          status: 307,
          headers: { Location: "https://93.184.216.35/mcp" },
        });
      })
      .mockImplementationOnce(async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return new Response("ok");
      });
    vi.stubGlobal("fetch", fetchFn);
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });

    const response = await app.fetch(
      new Request(proxyUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer must-not-leak",
          "Content-Type": "application/json",
          "X-Target-URL": "https://93.184.216.34/mcp",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("forwards an empty 204 response without constructing an invalid body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    );
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });

    const response = await app.fetch(
      new Request(proxyUrl, {
        headers: {
          "X-Target-URL": "https://93.184.216.34/mcp",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("disables reverse-proxy buffering for open-ended SSE responses", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          })
      )
    );
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });

    const response = await app.fetch(
      new Request(proxyUrl, {
        headers: {
          "X-Target-URL": "https://93.184.216.34/mcp",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform"
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("preserves upstream cache policy while disabling SSE buffering", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(stream, {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Type": "text/event-stream",
            },
          })
      )
    );
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });

    const response = await app.fetch(
      new Request(proxyUrl, {
        headers: {
          "X-Target-URL": "https://93.184.216.34/mcp",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });
});
