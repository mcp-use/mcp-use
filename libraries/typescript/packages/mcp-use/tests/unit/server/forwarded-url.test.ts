import { describe, expect, it } from "vitest";
import { buildForwardedUrl } from "../../../src/server/endpoints/mount-mcp.js";

describe("buildForwardedUrl", () => {
  const base = {
    reqUrl: "http://127.0.0.1:3001/mcp",
    path: "/mcp",
  };

  it("falls back to the request URL when no proxy headers are present", () => {
    expect(buildForwardedUrl(base)).toBe("http://127.0.0.1:3001/mcp");
  });

  it("honors single-value X-Forwarded-Proto / X-Forwarded-Host", () => {
    expect(
      buildForwardedUrl({
        ...base,
        forwardedProto: "https",
        forwardedHost: "alone-chocolate.local.mcp-use.run",
      })
    ).toBe("https://alone-chocolate.local.mcp-use.run/mcp");
  });

  it("takes the first value of a comma-separated X-Forwarded-Proto (tunnel chain)", () => {
    // Regression: tunnel chains produce "https,http" (edge sets https, local
    // hop appends http). Naive interpolation built "https,http://host/mcp",
    // which throws TypeError: Invalid URL in `new URL()`.
    const url = buildForwardedUrl({
      ...base,
      forwardedProto: "https,http",
      forwardedHost: "alone-chocolate.local.mcp-use.run",
    });

    expect(url).toBe("https://alone-chocolate.local.mcp-use.run/mcp");
    // The result must be a valid URL — this is what previously threw.
    expect(() => new URL(url)).not.toThrow();
  });

  it("trims whitespace in comma-separated lists (RFC 7239 style spacing)", () => {
    expect(
      buildForwardedUrl({
        ...base,
        forwardedProto: "https, http",
        forwardedHost: "example.com, internal.local",
      })
    ).toBe("https://example.com/mcp");
  });

  it("falls back to X-Forwarded-Protocol when X-Forwarded-Proto is absent", () => {
    expect(
      buildForwardedUrl({
        ...base,
        forwardedProtocol: "https",
        forwardedHost: "example.com",
      })
    ).toBe("https://example.com/mcp");
  });

  it("prefers the Host header over the request URL host when no X-Forwarded-Host", () => {
    expect(
      buildForwardedUrl({
        ...base,
        forwardedProto: "https",
        host: "public.example.com",
      })
    ).toBe("https://public.example.com/mcp");
  });

  it("ignores empty forwarded header values", () => {
    expect(
      buildForwardedUrl({
        ...base,
        forwardedProto: "",
        forwardedHost: "",
      })
    ).toBe("http://127.0.0.1:3001/mcp");
  });
});
