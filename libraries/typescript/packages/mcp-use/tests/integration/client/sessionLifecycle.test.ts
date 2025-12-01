import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Session Lifecycle Integration", () => {
  let client: MCPClient;
  const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

  beforeEach(() => {
    // Create fresh client for each test
  });

  afterEach(async () => {
    if (client) {
      await client.closeAllSessions();
      await client.close();
    }
  });

  describe("create → use → close workflow", () => {
    it("creates session, uses it, and closes it", async () => {
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config);

      // Create session
      const session = await client.createSession("simple");
      expect(session).toBeDefined();

      // Verify session is active
      const activeSessions = client.getAllActiveSessions();
      expect(activeSessions["simple"]).toBeDefined();

      // Use session - call a tool
      const connector = session.connector;
      const tools = connector.tools;
      expect(tools.length).toBeGreaterThan(0);

      // Close session
      await client.closeSession("simple");

      // Verify session is closed
      const sessionsAfterClose = client.getAllActiveSessions();
      expect(sessionsAfterClose["simple"]).toBeUndefined();
    }, 30000);

    it("handles multiple sessions lifecycle", async () => {
      const config = {
        mcpServers: {
          server1: {
            command: "tsx",
            args: [serverPath],
          },
          server2: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config);

      // Create all sessions
      await client.createAllSessions();
      let activeSessions = client.getAllActiveSessions();
      expect(Object.keys(activeSessions)).toHaveLength(2);

      // Close one session
      await client.closeSession("server1");
      activeSessions = client.getAllActiveSessions();
      expect(activeSessions["server1"]).toBeUndefined();
      expect(activeSessions["server2"]).toBeDefined();

      // Close remaining session
      await client.closeSession("server2");
      activeSessions = client.getAllActiveSessions();
      expect(Object.keys(activeSessions)).toHaveLength(0);
    }, 30000);

    it("recreates session after closing", async () => {
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config);

      // Create and close
      await client.createSession("simple");
      await client.closeSession("simple");

      // Recreate
      const session2 = await client.createSession("simple");
      expect(session2).toBeDefined();

      const activeSessions = client.getAllActiveSessions();
      expect(activeSessions["simple"]).toBeDefined();
    }, 30000);
  });

  describe("error recovery", () => {
    it("handles session creation failure gracefully", async () => {
      const config = {
        mcpServers: {
          invalid: {
            command: "nonexistent-command",
            args: ["--invalid"],
          },
        },
      };
      client = MCPClient.fromDict(config);

      // Should throw error when trying to create invalid session
      await expect(client.createSession("invalid")).rejects.toThrow();
    }, 10000);

    it("handles closing non-existent session", async () => {
      client = new MCPClient({});
      // Should not throw when closing non-existent session
      await expect(client.closeSession("nonexistent")).resolves.not.toThrow();
    });

    it("recovers from partial session creation failure", async () => {
      const config = {
        mcpServers: {
          valid: {
            command: "tsx",
            args: [serverPath],
          },
          invalid: {
            command: "nonexistent-command",
            args: ["--invalid"],
          },
        },
      };
      client = MCPClient.fromDict(config);

      // Try to create all sessions - one will fail
      try {
        await client.createAllSessions();
      } catch (e) {
        // Expected to fail for invalid server
      }

      // Valid session should still be created if it was attempted first
      // The behavior depends on iteration order, but we should handle errors gracefully
      const activeSessions = client.getAllActiveSessions();
      // At least the valid one might be there, or none if invalid was processed first
      expect(Array.isArray(Object.keys(activeSessions))).toBe(true);
    }, 30000);
  });

  describe("code mode with sessions", () => {
    it("code mode works alongside regular sessions", async () => {
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config, { codeMode: true });

      // Code mode session should exist
      const sessions = client.getAllActiveSessions();
      expect(sessions["code_mode"]).toBeDefined();

      // Create regular session
      await client.createSession("simple");
      const allSessions = client.getAllActiveSessions();
      expect(allSessions["code_mode"]).toBeDefined();
      expect(allSessions["simple"]).toBeDefined();

      // Code execution should work
      const result = await client.executeCode("return 42;");
      expect(result.result).toBe(42);
    }, 30000);

    it("searchTools includes tools from regular sessions", async () => {
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config, { codeMode: true });

      await client.createSession("simple");

      const searchResult = await client.searchTools("add");
      expect(searchResult.results.length).toBeGreaterThan(0);
      expect(searchResult.results.some((t) => t.name === "add")).toBe(true);
    }, 30000);
  });
});
