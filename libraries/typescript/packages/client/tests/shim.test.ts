import { describe, expect, it } from "vitest";

describe("@mcp-use/client shim", () => {
  it("re-exports MCPClient from mcp-use/client", async () => {
    const client = await import("@mcp-use/client");
    const legacy = await import("mcp-use/client");
    expect(client.MCPClient).toBe(legacy.MCPClient);
  });

  it("re-exports browser MCPClient", async () => {
    const client = await import("@mcp-use/client/browser");
    const legacy = await import("mcp-use/browser");
    expect(client.MCPClient).toBe(legacy.MCPClient);
  });
});
