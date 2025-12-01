import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";
import { BaseCodeExecutor } from "../../../src/client/codeExecutor.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a concrete implementation for testing
class TestCodeExecutor extends BaseCodeExecutor {
  async execute(code: string, timeout?: number) {
    return {
      result: null,
      logs: [],
      error: null,
      execution_time: 0,
    };
  }

  async cleanup() {
    // No-op for test
  }
}

describe("BaseCodeExecutor", () => {
  let client: MCPClient;
  let executor: TestCodeExecutor;

  beforeEach(() => {
    client = new MCPClient({});
    executor = new TestCodeExecutor(client);
  });

  describe("constructor", () => {
    it("stores client reference", () => {
      expect(executor).toBeInstanceOf(BaseCodeExecutor);
      // Client is protected, but we can verify through behavior
      expect(executor).toBeDefined();
    });
  });

  describe("ensureServersConnected()", () => {
    it("connects to missing servers", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      // Initially no sessions
      expect(Object.keys(testClient.getAllActiveSessions())).toHaveLength(0);

      // Ensure servers connected
      await (testExecutor as any).ensureServersConnected();

      // Should have created session
      const sessions = testClient.getAllActiveSessions();
      expect(Object.keys(sessions).length).toBeGreaterThan(0);

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("does not reconnect if servers already connected", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      // Create session manually
      await testClient.createSession("simple");
      const initialSessions = Object.keys(testClient.getAllActiveSessions());

      // Ensure servers connected (should not create duplicate)
      await (testExecutor as any).ensureServersConnected();

      const afterSessions = Object.keys(testClient.getAllActiveSessions());
      expect(afterSessions.length).toBe(initialSessions.length);

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("handles empty server config", async () => {
      const emptyClient = new MCPClient({});
      const emptyExecutor = new TestCodeExecutor(emptyClient);

      await expect(
        (emptyExecutor as any).ensureServersConnected()
      ).resolves.not.toThrow();
    });
  });

  describe("getToolNamespaces()", () => {
    it("returns empty array when no servers configured", () => {
      const namespaces = (executor as any).getToolNamespaces();
      expect(namespaces).toEqual([]);
    });

    it("excludes code_mode server", async () => {
      const codeModeClient = new MCPClient({}, { codeMode: true });
      const codeModeExecutor = new TestCodeExecutor(codeModeClient);

      const namespaces = (codeModeExecutor as any).getToolNamespaces();
      // Should not include code_mode
      expect(namespaces.every((n: any) => n.serverName !== "code_mode")).toBe(
        true
      );
    });

    it("returns tool namespaces from active sessions", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const namespaces = (testExecutor as any).getToolNamespaces();
      expect(namespaces.length).toBeGreaterThan(0);
      expect(namespaces[0]).toHaveProperty("serverName");
      expect(namespaces[0]).toHaveProperty("tools");
      expect(namespaces[0]).toHaveProperty("session");

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);
  });

  describe("createSearchToolsFunction()", () => {
    it("creates a search function", () => {
      const searchFn = executor.createSearchToolsFunction();
      expect(typeof searchFn).toBe("function");
    });

    it("search function returns correct structure", async () => {
      const searchFn = executor.createSearchToolsFunction();
      const result = await searchFn();

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("meta");
      expect(result.meta).toHaveProperty("total_tools");
      expect(result.meta).toHaveProperty("namespaces");
      expect(result.meta).toHaveProperty("result_count");
      expect(Array.isArray(result.results)).toBe(true);
      expect(Array.isArray(result.meta.namespaces)).toBe(true);
    });

    it("search function filters by query", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const searchFn = testExecutor.createSearchToolsFunction();

      // Search for "add" tool
      const result = await searchFn("add");
      expect(result.results.some((t: any) => t.name === "add")).toBe(true);

      // Search for non-existent tool
      const noResult = await searchFn("nonexistent_tool_xyz");
      expect(noResult.results.length).toBe(0);

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("search function respects detail level 'names'", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const searchFn = testExecutor.createSearchToolsFunction();
      const result = await searchFn("", "names");

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty("name");
        expect(result.results[0]).toHaveProperty("server");
        expect(result.results[0]).not.toHaveProperty("description");
      }

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("search function respects detail level 'descriptions'", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const searchFn = testExecutor.createSearchToolsFunction();
      const result = await searchFn("", "descriptions");

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty("description");
        expect(result.results[0]).not.toHaveProperty("input_schema");
      }

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("search function respects detail level 'full'", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const searchFn = testExecutor.createSearchToolsFunction();
      const result = await searchFn("", "full");

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty("input_schema");
      }

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);

    it("search function filters by server name", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const testClient = MCPClient.fromDict(config);
      const testExecutor = new TestCodeExecutor(testClient);

      await testClient.createSession("simple");
      await (testExecutor as any).ensureServersConnected();

      const searchFn = testExecutor.createSearchToolsFunction();
      const result = await searchFn("simple");

      // Should find tools from "simple" server
      expect(result.results.every((t: any) => t.server === "simple")).toBe(
        true
      );

      // Clean up
      await testClient.closeAllSessions();
    }, 30000);
  });
});
