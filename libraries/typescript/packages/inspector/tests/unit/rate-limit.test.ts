import { Hono } from "hono";
import RateLimiterMemory from "rate-limiter-flexible/lib/RateLimiterMemory.js";
import { describe, expect, it } from "vitest";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_ASSET_RATE_LIMIT,
  INSPECTOR_GLOBAL_API_RATE_LIMIT,
  inspectorRateLimitResponse,
  inspectorServerRateLimitKey,
} from "../../src/server/rate-limit.js";

describe("Inspector route rate limits", () => {
  it("uses separate budgets for assets and proxy/OAuth traffic", async () => {
    const app = new Hono();
    const assetLimiter = new RateLimiterMemory({ points: 2, duration: 60 });
    const apiLimiter = new RateLimiterMemory({ points: 1, duration: 60 });
    app.get("/assets/*", async (c) => {
      try {
        await assetLimiter.consume("assets");
      } catch (error) {
        return inspectorRateLimitResponse(c, error);
      }
      return c.text("asset");
    });
    app.get("/api/*", async (c) => {
      try {
        await apiLimiter.consume("api");
      } catch (error) {
        return inspectorRateLimitResponse(c, error);
      }
      return c.text("api");
    });

    expect((await app.request("/assets/app.js")).status).toBe(200);
    expect((await app.request("/api/proxy")).status).toBe(200);

    const apiLimited = await app.request("/api/oauth/token");
    expect(apiLimited.status).toBe(429);
    expect(Number(apiLimited.headers.get("Retry-After"))).toBeGreaterThan(0);

    expect((await app.request("/assets/app.css")).status).toBe(200);
    const assetLimited = await app.request("/assets/logo.svg");
    expect(assetLimited.status).toBe(429);
    expect(Number(assetLimited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("allows traffic again after the window resets", async () => {
    const app = new Hono();
    const limiter = new RateLimiterMemory({ points: 1, duration: 1 });
    app.get("/limited", async (c) => {
      try {
        await limiter.consume("reset");
      } catch (error) {
        return inspectorRateLimitResponse(c, error);
      }
      return c.text("ok");
    });

    expect((await app.request("/limited")).status).toBe(200);
    expect((await app.request("/limited")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect((await app.request("/limited")).status).toBe(200);
  });

  it("keeps the security patch defaults stable", () => {
    expect(INSPECTOR_API_RATE_LIMIT).toBe(120);
    expect(INSPECTOR_GLOBAL_API_RATE_LIMIT).toBe(1200);
    expect(INSPECTOR_ASSET_RATE_LIMIT).toBe(600);
  });

  it("isolates MCP and OAuth budgets by logical server without retaining query secrets", () => {
    expect(
      inspectorServerRateLimitKey(
        "mcp",
        "https://Example.com:443/mcp/?access_token=secret#fragment"
      )
    ).toBe("mcp:https://example.com/mcp");
    expect(
      inspectorServerRateLimitKey("oauth", "https://example.com/mcp")
    ).toBe("oauth:https://example.com/mcp");
    expect(inspectorServerRateLimitKey("mcp", undefined)).toBe("mcp:unknown");
    expect(inspectorServerRateLimitKey("oauth", "not a URL")).toBe(
      "oauth:unknown"
    );
  });

  it("lets unrelated targets consume independent per-server budgets", async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const first = inspectorServerRateLimitKey(
      "mcp",
      "https://first.example.com/mcp"
    );
    const second = inspectorServerRateLimitKey(
      "mcp",
      "https://second.example.com/mcp"
    );

    await expect(limiter.consume(first)).resolves.toBeDefined();
    await expect(limiter.consume(first)).rejects.toBeDefined();
    await expect(limiter.consume(second)).resolves.toBeDefined();
  });

  it("uses the fallback Retry-After for non-finite limiter values", async () => {
    const app = new Hono();
    app.get("/limited", (c) =>
      inspectorRateLimitResponse(c, { msBeforeNext: Number.NaN })
    );

    const response = await app.request("/limited");
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});
