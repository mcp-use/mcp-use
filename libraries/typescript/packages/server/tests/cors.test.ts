import { describe, expect, it } from "vitest";

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

  it("is a no-op when disabled", async () => {
    const fetch = composeFetch(
      async () => new Response("ok"),
      corsFetchMiddleware({ enabled: false, origin: "https://app.example.com" })
    );

    const response = await fetch(new Request("http://localhost/mcp"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
