import { Hono } from "hono";
import RateLimiterMemory from "rate-limiter-flexible/lib/RateLimiterMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountMcpProxy } from "../../src/server/proxy/mcp-proxy";

const proxyUrl = "http://localhost/inspector/api/proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inspector MCP proxy request isolation", () => {
  it("distinguishes omitted origins (legacy wildcard) from an explicit empty list", async () => {
    const legacy = new Hono();
    mountMcpProxy(legacy, {
      path: "/inspector/api/proxy",
      enableLogging: false,
    });
    const legacyPreflight = await legacy.fetch(
      new Request(proxyUrl, {
        method: "OPTIONS",
        headers: { Origin: "https://legacy.example" },
      })
    );
    expect(legacyPreflight.headers.get("access-control-allow-origin")).toBe(
      "*"
    );

    const explicit = new Hono();
    mountMcpProxy(explicit, {
      path: "/inspector/api/proxy",
      enableLogging: false,
      allowedOrigins: [],
    });
    const explicitPreflight = await explicit.fetch(
      new Request(proxyUrl, {
        method: "OPTIONS",
        headers: { Origin: "https://legacy.example" },
      })
    );
    expect(
      explicitPreflight.headers.get("access-control-allow-origin")
    ).toBeNull();
  });

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
      })
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://mochipi.dev"
    );
    expect(allowed.headers.get("access-control-allow-headers")).toContain(
      "Mcp-Method"
    );

    const denied = await app.fetch(
      new Request(proxyUrl, {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      })
    );
    expect(denied.headers.get("access-control-allow-origin")).not.toBe(
      "https://attacker.example"
    );
  });

  it("prefixes proxy logs only when sharing the dev server process", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("ok"))
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = () =>
      new Request(proxyUrl, {
        headers: { "X-Target-URL": "https://93.184.216.34/mcp" },
      });

    const embedded = new Hono();
    mountMcpProxy(embedded, {
      path: "/inspector/api/proxy",
      logPrefix: "[inspector]",
    });
    await embedded.fetch(request());
    expect(logSpy.mock.calls).not.toHaveLength(0);
    expect(
      logSpy.mock.calls.every(([line]) =>
        String(line).startsWith("[inspector]")
      )
    ).toBe(true);

    logSpy.mockClear();
    const standalone = new Hono();
    mountMcpProxy(standalone, { path: "/inspector/api/proxy" });
    await standalone.fetch(request());
    expect(logSpy.mock.calls).not.toHaveLength(0);
    expect(
      logSpy.mock.calls.every(
        ([line]) => !String(line).startsWith("[inspector]")
      )
    ).toBe(true);
    logSpy.mockRestore();
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

  it("authenticates before consuming the target budget", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer upstream-token");
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchFn);
    const app = new Hono();
    mountMcpProxy(app, {
      path: "/inspector/api/proxy",
      enableLogging: false,
      rateLimiter: new RateLimiterMemory({ points: 1, duration: 60 }),
      authenticate: (c) =>
        c.req.header("X-Inspector-Relay-Token") === "relay-token",
    });

    const denied = await app.fetch(
      new Request(proxyUrl, {
        headers: { "X-Target-URL": "https://93.184.216.34/mcp" },
      })
    );
    expect(denied.status).toBe(401);

    const allowed = await app.fetch(
      new Request(proxyUrl, {
        headers: {
          "X-Target-URL": "https://93.184.216.34/mcp",
          Authorization: "Bearer upstream-token",
          "X-Inspector-Relay-Token": "relay-token",
        },
      })
    );
    expect(allowed.status).toBe(200);
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
