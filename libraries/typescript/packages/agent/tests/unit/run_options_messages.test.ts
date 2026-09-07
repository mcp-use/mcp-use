/**
 * Tests that RunOptions.messages is forwarded by the LangChain agent.
 *
 * Regression test for issue #2462: RunOptions.messages was silently dropped
 * by the LangChain agent because normalizeRunOptions did not propagate the
 * field and stream()/streamEvents() did not consume it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the messages array passed to agentExecutor.stream() so tests can
// inspect whether RunOptions.messages was forwarded correctly.
const capturedStreamInputs: any[] = [];

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue("test-user-id"),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock/home"),
}));

vi.mock("langchain", () => ({
  createAgent: vi.fn(() => ({
    stream: vi.fn().mockImplementation(async function* (inputs: any) {
      capturedStreamInputs.push(inputs);
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
    streamEvents: vi.fn().mockImplementation(async function* (inputs: any) {
      capturedStreamInputs.push(inputs);
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
    type = "human";
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
    type = "ai";
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
    type = "system";
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
    type = "tool";
    constructor(data: { content: string; tool_call_id: string }) {
      this.content = data.content;
      this.tool_call_id = data.tool_call_id;
    }
    getType() {
      return "tool";
    }
  },
}));

vi.mock("../../src/adapters/langchain_adapter.js", () => ({
  LangChainAdapter: class {
    createToolsFromConnectors = vi.fn().mockResolvedValue([]);
    createResourcesFromConnectors = vi.fn().mockResolvedValue([]);
    createPromptsFromConnectors = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("@mcp-use/client", async (importOriginal) => {
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
      getInstance: () => ({
        trackAgentExecution: vi.fn(),
      }),
    },
  };
});

vi.mock("../../src/observability/index.js", () => ({
  ObservabilityManager: class {
    getCallbacks = vi.fn().mockResolvedValue([]);
    getHandlerNames = vi.fn().mockResolvedValue([]);
    flush = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

class MockConnector {
  publicIdentifier = "mock-connector";
  isClientConnected = true;
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
  listTools = vi.fn().mockResolvedValue([]);
}

describe("RunOptions.messages forwarding", () => {
  let mockLlm: any;

  beforeEach(() => {
    capturedStreamInputs.length = 0;
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stream(): forwards RunOptions.messages before the prompt", async () => {
    const { MCPAgent } =
      await import("../../src/agents/mcp_agent_langchain.js");

    const connector = new MockConnector();
    const agent = new MCPAgent({
      llm: mockLlm,
      connectors: [connector as any],
      memoryEnabled: false,
    });

    await agent.initialize();

    await agent.run({
      prompt: "what is the weather",
      messages: [{ role: "user", content: "CANARY-PROVIDER-MESSAGE" }],
    });

    expect(capturedStreamInputs.length).toBeGreaterThan(0);
    const { messages } = capturedStreamInputs[0];
    expect(messages).toBeDefined();

    // The CANARY message should appear before the prompt HumanMessage.
    const contents = messages.map((m: any) => m.content);
    const canaryIndex = contents.indexOf("CANARY-PROVIDER-MESSAGE");
    const promptIndex = contents.indexOf("what is the weather");

    expect(canaryIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(canaryIndex).toBeLessThan(promptIndex);
  });

  it("stream(): omitting messages does not break execution", async () => {
    const { MCPAgent } =
      await import("../../src/agents/mcp_agent_langchain.js");

    const connector = new MockConnector();
    const agent = new MCPAgent({
      llm: mockLlm,
      connectors: [connector as any],
      memoryEnabled: false,
    });

    await agent.initialize();

    const result = await agent.run({ prompt: "hello" });
    expect(result).toBe("Test response");
  });

  it("streamEvents(): forwards RunOptions.messages before the prompt", async () => {
    const { MCPAgent } =
      await import("../../src/agents/mcp_agent_langchain.js");

    const connector = new MockConnector();
    const agent = new MCPAgent({
      llm: mockLlm,
      connectors: [connector as any],
      memoryEnabled: false,
    });

    await agent.initialize();

    for await (const _ of agent.streamEvents({
      prompt: "what is the weather",
      messages: [{ role: "user", content: "CANARY-PROVIDER-MESSAGE" }],
    })) {
      // consume events
    }

    expect(capturedStreamInputs.length).toBeGreaterThan(0);
    const { messages } = capturedStreamInputs[0];
    expect(messages).toBeDefined();

    const contents = messages.map((m: any) => m.content);
    const canaryIndex = contents.indexOf("CANARY-PROVIDER-MESSAGE");
    const promptIndex = contents.indexOf("what is the weather");

    expect(canaryIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(canaryIndex).toBeLessThan(promptIndex);
  });
});
