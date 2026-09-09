import { describe, expect, it, vi } from "vitest";
import { CodeModeConnector } from "../../../src/code-mode/connector.js";
import { MCPSession } from "../../../src/core/session.js";
import { MCPClient } from "../../../src/core/node.js";
import { createAiSdkTools } from "../../../src/adapters/ai-sdk.js";

describe("CodeModeConnector protocol contract", () => {
  function createMockMcpClient() {
    return {
      executeCode: vi.fn(async (code: string, timeout: number) => ({
        result: `executed:${code}`,
        logs: [],
        error: null,
        execution_time: 1,
      })),
      searchTools: vi.fn(async (query: string, detailLevel: string) => [
        { name: "test_tool", description: "A test tool" },
      ]),
    } as unknown as MCPClient;
  }

  describe("direct connector operations", () => {
    it("exposes tools through synchronous getter", () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      expect(connector.tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
    });

    it("returns tool list from listTools()", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const tools = await connector.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
      // Should return a clone to avoid external mutation of internal list
      expect(tools).not.toBe(connector.tools);
    });

    it("throws when listTools() is called on a disconnected connector", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      await connector.disconnect();
      await expect(connector.listTools()).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("throws when listTools() is called with an aborted signal", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const controller = new AbortController();
      controller.abort();
      await expect(
        connector.listTools({ signal: controller.signal })
      ).rejects.toThrow();
    });

    it("initializes capabilities and serverInfo caches", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const initResult = await connector.initialize();

      expect(connector.serverCapabilities).toEqual({ tools: {} });
      expect(connector.serverInfo).toEqual({
        name: "code_mode",
        version: "1.0.0",
        description: "MCP Code Mode Internal Server",
      });
      expect(initResult.capabilities).toEqual({ tools: {} });
      expect(initResult.serverInfo).toEqual(connector.serverInfo);
      expect(initResult.protocolVersion).toBe("2026-07-28");
    });

    it("exposes modern protocol era and negotiated version when connected", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      expect(connector.protocolEra).toBe("modern");
      expect(connector.negotiatedProtocolVersion).toBe("2026-07-28");

      await connector.disconnect();
      expect(connector.protocolEra).toBeUndefined();
      expect(connector.negotiatedProtocolVersion).toBeUndefined();
    });

    it("returns empty arrays for resources and prompts without error", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      await expect(connector.listResources()).resolves.toEqual({
        resources: [],
      });
      await expect(connector.listAllResources()).resolves.toEqual({
        resources: [],
      });
      await expect(connector.listResourceTemplates()).resolves.toEqual({
        resourceTemplates: [],
      });
      await expect(connector.listPrompts()).resolves.toEqual({ prompts: [] });
      await expect(connector.listAllPrompts()).resolves.toEqual({
        prompts: [],
      });
    });

    it("throws when resource and prompt listing are called with an aborted signal", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const controller = new AbortController();
      controller.abort();

      await expect(
        connector.listResources(undefined, { signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        connector.listAllResources({ signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        connector.listResourceTemplates({ signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        connector.listPrompts({ signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        connector.listAllPrompts({ signal: controller.signal })
      ).rejects.toThrow();
    });

    it("throws for resources and prompts when disconnected", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      await connector.disconnect();

      await expect(connector.listResources()).rejects.toThrow(
        "MCP client is not connected"
      );
      await expect(connector.listAllResources()).rejects.toThrow(
        "MCP client is not connected"
      );
      await expect(connector.listResourceTemplates()).rejects.toThrow(
        "MCP client is not connected"
      );
      await expect(connector.listPrompts()).rejects.toThrow(
        "MCP client is not connected"
      );
      await expect(connector.listAllPrompts()).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("respects abort signal in callTool", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const controller = new AbortController();
      controller.abort();

      await expect(
        connector.callTool(
          "execute_code",
          { code: "1+1" },
          { signal: controller.signal }
        )
      ).rejects.toThrow();
    });

    it("cancels execute_code mid-flight when signal is aborted during execution", async () => {
      let resolveExecution!: (val: any) => void;
      const executionPromise = new Promise((resolve) => {
        resolveExecution = resolve;
      });
      const mockClient = createMockMcpClient();
      vi.mocked(mockClient.executeCode).mockImplementation(
        () => executionPromise as any
      );
      const connector = new CodeModeConnector(mockClient);

      const controller = new AbortController();
      const callPromise = connector.callTool(
        "execute_code",
        { code: "while(true){}" },
        { signal: controller.signal }
      );

      expect(mockClient.executeCode).toHaveBeenCalled();
      controller.abort(new Error("Operation cancelled mid-flight"));

      await expect(callPromise).rejects.toThrow(
        "Operation cancelled mid-flight"
      );

      resolveExecution({
        result: "done",
        logs: [],
        error: null,
        execution_time: 10,
      });
    });

    it("cancels search_tools mid-flight when signal is aborted during execution", async () => {
      let resolveSearch!: (val: any) => void;
      const searchPromise = new Promise((resolve) => {
        resolveSearch = resolve;
      });
      const mockClient = createMockMcpClient();
      vi.mocked(mockClient.searchTools).mockImplementation(
        () => searchPromise as any
      );
      const connector = new CodeModeConnector(mockClient);

      const controller = new AbortController();
      const callPromise = connector.callTool(
        "search_tools",
        { query: "test" },
        { signal: controller.signal }
      );

      expect(mockClient.searchTools).toHaveBeenCalled();
      controller.abort(new Error("Search cancelled mid-flight"));

      await expect(callPromise).rejects.toThrow("Search cancelled mid-flight");

      resolveSearch({
        meta: { total_tools: 0, namespaces: [], result_count: 0 },
        results: [],
      });
    });

    it("executes code via callTool", async () => {
      const mockClient = createMockMcpClient();
      const connector = new CodeModeConnector(mockClient);

      const res = await connector.callTool("execute_code", {
        code: "console.log('hi')",
        timeout: 5000,
      });

      expect(mockClient.executeCode).toHaveBeenCalledWith(
        "console.log('hi')",
        5000
      );
      expect(res.content[0]?.type).toBe("text");
      expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({
        result: "executed:console.log('hi')",
        logs: [],
        error: null,
        execution_time: 1,
      });
    });
  });

  describe("MCPSession integration", () => {
    it("delegates listTools() and tools cleanly through MCPSession", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const session = new MCPSession(connector);
      await session.initialize();

      expect(session.tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
      const tools = await session.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
    });

    it("reports supports('tools') as true and resources as false", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const session = new MCPSession(connector);
      await session.initialize();

      expect(session.supports("tools")).toBe(true);
      expect(session.supports("resources")).toBe(false);
      expect(session.supports("prompts")).toBe(false);
    });

    it("MCPSession.info returns normalized metadata without throwing", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const session = new MCPSession(connector);
      await session.initialize();

      expect(session.info).toEqual({
        protocolEra: "modern",
        protocolVersion: "2026-07-28",
        server: {
          name: "code_mode",
          version: "1.0.0",
          description: "MCP Code Mode Internal Server",
        },
        capabilities: { tools: {} },
        instructions: undefined,
        extensions: {},
      });
    });

    it("adapts code_mode session tools for Vercel AI SDK dynamic tools", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const session = new MCPSession(connector);
      await session.initialize();

      const aiTools = await createAiSdkTools(session);
      expect(Object.keys(aiTools).sort()).toEqual([
        "execute_code",
        "search_tools",
      ]);
      expect(aiTools["execute_code"]?.type).toBe("dynamic");
      expect(aiTools["search_tools"]?.type).toBe("dynamic");
    });

    it("throws when session.listResources or listAllResources is called with an aborted signal", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const session = new MCPSession(connector);
      await session.initialize();

      const controller = new AbortController();
      controller.abort();

      await expect(
        session.listResources(undefined, { signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        session.listAllResources({ signal: controller.signal })
      ).rejects.toThrow();
      await expect(
        session.listResourceTemplates({ signal: controller.signal })
      ).rejects.toThrow();
    });
  });

  describe("MCPClient codeMode integration", () => {
    it("registers an active code_mode session that can be inspected and listed", async () => {
      const client = new MCPClient({}, { codeMode: true });
      expect(client.activeSessions).toContain("code_mode");

      const session = client.getSession("code_mode");
      expect(session).toBeDefined();

      const tools = await session!.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
      expect(session!.supports("tools")).toBe(true);
    });
  });
});
