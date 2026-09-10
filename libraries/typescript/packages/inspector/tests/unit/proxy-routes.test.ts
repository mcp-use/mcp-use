import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerInspectorProxyRoutes } from "../../src/server/proxy-routes.js";

describe("Inspector health state-store probes", () => {
  it("actively probes the state store instead of trusting ready state", async () => {
    const probe = vi.fn(async () => undefined);
    const ready = vi.fn(async () => {
      throw new Error("ready must not be used when probe is available");
    });
    const app = new Hono();
    registerInspectorProxyRoutes(app, {
      mcp: false,
      oauth: false,
      oauthProxyStateStore: {
        get: async () => undefined,
        set: async () => undefined,
        delete: async () => undefined,
        probe,
        ready,
      },
    });

    const response = await app.request("/inspector/health");
    expect(response.status).toBe(200);
    expect(probe).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  });

  it("reports unavailable when an active state-store probe fails", async () => {
    const app = new Hono();
    registerInspectorProxyRoutes(app, {
      mcp: false,
      oauth: false,
      oauthProxyStateStore: {
        get: async () => undefined,
        set: async () => undefined,
        delete: async () => undefined,
        probe: async () => {
          throw new Error("probe failed");
        },
      },
    });

    const response = await app.request("/inspector/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
