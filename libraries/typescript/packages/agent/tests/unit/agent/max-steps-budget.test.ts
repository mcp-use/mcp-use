import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCPAgent } from "../../../src/agents/mcp_agent_langchain.js";
import { MCPClient } from "@mcp-use/client";

vi.mock("@mcp-use/client", async (importOriginal) => {
  class MockMCPClient {
    getAllActiveSessions = vi.fn().mockResolvedValue({});
    createAllSessions = vi.fn().mockResolvedValue({});
    closeAllSessions = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    MCPClient: MockMCPClient,
  };
});

vi.mock("../../../src/adapters/langchain_adapter.js", () => ({
  LangChainAdapter: class {
    createToolsFromConnectors = vi.fn().mockResolvedValue([]);
    createResourcesFromConnectors = vi.fn().mockResolvedValue([]);
    createPromptsFromConnectors = vi.fn().mockResolvedValue([]);
  },
}));

const DEFAULT_MAX_STEPS = 5;

type Path = "run" | "stream" | "streamEvents";

describe("per-call maxSteps", () => {
  let agent: MCPAgent;
  let stream: ReturnType<typeof vi.fn>;
  let streamEvents: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agent = new MCPAgent({
      llm: { invoke: vi.fn(), _llmType: "openai" } as never,
      client: new MCPClient({}),
      maxSteps: DEFAULT_MAX_STEPS,
      verbose: false,
    });

    stream = vi.fn().mockImplementation(async function* () {
      yield { agent: { messages: [{ type: "ai", content: "ok" }] } };
    });
    streamEvents = vi.fn().mockImplementation(async function* () {
      yield { event: "on_chain_end", data: { output: "ok" } };
    });
    Object.assign(agent as never as Record<string, unknown>, {
      _agentExecutor: { stream, streamEvents, invoke: vi.fn() },
      _initialized: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function budgetFor(
    path: Path,
    maxSteps?: number
  ): Promise<{ runLimit?: number; recursionLimit?: number }> {
    const options = {
      prompt: "q",
      ...(maxSteps !== undefined && { maxSteps }),
    };
    const drained: unknown[] = [];
    if (path === "run") {
      await agent.run(options);
    } else if (path === "stream") {
      for await (const event of agent.stream(options)) drained.push(event);
    } else {
      for await (const event of agent.streamEvents(options))
        drained.push(event);
    }
    const mock = path === "streamEvents" ? streamEvents : stream;
    const config = mock.mock.calls.at(-1)?.[1] as {
      context?: { runLimit?: number };
      recursionLimit?: number;
    };
    return {
      runLimit: config?.context?.runLimit,
      recursionLimit: config?.recursionLimit,
    };
  }

  it.each([
    ["run", 2, 6],
    ["run", 20, 60],
    ["stream", 2, 6],
    ["stream", 20, 60],
    ["streamEvents", 2, 6],
    ["streamEvents", 20, 60],
  ] as const)(
    "%s() passes a budget of %i to the executor",
    async (path, maxSteps, recursionLimit) => {
      expect(await budgetFor(path, maxSteps)).toEqual({
        runLimit: maxSteps,
        recursionLimit,
      });
    }
  );

  it.each(["run", "stream", "streamEvents"] as const)(
    "%s() leaves the constructor default in place for the next call",
    async (path) => {
      await budgetFor(path, 20);

      expect(await budgetFor(path)).toEqual({
        runLimit: DEFAULT_MAX_STEPS,
        recursionLimit: DEFAULT_MAX_STEPS * 3,
      });
      expect(agent["maxSteps"]).toBe(DEFAULT_MAX_STEPS);
    }
  );
});
