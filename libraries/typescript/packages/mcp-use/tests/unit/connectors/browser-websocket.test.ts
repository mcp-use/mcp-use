import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketConnector } from "../../../src/connectors/websocket.js";

// Mock browser WebSocket
let mockWebSocket: any;
let mockWebSocketInstances: any[];

beforeEach(() => {
  mockWebSocketInstances = [];
  mockWebSocket = class MockWebSocket {
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

    constructor(url: string, protocols?: string | string[]) {
      this.url = url;
      mockWebSocketInstances.push(this);
      // Simulate connection after a tick
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

    removeEventListener(event: string, handler: (event: any) => void) {
      if (event === "open" && this.onopen === handler) this.onopen = null;
      if (event === "message" && this.onmessage === handler) this.onmessage = null;
      if (event === "error" && this.onerror === handler) this.onerror = null;
      if (event === "close" && this.onclose === handler) this.onclose = null;
    }
  };

  global.WebSocket = mockWebSocket as any;
  (global.WebSocket as any).OPEN = 1;
  (global.WebSocket as any).CLOSED = 3;

  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  mockWebSocketInstances = [];
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
      expect(mockWebSocketInstances.length).toBe(0);
    });

    it("should create WebSocket connection", async () => {
      const connector = new WebSocketConnector(url);
      const connectPromise = connector.connect();
      // Wait for WebSocket to be created
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockWebSocketInstances.length).toBe(1);
      const ws = mockWebSocketInstances[0];
      expect(ws.url).toBe(url);
      // Complete connection
      ws.readyState = mockWebSocket.OPEN;
      if (ws.onopen) ws.onopen({});
      await connectPromise;
      expect((connector as any).connected).toBe(true);
    });

    it("should handle connection errors", async () => {
      const connector = new WebSocketConnector(url);
      const connectPromise = connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = mockWebSocketInstances[0];
      const error = new Error("Connection failed");
      if (ws.onerror) ws.onerror({ error } as any);
      await expect(connectPromise).rejects.toThrow();
    });
  });

  describe("disconnect", () => {
    it("should not disconnect if not connected", async () => {
      const connector = new WebSocketConnector(url);
      await connector.disconnect();
      expect(mockWebSocketInstances.length).toBe(0);
    });

    it("should close WebSocket connection", async () => {
      const connector = new WebSocketConnector(url);
      await connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = mockWebSocketInstances[0];
      await connector.disconnect();
      expect(ws.close).toHaveBeenCalled();
      expect((connector as any).connected).toBe(false);
    });
  });

  describe("browser-specific behavior", () => {
    it("should use browser WebSocket API", () => {
      const connector = new WebSocketConnector(url);
      expect(typeof global.WebSocket).toBe("function");
    });

    it("should handle browser WebSocket events", async () => {
      const connector = new WebSocketConnector(url);
      const connectPromise = connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = mockWebSocketInstances[0];
      // Simulate message
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({ id: "1", result: { success: true } }),
        } as any);
      }
      await connectPromise;
    });

    it("should handle WebSocket close events", async () => {
      const connector = new WebSocketConnector(url);
      await connector.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = mockWebSocketInstances[0];
      if (ws.onclose) {
        ws.onclose({ code: 1000, reason: "Normal closure" } as any);
      }
      expect((connector as any).connected).toBe(false);
    });
  });
});
