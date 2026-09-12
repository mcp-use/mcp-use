/**
 * Per-call maxSteps, observed at the executor boundary.
 *
 * modelCallLimitMiddleware takes its runLimit when the executor is built, so
 * the effect of a per-call budget is only visible in the config the executor
 * is invoked with. Both the executor and the middleware are mocked here, so
 * these assert forwarding rather than enforcement.
 */

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

/** Constructor default every case below overrides or falls back to. */
const DEFAULT_MAX_STEPS = 5;

/**
 * Public entry points that take a per-call budget. `run` delegates to `stream`
 * with positional arguments, so the options-object overload of `stream` needs
 * its own cases rather than riding on the `run` ones.
 */
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
    // Inject the executor and mark the agent ready, so initialize() does not
    // build a real one over the top of it.
    Object.assign(agent as never as Record<string, unknown>, {
      _agentExecutor: { stream, streamEvents, invoke: vi.fn() },
      _initialized: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** Drain a path and return the config its executor call received. */
  async function budgetFor(
    path: Path,
    maxSteps?: number
  ): Promise<{ runLimit?: number; recursionLimit?: number }> {
    const options = {
      prompt: "q",
      ...(maxSteps !== undefined && { maxSteps }),
    };
    if (path === "run") {
      await agent.run(options);
    } else if (path === "stream") {
      for await (const _ of agent.stream(options)) {
        // drain
      }
    } else {
      for await (const _ of agent.streamEvents(options)) {
        // drain
      }
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
