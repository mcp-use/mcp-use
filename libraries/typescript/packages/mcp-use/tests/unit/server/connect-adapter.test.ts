import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isExpressMiddleware } from "../../../src/server/connect-adapter.js";
import { createHonoProxy } from "../../../src/server/utils/hono-proxy.js";

async function withoutHanging<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Connect adapter left the request pending")),
          1000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function makeServer() {
  const app = new Hono();
  // This is the same public use() registration path returned by MCPServer.
  const server = createHonoProxy({}, app);
  const errors: Error[] = [];
  app.onError((error, c) => {
    errors.push(error);
    return c.text(error.message, 500);
  });
  return { app, server, errors };
}

describe("HTTP middleware registration", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Outbound requests are forbidden in this local test");
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const honoHandlers: [string, MiddlewareHandler][] = [
    [
      "c",
      async (c: Context, next: Next) => {
        c.header("x-query", c.req.query("q"));
        c.header("x-session", c.req.header("mcp-session-id"));
        await next();
      },
    ],
    [
      "ctx",
      async (ctx: Context, next: Next) => {
        ctx.header("x-query", ctx.req.query("q"));
        ctx.header("x-session", ctx.req.header("mcp-session-id"));
        await next();
      },
    ],
    [
      "req",
      async (req: Context, next: Next) => {
        req.header("x-query", req.req.query("q"));
        req.header("x-session", req.req.header("mcp-session-id"));
        await next();
      },
    ],
    [
      "aliased Hono request",
      async (c: Context, next: Next) => {
        const req = c.req;
        c.header("x-query", req.query("q"));
        c.header("x-session", req.header("mcp-session-id"));
        await next();
      },
    ],
    [
      "destructured Context parameter",
      async ({ req, header }: Context, next: Next) => {
        header("x-query", req.query("q"));
        header("x-session", req.header("mcp-session-id"));
        await next();
      },
    ],
    [
      "destructured Context in the body",
      async (context: Context, next: Next) => {
        const { req, header } = context;
        header("x-query", req.query("q"));
        header("x-session", req.header("mcp-session-id"));
        await next();
      },
    ],
  ];

  it.each(honoHandlers)(
    "classifies Hono middleware using %s as native",
    (_, handler) => {
      expect(isExpressMiddleware(handler)).toBe(false);
    }
  );

  it("runs middleware taking only destructured req through public use()", async () => {
    const { app, server, errors } = makeServer();
    let observed: unknown;
    await server.use("*", async ({ req }: Context, next: Next) => {
      observed = {
        query: req.query("q"),
        sessionId: req.header("mcp-session-id"),
      };
      await next();
    });
    app.get("/mcp", (c) => c.json(observed));

    const response = await withoutHanging(
      Promise.resolve(
        app.request("/mcp?q=expected", {
          headers: { "mcp-session-id": "local-session" },
        })
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: "expected",
      sessionId: "local-session",
    });
    expect(errors).toEqual([]);
  });

  it.each(honoHandlers)(
    "runs Hono query/header middleware using %s through public use()",
    async (_, handler) => {
      const { app, server, errors } = makeServer();
      await server.use("*", handler);
      const downstream = vi.fn((c: Context) => c.text("downstream"));
      app.get("/mcp", downstream);

      const response = await withoutHanging(
        Promise.resolve(
          app.request("/mcp?q=expected", {
            headers: { "mcp-session-id": "local-session" },
          })
        )
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("downstream");
      expect(response.headers.get("x-query")).toBe("expected");
      expect(response.headers.get("x-session")).toBe("local-session");
      expect(downstream).toHaveBeenCalledOnce();
      expect(errors).toEqual([]);
    }
  );

  it("preserves Connect next(), mount paths, query, and headers", async () => {
    const { app, server, errors } = makeServer();
    let observed: unknown;
    const connect = (req: any, res: any, next: () => void) => {
      observed = {
        url: req.url,
        query: req.query,
        header: req.headers["x-input"],
      };
      res.setHeader("x-connect", "passed");
      next();
    };
    expect(isExpressMiddleware(connect)).toBe(true);
    await server.use("/api/*", connect);
    app.get("/api/echo", (c) => c.text("downstream"));

    const response = await app.request("/api/echo?q=value", {
      headers: { "x-input": "local" },
    });

    expect(observed).toEqual({
      url: "/echo?q=value",
      query: { q: "value" },
      header: "local",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("downstream");
    expect(response.headers.get("x-connect")).toBe("passed");
    expect(errors).toEqual([]);
  });

  it("adapts request-only three-argument Connect middleware", async () => {
    const { app, server, errors } = makeServer();
    let observed: unknown;
    const connect = (req: any, _res: any, next: () => void) => {
      observed = req.query;
      next();
    };
    await server.use("*", connect);
    app.get("/mcp", (c) => c.json(observed));

    const response = await withoutHanging(
      Promise.resolve(app.request("/mcp?q=expected"))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ q: "expected" });
    expect(errors).toEqual([]);
  });

  it("preserves an async two-argument Express terminal handler", async () => {
    const { app, server, errors } = makeServer();
    const express = async (req: any, res: any) => {
      await Promise.resolve();
      res.status(201).setHeader("x-express", "ended");
      res.end(req.query.q);
    };
    expect(isExpressMiddleware(express)).toBe(true);
    await server.use("*", express);

    const response = await withoutHanging(
      Promise.resolve(app.request("/echo?q=terminal"))
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("terminal");
    expect(response.headers.get("x-express")).toBe("ended");
    expect(errors).toEqual([]);
  });

  it.each([204, 304])(
    "keeps a Connect %s response bodyless",
    async (status) => {
      const { app, server, errors } = makeServer();
      await server.use("*", (_req: any, res: any, _next: () => void) => {
        res.status(status).end("ignored");
      });

      const response = await app.request("/mcp");

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe("");
      expect(errors).toEqual([]);
    }
  );

  it.each(["sync throw", "async rejection", "next(error)"])(
    "propagates %s from Connect to Hono instead of hanging",
    async (failure) => {
      const { app, server, errors } = makeServer();
      const expected = new Error(`local ${failure}`);
      const connect =
        failure === "sync throw"
          ? (_req: any, _res: any, _next: (error?: Error) => void) => {
              throw expected;
            }
          : async (_req: any, _res: any, next: (error?: Error) => void) => {
              await Promise.resolve();
              if (failure === "next(error)") {
                next(expected);
              } else {
                throw expected;
              }
            };
      await server.use("*", connect);
      const downstream = vi.fn((c: Context) => c.text("unexpected"));
      app.get("/mcp", downstream);

      const response = await withoutHanging(
        Promise.resolve(app.request("/mcp"))
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toBe(expected.message);
      expect(errors).toEqual([expected]);
      expect(downstream).not.toHaveBeenCalled();
    }
  );

  it("propagates response conversion errors from a deferred end()", async () => {
    const { app, server, errors } = makeServer();
    await server.use("*", (_req: any, res: any, _next: () => void) => {
      setTimeout(() => res.status(199).end("invalid status"), 0);
    });

    const response = await withoutHanging(Promise.resolve(app.request("/mcp")));

    expect(response.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
  });

  it.each(["next", "end"])(
    "honors the first %s settlement and observes a later rejection",
    async (completion) => {
      const { app, server, errors } = makeServer();
      await server.use(
        "*",
        async (_req: any, res: any, next: (error?: Error) => void) => {
          if (completion === "next") {
            next();
          } else {
            res.end("finished");
          }
          await Promise.resolve();
          throw new Error("rejection after completion");
        }
      );
      app.get("/mcp", (c) => c.text("downstream"));

      const response = await withoutHanging(
        Promise.resolve(app.request("/mcp"))
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        completion === "next" ? "downstream" : "finished"
      );
      expect(errors).toEqual([]);
    }
  );
});
