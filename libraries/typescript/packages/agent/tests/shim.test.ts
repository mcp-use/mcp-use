import { describe, expect, it } from "vitest";

describe("@mcp-use/agent shim", () => {
  it("re-exports MCPAgent from mcp-use/agent", async () => {
    const agent = await import("@mcp-use/agent");
    const legacy = await import("mcp-use/agent");
    expect(agent.MCPAgent).toBe(legacy.MCPAgent);
  });

  it("re-exports browser MCPAgent", async () => {
    const agent = await import("@mcp-use/agent/browser");
    const legacy = await import("mcp-use/browser/agent");
    expect(agent.MCPAgent).toBe(legacy.MCPAgent);
  });
});
