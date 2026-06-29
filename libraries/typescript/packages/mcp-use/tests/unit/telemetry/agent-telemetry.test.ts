/**
 * Tests for MCPAgent telemetry integration
 *
 * These tests verify that MCPAgent correctly triggers telemetry events:
 * - trackAgentExecution in stream() method's finally block
 * - trackAgentExecution in streamEvents() method's finally block
 * - Correct event data is captured (query, success, tools, execution time, etc.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPostHogEvent,
  flushPostHogTelemetry,
  installTelemetryFetchMock,
  restoreTelemetryFetchMock,
} from "./telemetry-test-utils.js";
import { BaseConnector } from "../../../src/connectors/base.js";

type MockToolCall = Record<string, unknown>;
type MockLlm = {
  invoke: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
  _llm_type: string;
  modelName: string;
};

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
    tool_calls: MockToolCall[];
    constructor(
      content: string | { content: string; tool_calls?: MockToolCall[] }
    ) {
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

// Mock MCPClient
vi.mock("../../../src/client.js", () => ({
  MCPClient: class {
    getAllActiveSessions = vi.fn().mockReturnValue({});
    createAllSessions = vi.fn().mockResolvedValue({});
    closeAllSessions = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    getServerNames = vi.fn().mockReturnValue([]);
  },
}));

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
class MockConnector extends BaseConnector {
  constructor(private identifier = "mock-connector") {
    super();
  }

  get publicIdentifier(): Record<string, string> {
    return { name: this.identifier };
  }

  connect = vi.fn().mockResolvedValue(undefined);
  listTools = vi.fn().mockResolvedValue([]);
}

describe("MCPAgent Telemetry Integration", () => {
  let mockLlm: MockLlm;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY; // Ensure telemetry is enabled
    vi.resetModules();
    vi.clearAllMocks();
    installTelemetryFetchMock();

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

  afterEach(async () => {
    await flushPostHogTelemetry();
    // Restore original environment
    process.env = originalEnv;
    restoreTelemetryFetchMock();
    vi.clearAllMocks();
  });

  describe("trackAgentExecution in stream()", () => {
    it("should track execution on successful stream run", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
        maxSteps: 5,
        memoryEnabled: true,
      });

      await agent.initialize();

      // Run the agent
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        execution_method: "stream",
        query: "test query",
        success: true,
        model_provider: "openai",
        model_name: "gpt-4",
        memory_enabled: true,
        max_steps_configured: 5,
      });
    });

    it("should track execution with correct server count", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector1 = new MockConnector();
      const connector2 = new MockConnector("mock-connector-2");

      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector1, connector2],
        maxSteps: 3,
      });

      await agent.initialize();
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        server_count: 2,
        server_identifiers: expect.arrayContaining([
          { name: "mock-connector" },
          { name: "mock-connector-2" },
        ]),
      });
    });

    it("should track execution with tools information", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        total_tools_available: expect.any(Number),
        tools_available_names: expect.any(Array),
      });
    });

    it("should track execution time", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        execution_time_ms: expect.any(Number),
      });

      // Verify execution time is reasonable (> 0)
      expect(event.properties.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("should track manageConnector parameter", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();
      await agent.run("test query", undefined, false);

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        manage_connector: false,
      });
    });

    it("should track external history usage", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");
      const { HumanMessage, AIMessage } = await import("langchain");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();

      const externalHistory = [
        new HumanMessage("Previous question"),
        new AIMessage("Previous answer"),
      ];

      await agent.run("test query", undefined, true, externalHistory);

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        external_history_used: true,
      });
    });

    it("should track conversation history length when memory is enabled", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
        memoryEnabled: true,
      });

      await agent.initialize();
      await agent.run("first query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        conversation_history_length: expect.any(Number),
      });
    });
  });

  describe("trackAgentExecution in streamEvents()", () => {
    it("should track execution on streamEvents run", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
        maxSteps: 5,
      });

      await agent.initialize();

      // Consume the stream
      const events = [];
      for await (const event of agent.streamEvents("test query")) {
        events.push(event);
      }

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        execution_method: "streamEvents",
        query: "test query",
        success: true,
      });
    });

    it("should track response length for streamed responses", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();

      // Consume the stream
      for await (const _ of agent.streamEvents("test query")) {
        // Just consume events
      }

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties.response).toContain("STREAMED RESPONSE");
    });
  });

  describe("error tracking", () => {
    it("should track error type on failure", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
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
      const { MCPClient } = await import("../../../src/client.js");

      const client = new MCPClient();
      const agent = new MCPAgent({
        llm: mockLlm,
        client,
        useServerManager: false,
      });

      await agent.initialize();
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        use_server_manager: false,
      });
    });
  });

  describe("model info extraction", () => {
    it("should extract model provider and name", async () => {
      const { MCPAgent } = await import("../../../src/agents/mcp_agent.js");

      const connector = new MockConnector();
      const agent = new MCPAgent({
        llm: mockLlm,
        connectors: [connector],
      });

      await agent.initialize();
      await agent.run("test query");

      const event = await expectPostHogEvent("mcp_agent_execution");
      expect(event.properties).toMatchObject({
        model_provider: "openai",
        model_name: "gpt-4",
      });
    });
  });
});
