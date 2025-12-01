/**
 * Node.js-Specific Feature Tests
 *
 * Tests for features that are ONLY available in the Node.js client:
 * - fromConfigFile()
 * - saveConfig()
 * - Code mode
 * - STDIO connector support
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "../../../src/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Node.js-Specific Features", () => {
  const testConfigDir = path.join(__dirname, "../../../.test-configs");
  const testConfigPath = path.join(testConfigDir, "test-config.json");

  beforeEach(() => {
    // Ensure test config directory exists
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test config files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe("fromConfigFile()", () => {
    it("should load configuration from a file", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      const client = MCPClient.fromConfigFile(testConfigPath);

      expect(client.getServerNames()).toEqual(["test"]);
      expect(client.getServerConfig("test")).toEqual(config.mcpServers.test);
    });

    it("should handle file path correctly", () => {
      const config = {
        mcpServers: {
          server1: { url: "http://localhost:3000" },
          server2: { url: "http://localhost:3001" },
        },
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      const client = MCPClient.fromConfigFile(testConfigPath);

      expect(client.getServerNames().length).toBe(2);
      expect(client.getServerNames()).toContain("server1");
      expect(client.getServerNames()).toContain("server2");
    });

    it("should work with codeMode option", () => {
      const config = {
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      const client = MCPClient.fromConfigFile(testConfigPath, {
        codeMode: true,
      });

      expect(client.codeMode).toBe(true);
      expect(client.getAllActiveSessions()["code_mode"]).toBeDefined();
    });
  });

  describe("saveConfig()", () => {
    it("should save configuration to a file", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      };

      const client = new MCPClient(config);
      client.saveConfig(testConfigPath);

      expect(fs.existsSync(testConfigPath)).toBe(true);

      const savedConfig = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
      expect(savedConfig).toEqual(config);
    });

    it("should create directory if it doesn't exist", () => {
      const nestedDir = path.join(testConfigDir, "nested", "deep");
      const nestedPath = path.join(nestedDir, "config.json");

      const config = {
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      };

      const client = new MCPClient(config);
      client.saveConfig(nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(nestedPath);
      fs.rmdirSync(path.join(nestedDir));
      fs.rmdirSync(path.join(testConfigDir, "nested"));
    });

    it("should save updated configuration after addServer", () => {
      const client = new MCPClient({
        mcpServers: {
          server1: { url: "http://localhost:3000" },
        },
      });

      client.addServer("server2", { url: "http://localhost:3001" });
      client.saveConfig(testConfigPath);

      const savedConfig = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
      expect(savedConfig.mcpServers.server1).toBeDefined();
      expect(savedConfig.mcpServers.server2).toBeDefined();
    });

    it("should save updated configuration after removeServer", () => {
      const client = new MCPClient({
        mcpServers: {
          server1: { url: "http://localhost:3000" },
          server2: { url: "http://localhost:3001" },
        },
      });

      client.removeServer("server1");
      client.saveConfig(testConfigPath);

      const savedConfig = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
      expect(savedConfig.mcpServers.server1).toBeUndefined();
      expect(savedConfig.mcpServers.server2).toBeDefined();
    });
  });

  describe("Code Mode", () => {
    it("should enable code mode when configured", () => {
      const client = new MCPClient({}, { codeMode: true });

      expect(client.codeMode).toBe(true);
      expect(client.getAllActiveSessions()["code_mode"]).toBeDefined();
    });

    it("should enable code mode with executor config", () => {
      const client = new MCPClient(
        {},
        {
          codeMode: {
            enabled: true,
            executor: "vm",
          },
        }
      );

      expect(client.codeMode).toBe(true);
    });

    it("should execute code when code mode is enabled", async () => {
      const client = new MCPClient({}, { codeMode: true });

      const result = await client.executeCode("return 42;");
      expect(result.result).toBe(42);
    });

    it("should handle code execution errors", async () => {
      const client = new MCPClient({}, { codeMode: true });

      const result = await client.executeCode("throw new Error('test error');");
      expect(result.error).toBeDefined();
      expect(result.result).toBeNull();
    });
  });

  describe("STDIO Connector Support", () => {
    it("should support stdio connector configuration", () => {
      const config = {
        mcpServers: {
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
          },
        },
      };

      const client = new MCPClient(config);
      expect(client.getServerConfig("stdio")).toEqual(config.mcpServers.stdio);
    });

    it("should accept stdio connector with env variables", () => {
      const config = {
        mcpServers: {
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
      };

      const client = new MCPClient(config);
      const serverConfig = client.getServerConfig("stdio");
      expect(serverConfig.env).toEqual({ NODE_ENV: "test" });
    });
  });
});
