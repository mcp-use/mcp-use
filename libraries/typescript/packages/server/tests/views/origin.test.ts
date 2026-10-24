import { afterEach, describe, expect, it } from "vitest";

import {
  resolveAssetsBase,
  resolveServerOrigin,
  resolveRequestOriginFromHeaders,
} from "../../src/views/origin.js";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("resolveServerOrigin", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("uses MCP_URL origin only (ignores path suffix)", () => {
    process.env.MCP_URL = "https://tunnel.example.com/mcp";
    expect(resolveServerOrigin(req("http://127.0.0.1:3000/mcp"))).toBe(
      "https://tunnel.example.com"
    );
  });

  it("falls back to forwarded headers when MCP_URL is malformed", () => {
    process.env.MCP_URL = "not-a-url";
    expect(
      resolveServerOrigin(
        req("http://127.0.0.1:3000/mcp", {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "proxy.example.com",
        })
      )
    ).toBe("https://proxy.example.com");
  });

  it("falls back to request origin", () => {
    delete process.env.MCP_URL;
    expect(resolveServerOrigin(req("http://127.0.0.1:3000/mcp"))).toBe(
      "http://127.0.0.1:3000"
    );
  });
});

describe("resolveAssetsBase", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("uses MCP_ASSETS_URL prefix with path", () => {
    process.env.MCP_ASSETS_URL =
      "https://cdn.example.com/storage/v1/object/public/widgets";
    expect(resolveAssetsBase(req("http://127.0.0.1:3000/mcp"))).toBe(
      "https://cdn.example.com/storage/v1/object/public/widgets"
    );
  });

  it("falls back to MCP_URL origin when MCP_ASSETS_URL unset", () => {
    delete process.env.MCP_ASSETS_URL;
    process.env.MCP_URL = "https://server.example.com/mcp";
    expect(resolveAssetsBase(req("http://127.0.0.1:3000/mcp"))).toBe(
      "https://server.example.com"
    );
  });

  it("falls back to request origin when no env set", () => {
    delete process.env.MCP_ASSETS_URL;
    delete process.env.MCP_URL;
    expect(resolveAssetsBase(req("http://127.0.0.1:3000/mcp"))).toBe(
      "http://127.0.0.1:3000"
    );
  });
});

describe("resolveRequestOriginFromHeaders", () => {
  it("parses Forwarded header", () => {
    expect(
      resolveRequestOriginFromHeaders(
        req("http://127.0.0.1/mcp", {
          forwarded: "proto=https;host=fruit.example.com",
        })
      )
    ).toBe("https://fruit.example.com");
  });

  it("uses Forwarded proto with the request host when host is absent", () => {
    expect(
      resolveRequestOriginFromHeaders(
        req("http://myapp.example.com/mcp", {
          forwarded: "for=203.0.113.7;proto=https",
        })
      )
    ).toBe("https://myapp.example.com");
  });

  it("uses X-Forwarded-Proto with the request host when X-Forwarded-Host is absent", () => {
    expect(
      resolveRequestOriginFromHeaders(
        req("http://myapp.example.com/mcp", {
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://myapp.example.com");
  });

  it("uses X-Forwarded-Host when present", () => {
    expect(
      resolveRequestOriginFromHeaders(
        req("http://127.0.0.1:3000/mcp", {
          "x-forwarded-proto": "https,http",
          "x-forwarded-host": "proxy.example.com, 10.0.0.1",
        })
      )
    ).toBe("https://proxy.example.com");
  });

  it("ignores X-Forwarded-Host without X-Forwarded-Proto", () => {
    expect(
      resolveRequestOriginFromHeaders(
        req("http://127.0.0.1:3000/mcp", {
          "x-forwarded-host": "proxy.example.com",
        })
      )
    ).toBe("http://127.0.0.1:3000");
  });
});
