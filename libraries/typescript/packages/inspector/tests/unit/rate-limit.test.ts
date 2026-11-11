import { Hono } from "hono";
import RateLimiterMemory from "rate-limiter-flexible/lib/RateLimiterMemory.js";
import { describe, expect, it } from "vitest";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_ASSET_RATE_LIMIT,
  inspectorApiRateLimit,
  inspectorRateLimitResponse,
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

  describe("proxy/OAuth caller budgets", () => {
    function limitedApp() {
      const app = new Hono();
      const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
      app.use("/api/*", inspectorApiRateLimit(limiter));
      app.get("/api/proxy", (c) => c.text("ok"));
      return app;
    }
    const from = (xff: string) => ({ headers: { "X-Forwarded-For": xff } });

    it("gives each caller behind a platform proxy its own budget", async () => {
      const app = limitedApp();
      expect((await app.request("/api/proxy", from("10.0.0.1"))).status).toBe(
        200
      );
      expect((await app.request("/api/proxy", from("10.0.0.1"))).status).toBe(
        429
      );
      expect((await app.request("/api/proxy", from("10.0.0.2"))).status).toBe(
        200
      );
    });

    it("keys on the proxy-added entry, not one the client sent", async () => {
      const app = limitedApp();
      expect(
        (await app.request("/api/proxy", from("1.1.1.1, 10.0.0.3"))).status
      ).toBe(200);
      expect(
        (await app.request("/api/proxy", from("2.2.2.2, 10.0.0.3"))).status
      ).toBe(429);
    });

    it("applies only the process ceiling without a platform proxy", async () => {
      const app = limitedApp();
      expect((await app.request("/api/proxy")).status).toBe(200);
      expect((await app.request("/api/proxy")).status).toBe(200);
    });
  });

  it("keeps the security patch defaults stable", () => {
    expect(INSPECTOR_API_RATE_LIMIT).toBe(120);
    expect(INSPECTOR_ASSET_RATE_LIMIT).toBe(600);
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
