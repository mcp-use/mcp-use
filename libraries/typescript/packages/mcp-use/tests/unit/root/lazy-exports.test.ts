import { describe, expect, it } from "vitest";

describe("mcp-use root lazy exports", () => {
  it("does not load agent module until MCPAgent is accessed", async () => {
    const root = await import("mcp-use");
    expect(root.Tel).toBeDefined();
    expect(root.MCPAgent).toBeDefined();
    // Proxy class should not have loaded real constructor yet
    expect(typeof root.MCPAgent).toBe("function");
  });
});
