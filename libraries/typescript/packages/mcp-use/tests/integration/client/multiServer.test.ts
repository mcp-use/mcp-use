import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Multi-Server Scenarios", () => {
  let client: MCPClient;
  const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

  afterEach(async () => {
    if (client) {
      await client.closeAllSessions();
      await client.close();
    }
  });

  describe("multiple server configurations", () => {
    it("creates and manages multiple servers", async () => {
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
          server3: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      client = MCPClient.fromDict(config);

      await client.createAllSessions();

      const sessions = client.getAllActiveSessions();
      expect(Object.keys(sessions)).toHaveLength(3);
      expect(sessions["server1"]).toBeDefined();
      expect(sessions["server2"]).toBeDefined();
      expect(sessions["server3"]).toBeDefined();
    }, 30000);

    it("manages sessions independently", async () => {
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

      await client.createAllSessions();

      // Close one server
      await client.closeSession("server1");

      const sessions = client.getAllActiveSessions();
      expect(sessions["server1"]).toBeUndefined();
      expect(sessions["server2"]).toBeDefined();
    }, 30000);

    it("searches tools across multiple servers", async () => {
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
      client = MCPClient.fromDict(config, { codeMode: true });

      await client.createAllSessions();

      const searchResult = await client.searchTools();
      // Both servers should contribute tools
      expect(searchResult.meta.namespaces.length).toBeGreaterThanOrEqual(1);
      expect(searchResult.meta.total_tools).toBeGreaterThan(0);
    }, 30000);

    it("handles mixed server types", async () => {
      const config = {
        mcpServers: {
          stdioServer: {
            command: "tsx",
            args: [serverPath],
          },
          // Note: HTTP and WebSocket servers would require actual servers running
          // We'll test stdio servers here
        },
      };
      client = MCPClient.fromDict(config);

      await client.createAllSessions();
      const sessions = client.getAllActiveSessions();
      expect(sessions["stdioServer"]).toBeDefined();
    }, 30000);
  });

  describe("server configuration management", () => {
    it("adds server dynamically", () => {
      client = new MCPClient({});
      client.addServer("newServer", {
        command: "node",
        args: ["server.js"],
      });

      expect(client.getServerNames()).toContain("newServer");
      expect(client.getServerConfig("newServer")).toEqual({
        command: "node",
        args: ["server.js"],
      });
    });

    it("removes server dynamically", () => {
      const config = {
        mcpServers: {
          server1: { command: "node", args: ["s1.js"] },
          server2: { command: "node", args: ["s2.js"] },
        },
      };
      client = MCPClient.fromDict(config);

      expect(client.getServerNames()).toContain("server1");
      expect(client.getServerNames()).toContain("server2");

      client.removeServer("server1");
      expect(client.getServerNames()).not.toContain("server1");
      expect(client.getServerNames()).toContain("server2");
    });

    it("removes server from active sessions when removed from config", () => {
      const config = {
        mcpServers: {
          server1: { command: "node", args: ["s1.js"] },
        },
      };
      client = MCPClient.fromDict(config);

      // Add to active sessions manually (simulating a created session)
      client.activeSessions.push("server1");

      client.removeServer("server1");
      expect(client.activeSessions).not.toContain("server1");
    });
  });

  describe("code mode with multiple servers", () => {
    it("executes code with access to multiple server tools", async () => {
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
      client = MCPClient.fromDict(config, { codeMode: true });

      await client.createAllSessions();

      // Code should be able to search tools from all servers
      const searchResult = await client.searchTools();
      expect(searchResult.meta.namespaces.length).toBeGreaterThanOrEqual(1);

      // Execute code that uses search_tools
      const result = await client.executeCode(`
        const tools = await search_tools("", "names");
        return tools.meta.namespaces.length;
      `);
      expect(result.result).toBeGreaterThanOrEqual(1);
    }, 30000);
  });
});
