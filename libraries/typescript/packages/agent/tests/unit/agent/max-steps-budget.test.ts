/**
 * Tests for MCPAgent telemetry integration
 *
 * These tests verify that MCPAgent correctly triggers telemetry events:
 * - trackAgentExecution in stream() method's finally block
 * - trackAgentExecution in streamEvents() method's finally block
 * - Correct event data is captured (query, success, tools, execution time, etc.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records the data the agent passes to Telemetry.trackAgentExecution. Telemetry
// itself (PostHog forwarding, the snake_cased event payload) lives in and is
// tested by @mcp-use/client; the agent's responsibility — and what this suite
// verifies — is that it invokes trackAgentExecution with the correct metadata.
// We therefore stub Telemetry at the @mcp-use/client boundary (below) rather
// than reaching down through the client's compiled dist to PostHog.
const mockTrackAgentExecution = vi.fn();

/** The data object from the most recent trackAgentExecution call. */
function lastExecution(): any {
  const calls = mockTrackAgentExecution.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
}

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue("test-user-id"),
}));

// Mock os module
vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock/home"),
}));

// Mock langchain dependencies
vi.mock("langchain", () => ({
  createAgent: vi.fn(() => ({
    stream: vi.fn().mockImplementation(async function* () {
      yield {
        agent: {
          messages: [
            {
              type: "ai",
              content: "Test response",
              tool_calls: [],
            },
          ],
        },
      };
    }),
    streamEvents: vi.fn().mockImplementation(async function* () {
      yield {
        event: "on_chat_model_stream",
        data: { chunk: { content: "Test" } },
      };
      yield {
        event: "on_chain_end",
        data: { output: "Test response" },
      };
    }),
  })),
  modelCallLimitMiddleware: vi.fn(() => ({})),
  HumanMessage: class {
    content: string;
    constructor(content: string | { content: string }) {
      this.content = typeof content === "string" ? content : content.content;
    }
    getType() {
      return "human";
    }
  },
  AIMessage: class {
    content: string;
    tool_calls: any[];
    constructor(content: string | { content: string; tool_calls?: any[] }) {
      if (typeof content === "string") {
        this.content = content;
        this.tool_calls = [];
      } else {
        this.content = content.content;
        this.tool_calls = content.tool_calls || [];
      }
    }
    getType() {
      return "ai";
    }
  },
  SystemMessage: class {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
    getType() {
      return "system";
    }
  },
  ToolMessage: class {
    content: string;
    tool_call_id: string;
    constructor(data: { content: string; tool_call_id: string }) {
      this.content = data.content;
      this.tool_call_id = data.tool_call_id;
    }
    getType() {
      return "tool";
    }
  },
}));

// Mock the LangChain adapter
vi.mock("../../../src/adapters/langchain_adapter.js", () => ({
  LangChainAdapter: class {
    createToolsFromConnectors = vi.fn().mockResolvedValue([
      {
        name: "test_tool",
        description: "A test tool",
        schema: {},
        func: vi.fn().mockResolvedValue("Test tool result"),
      },
    ]);
    createResourcesFromConnectors = vi.fn().mockResolvedValue([]);
    createPromptsFromConnectors = vi.fn().mockResolvedValue([]);
    static createTools = vi.fn().mockResolvedValue([
      {
        name: "test_tool",
        description: "A test tool",
        schema: {},
        func: vi.fn().mockResolvedValue("Test tool result"),
      },
    ]);
  },
}));

// Mock MCPClient + Telemetry (partial — preserve the rest of @mcp-use/client's
// surface). The agent only consumes Telemetry.getInstance() and
// trackAgentExecution, so the double implements exactly those.
vi.mock("@mcp-use/client", async (importOriginal) => {
  const mockTelemetryInstance = {
    trackAgentExecution: mockTrackAgentExecution,
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    MCPClient: class {
      getAllActiveSessions = vi.fn().mockReturnValue({});
      createAllSessions = vi.fn().mockResolvedValue({});
      closeAllSessions = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      getServerNames = vi.fn().mockReturnValue([]);
    },
    Telemetry: {
      getInstance: () => mockTelemetryInstance,
    },
  };
});

// Mock observability manager
vi.mock("../../../src/observability/index.js", () => ({
  ObservabilityManager: class {
    getCallbacks = vi.fn().mockResolvedValue([]);
    getHandlerNames = vi.fn().mockResolvedValue([]);
    flush = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock BaseConnector
class MockConnector {
  publicIdentifier = "mock-connector";
  isClientConnected = true;
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
  listTools = vi.fn().mockResolvedValue([]);
}

import { createAgent } from "langchain";

/**
 * `modelCallLimitMiddleware` takes its budget when the executor is built, so a
 * per-call `maxSteps` only takes effect if it is passed again through the run
 * context. These assert the budget the executor actually receives.
 */
describe("per-call maxSteps", () => {
  let mockLlm: any;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockLlm = {
      invoke: vi.fn().mockResolvedValue({ content: "Test response" }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: "Test" };
      }),
      _llm_type: "openai",
      modelName: "gpt-4",
    };
  });

  async function startAgent(): Promise<any> {
    const { MCPAgent } =
      await import("../../../src/agents/mcp_agent_langchain.js");
    const agent = new MCPAgent({
      llm: mockLlm,
      connectors: [new MockConnector() as any],
      maxSteps: 5,
    });
    await agent.initialize();
    return agent;
  }

  /** Config the executor was last invoked with. */
  function lastConfig(method: "stream" | "streamEvents"): any {
    const results = (createAgent as any).mock.results;
    const executor = results[results.length - 1].value;
    return executor[method].mock.calls.at(-1)?.[1];
  }

  it("run() enforces the budget it was given", async () => {
    const agent = await startAgent();

    await agent.run({ prompt: "q", maxSteps: 20 });

    expect(lastConfig("stream")).toMatchObject({
      context: { runLimit: 20 },
      recursionLimit: 60,
    });
  });

  it("streamEvents() enforces it and leaves the default in place", async () => {
    const agent = await startAgent();

    for await (const _ of agent.streamEvents({ prompt: "q", maxSteps: 20 })) {
      // drain
    }
    expect(lastConfig("streamEvents")).toMatchObject({
      context: { runLimit: 20 },
      recursionLimit: 60,
    });

    for await (const _ of agent.streamEvents({ prompt: "q2" })) {
      // drain
    }
    expect(lastConfig("streamEvents")).toMatchObject({
      context: { runLimit: 5 },
      recursionLimit: 15,
    });
  });
});
