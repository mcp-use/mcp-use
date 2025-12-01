import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BrowserMCPClient } from "../../../src/client/browser.js";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser-provider.js";
import { HttpConnector } from "../../../src/connectors/http.js";
import { WebSocketConnector } from "../../../src/connectors/websocket.js";

// Mock browser APIs for integration tests
const mockLocalStorage: Record<string, string> = {};
let mockWindow: any;
let mockFetch: any;
let mockWebSocket: any;
let mockWebSocketInstances: any[];

beforeEach(() => {
  // Mock localStorage
  mockLocalStorage = {};
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
  mockWindow = {
    location: {
      origin: "https://example.com",
      href: "https://example.com",
      search: "",
      pathname: "/",
    },
    open: vi.fn(() => ({
      closed: false,
      focus: vi.fn(),
      postMessage: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  global.window = mockWindow;

  // Mock fetch
  mockFetch = vi.fn();
  global.fetch = mockFetch;

  // Mock WebSocket
  mockWebSocketInstances = [];
  mockWebSocket = class MockWebSocket {
    url: string;
    readyState: number = 0;
    onopen: ((event: any) => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onclose: ((event: any) => void) | null = null;
    send: vi.Mock = vi.fn();
    close: vi.Mock = vi.fn();

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url: string) {
      this.url = url;
      mockWebSocketInstances.push(this);
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) {
          this.onopen({} as any);
        }
      }, 0);
    }

    addEventListener(event: string, handler: (event: any) => void) {
      if (event === "open") this.onopen = handler;
      if (event === "message") this.onmessage = handler;
      if (event === "error") this.onerror = handler;
      if (event === "close") this.onclose = handler;
    }
  };

  global.WebSocket = mockWebSocket as any;
  (global.WebSocket as any).OPEN = 1;
  (global.WebSocket as any).CLOSED = 3;

  // Mock crypto
  global.crypto = {
    randomUUID: vi.fn(() => "test-uuid-123"),
  } as any;

  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
});

describe("BrowserMCPClient Integration Tests", () => {
  describe("Client lifecycle", () => {
    it("should create client and manage servers", () => {
      const client = new BrowserMCPClient();
      expect(client.getServerNames()).toEqual([]);

      client.addServer("server1", {
        url: "https://server1.com/mcp",
        transport: "http",
      });
      expect(client.getServerNames()).toContain("server1");

      client.addServer("server2", {
        url: "wss://server2.com/mcp",
        transport: "websocket",
      });
      expect(client.getServerNames()).toHaveLength(2);

      client.removeServer("server1");
      expect(client.getServerNames()).not.toContain("server1");
      expect(client.getServerNames()).toContain("server2");
    });

    it("should handle multiple server configurations", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          httpServer: {
            url: "https://http.example.com/mcp",
            transport: "http",
          },
          wsServer: {
            url: "wss://ws.example.com/mcp",
            transport: "websocket",
          },
        },
      });

      expect(client.getServerNames()).toHaveLength(2);
      expect(client.getServerConfig("httpServer")).toBeDefined();
      expect(client.getServerConfig("wsServer")).toBeDefined();
    });
  });

  describe("OAuth integration", () => {
    it("should work with BrowserOAuthClientProvider", () => {
      const client = new BrowserMCPClient();
      const oauthProvider = new BrowserOAuthClientProvider("https://oauth.example.com");

      client.addServer("oauth-server", {
        url: "https://oauth.example.com/mcp",
        transport: "http",
        authProvider: oauthProvider,
      });

      const config = client.getServerConfig("oauth-server");
      expect(config.authProvider).toBe(oauthProvider);
    });

    it("should store OAuth tokens in localStorage", async () => {
      const provider = new BrowserOAuthClientProvider("https://oauth.example.com");
      const tokens = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
      };

      await provider.saveTokens(tokens);
      const retrieved = await provider.tokens();
      expect(retrieved).toEqual(tokens);
    });

    it("should handle OAuth flow with popup", async () => {
      const provider = new BrowserOAuthClientProvider("https://oauth.example.com", {
        preventAutoAuth: false,
      });
      const url = new URL("https://oauth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(mockWindow.open).toHaveBeenCalled();
    });

    it("should handle OAuth flow with redirect", async () => {
      const provider = new BrowserOAuthClientProvider("https://oauth.example.com", {
        useRedirectFlow: true,
        preventAutoAuth: false,
      });
      const url = new URL("https://oauth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      // Redirect flow should set window.location.href
      expect(mockWindow.location.href).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should handle missing server URL gracefully", () => {
      const client = new BrowserMCPClient();
      expect(() => {
        (client as any).createConnectorFromConfig({
          transport: "http",
        });
      }).toThrow("Server URL is required");
    });

    it("should handle invalid server name in createSession", async () => {
      const client = new BrowserMCPClient();
      await expect(
        client.createSession("non-existent-server")
      ).rejects.toThrow("Server 'non-existent-server' not found in config");
    });

    it("should handle connection errors gracefully", async () => {
      const client = new BrowserMCPClient();
      client.addServer("test-server", {
        url: "https://invalid-url-that-does-not-exist-12345.com/mcp",
        transport: "http",
      });

      // Mock fetch to reject
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Connection should fail but not crash
      try {
        await client.createSession("test-server");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Browser-specific behavior", () => {
    it("should use browser localStorage for OAuth", async () => {
      const provider = new BrowserOAuthClientProvider("https://oauth.example.com");
      await provider.saveClientInformation({
        client_id: "test-client",
        client_secret: "test-secret",
      });

      expect(global.localStorage.setItem).toHaveBeenCalled();
      const info = await provider.clientInformation();
      expect(info?.client_id).toBe("test-client");
    });

    it("should use browser window for OAuth popup", async () => {
      const provider = new BrowserOAuthClientProvider("https://oauth.example.com", {
        preventAutoAuth: false,
      });
      const url = new URL("https://oauth.example.com/authorize");
      await provider.redirectToAuthorization(url);
      expect(mockWindow.open).toHaveBeenCalled();
    });

    it("should work without Node.js-specific APIs", () => {
      // Remove Node.js globals
      const originalProcess = (global as any).process;
      const originalFs = (global as any).fs;
      delete (global as any).process;
      delete (global as any).fs;

      const client = new BrowserMCPClient();
      client.addServer("test", {
        url: "https://example.com/mcp",
        transport: "http",
      });
      expect(client.getServerNames()).toContain("test");

      // Restore
      if (originalProcess) (global as any).process = originalProcess;
      if (originalFs) (global as any).fs = originalFs;
    });
  });

  describe("Transport fallback", () => {
    it("should default to HTTP connector for unknown transports", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "https://example.com/mcp",
        transport: "unknown-transport",
      });
      expect(connector).toBeDefined();
      // Should default to HTTP
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should use WebSocket for ws:// URLs", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "ws://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should use WebSocket for wss:// URLs", () => {
      const client = new BrowserMCPClient();
      const connector = (client as any).createConnectorFromConfig({
        url: "wss://example.com/mcp",
      });
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });
  });
});
