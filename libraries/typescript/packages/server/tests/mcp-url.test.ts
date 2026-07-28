import { describe, expect, it } from "vitest";

import { resolveMcpEndpointUrl } from "../src/mcp-url.js";

describe("resolveMcpEndpointUrl", () => {
  it("combines the public origin with the exact base path", () => {
    expect(
      resolveMcpEndpointUrl("https://api.example.com", "/tenant-a/api/mcp").href
    ).toBe("https://api.example.com/tenant-a/api/mcp");
  });

  it("replaces any accidental path on the origin instead of appending twice", () => {
    expect(
      resolveMcpEndpointUrl("https://api.example.com/stale/mcp", "/api/mcp")
        .href
    ).toBe("https://api.example.com/api/mcp");
  });

  it("preserves the canonical root slash", () => {
    expect(resolveMcpEndpointUrl("https://api.example.com", "/").href).toBe(
      "https://api.example.com/"
    );
  });
});
