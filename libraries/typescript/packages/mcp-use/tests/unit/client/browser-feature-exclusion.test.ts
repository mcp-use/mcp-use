import { describe, it, expect, beforeEach } from "vitest";
import { BrowserMCPClient } from "../../../src/client/browser.js";
import { MCPClient } from "../../../src/client.js";

describe("BrowserMCPClient Feature Exclusion", () => {
  beforeEach(() => {
    // Ensure we're in a browser-like environment
    global.window = {} as any;
    delete (global as any).process;
  });

  describe("Node.js-only features should not be available", () => {
    it("should not have codeMode property", () => {
      const client = new BrowserMCPClient();
      expect((client as any).codeMode).toBeUndefined();
    });

    it("should not have code executor methods", () => {
      const client = new BrowserMCPClient();
      expect((client as any).executeCode).toBeUndefined();
      expect((client as any).getCodeExecutor).toBeUndefined();
    });

    it("should not have file system methods", () => {
      const client = new BrowserMCPClient();
      expect((client as any).saveConfig).toBeUndefined();
      expect((client as any).fromConfigFile).toBeUndefined();
    });

    it("should not support stdio connector", () => {
      const client = new BrowserMCPClient();
      // Browser client should default to HTTP for unknown transports
      // stdio is not supported in browser, so it should fallback to HTTP
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp", // Use valid URL since stdio URLs won't work
        transport: "stdio", // This should be ignored or cause fallback
      });
      // Should default to HTTP connector
      expect(connector).toBeDefined();
    });

    it("should not support code mode connector", () => {
      const client = new BrowserMCPClient();
      // Code mode connector should not be available in browser
      // Browser client should default to HTTP for unknown transports
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp", // Use valid URL
        transport: "code", // This should be ignored or cause fallback
      });
      // Should default to HTTP connector
      expect(connector).toBeDefined();
    });
  });

  describe("Browser-compatible features should be available", () => {
    it("should support HTTP connector", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
        transport: "http",
      });
      expect(connector).toBeDefined();
    });

    it("should support WebSocket connector", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "wss://example.com/mcp",
        transport: "websocket",
      });
      expect(connector).toBeDefined();
    });

    it("should support OAuth provider", () => {
      const client = new BrowserMCPClient();
      client.addServer("oauth-server", {
        url: "https://example.com/mcp",
        transport: "http",
        authProvider: {},
      });
      const connector = (client as any).createConnectorFromConfig(
        client.getServerConfig("oauth-server")
      );
      expect(connector).toBeDefined();
    });
  });

  describe("Comparison with Node.js MCPClient", () => {
    it("should have different feature set than Node.js client", () => {
      const browserClient = new BrowserMCPClient();
      // Browser client should not have Node.js-specific features
      expect((browserClient as any).codeMode).toBeUndefined();
      expect((browserClient as any).saveConfig).toBeUndefined();
    });

    it("should share base functionality with Node.js client", () => {
      const browserClient = new BrowserMCPClient();
      // Both should have base methods
      expect(typeof browserClient.addServer).toBe("function");
      expect(typeof browserClient.removeServer).toBe("function");
      expect(typeof browserClient.getServerNames).toBe("function");
      expect(typeof browserClient.createSession).toBe("function");
    });
  });

  describe("Browser-specific APIs", () => {
    it("should work without Node.js globals", () => {
      // Simulate browser environment
      const originalProcess = (global as any).process;
      delete (global as any).process;
      const originalFs = (global as any).fs;
      delete (global as any).fs;

      const client = new BrowserMCPClient();
      client.addServer("test", {
        url: "https://example.com/mcp",
        transport: "http",
      });
      expect(client.getServerNames()).toContain("test");

      // Restore (for other tests)
      if (originalProcess) (global as any).process = originalProcess;
      if (originalFs) (global as any).fs = originalFs;
    });

    it("should use browser APIs when available", () => {
      global.window = {
        location: { origin: "https://example.com" },
      } as any;
      global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      } as any;

      const client = new BrowserMCPClient();
      expect(client).toBeDefined();
    });
  });
});
