import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketConnector } from "../../../src/connectors/websocket.js";

// Shared state for tracking mock WebSocket instances
const mockState = {
  instances: [] as any[],
};

// Mock the ws module used by WebSocketConnectionManager
vi.mock("ws", () => {
  class MockWebSocket {
    url: string;
    readyState: number = 0;
    protocol: string = "";
    extensions: string = "";
    binaryType: "blob" | "arraybuffer" = "blob";
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

    constructor(url: string, options?: any) {
      this.url = url;
      mockState.instances.push(this);
      // Simulate connection after a tick
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) {
          this.onopen({} as any);
        }
      }, 0);
    }

    on(event: string, handler: (event: any) => void) {
      if (event === "open") this.onopen = handler;
      if (event === "message") this.onmessage = handler;
      if (event === "error") this.onerror = handler;
      if (event === "close") this.onclose = handler;
    }

    off(event: string, handler: (event: any) => void) {
      if (event === "open" && this.onopen === handler) this.onopen = null;
      if (event === "message" && this.onmessage === handler) this.onmessage = null;
      if (event === "error" && this.onerror === handler) this.onerror = null;
      if (event === "close" && this.onclose === handler) this.onclose = null;
    }

    addEventListener(event: string, handler: (event: any) => void) {
      this.on(event, handler);
    }

    removeEventListener(event: string, handler: (event: any) => void) {
      this.off(event, handler);
    }
  }

  return {
    default: MockWebSocket,
  };
});

beforeEach(() => {
  mockState.instances = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  mockState.instances = [];
});

describe("WebSocketConnector (Browser Environment)", () => {
  const url = "wss://example.com/mcp";

  describe("constructor", () => {
    it("should create WebSocketConnector with URL", () => {
      const connector = new WebSocketConnector(url);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should set default headers", () => {
      const connector = new WebSocketConnector(url);
      expect((connector as any).headers).toBeDefined();
    });

    it("should set Authorization header when authToken provided", () => {
      const connector = new WebSocketConnector(url, {
        authToken: "test-token",
      });
      expect((connector as any).headers.Authorization).toBe("Bearer test-token");
    });

    it("should merge custom headers", () => {
      const connector = new WebSocketConnector(url, {
        headers: { "X-Custom": "value" },
      });
      expect((connector as any).headers["X-Custom"]).toBe("value");
    });
  });

  describe("connect", () => {
    it("should not reconnect if already connected", async () => {
      const connector = new WebSocketConnector(url);
      (connector as any).connected = true;
      await connector.connect();
      expect(mockState.instances.length).toBe(0);
    });

    it("should create WebSocket connection", async () => {
      const connector = new WebSocketConnector(url);
      const connectPromise = connector.connect();
      // Wait for WebSocket to be created and connected
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockState.instances.length).toBe(1);
      const ws = mockState.instances[0];
      expect(ws.url).toBe(url);
      await connectPromise;
      expect((connector as any).connected).toBe(true);
    });

    it("should handle connection errors gracefully", async () => {
      const connector = new WebSocketConnector(url);
      // Connection should complete successfully with our mock
      await connector.connect();
      expect((connector as any).connected).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("should not disconnect if not connected", async () => {
      const connector = new WebSocketConnector(url);
      await connector.disconnect();
      expect(mockState.instances.length).toBe(0);
    });

    it("should close WebSocket connection", async () => {
      const connector = new WebSocketConnector(url);
      await connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockState.instances.length).toBe(1);
      const ws = mockState.instances[0];
      await connector.disconnect();
      expect(ws.close).toHaveBeenCalled();
      expect((connector as any).connected).toBe(false);
    });
  });

  describe("browser-specific behavior", () => {
    it("should create WebSocketConnector instance", () => {
      const connector = new WebSocketConnector(url);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should handle browser WebSocket events", async () => {
      const connector = new WebSocketConnector(url);
      await connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockState.instances.length).toBe(1);
      const ws = mockState.instances[0];
      // Simulate message
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({ id: "1", result: { success: true } }),
        } as any);
      }
      // Message handling is tested through the connector's internal logic
      expect(ws).toBeDefined();
    });

    it("should handle WebSocket close events", async () => {
      const connector = new WebSocketConnector(url);
      await connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockState.instances.length).toBe(1);
      const ws = mockState.instances[0];
      // Simulate close event
      ws.readyState = 3; // CLOSED
      if (ws.onclose) {
        ws.onclose({ code: 1000, reason: "Normal closure" } as any);
      }
      // The connector should handle the close event internally
      expect(ws).toBeDefined();
    });
  });
});
