import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";

describe("MCPAgent autoInitialize defaults", () => {
  it("defaults autoInitialize to true in simplified mode", () => {
    const agent = new MCPAgent({
      llm: "openai/gpt-4o-mini",
      mcpServers: {
        demo: { url: "http://127.0.0.1:9999/mcp" },
      },
    });

    expect((agent as any).autoInitialize).toBe(true);
  });

  it("defaults autoInitialize to false in explicit provider mode", () => {
    const agent = new MCPAgent({
      llm: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "test-key",
      },
      mcpServers: {
        demo: { url: "http://127.0.0.1:9999/mcp" },
      },
    });

    expect((agent as any).autoInitialize).toBe(false);
  });

  it("honors explicit autoInitialize: false in simplified mode", () => {
    const agent = new MCPAgent({
      llm: "openai/gpt-4o-mini",
      mcpServers: {
        demo: { url: "http://127.0.0.1:9999/mcp" },
      },
      autoInitialize: false,
    });

    expect((agent as any).autoInitialize).toBe(false);
  });
});
