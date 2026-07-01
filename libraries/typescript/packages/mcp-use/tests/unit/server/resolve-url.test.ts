/**
 * Tests for the public-URL resolver: `requestOrigin` (always inferred) and
 * `canonicalOrigin` (MCP_URL → spoof-guarded request origin → fallback),
 * including the `allowedOrigins`-bound X-Forwarded-Host spoof rejection.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalOrigin,
  normalizeUrlHost,
  requestOrigin,
  type RequestHeaderReader,
} from "../../../src/server/utils/resolve-url.js";

/**
 * Build a case-insensitive header reader from a plain record, mirroring how
 * Hono's `c.req.header(name)` behaves.
 */
function headers(map: Record<string, string>): RequestHeaderReader {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return (name: string) => lower[name.toLowerCase()];
}

describe("normalizeUrlHost", () => {
  it("rewrites a 0.0.0.0 host to localhost", () => {
    expect(normalizeUrlHost("http://0.0.0.0:3000")).toBe(
      "http://localhost:3000"
    );
    expect(normalizeUrlHost("http://0.0.0.0/mcp")).toBe(
      "http://localhost/mcp"
    );
  });

  it("leaves other hosts untouched", () => {
    expect(normalizeUrlHost("https://example.com")).toBe("https://example.com");
    expect(normalizeUrlHost("http://10.0.0.0:3000")).toBe(
      "http://10.0.0.0:3000"
    );
  });
});

describe("requestOrigin", () => {
  it("prefers X-Forwarded-Host and X-Forwarded-Proto", () => {
    const h = headers({
      "X-Forwarded-Host": "public.example.com",
      "X-Forwarded-Proto": "https",
      Host: "internal:3000",
    });
    expect(requestOrigin(h, "http://internal:3000/mcp")).toBe(
      "https://public.example.com"
    );
  });

  it("falls back to the Host header when no forwarded host is present", () => {
    const h = headers({ Host: "myhost:8080" });
    expect(requestOrigin(h, "http://myhost:8080/mcp")).toBe(
      "http://myhost:8080"
    );
  });

  it("falls back to the request URL when no host headers are present", () => {
    const h = headers({});
    expect(requestOrigin(h, "https://fromurl.test/mcp")).toBe(
      "https://fromurl.test"
    );
  });

  it("normalizes a 0.0.0.0 host to localhost", () => {
    const h = headers({ Host: "0.0.0.0:3000" });
    expect(requestOrigin(h, "http://0.0.0.0:3000/mcp")).toBe(
      "http://localhost:3000"
    );
  });
});

describe("canonicalOrigin", () => {
  afterEach(() => {
    delete process.env.MCP_URL;
  });

  it("uses MCP_URL when provided (highest precedence)", () => {
    const h = headers({ "X-Forwarded-Host": "attacker.example" });
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://internal:3000/mcp",
        fallback: "http://localhost:3000",
        mcpUrl: "https://canonical.example.com",
      })
    ).toBe("https://canonical.example.com");
  });

  it("reads MCP_URL from the environment when not passed explicitly", () => {
    process.env.MCP_URL = "https://from-env.example.com";
    expect(canonicalOrigin({ fallback: "http://localhost:3000" })).toBe(
      "https://from-env.example.com"
    );
  });

  it("infers from the request origin when MCP_URL is unset and no allow-list is configured", () => {
    const h = headers({
      "X-Forwarded-Host": "public.example.com",
      "X-Forwarded-Proto": "https",
    });
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://internal:3000/mcp",
        fallback: "http://localhost:3000",
      })
    ).toBe("https://public.example.com");
  });

  it("trusts a forwarded host whose hostname is in allowedOrigins", () => {
    const h = headers({
      "X-Forwarded-Host": "public.example.com",
      "X-Forwarded-Proto": "https",
    });
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://internal:3000/mcp",
        fallback: "http://localhost:3000",
        allowedOrigins: ["https://public.example.com"],
      })
    ).toBe("https://public.example.com");
  });

  it("REJECTS a spoofed forwarded host not in allowedOrigins (falls back)", () => {
    const h = headers({
      "X-Forwarded-Host": "attacker.evil.com",
      "X-Forwarded-Proto": "https",
    });
    // A configured allow-list means an untrusted forwarded host must NOT forge
    // the canonical origin — we fall back to the configured origin instead.
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://internal:3000/mcp",
        fallback: "https://public.example.com",
        allowedOrigins: ["https://public.example.com"],
      })
    ).toBe("https://public.example.com");
  });

  it("still uses MCP_URL even when a spoofed forwarded host is present with an allow-list", () => {
    const h = headers({ "X-Forwarded-Host": "attacker.evil.com" });
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://internal:3000/mcp",
        fallback: "http://localhost:3000",
        allowedOrigins: ["https://public.example.com"],
        mcpUrl: "https://canonical.example.com",
      })
    ).toBe("https://canonical.example.com");
  });

  it("falls back to host:port when no request is in scope", () => {
    expect(canonicalOrigin({ fallback: "http://localhost:3000" })).toBe(
      "http://localhost:3000"
    );
  });

  it("normalizes a 0.0.0.0 fallback to localhost", () => {
    expect(canonicalOrigin({ fallback: "http://0.0.0.0:3000" })).toBe(
      "http://localhost:3000"
    );
  });

  it("trusts the plain Host header (no forwarded host) even with an allow-list", () => {
    // Only X-Forwarded-Host is attacker-controllable; the plain Host path is
    // gated separately by DNS-rebinding host validation, so it stays trusted.
    const h = headers({ Host: "public.example.com" });
    expect(
      canonicalOrigin({
        header: h,
        requestUrl: "http://public.example.com/mcp",
        fallback: "http://localhost:3000",
        allowedOrigins: ["https://public.example.com"],
      })
    ).toBe("http://public.example.com");
  });
});
