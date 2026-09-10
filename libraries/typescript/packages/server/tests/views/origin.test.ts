import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveAssetsBase,
  resolveMcpEndpoint,
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
});

describe("resolveMcpEndpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["https://example.com", "/mcp", "https://example.com/mcp"],
    ["https://example.com/", "/custom/mcp", "https://example.com/custom/mcp"],
    ["https://example.com/mcp", "/mcp", "https://example.com/mcp"],
    [
      "https://example.com/proxy/mcp/",
      "/mcp",
      "https://example.com/proxy/mcp/",
    ],
    [
      "https://example.com/mcp?tenant=1",
      "/mcp",
      "https://example.com/mcp?tenant=1",
    ],
    ["https://example.com", "/", "https://example.com/"],
  ])("resolves MCP_URL %s with route %s", (value, basePath, expected) => {
    vi.stubEnv("MCP_URL", value);
    vi.stubEnv("MCP_ASSETS_URL", "https://cdn.example.com/assets");
    expect(resolveMcpEndpoint(req("http://localhost:3000/mcp"), basePath)).toBe(
      expected
    );
    expect(resolveMcpEndpoint(undefined, basePath)).toBe(expected);
  });

  it.each([undefined, "not-a-url"])(
    "uses the forwarded origin with request path when MCP_URL is %s",
    (value) => {
      vi.stubEnv("MCP_URL", value);
      expect(
        resolveMcpEndpoint(
          req("http://localhost:3000/custom/mcp?tenant=1", {
            forwarded: "proto=https;host=public.example.com",
          }),
          "/custom/mcp"
        )
      ).toBe("https://public.example.com/custom/mcp?tenant=1");
    }
  );

  it("uses the request endpoint without an override and has no stdio default", () => {
    vi.stubEnv("MCP_URL", undefined);
    expect(resolveMcpEndpoint(req("https://example.com/mcp"), "/mcp")).toBe(
      "https://example.com/mcp"
    );
    expect(resolveMcpEndpoint(undefined, "/mcp")).toBeUndefined();
  });
});
