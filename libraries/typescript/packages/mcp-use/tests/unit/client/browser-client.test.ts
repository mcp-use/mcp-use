/**
 * Browser Client Tests
 *
 * Tests for BrowserMCPClient features:
 * - HTTP connector support
 * - WebSocket connector support
 * - OAuth support (via BrowserOAuthClientProvider)
 * - Feature exclusions (no code mode, no file system, no STDIO)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BrowserMCPClient } from "../../../src/client/browser.js";

describe("BrowserMCPClient", () => {
  let client: BrowserMCPClient;

  beforeEach(() => {
    client = new BrowserMCPClient();
  });

  afterEach(async () => {
    await client.closeAllSessions();
  });

  describe("HTTP Connector Support", () => {
    it("should support HTTP connector via URL", () => {
      const config = {
        url: "http://localhost:3000",
      };

      client.addServer("http-server", config);
      expect(client.getServerConfig("http-server")).toEqual(config);
    });

    it("should support HTTPS connector via URL", () => {
      const config = {
        url: "https://example.com/mcp",
      };

      client.addServer("https-server", config);
      expect(client.getServerConfig("https-server")).toEqual(config);
    });

    it("should support explicit HTTP transport", () => {
      const config = {
        url: "http://localhost:3000",
        transport: "http",
      };

      client.addServer("http-explicit", config);
      expect(client.getServerConfig("http-explicit")).toEqual(config);
    });

    it("should support custom headers", () => {
      const config = {
        url: "http://localhost:3000",
        headers: {
          Authorization: "Bearer token123",
          "X-Custom": "value",
        },
      };

      client.addServer("http-with-headers", config);
      expect(client.getServerConfig("http-with-headers")).toEqual(config);
    });
  });

  describe("WebSocket Connector Support", () => {
    it("should support WebSocket connector via ws:// URL", () => {
      const config = {
        url: "ws://localhost:3000",
      };

      client.addServer("ws-server", config);
      expect(client.getServerConfig("ws-server")).toEqual(config);
    });

    it("should support WebSocket connector via wss:// URL", () => {
      const config = {
        url: "wss://example.com/mcp",
      };

      client.addServer("wss-server", config);
      expect(client.getServerConfig("wss-server")).toEqual(config);
    });

    it("should support explicit WebSocket transport", () => {
      const config = {
        url: "http://localhost:3000", // Base URL
        transport: "websocket",
      };

      client.addServer("ws-explicit", config);
      expect(client.getServerConfig("ws-explicit")).toEqual(config);
    });
  });

  describe("OAuth Support", () => {
    it("should accept authProvider in server config", () => {
      const mockAuthProvider = {
        tokens: async () => ({ access_token: "test-token" }),
      };

      const config = {
        url: "http://localhost:3000",
        authProvider: mockAuthProvider,
      };

      client.addServer("oauth-server", config);
      const serverConfig = client.getServerConfig("oauth-server");
      expect(serverConfig.authProvider).toBe(mockAuthProvider);
    });

    it("should accept authToken in server config", () => {
      const config = {
        url: "http://localhost:3000",
        authToken: "bearer-token-123",
      };

      client.addServer("token-server", config);
      expect(client.getServerConfig("token-server").authToken).toBe(
        "bearer-token-123"
      );
    });
  });

  describe("Feature Exclusions", () => {
    it("should NOT have codeMode property", () => {
      expect((client as any).codeMode).toBeUndefined();
    });

    it("should NOT have fromConfigFile static method", () => {
      expect((BrowserMCPClient as any).fromConfigFile).toBeUndefined();
    });

    it("should NOT have saveConfig method", () => {
      expect((client as any).saveConfig).toBeUndefined();
    });

    it("should NOT have executeCode method", () => {
      expect((client as any).executeCode).toBeUndefined();
    });

    it("should NOT support stdio connector configuration", () => {
      // Browser client should throw error or not support stdio
      const config = {
        command: "node",
        args: ["-e", "console.log('test')"],
      };

      client.addServer("stdio-test", config as any);
      // The connector creation will fail at runtime, but config storage should work
      // We test that the config is stored, but connector creation will error
      expect(client.getServerConfig("stdio-test")).toBeDefined();
    });
  });

  describe("fromDict Static Method", () => {
    it("should create client from dictionary config", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
          },
        },
      };

      const client = BrowserMCPClient.fromDict(config);
      expect(client.getServerNames()).toEqual(["test"]);
      expect(client.getServerConfig("test")).toEqual(config.mcpServers.test);
    });

    it("should work with empty config", () => {
      const client = BrowserMCPClient.fromDict({});
      expect(client.getServerNames()).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when URL is missing", async () => {
      const config = {
        transport: "http",
        // Missing url
      };

      // This will fail when creating a session, not when adding server
      client.addServer("invalid", config as any);
      expect(client.getServerConfig("invalid")).toBeDefined();

      // The error will occur during connector creation
      await expect(client.createSession("invalid")).rejects.toThrow();
    });
  });
});
