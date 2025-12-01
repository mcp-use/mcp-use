/**
 * Cross-Platform Feature Parity Tests
 *
 * Tests that verify API parity and expected differences between:
 * - Node.js Client (MCPClient)
 * - Browser Client (BrowserMCPClient)
 * - React Hook (useMcp)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { BrowserMCPClient } from "../../../src/client/browser.js";

describe("Cross-Platform API Parity", () => {
  describe("Shared Base Client Methods", () => {
    it("should have identical addServer behavior", () => {
      const nodeClient = new MCPClient();
      const browserClient = new BrowserMCPClient();

      const serverConfig = {
        url: "http://localhost:3000",
        transport: "http",
      };

      nodeClient.addServer("test-server", serverConfig);
      browserClient.addServer("test-server", serverConfig);

      expect(nodeClient.getServerNames()).toEqual(["test-server"]);
      expect(browserClient.getServerNames()).toEqual(["test-server"]);

      expect(nodeClient.getServerConfig("test-server")).toEqual(serverConfig);
      expect(browserClient.getServerConfig("test-server")).toEqual(
        serverConfig
      );
    });

    it("should have identical removeServer behavior", () => {
      const nodeClient = new MCPClient({
        mcpServers: {
          server1: { url: "http://localhost:3000" },
          server2: { url: "http://localhost:3001" },
        },
      });
      const browserClient = new BrowserMCPClient({
        mcpServers: {
          server1: { url: "http://localhost:3000" },
          server2: { url: "http://localhost:3001" },
        },
      });

      nodeClient.removeServer("server1");
      browserClient.removeServer("server1");

      expect(nodeClient.getServerNames()).toEqual(["server2"]);
      expect(browserClient.getServerNames()).toEqual(["server2"]);
    });

    it("should have identical getServerNames behavior", () => {
      const config = {
        mcpServers: {
          server1: { url: "http://localhost:3000" },
          server2: { url: "http://localhost:3001" },
          server3: { url: "http://localhost:3002" },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      const nodeNames = nodeClient.getServerNames();
      const browserNames = browserClient.getServerNames();

      expect(nodeNames).toEqual(browserNames);
      expect(nodeNames).toEqual(["server1", "server2", "server3"]);
    });

    it("should have identical getServerConfig behavior", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
            headers: { "X-Custom": "value" },
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      expect(nodeClient.getServerConfig("test")).toEqual(
        browserClient.getServerConfig("test")
      );
      expect(nodeClient.getServerConfig("nonexistent")).toEqual(
        browserClient.getServerConfig("nonexistent")
      );
    });

    it("should have identical getConfig behavior", () => {
      const config = {
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
        customField: "value",
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      expect(nodeClient.getConfig()).toEqual(browserClient.getConfig());
      expect(nodeClient.getConfig()).toEqual(config);
    });

    it("should have identical fromDict static method behavior", () => {
      const config = {
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      };

      const nodeClient = MCPClient.fromDict(config);
      const browserClient = BrowserMCPClient.fromDict(config);

      expect(nodeClient.getConfig()).toEqual(browserClient.getConfig());
      expect(nodeClient.getServerNames()).toEqual(
        browserClient.getServerNames()
      );
    });
  });

  describe("Session Management Parity", () => {
    let nodeClient: MCPClient;
    let browserClient: BrowserMCPClient;

    beforeEach(() => {
      nodeClient = new MCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });
      browserClient = new BrowserMCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });
    });

    afterEach(async () => {
      await nodeClient.closeAllSessions();
      await browserClient.closeAllSessions();
    });

    it("should have identical getAllActiveSessions behavior when no sessions exist", () => {
      expect(nodeClient.getAllActiveSessions()).toEqual({});
      expect(browserClient.getAllActiveSessions()).toEqual({});
      expect(nodeClient.getAllActiveSessions()).toEqual(
        browserClient.getAllActiveSessions()
      );
    });

    it("should have identical getSession behavior when session doesn't exist", () => {
      expect(nodeClient.getSession("nonexistent")).toBeNull();
      expect(browserClient.getSession("nonexistent")).toBeNull();
    });

    it("should have identical activeSessions array behavior", () => {
      expect(nodeClient.activeSessions).toEqual([]);
      expect(browserClient.activeSessions).toEqual([]);
      expect(nodeClient.activeSessions).toEqual(browserClient.activeSessions);
    });
  });

  describe("Error Handling Parity", () => {
    it("should throw same error when creating session for nonexistent server", async () => {
      const nodeClient = new MCPClient();
      const browserClient = new BrowserMCPClient();

      await expect(nodeClient.createSession("nonexistent")).rejects.toThrow(
        "Server 'nonexistent' not found in config"
      );

      await expect(browserClient.createSession("nonexistent")).rejects.toThrow(
        "Server 'nonexistent' not found in config"
      );
    });

    it("should handle empty config identically", () => {
      const nodeClient = new MCPClient();
      const browserClient = new BrowserMCPClient();

      expect(nodeClient.getServerNames()).toEqual([]);
      expect(browserClient.getServerNames()).toEqual([]);
      expect(nodeClient.getConfig()).toEqual({});
      expect(browserClient.getConfig()).toEqual({});
    });
  });
});
