import { describe, expect, it } from "vitest";

import {
  isBufferedResponse,
  markBufferedResponse,
} from "../src/buffered-response.js";
import { composeFetch } from "../src/fetch-app.js";
import { corsFetchMiddleware } from "../src/middleware/cors.js";

describe("corsFetchMiddleware", () => {
  it("answers OPTIONS preflight with configured headers", async () => {
    const fetch = composeFetch(
      async () => new Response("missing"),
      corsFetchMiddleware({
        origin: "https://app.example.com",
      })
    );

    const response = await fetch(
      new Request("http://localhost/mcp", {
        method: "OPTIONS",
        headers: { Origin: "https://app.example.com" },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
  });

  it("merges CORS headers onto successful responses", async () => {
    const fetch = composeFetch(
      async () => new Response("ok", { status: 200 }),
      corsFetchMiddleware({ origin: "https://app.example.com" })
    );

    const response = await fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
      })
    );

    expect(await response.text()).toBe("ok");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );
  });

  it("preserves the buffered marker across its header-only wrapper", async () => {
    const fetch = composeFetch(
      async () => markBufferedResponse(Response.json({ ok: true })),
      corsFetchMiddleware({ origin: "https://app.example.com" })
    );

    const response = await fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
      })
    );

    expect(isBufferedResponse(response)).toBe(true);
  });

  it("does not override responses that already set ACAO", async () => {
    const fetch = composeFetch(
      async () =>
        new Response("oauth", {
          headers: { "Access-Control-Allow-Origin": "*" },
        }),
      corsFetchMiddleware({ origin: "https://app.example.com" })
    );

    const response = await fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
      })
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("ignores response-only CORS headers mistakenly sent in a request", async () => {
    const fetch = composeFetch(
      async () => new Response("ok"),
      corsFetchMiddleware({ origin: "https://app.example.com" })
    );

    const headers = {
      Origin: "https://app.example.com",
      "Access-Control-Allow-Origin": "https://other.example.com",
    };
    const response = await fetch(
      new Request("http://localhost/mcp", { method: "POST", headers })
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );

    const preflight = await fetch(
      new Request("http://localhost/mcp", { method: "OPTIONS", headers })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );
  });

  it("is a no-op when disabled", async () => {
    const fetch = composeFetch(
      async () => new Response("ok"),
      corsFetchMiddleware({ enabled: false, origin: "https://app.example.com" })
    );

    const response = await fetch(new Request("http://localhost/mcp"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
