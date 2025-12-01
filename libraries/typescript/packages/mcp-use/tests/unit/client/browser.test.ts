import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BrowserMCPClient } from "../../../src/client/browser.js";
import { HttpConnector } from "../../../src/connectors/http.js";
import { WebSocketConnector } from "../../../src/connectors/websocket.js";

// Mock browser APIs
const mockLocalStorage: Record<string, string> = {};
const mockWindow = {
  location: {
    origin: "https://example.com",
    href: "https://example.com",
    search: "",
    pathname: "/",
  },
  open: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  postMessage: vi.fn(),
  close: vi.fn(),
};

// Setup browser environment mocks
beforeEach(() => {
  // Mock localStorage
  global.localStorage = {
    getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      mockLocalStorage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete mockLocalStorage[key];
    }),
    clear: vi.fn(() => {
      Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
    }),
    key: vi.fn((index: number) => {
      const keys = Object.keys(mockLocalStorage);
      return keys[index] || null;
    }),
    get length() {
      return Object.keys(mockLocalStorage).length;
    },
  } as any;

  // Mock window
  global.window = mockWindow as any;

  // Mock fetch
  global.fetch = vi.fn();

  // Mock WebSocket
  global.WebSocket = vi.fn() as any;
  (global.WebSocket as any).OPEN = 1;
  (global.WebSocket as any).CLOSED = 3;

  // Mock crypto
  global.crypto = {
    randomUUID: vi.fn(() => "test-uuid-123"),
  } as any;

  // Clear all mocks
  vi.clearAllMocks();
  Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrowserMCPClient", () => {
  describe("constructor", () => {
    it("should create a BrowserMCPClient instance", () => {
      const client = new BrowserMCPClient();
      expect(client).toBeInstanceOf(BrowserMCPClient);
    });

    it("should create a BrowserMCPClient with config", () => {
      const config = {
        mcpServers: {
          testServer: {
            url: "https://example.com/mcp",
            transport: "http",
          },
        },
      };
      const client = new BrowserMCPClient(config);
      expect(client.getConfig()).toEqual(config);
    });
  });

  describe("fromDict", () => {
    it("should create a BrowserMCPClient from dictionary", () => {
      const config = {
        mcpServers: {
          testServer: {
            url: "https://example.com/mcp",
            transport: "http",
          },
        },
      };
      const client = BrowserMCPClient.fromDict(config);
      expect(client).toBeInstanceOf(BrowserMCPClient);
      expect(client.getConfig()).toEqual(config);
    });
  });

  describe("addServer", () => {
    it("should add a server configuration", () => {
      const client = new BrowserMCPClient();
      client.addServer("testServer", {
        url: "https://example.com/mcp",
        transport: "http",
      });
      expect(client.getServerNames()).toContain("testServer");
      expect(client.getServerConfig("testServer")).toEqual({
        url: "https://example.com/mcp",
        transport: "http",
      });
    });

    it("should add multiple servers", () => {
      const client = new BrowserMCPClient();
      client.addServer("server1", { url: "https://server1.com", transport: "http" });
      client.addServer("server2", { url: "wss://server2.com", transport: "websocket" });
      expect(client.getServerNames()).toHaveLength(2);
      expect(client.getServerNames()).toContain("server1");
      expect(client.getServerNames()).toContain("server2");
    });
  });

  describe("removeServer", () => {
    it("should remove a server configuration", () => {
      const client = new BrowserMCPClient();
      client.addServer("testServer", { url: "https://example.com/mcp", transport: "http" });
      expect(client.getServerNames()).toContain("testServer");
      client.removeServer("testServer");
      expect(client.getServerNames()).not.toContain("testServer");
    });

    it("should remove server from activeSessions when removed", () => {
      const client = new BrowserMCPClient();
      client.addServer("testServer", { url: "https://example.com/mcp", transport: "http" });
      (client as any).activeSessions = ["testServer"];
      client.removeServer("testServer");
      expect(client.activeSessions).not.toContain("testServer");
    });
  });

  describe("createConnectorFromConfig", () => {
    it("should create HttpConnector for http transport", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
        transport: "http",
      });
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector for https URL", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector for http URL", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "http://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create WebSocketConnector for websocket transport", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
        transport: "websocket",
      });
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should create WebSocketConnector for ws URL", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "ws://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should create WebSocketConnector for wss URL", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "wss://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should default to HttpConnector when no transport specified", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should throw error when URL is missing", () => {
      const client = new BrowserMCPClient();
      expect(() => {
        (client as any).createConnectorFromConfig({ transport: "http" });
      }).toThrow("Server URL is required");
    });

    it("should pass connector options correctly", () => {
      const client = new BrowserMCPClient();
      const options = {
        url: "https://example.com/mcp",
        transport: "http",
        headers: { "X-Custom": "value" },
        authToken: "token123",
        authProvider: {},
        wrapTransport: vi.fn(),
        clientOptions: { capabilities: {} },
        samplingCallback: vi.fn(),
      };
      const connector = (client as any).createConnectorFromConfig(options);
      expect(connector).toBeInstanceOf(HttpConnector);
    });
  });

  describe("getServerNames", () => {
    it("should return empty array when no servers configured", () => {
      const client = new BrowserMCPClient();
      expect(client.getServerNames()).toEqual([]);
    });

    it("should return array of server names", () => {
      const client = new BrowserMCPClient();
      client.addServer("server1", { url: "https://server1.com", transport: "http" });
      client.addServer("server2", { url: "https://server2.com", transport: "http" });
      expect(client.getServerNames()).toEqual(["server1", "server2"]);
    });
  });

  describe("getServerConfig", () => {
    it("should return server configuration", () => {
      const client = new BrowserMCPClient();
      const config = { url: "https://example.com/mcp", transport: "http" };
      client.addServer("testServer", config);
      expect(client.getServerConfig("testServer")).toEqual(config);
    });

    it("should return undefined for non-existent server", () => {
      const client = new BrowserMCPClient();
      expect(client.getServerConfig("nonExistent")).toBeUndefined();
    });
  });

  describe("getConfig", () => {
    it("should return empty config when no config provided", () => {
      const client = new BrowserMCPClient();
      expect(client.getConfig()).toEqual({});
    });

    it("should return the config object", () => {
      const config = {
        mcpServers: {
          testServer: { url: "https://example.com/mcp", transport: "http" },
        },
      };
      const client = new BrowserMCPClient(config);
      expect(client.getConfig()).toEqual(config);
    });
  });
});
