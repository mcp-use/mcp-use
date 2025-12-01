/**
 * Compatibility Matrix Tests
 *
 * Tests that verify connector compatibility per platform:
 * - HTTP connector: Node.js ✅, Browser ✅
 * - WebSocket connector: Node.js ✅, Browser ✅
 * - STDIO connector: Node.js ✅, Browser ❌
 * - Code Mode connector: Node.js ✅, Browser ❌
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { BrowserMCPClient } from "../../../src/client/browser.js";

describe("Connector Compatibility Matrix", () => {
  describe("HTTP Connector", () => {
    it("should be supported in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      });

      expect(client.getServerConfig("http")).toBeDefined();
      expect(client.getServerConfig("http").transport).toBe("http");
    });

    it("should be supported in Browser client", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      });

      expect(client.getServerConfig("http")).toBeDefined();
      expect(client.getServerConfig("http").transport).toBe("http");
    });

    it("should work identically in both clients", () => {
      const config = {
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
            headers: { "X-Custom": "value" },
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      expect(nodeClient.getServerConfig("http")).toEqual(
        browserClient.getServerConfig("http")
      );
    });
  });

  describe("WebSocket Connector", () => {
    it("should be supported in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
            transport: "websocket",
          },
        },
      });

      expect(client.getServerConfig("ws")).toBeDefined();
      expect(client.getServerConfig("ws").transport).toBe("websocket");
    });

    it("should be supported in Browser client", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
            transport: "websocket",
          },
        },
      });

      expect(client.getServerConfig("ws")).toBeDefined();
      expect(client.getServerConfig("ws").transport).toBe("websocket");
    });

    it("should work identically in both clients", () => {
      const config = {
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
            transport: "websocket",
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      expect(nodeClient.getServerConfig("ws")).toEqual(
        browserClient.getServerConfig("ws")
      );
    });
  });

  describe("STDIO Connector", () => {
    it("should be supported in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
          },
        },
      });

      expect(client.getServerConfig("stdio")).toBeDefined();
      expect(client.getServerConfig("stdio").command).toBe("node");
    });

    it("should NOT be supported in Browser client", async () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
          },
        },
      });

      // Config can be stored, but connector creation will fail
      expect(client.getServerConfig("stdio")).toBeDefined();

      // Attempting to create a session should fail because browser can't create stdio connector
      await expect(client.createSession("stdio")).rejects.toThrow();
    });
  });

  describe("Code Mode Connector", () => {
    it("should be supported in Node.js client", () => {
      const client = new MCPClient({}, { codeMode: true });

      expect(client.codeMode).toBe(true);
      expect(client.getAllActiveSessions()["code_mode"]).toBeDefined();
    });

    it("should NOT be supported in Browser client", () => {
      const client = new BrowserMCPClient();

      expect((client as any).codeMode).toBeUndefined();
      expect((client as any).executeCode).toBeUndefined();
    });
  });

  describe("Transport Detection", () => {
    it("should detect HTTP from URL in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
          },
        },
      });

      expect(client.getServerConfig("http").url).toBe("http://localhost:3000");
    });

    it("should detect HTTP from URL in Browser client", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
          },
        },
      });

      expect(client.getServerConfig("http").url).toBe("http://localhost:3000");
    });

    it("should detect WebSocket from URL in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
          },
        },
      });

      expect(client.getServerConfig("ws").url).toBe("ws://localhost:3000");
    });

    it("should detect WebSocket from URL in Browser client", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
          },
        },
      });

      expect(client.getServerConfig("ws").url).toBe("ws://localhost:3000");
    });
  });

  describe("Multi-Connector Support", () => {
    it("should support multiple connectors in Node.js client", () => {
      const client = new MCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
          },
          ws: {
            url: "ws://localhost:3001",
            transport: "websocket",
          },
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
          },
        },
      });

      expect(client.getServerNames().length).toBe(3);
      expect(client.getServerNames()).toContain("http");
      expect(client.getServerNames()).toContain("ws");
      expect(client.getServerNames()).toContain("stdio");
    });

    it("should support multiple connectors in Browser client (excluding stdio)", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
          },
          ws: {
            url: "ws://localhost:3001",
            transport: "websocket",
          },
        },
      });

      expect(client.getServerNames().length).toBe(2);
      expect(client.getServerNames()).toContain("http");
      expect(client.getServerNames()).toContain("ws");
    });
  });
});
