import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { WebMCP } from "../../../src/react/WebMCP.js";

const mockProvideContext = vi.fn();
const mockClearContext = vi.fn();

const mockTool = {
  name: "test_tool",
  description: "A test tool",
  inputSchema: {
    type: "object" as const,
    properties: {
      foo: { type: "string", description: "Foo arg" },
    },
    required: ["foo"],
  },
};

const mockCallTool = vi.fn();

vi.mock("../../../src/react/useMcp.js", () => ({
  useMcp: (options: unknown) => {
    const [state, setState] = React.useState<
      "discovering" | "pending_auth" | "authenticating" | "ready" | "failed"
    >("discovering");

    React.useEffect(() => {
      setState("ready");
    }, []);

    return {
      name: "test-server",
      tools: [mockTool],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      serverInfo: { name: "Test" },
      capabilities: {},
      state,
      error: undefined,
      authUrl: undefined,
      authTokens: undefined,
      log: [],
      callTool: mockCallTool,
      readResource: vi.fn(),
      listResources: vi.fn(),
      listPrompts: vi.fn(),
      getPrompt: vi.fn(),
      refreshTools: vi.fn(),
      refreshResources: vi.fn(),
      refreshPrompts: vi.fn(),
      refreshAll: vi.fn(),
      retry: vi.fn(),
      disconnect: vi.fn(),
      authenticate: vi.fn(),
      clearStorage: vi.fn(),
      ensureIconLoaded: vi.fn(),
      client: null,
    };
  },
}));

describe("WebMCP", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    mockProvideContext.mockClear();
    mockClearContext.mockClear();
    mockCallTool.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe("feature detection", () => {
    it("does not call provideContext when navigator.modelContext is undefined", async () => {
      Object.defineProperty(globalThis, "navigator", {
        value: { ...originalNavigator, modelContext: undefined },
        writable: true,
        configurable: true,
      });

      await act(async () => {
        create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockProvideContext).not.toHaveBeenCalled();
    });

    it("calls provideContext when navigator.modelContext is available", async () => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });

      await act(async () => {
        create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockProvideContext).toHaveBeenCalled();
      const call = mockProvideContext.mock.calls[0][0];
      expect(call.tools).toHaveLength(1);
      expect(call.tools[0].name).toBe("test_tool");
      expect(call.tools[0].description).toBe("A test tool");
      expect(call.tools[0].inputSchema.type).toBe("object");
      expect(typeof call.tools[0].execute).toBe("function");
    });
  });

  describe("tool registration", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it("registers tools with correct mapping from MCP to WebMCP shape", async () => {
      await act(async () => {
        create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      const def = mockProvideContext.mock.calls[0][0].tools[0];
      expect(def.name).toBe("test_tool");
      expect(def.description).toBe("A test tool");
      expect(def.inputSchema).toEqual(
        expect.objectContaining({
          type: "object",
          properties: { foo: { type: "string", description: "Foo arg" } },
          required: ["foo"],
        })
      );
    });
  });

  describe("tool execution", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "Tool result" }],
      });
    });

    it("execute proxies to callTool and returns WebMCP content format", async () => {
      await act(async () => {
        create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      const def = mockProvideContext.mock.calls[0][0].tools[0];
      const result = await def.execute({ foo: "bar" });

      expect(mockCallTool).toHaveBeenCalledWith("test_tool", { foo: "bar" });
      expect(result).toEqual({
        content: [{ type: "text", text: "Tool result" }],
      });
    });

    it("returns error as text content when callTool throws", async () => {
      mockCallTool.mockRejectedValueOnce(new Error("Tool failed"));

      await act(async () => {
        create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      const def = mockProvideContext.mock.calls[0][0].tools[0];
      const result = await def.execute({ foo: "bar" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Error:");
      expect(result.content[0].text).toContain("Tool failed");
    });
  });

  describe("tool filtering", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it("filter prop excludes tools that return false", async () => {
      await act(async () => {
        create(
          React.createElement(WebMCP, {
            url: "http://localhost:3000/mcp",
            filter: (tool) => tool.name !== "test_tool",
          })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      // When no tools pass the filter, we clearContext instead of provideContext
      expect(mockProvideContext).not.toHaveBeenCalled();
      expect(mockClearContext).toHaveBeenCalled();
    });

    it("filter prop includes tools that return true", async () => {
      await act(async () => {
        create(
          React.createElement(WebMCP, {
            url: "http://localhost:3000/mcp",
            filter: (tool) => tool.name === "test_tool",
          })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockProvideContext.mock.calls[0][0].tools).toHaveLength(1);
    });
  });

  describe("tool prefix", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it("prefix prop prepends to registered tool names", async () => {
      await act(async () => {
        create(
          React.createElement(WebMCP, {
            url: "http://localhost:3000/mcp",
            prefix: "mcp_",
          })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockProvideContext.mock.calls[0][0].tools[0].name).toBe(
        "mcp_test_tool"
      );
    });
  });

  describe("cleanup", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });
    });

    it("calls clearContext on unmount", async () => {
      let root: ReturnType<typeof create>;
      mockClearContext.mockClear();

      await act(async () => {
        root = create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      const callsBeforeUnmount = mockClearContext.mock.calls.length;

      await act(async () => {
        root!.unmount();
      });

      expect(mockClearContext.mock.calls.length).toBeGreaterThan(
        callsBeforeUnmount
      );
    });
  });

  describe("children", () => {
    it("renders null when no children provided", async () => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });

      let root: ReturnType<typeof create>;
      await act(async () => {
        root = create(
          React.createElement(WebMCP, { url: "http://localhost:3000/mcp" })
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(root!.toJSON()).toBe(null);
    });

    it("renders children when provided", async () => {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          modelContext: {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            provideContext: mockProvideContext,
            clearContext: mockClearContext,
          },
        },
        writable: true,
        configurable: true,
      });

      let root: ReturnType<typeof create>;
      await act(async () => {
        root = create(
          React.createElement(
            WebMCP,
            { url: "http://localhost:3000/mcp" },
            React.createElement("span", null, "Hello")
          )
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(root!.toJSON()).toMatchObject({
        type: "span",
        children: ["Hello"],
      });
    });
  });
});
