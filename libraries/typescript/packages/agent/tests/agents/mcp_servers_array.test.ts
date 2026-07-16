import { describe, expect, it, vi } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import type { McpConnectionLike } from "../../src/agents/agent_options.js";

type AgentInternals = {
  providerTools: Array<{ name: string }>;
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  initialized: boolean;
};

function internals(agent: MCPAgent): AgentInternals {
  return agent as unknown as AgentInternals;
}

describe("MCPAgent mcpServers live connections", () => {
  it("binds a single live connection from mcpServers array", async () => {
    const connection: McpConnectionLike = {
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    const agent = new MCPAgent({
      llm: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
      },
      mcpServers: [connection],
    });

    const inner = internals(agent);
    expect(inner.initialized).toBe(true);
    expect(inner.providerTools).toHaveLength(1);
    expect(inner.providerTools[0]?.name).toBe("echo");

    await inner.callTool("echo", { msg: "hi" });
    expect(connection.callTool).toHaveBeenCalledWith("echo", { msg: "hi" });
  });

  it("deduplicates tool names across multiple live connections", async () => {
    const serverA: McpConnectionLike = {
      tools: [{ name: "search", description: "A" }],
      callTool: vi.fn().mockResolvedValue("a"),
    };
    const serverB: McpConnectionLike = {
      tools: [{ name: "search", description: "B" }],
      callTool: vi.fn().mockResolvedValue("b"),
    };

    const agent = new MCPAgent({
      llm: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
      },
      mcpServers: [serverA, serverB],
    });

    const inner = internals(agent);
    expect(inner.providerTools.map((t) => t.name)).toEqual(["search", "search_2"]);

    await inner.callTool("search", {});
    expect(serverA.callTool).toHaveBeenCalledWith("search", {});

    await inner.callTool("search_2", {});
    expect(serverB.callTool).toHaveBeenCalledWith("search", {});
  });

  it("filters disallowed tools from live connections", () => {
    const connection: McpConnectionLike = {
      tools: [
        { name: "allowed", description: "ok" },
        { name: "blocked", description: "no" },
      ],
      callTool: vi.fn(),
    };

    const agent = new MCPAgent({
      llm: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
      },
      mcpServers: [connection],
      disallowedTools: ["blocked"],
    });

    expect(internals(agent).providerTools.map((t) => t.name)).toEqual(["allowed"]);
  });

  it("requires mcpServers or client in simplified mode", () => {
    expect(
      () =>
        new MCPAgent({
          llm: "openai/gpt-4o",
        })
    ).toThrow(/mcpServers/);
  });
});
