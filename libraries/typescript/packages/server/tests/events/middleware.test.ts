import { describe, expect, it } from "vitest";
import { MCPServer } from "../../src/index.js";
import {
  createMcpEventListenerEntry,
  createMcpMiddlewareEntry,
  dispatchEventsStreamClosed,
  runEventsOperation,
} from "../../src/middleware/mcp-middleware.js";

describe("events middleware (D43)", () => {
  it("one wildcard middleware sees events/subscribe like any other method", async () => {
    const seen: string[] = [];
    const mw = createMcpMiddlewareEntry("mcp:*", async (ctx, next) => {
      seen.push(`mcp:${ctx.method}`);
      await next();
    });
    await runEventsOperation(
      [mw],
      [],
      "events/subscribe",
      {},
      { name: "a" },
      async () =>
        ({
          id: "sub_1",
        }) as never
    );
    expect(seen).toEqual(["mcp:events/subscribe"]);
  });

  it("never exposes delivery.secret to middleware or observers", async () => {
    const seen: unknown[] = [];
    const mw = createMcpMiddlewareEntry(
      "mcp:events/subscribe",
      async (ctx, next) => {
        seen.push(ctx.params.delivery);
        return next();
      }
    );
    const observer = createMcpEventListenerEntry(
      "mcp:events/subscribe:complete",
      (ctx) => {
        seen.push((ctx.params as { delivery: unknown }).delivery);
      }
    );
    const params = {
      name: "a",
      delivery: {
        mode: "webhook",
        url: "https://x.test/h",
        secret: "whsec_c2VjcmV0",
      },
    };
    let handlerSecret: unknown;
    await runEventsOperation(
      [mw],
      [observer],
      "events/subscribe",
      {},
      params,
      async () => {
        handlerSecret = params.delivery.secret;
        return { id: "sub_1" } as never;
      }
    );
    expect(seen).toEqual([
      { mode: "webhook", url: "https://x.test/h", secret: "whsec_[redacted]" },
      { mode: "webhook", url: "https://x.test/h", secret: "whsec_[redacted]" },
    ]);
    expect(handlerSecret).toBe("whsec_c2VjcmV0");
  });

  it("reports stream:closed with its reason", () => {
    const reasons: unknown[] = [];
    const observer = createMcpEventListenerEntry(
      "mcp:events/stream:closed",
      (_ctx, info) => {
        reasons.push(info);
      }
    );
    dispatchEventsStreamClosed([observer], { name: "a" }, "shutdown");
    expect(reasons).toEqual([{ reason: "shutdown" }]);
  });
});

describe("server.on naming (D3)", () => {
  it("still accepts operation patterns", () => {
    const server = new MCPServer({
      name: "o",
      version: "1.0.0",
      skills: false,
    });
    expect(() => server.on("mcp:tools/call", () => undefined)).not.toThrow();
    expect(() =>
      server.on("tools/call" as never, () => undefined)
    ).not.toThrow();
  });

  it("throws ON_NOT_EVENT for an event-shaped pattern", () => {
    const server = new MCPServer({
      name: "o",
      version: "1.0.0",
      skills: false,
    });
    expect(() => server.on("note.created" as never, () => undefined)).toThrow(
      expect.objectContaining({ code: "ON_NOT_EVENT" })
    );
  });
});
