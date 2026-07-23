import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  createInspectorRateLimiter,
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_ASSET_RATE_LIMIT,
} from "../../src/server/rate-limit.js";

describe("Inspector route rate limits", () => {
  it("uses separate budgets for assets and proxy/OAuth traffic", async () => {
    const app = new Hono();
    app.use(
      "/assets/*",
      createInspectorRateLimiter({
        points: 2,
        durationSeconds: 60,
        key: "assets",
      })
    );
    app.use(
      "/api/*",
      createInspectorRateLimiter({
        points: 1,
        durationSeconds: 60,
        key: "api",
      })
    );
    app.get("/assets/*", (c) => c.text("asset"));
    app.get("/api/*", (c) => c.text("api"));

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
    app.use(
      "/limited",
      createInspectorRateLimiter({
        points: 1,
        durationSeconds: 1,
        key: "reset",
      })
    );
    app.get("/limited", (c) => c.text("ok"));

    expect((await app.request("/limited")).status).toBe(200);
    expect((await app.request("/limited")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect((await app.request("/limited")).status).toBe(200);
  });

  it("keeps the security patch defaults stable", () => {
    expect(INSPECTOR_API_RATE_LIMIT).toBe(120);
    expect(INSPECTOR_ASSET_RATE_LIMIT).toBe(600);
  });
});
