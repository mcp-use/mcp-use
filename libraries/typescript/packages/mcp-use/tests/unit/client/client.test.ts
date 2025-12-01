import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";
import { BaseCodeExecutor } from "../../../src/client/codeExecutor.js";
import { CodeModeConnector } from "../../../src/client/connectors/codeMode.js";
import type { CreateMessageRequest, CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("MCPClient Core Functionality", () => {
  let tempConfigDir: string;
  let tempConfigFile: string;

  beforeEach(() => {
    // Create a temporary directory for test config files
    tempConfigDir = path.join(__dirname, "../../../.test-temp");
    if (!fs.existsSync(tempConfigDir)) {
      fs.mkdirSync(tempConfigDir, { recursive: true });
    }
    tempConfigFile = path.join(tempConfigDir, "test-config.json");
  });

  afterEach(async () => {
    // Clean up test config files
    if (fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
    }
    if (fs.existsSync(tempConfigDir)) {
      fs.rmdirSync(tempConfigDir);
    }
  });

  describe("fromDict()", () => {
    it("creates client from empty config dict", () => {
      const client = MCPClient.fromDict({});
      expect(client).toBeInstanceOf(MCPClient);
      expect(client.getConfig()).toEqual({});
      expect(client.getServerNames()).toEqual([]);
    });

    it("creates client from config dict with servers", () => {
      const config = {
        mcpServers: {
          server1: {
            command: "node",
            args: ["server.js"],
          },
          server2: {
            url: "http://localhost:3000",
          },
        },
      };
      const client = MCPClient.fromDict(config);
      expect(client.getServerNames()).toEqual(["server1", "server2"]);
      expect(client.getServerConfig("server1")).toEqual(config.mcpServers.server1);
      expect(client.getServerConfig("server2")).toEqual(config.mcpServers.server2);
    });

    it("creates client from dict with code mode enabled", () => {
      const config = { mcpServers: {} };
      const client = MCPClient.fromDict(config, { codeMode: true });
      expect(client.codeMode).toBe(true);
      const sessions = client.getAllActiveSessions();
      expect(sessions["code_mode"]).toBeDefined();
    });

    it("creates client from dict with code mode config", () => {
      const config = { mcpServers: {} };
      const client = MCPClient.fromDict(config, {
        codeMode: {
          enabled: true,
          executor: "vm",
          executorOptions: { timeoutMs: 60000 },
        },
      });
      expect(client.codeMode).toBe(true);
    });

    it("creates client from dict with sampling callback", async () => {
      const config = { mcpServers: {} };
      const samplingCallback = vi.fn(async (params: CreateMessageRequest["params"]) => {
        return {
          content: [{ type: "text", text: "test response" }],
        } as CreateMessageResult;
      });
      const client = MCPClient.fromDict(config, { samplingCallback });
      expect(client).toBeInstanceOf(MCPClient);
      // Sampling callback is stored internally, verify it's set by checking connector creation
      // We can't directly access it, but we can verify the client was created successfully
      expect(client.getConfig()).toEqual(config);
    });
  });

  describe("fromConfigFile()", () => {
    it("creates client from valid config file", () => {
      const config = {
        mcpServers: {
          testServer: {
            command: "node",
            args: ["test.js"],
          },
        },
      };
      fs.writeFileSync(tempConfigFile, JSON.stringify(config, null, 2), "utf-8");

      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client).toBeInstanceOf(MCPClient);
      expect(client.getServerNames()).toEqual(["testServer"]);
    });

    it("creates client from config file with code mode", () => {
      const config = { mcpServers: {} };
      fs.writeFileSync(tempConfigFile, JSON.stringify(config, null, 2), "utf-8");

      const client = MCPClient.fromConfigFile(tempConfigFile, { codeMode: true });
      expect(client.codeMode).toBe(true);
    });

    it("throws error for non-existent config file", () => {
      const nonExistentFile = path.join(tempConfigDir, "nonexistent.json");
      expect(() => {
        MCPClient.fromConfigFile(nonExistentFile);
      }).toThrow();
    });

    it("throws error for invalid JSON config file", () => {
      fs.writeFileSync(tempConfigFile, "invalid json content", "utf-8");
      expect(() => {
        MCPClient.fromConfigFile(tempConfigFile);
      }).toThrow();
    });

    it("handles config file with empty mcpServers", () => {
      const config = { mcpServers: {} };
      fs.writeFileSync(tempConfigFile, JSON.stringify(config, null, 2), "utf-8");

      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client.getServerNames()).toEqual([]);
    });

    it("handles config file with multiple servers", () => {
      const config = {
        mcpServers: {
          server1: { command: "node", args: ["s1.js"] },
          server2: { url: "http://localhost:3000" },
          server3: { ws_url: "ws://localhost:3001" },
        },
      };
      fs.writeFileSync(tempConfigFile, JSON.stringify(config, null, 2), "utf-8");

      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client.getServerNames()).toEqual(["server1", "server2", "server3"]);
    });
  });

  describe("getAllActiveSessions()", () => {
    it("returns empty object when no sessions created", () => {
      const client = new MCPClient({});
      const sessions = client.getAllActiveSessions();
      expect(sessions).toEqual({});
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it("returns code_mode session when code mode is enabled", () => {
      const client = new MCPClient({}, { codeMode: true });
      const sessions = client.getAllActiveSessions();
      expect(sessions["code_mode"]).toBeDefined();
      expect(sessions["code_mode"].connector.publicIdentifier.name).toBe("code_mode");
    });

    it("returns all active sessions after creation", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config);
      
      // Create session
      await client.createSession("simple");
      
      const sessions = client.getAllActiveSessions();
      expect(sessions["simple"]).toBeDefined();
      expect(Object.keys(sessions)).toContain("simple");
    });

    it("excludes closed sessions", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config);
      
      await client.createSession("simple");
      let sessions = client.getAllActiveSessions();
      expect(sessions["simple"]).toBeDefined();
      
      await client.closeSession("simple");
      sessions = client.getAllActiveSessions();
      expect(sessions["simple"]).toBeUndefined();
    });
  });

  describe("createAllSessions()", () => {
    it("creates all sessions from config", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
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
      const client = MCPClient.fromDict(config);
      
      const sessions = await client.createAllSessions();
      
      expect(Object.keys(sessions)).toHaveLength(2);
      expect(sessions["server1"]).toBeDefined();
      expect(sessions["server2"]).toBeDefined();
      
      // Clean up
      await client.closeAllSessions();
    }, 30000);

    it("handles empty config gracefully", async () => {
      const client = new MCPClient({});
      const sessions = await client.createAllSessions();
      expect(sessions).toEqual({});
    });

    it("creates sessions without auto-initialization when specified", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config);
      
      const sessions = await client.createAllSessions(false);
      expect(sessions["simple"]).toBeDefined();
      
      // Session should exist but may not be initialized
      const session = client.getSession("simple");
      expect(session).toBeDefined();
      
      // Clean up
      await client.closeAllSessions();
    }, 30000);
  });

  describe("closeAllSessions()", () => {
    it("closes all active sessions", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
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
      const client = MCPClient.fromDict(config);
      
      await client.createAllSessions();
      expect(Object.keys(client.getAllActiveSessions()).length).toBeGreaterThan(0);
      
      await client.closeAllSessions();
      expect(Object.keys(client.getAllActiveSessions())).toHaveLength(0);
    }, 30000);

    it("handles closing when no sessions exist", async () => {
      const client = new MCPClient({});
      await expect(client.closeAllSessions()).resolves.not.toThrow();
    });

    it("handles errors gracefully when closing sessions", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config);
      
      await client.createSession("simple");
      
      // Manually corrupt the session to cause an error
      const session = client.getSession("simple");
      if (session) {
        // Mock disconnect to throw an error
        vi.spyOn(session, "disconnect").mockRejectedValueOnce(new Error("Disconnect error"));
      }
      
      // Should not throw, but handle errors gracefully
      await expect(client.closeAllSessions()).resolves.not.toThrow();
      
      // Clean up
      await client.closeAllSessions();
    }, 30000);
  });

  describe("executeCode()", () => {
    it("executes simple code successfully", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("return 42;");
      expect(result.result).toBe(42);
      expect(result.error).toBeNull();
    });

    it("throws error when code mode is not enabled", async () => {
      const client = new MCPClient({});
      await expect(client.executeCode("return 42;")).rejects.toThrow(
        "Code execution mode is not enabled"
      );
    });

    it("handles code with console.log", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode(`
        console.log("Hello");
        console.log("World");
        return "done";
      `);
      expect(result.result).toBe("done");
      expect(result.logs.some(log => log.includes("Hello"))).toBe(true);
      expect(result.logs.some(log => log.includes("World"))).toBe(true);
    });

    it("handles async code", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode(`
        await new Promise(resolve => setTimeout(resolve, 10));
        return "async done";
      `);
      expect(result.result).toBe("async done");
    });

    it("handles code errors", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("throw new Error('Test error');");
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("Test error");
    });

    it("respects timeout parameter", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode(`
        // Use a busy loop to ensure timeout triggers
        const start = Date.now();
        while (Date.now() - start < 2000) {
          // Busy wait
        }
        return "done";
      `, 100); // 100ms timeout - very short
      // VM timeout should catch busy loops
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("timed out");
    }, 10000);

    it("handles code with arithmetic operations", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("return 10 + 20 * 2;");
      expect(result.result).toBe(50);
    });
  });

  describe("searchTools()", () => {
    it("returns empty results when no servers are configured", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.searchTools();
      expect(result.results).toEqual([]);
      expect(result.meta.total_tools).toBe(0);
      expect(result.meta.namespaces).toEqual([]);
    });

    it("throws error when code mode is not enabled", async () => {
      const client = new MCPClient({});
      await expect(client.searchTools()).rejects.toThrow(
        "Code execution mode is not enabled"
      );
    });

    it("searches tools with query filter", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config, { codeMode: true });
      
      // Create session to get tools
      await client.createSession("simple");
      
      const result = await client.searchTools("add");
      expect(result.meta.total_tools).toBeGreaterThan(0);
      expect(result.results.some(tool => tool.name === "add")).toBe(true);
      
      // Clean up
      await client.closeAllSessions();
    }, 30000);

    it("searches tools with different detail levels", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      const config = {
        mcpServers: {
          simple: {
            command: "tsx",
            args: [serverPath],
          },
        },
      };
      const client = MCPClient.fromDict(config, { codeMode: true });
      
      await client.createSession("simple");
      
      // Test names detail level
      const namesResult = await client.searchTools("", "names");
      expect(namesResult.results.length).toBeGreaterThan(0);
      expect(namesResult.results[0]).toHaveProperty("name");
      expect(namesResult.results[0]).toHaveProperty("server");
      expect(namesResult.results[0]).not.toHaveProperty("description");
      
      // Test descriptions detail level
      const descResult = await client.searchTools("", "descriptions");
      expect(descResult.results.length).toBeGreaterThan(0);
      expect(descResult.results[0]).toHaveProperty("description");
      expect(descResult.results[0]).not.toHaveProperty("input_schema");
      
      // Test full detail level
      const fullResult = await client.searchTools("", "full");
      expect(fullResult.results.length).toBeGreaterThan(0);
      expect(fullResult.results[0]).toHaveProperty("input_schema");
      
      // Clean up
      await client.closeAllSessions();
    }, 30000);
  });

  describe("getServerNames()", () => {
    it("excludes code_mode server when code mode is enabled", () => {
      const client = new MCPClient({}, { codeMode: true });
      const serverNames = client.getServerNames();
      expect(serverNames).not.toContain("code_mode");
    });

    it("returns all configured server names", () => {
      const config = {
        mcpServers: {
          server1: { command: "node", args: ["s1.js"] },
          server2: { url: "http://localhost:3000" },
        },
      };
      const client = MCPClient.fromDict(config);
      const serverNames = client.getServerNames();
      expect(serverNames).toEqual(["server1", "server2"]);
    });
  });

  describe("close()", () => {
    it("cleans up code executor and closes all sessions", async () => {
      const client = new MCPClient({}, { codeMode: true });
      
      // Create a session if possible
      const sessions = client.getAllActiveSessions();
      expect(sessions["code_mode"]).toBeDefined();
      
      await client.close();
      
      // After close, sessions should be empty
      const sessionsAfterClose = client.getAllActiveSessions();
      expect(Object.keys(sessionsAfterClose)).toHaveLength(0);
    });

    it("handles close when no executor exists", async () => {
      const client = new MCPClient({});
      await expect(client.close()).resolves.not.toThrow();
    });
  });
});
