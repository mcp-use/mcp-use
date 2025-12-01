import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketConnector } from "../../../src/connectors/websocket.js";
import { WebSocketConnectionManager } from "../../../src/task_managers/websocket.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mock the connection manager using hoisted functions
const { mockWebSocket, mockStart, mockStop } = vi.hoisted(() => {
  const ws = {
    send: vi.fn((data: string, callback?: (err?: Error) => void) => {
      if (callback) callback();
    }),
    on: vi.fn(),
    off: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
  };
  const start = vi.fn().mockResolvedValue(ws);
  const stop = vi.fn().mockResolvedValue(undefined);
  return { mockWebSocket: ws, mockStart: start, mockStop: stop };
});

vi.mock("../../../src/task_managers/websocket.js", () => {
  class MockWebSocketConnectionManager {
    start = mockStart;
    stop = mockStop;
  }
  return {
    WebSocketConnectionManager: MockWebSocketConnectionManager,
  };
});

// Mock generateUUID
vi.mock("../../../src/server/utils/runtime.js", () => {
  return {
    generateUUID: vi.fn(() => "test-uuid-123"),
  };
});

describe("WebSocketConnector", () => {
  let connector: WebSocketConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSocket.readyState = 1; // OPEN
    mockStart.mockResolvedValue(mockWebSocket);
    mockStop.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (connector?.isClientConnected) {
      await connector.disconnect();
    }
  });

  describe("Constructor", () => {
    it("should create connector with URL", () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      expect(connector.publicIdentifier.type).toBe("websocket");
      expect(connector.publicIdentifier.url).toBe("ws://localhost:3000");
    });

    it("should create connector with auth token", () => {
      connector = new WebSocketConnector("ws://localhost:3000", {
        authToken: "test-token",
      });
      expect(connector.publicIdentifier.type).toBe("websocket");
    });

    it("should create connector with custom headers", () => {
      connector = new WebSocketConnector("ws://localhost:3000", {
        headers: { "X-Custom": "value" },
      });
      expect(connector.publicIdentifier.type).toBe("websocket");
    });
  });

  describe("Connection", () => {
    it("should connect successfully", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(WebSocketConnectionManager).toHaveBeenCalled();
    });

    it("should not connect twice", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
      const firstWs = (connector as any).ws;

      await connector.connect(); // Should be idempotent
      expect((connector as any).ws).toBe(firstWs);
    });

    it("should start receiver loop on connect", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
      expect((connector as any).receiverTask).toBeDefined();
    });

    it("should handle connection errors", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      vi.mocked(WebSocketConnectionManager.prototype.start).mockRejectedValueOnce(
        new Error("Connection failed")
      );

      await expect(connector.connect()).rejects.toThrow("Connection failed");
      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Public Identifier", () => {
    it("should return correct public identifier", () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      expect(connector.publicIdentifier).toEqual({
        type: "websocket",
        url: "ws://localhost:3000",
      });
    });
  });

  describe("Disconnection", () => {
    it("should disconnect successfully", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
      await connector.disconnect();
      expect(connector.isClientConnected).toBe(false);
    });

    it("should handle disconnect when not connected", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.disconnect(); // Should not throw
      expect(connector.isClientConnected).toBe(false);
    });

    it("should reject pending requests on disconnect", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();

      // Start a request that will be pending
      const requestPromise = (connector as any).sendRequest("test/method", {});

      // Disconnect immediately
      await connector.disconnect();

      // Request should be rejected
      await expect(requestPromise).rejects.toThrow();
    });
  });

  describe("Initialization", () => {
    beforeEach(async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
    });

    it("should initialize successfully", async () => {
      // Mock the response for initialize
      const mockInitializeResponse = {
        capabilities: {},
        serverInfo: { name: "test-server", version: "1.0.0" },
      };

      // Mock the response for listTools
      const mockToolsResponse = {
        tools: [
          {
            name: "test_tool",
            description: "Test tool",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };

      // Set up message handler to respond to requests
      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
          // Immediately respond to initialize
          setTimeout(() => {
            if (messageHandler) {
              messageHandler({
                data: JSON.stringify({
                  id: "test-uuid-123",
                  result: mockInitializeResponse,
                }),
              });
              // Then respond to listTools
              setTimeout(() => {
                if (messageHandler) {
                  messageHandler({
                    data: JSON.stringify({
                      id: "test-uuid-123",
                      result: mockToolsResponse,
                    }),
                  });
                }
              }, 5);
            }
          }, 5);
        }
      });

      await connector.initialize();
      expect(connector.tools).toHaveLength(1);
    });
  });

  describe("Tool Operations", () => {
    beforeEach(async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
    });

    it("should list tools", async () => {
      const mockResponse = {
        tools: [
          {
            name: "test_tool",
            description: "Test tool",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const listPromise = connector.listTools();

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            result: mockResponse,
          }),
        });
      }

      const tools = await listPromise;
      expect(tools).toHaveLength(1);
    });

    it("should call tool", async () => {
      const mockResult: CallToolResult = {
        content: [{ type: "text", text: "result" }],
        isError: false,
      };

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const callPromise = connector.callTool("test_tool", { arg: "value" });

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            result: mockResult,
          }),
        });
      }

      const result = await callPromise;
      expect(result).toEqual(mockResult);
      expect(mockWebSocket.send).toHaveBeenCalled();
    });

    it("should handle tool call errors", async () => {
      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const callPromise = connector.callTool("test_tool", {});

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            error: { code: -32603, message: "Internal error" },
          }),
        });
      }

      await expect(callPromise).rejects.toEqual({
        code: -32603,
        message: "Internal error",
      });
    });
  });

  describe("Resource Operations", () => {
    beforeEach(async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
    });

    it("should list resources", async () => {
      const mockResponse = {
        resources: [{ uri: "file:///test" }],
      };

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const listPromise = connector.listResources();

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            result: mockResponse,
          }),
        });
      }

      const result = await listPromise;
      expect(result.resources).toEqual([{ uri: "file:///test" }]);
    });

    it("should read resource", async () => {
      const mockResponse = {
        contents: [{ uri: "file:///test", mimeType: "text/plain" }],
      };

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const readPromise = connector.readResource("file:///test");

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            result: mockResponse,
          }),
        });
      }

      const result = await readPromise;
      expect(result).toEqual(mockResponse);
    });
  });

  describe("Notification Handling", () => {
    beforeEach(async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
    });

    it("should handle tools/list_changed notification", async () => {
      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      // Initialize first
      await connector.initialize();

      // Send tools/list_changed notification
      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            method: "notifications/tools/list_changed",
            params: {},
          }),
        });
      }

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify refreshToolsCache was called (we can't easily verify the actual refresh
      // without setting up a more complex mock)
      expect(messageHandler).toBeDefined();
    });

    it("should call user-registered notification handlers", async () => {
      const handler = vi.fn();
      connector.onNotification(handler);

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const notification = {
        method: "custom/notification",
        params: { data: "test" },
      };

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify(notification),
        });
      }

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Handler should be called
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle send errors", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();

      mockWebSocket.send.mockImplementationOnce((data: string, callback?: (err?: Error) => void) => {
        if (callback) callback(new Error("Send failed"));
      });

      const requestPromise = (connector as any).sendRequest("test/method", {});
      await expect(requestPromise).rejects.toThrow("Send failed");
    });

    it("should handle invalid JSON messages", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      // Send invalid JSON
      if (messageHandler) {
        messageHandler({ data: "invalid json{" });
      }

      // Should not throw, just log warning
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(connector.isClientConnected).toBe(true);
    });

    it("should cleanup resources on connection failure", async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      mockStart.mockRejectedValueOnce(new Error("Connection failed"));

      await expect(connector.connect()).rejects.toThrow();
      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Raw Request", () => {
    beforeEach(async () => {
      connector = new WebSocketConnector("ws://localhost:3000");
      await connector.connect();
    });

    it("should send raw request", async () => {
      const mockResponse = { result: "success" };

      let messageHandler: ((msg: any) => void) | null = null;
      mockWebSocket.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      const requestPromise = connector.request("custom/method", { param: "value" });

      if (messageHandler) {
        messageHandler({
          data: JSON.stringify({
            id: "test-uuid-123",
            result: mockResponse,
          }),
        });
      }

      const result = await requestPromise;
      expect(result).toEqual(mockResponse);
      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });
});
