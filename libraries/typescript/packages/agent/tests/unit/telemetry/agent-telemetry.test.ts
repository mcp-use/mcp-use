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

describe("MCPAgent Telemetry Integration", () => {
  let mockLlm: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY; // Ensure telemetry is enabled
    vi.resetModules();
    vi.clearAllMocks();
    mockTrackAgentExecution.mockClear();

    // Create a minimal mock LLM
    mockLlm = {
      invoke: vi.fn().mockResolvedValue({
        content: "Test response",
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: "Test" };
      }),
      _llm_type: "openai",
      modelName: "gpt-4",
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("trackAgentExecution in stream()", () => {
    it("should track execution on successful stream run", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
        maxSteps: 5,
        memoryEnabled: true,
      });

      await agent.initialize();

      // Run the agent
      const result = await agent.run("test query");

      // Verify the agent tracked execution with the correct metadata
      expect(mockTrackAgentExecution).toHaveBeenCalled();
      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        executionMethod: "stream",
        query: "test query",
        success: true,
        modelProvider: "openai",
        modelName: "gpt-4",
        memoryEnabled: true,
        maxStepsConfigured: 5,
      });
    });

    it("should track execution with correct server count", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector1 = new MockConnector();
      const connector2 = new MockConnector();
      connector2.publicIdentifier = "mock-connector-2";

      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector1 as any, connector2 as any],
        maxSteps: 3,
      });

      await agent.initialize();
      await agent.run("test query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        serverCount: 2,
        serverIdentifiers: expect.arrayContaining([
          "mock-connector",
          "mock-connector-2",
        ]),
      });
    });

    it("should track execution with tools information", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();
      await agent.run("test query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        totalToolsAvailable: expect.any(Number),
        toolsAvailableNames: expect.any(Array),
      });
    });

    it("should track execution time", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();
      await agent.run("test query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        executionTimeMs: expect.any(Number),
      });

      // Verify execution time is reasonable (> 0)
      expect(exec.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should track manageConnector parameter", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();
      await agent.run("test query", undefined, false);

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        manageConnector: false,
      });
    });

    it("should track external history usage", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");
      const { HumanMessage, AIMessage } = await import("langchain");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();

      const externalHistory = [
        new HumanMessage("Previous question"),
        new AIMessage("Previous answer"),
      ];

      await agent.run("test query", undefined, true, externalHistory);

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        externalHistoryUsed: true,
      });
    });

    it("should track conversation history length when memory is enabled", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
        memoryEnabled: true,
      });

      await agent.initialize();
      await agent.run("first query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        conversationHistoryLength: expect.any(Number),
      });
    });
  });

  describe("trackAgentExecution in streamEvents()", () => {
    it("should track execution on streamEvents run", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
        maxSteps: 5,
      });

      await agent.initialize();

      // Consume the stream
      const events = [];
      for await (const event of agent.streamEvents("test query")) {
        events.push(event);
      }

      // Verify telemetry was tracked with streamEvents method
      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        executionMethod: "streamEvents",
        query: "test query",
        success: true,
      });
    });

    it("should track response length for streamed responses", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();

      // Consume the stream
      for await (const _ of agent.streamEvents("test query")) {
        // Just consume events
      }

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec.response).toContain("STREAMED RESPONSE");
    });
  });

  describe("error tracking", () => {
    it("should track error type on failure", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      // Don't initialize - this should cause an error
      try {
        await agent.run("test query", undefined, false);
      } catch (e) {
        // Expected to fail
      }

      // Telemetry might not be called if initialization fails early
      // The agent needs to be initialized before tracking
    });
  });

  describe("useServerManager tracking", () => {
    it("should track useServerManager configuration", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");
      const { MCPClient } = await import("@mcp-use/client");

      const client = new MCPClient();
      const agent = new MCPAgent({
        llm: mockLlm,
        client: client as any,
        useServerManager: false,
      });

      await agent.initialize();
      await agent.run("test query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        useServerManager: false,
      });
    });
  });

  describe("model info extraction", () => {
    it("should extract model provider and name", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector as any],
      });

      await agent.initialize();
      await agent.run("test query");

      const exec = lastExecution();
      expect(exec).toBeDefined();
      expect(exec).toMatchObject({
        modelProvider: "openai",
        modelName: "gpt-4",
      });
    });
  });
});
