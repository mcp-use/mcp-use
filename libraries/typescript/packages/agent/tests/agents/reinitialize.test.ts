import type { BaseConnector } from "@mcp-use/client";
import { afterEach, expect, it, vi } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";

vi.mock("@mcp-use/client", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("can invoke a supplied connector after close and reinitialize", async () => {
  const callTool = vi.fn(async () => ({
    content: [{ type: "text", text: "hello" }],
  }));
  const connector = {
    tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }],
    isClientConnected: true,
    callTool,
  } as unknown as BaseConnector;
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      requests++;
      const message =
        requests % 2 === 1
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "echo-call",
                  type: "function",
                  function: { name: "echo", arguments: "{}" },
                },
              ],
            }
          : { role: "assistant", content: "done" };
      return Response.json({ choices: [{ message }] });
    })
  );
  const agent = new MCPAgent({
    llm: {
      provider: "openai-compatible",
      model: "test-model",
      baseUrl: "http://localhost:1234/v1",
    },
    connectors: [connector],
    exposeResourcesAsTools: false,
    exposePromptsAsTools: false,
    memoryEnabled: false,
  });

  try {
    await agent.initialize();
    expect(await agent.run({ prompt: "echo hello" })).toBe("done");
    expect(callTool).toHaveBeenCalledTimes(1);
    await agent.close();
    await agent.initialize();
    expect(await agent.run({ prompt: "echo hello" })).toBe("done");
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenLastCalledWith("echo", {});
  } finally {
    await agent.close();
  }
});
