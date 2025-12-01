import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Error Handling and Edge Cases", () => {
  let tempConfigDir: string;
  let tempConfigFile: string;

  beforeEach(() => {
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
      try {
        fs.rmSync(tempConfigDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("config file loading edge cases", () => {
    it("handles config file with missing mcpServers key", () => {
      const config = {};
      fs.writeFileSync(
        tempConfigFile,
        JSON.stringify(config, null, 2),
        "utf-8"
      );

      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client.getServerNames()).toEqual([]);
    });

    it("handles config file with null mcpServers", () => {
      const config = { mcpServers: null };
      fs.writeFileSync(
        tempConfigFile,
        JSON.stringify(config, null, 2),
        "utf-8"
      );

      // Should handle gracefully
      expect(() => {
        MCPClient.fromConfigFile(tempConfigFile);
      }).not.toThrow();
    });

    it("handles config file with invalid server config", () => {
      const config = {
        mcpServers: {
          invalid: {
            // Missing required fields
          },
        },
      };
      fs.writeFileSync(
        tempConfigFile,
        JSON.stringify(config, null, 2),
        "utf-8"
      );

      // Should create client but fail when trying to create session
      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client.getServerNames()).toContain("invalid");

      // Creating session should fail
      expect(async () => {
        await client.createSession("invalid");
      }).rejects.toThrow();
    });

    it("handles very large config file", () => {
      // Ensure directory exists
      if (!fs.existsSync(tempConfigDir)) {
        fs.mkdirSync(tempConfigDir, { recursive: true });
      }

      const largeConfig = {
        mcpServers: {},
      };
      // Add many servers
      for (let i = 0; i < 100; i++) {
        largeConfig.mcpServers[`server${i}`] = {
          command: "node",
          args: ["server.js"],
        };
      }
      fs.writeFileSync(
        tempConfigFile,
        JSON.stringify(largeConfig, null, 2),
        "utf-8"
      );

      const client = MCPClient.fromConfigFile(tempConfigFile);
      expect(client.getServerNames().length).toBe(100);
    });
  });

  describe("code executor error handling", () => {
    it("handles code execution timeout", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode(
        // Use a busy loop to ensure timeout triggers
        `const start = Date.now();
        while (Date.now() - start < 2000) {
          // Busy wait
        }
        return "done";`,
        100 // Very short timeout
      );
      // VM timeout should catch busy loops
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("timed out");
    }, 10000);

    it("handles code with syntax errors", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("return { invalid json }");
      expect(result.error).toBeTruthy();
    });

    it("handles code that throws errors", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("throw new Error('Test error');");
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("Test error");
    });

    it("handles code with infinite loops (timeout)", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode(
        "while(true) { }",
        100 // Short timeout
      );
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("timed out");
    }, 10000);
  });

  describe("session management error handling", () => {
    it("handles creating session for non-existent server", async () => {
      const client = new MCPClient({});
      await expect(client.createSession("nonexistent")).rejects.toThrow(
        "Server 'nonexistent' not found in config"
      );
    });

    it("handles closing already-closed session", async () => {
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
      const client = MCPClient.fromDict(config);

      await client.createSession("simple");
      await client.closeSession("simple");

      // Closing again should not throw
      await expect(client.closeSession("simple")).resolves.not.toThrow();
    }, 30000);

    it("handles getSession for non-existent session", () => {
      const client = new MCPClient({});
      const session = client.getSession("nonexistent");
      expect(session).toBeNull();
    });
  });

  describe("code mode error handling", () => {
    it("handles searchTools when no servers are configured", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.searchTools();
      expect(result.results).toEqual([]);
      expect(result.meta.total_tools).toBe(0);
    });

    it("handles executeCode with empty string", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const result = await client.executeCode("");
      // Empty code might return undefined or null
      expect(result).toBeDefined();
    });

    it("handles executeCode with very long code", async () => {
      const client = new MCPClient({}, { codeMode: true });
      const longCode = `return "${"x".repeat(10000)}";`;
      const result = await client.executeCode(longCode);
      expect(result.result).toBe("x".repeat(10000));
    });
  });

  describe("executor options edge cases", () => {
    it("handles VM executor with custom timeout", () => {
      const client = new MCPClient(
        {},
        {
          codeMode: {
            enabled: true,
            executor: "vm",
            executorOptions: {
              timeoutMs: 60000,
            },
          },
        }
      );
      expect(client.codeMode).toBe(true);
    });

    it("handles VM executor with memory limit", () => {
      const client = new MCPClient(
        {},
        {
          codeMode: {
            enabled: true,
            executor: "vm",
            executorOptions: {
              timeoutMs: 30000,
              memoryLimitMb: 128,
            },
          },
        }
      );
      expect(client.codeMode).toBe(true);
    });

    it("handles E2B executor configuration", () => {
      const client = new MCPClient(
        {},
        {
          codeMode: {
            enabled: true,
            executor: "e2b",
            executorOptions: {
              apiKey: "test-key",
              timeoutMs: 300000,
            },
          },
        }
      );
      expect(client.codeMode).toBe(true);
    });
  });

  describe("client close error handling", () => {
    it("handles close when no sessions exist", async () => {
      const client = new MCPClient({});
      await expect(client.close()).resolves.not.toThrow();
    });

    it("handles close when code mode is enabled but no executor created", async () => {
      const client = new MCPClient({}, { codeMode: true });
      // Don't execute any code, so executor isn't created
      await expect(client.close()).resolves.not.toThrow();
    });
  });
});
