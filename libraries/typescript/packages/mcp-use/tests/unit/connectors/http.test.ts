import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpConnector } from "../../../src/connectors/http.js";
import { SseConnectionManager } from "../../../src/task_managers/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Mock the SDK Client
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
      getServerVersion: vi.fn().mockReturnValue({ name: "test-server", version: "1.0.0" }),
      sendRootsListChanged: vi.fn().mockResolvedValue(undefined),
      setRequestHandler: vi.fn(),
      fallbackNotificationHandler: undefined,
      listResources: vi.fn(),
      readResource: vi.fn(),
      listResourceTemplates: vi.fn(),
      subscribeResource: vi.fn(),
      unsubscribeResource: vi.fn(),
      listPrompts: vi.fn(),
      getPrompt: vi.fn(),
      request: vi.fn(),
    })),
  };
});

// Mock StreamableHTTPClientTransport
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  return {
    StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      terminateSession: vi.fn().mockResolvedValue(undefined),
      sessionId: "test-session-id",
    })),
    StreamableHTTPError: class StreamableHTTPError extends Error {
      code: number;
      constructor(message: string, code: number) {
        super(message);
        this.code = code;
        this.name = "StreamableHTTPError";
      }
    },
  };
});

// Mock the SSE connection manager
vi.mock("../../../src/task_managers/sse.js", () => {
  return {
    SseConnectionManager: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue({
        // Mock transport
        close: vi.fn().mockResolvedValue(undefined),
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("HttpConnector", () => {
  let connector: HttpConnector;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (connector?.isClientConnected) {
      await connector.disconnect();
    }
  });

  describe("Constructor", () => {
    it("should create connector with base URL", () => {
      connector = new HttpConnector("http://localhost:3000");
      expect(connector.publicIdentifier.type).toBe("http");
      expect(connector.publicIdentifier.url).toBe("http://localhost:3000");
    });

    it("should normalize URL by removing trailing slash", () => {
      connector = new HttpConnector("http://localhost:3000/");
      expect(connector.publicIdentifier.url).toBe("http://localhost:3000");
    });

    it("should create connector with auth token", () => {
      connector = new HttpConnector("http://localhost:3000", {
        authToken: "test-token",
      });
      expect(connector.publicIdentifier.type).toBe("http");
    });

    it("should create connector with custom headers", () => {
      connector = new HttpConnector("http://localhost:3000", {
        headers: { "X-Custom": "value" },
      });
      expect(connector.publicIdentifier.type).toBe("http");
    });

    it("should create connector with custom timeout", () => {
      connector = new HttpConnector("http://localhost:3000", {
        timeout: 60000,
      });
      expect(connector.publicIdentifier.type).toBe("http");
    });

    it("should create connector with preferSse option", () => {
      connector = new HttpConnector("http://localhost:3000", {
        preferSse: true,
      });
      expect(connector.publicIdentifier.type).toBe("http");
    });
  });

  describe("Connection - Streamable HTTP", () => {
    it("should connect via streamable HTTP successfully", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(StreamableHTTPClientTransport).toHaveBeenCalled();
      expect(connector.getTransportType()).toBe("streamable-http");
    });

    it("should not connect twice", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      const firstClient = (connector as any).client;

      await connector.connect(); // Should be idempotent
      expect((connector as any).client).toBe(firstClient);
    });

    it("should advertise roots capability", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();

      expect(Client).toHaveBeenCalled();
      const clientOptions = vi.mocked(Client).mock.calls[0][1];
      expect(clientOptions?.capabilities?.roots).toEqual({ listChanged: true });
    });

    it("should set up roots handler before connect", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();

      const mockClient = (connector as any).client;
      expect(mockClient.setRequestHandler).toHaveBeenCalled();
    });
  });

  describe("Connection - SSE Fallback", () => {
    it("should fallback to SSE when streamable HTTP fails with 404", async () => {
      connector = new HttpConnector("http://localhost:3000");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(
        new StreamableHTTPError("Not Found", 404)
      );

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(SseConnectionManager).toHaveBeenCalled();
      expect(connector.getTransportType()).toBe("sse");
    });

    it("should fallback to SSE when streamable HTTP fails with 405", async () => {
      connector = new HttpConnector("http://localhost:3000");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(
        new StreamableHTTPError("Method Not Allowed", 405)
      );

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(SseConnectionManager).toHaveBeenCalled();
    });

    it("should fallback to SSE when missing session ID error", async () => {
      connector = new HttpConnector("http://localhost:3000");
      const error = new Error("Bad Request: Missing session ID");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(error);

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(SseConnectionManager).toHaveBeenCalled();
    });

    it("should not fallback on 401 authentication error", async () => {
      connector = new HttpConnector("http://localhost:3000");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(
        new StreamableHTTPError("Unauthorized", 401)
      );

      await expect(connector.connect()).rejects.toThrow();
      expect(SseConnectionManager).not.toHaveBeenCalled();
    });

    it("should throw error if both transports fail", async () => {
      connector = new HttpConnector("http://localhost:3000");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(
        new StreamableHTTPError("Not Found", 404)
      );
      vi.mocked(SseConnectionManager.prototype.start).mockRejectedValueOnce(
        new Error("SSE failed")
      );

      await expect(connector.connect()).rejects.toThrow();
    });
  });

  describe("Connection - Prefer SSE", () => {
    it("should use SSE directly when preferSse is true", async () => {
      connector = new HttpConnector("http://localhost:3000", {
        preferSse: true,
      });

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      expect(SseConnectionManager).toHaveBeenCalled();
      expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
      expect(connector.getTransportType()).toBe("sse");
    });
  });

  describe("Public Identifier", () => {
    it("should return correct public identifier", () => {
      connector = new HttpConnector("http://localhost:3000");
      expect(connector.publicIdentifier).toEqual({
        type: "http",
        url: "http://localhost:3000",
        transport: "unknown",
      });
    });

    it("should include transport type after connection", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      expect(connector.publicIdentifier.transport).toBe("streamable-http");
    });
  });

  describe("Transport Type", () => {
    it("should return null before connection", () => {
      connector = new HttpConnector("http://localhost:3000");
      expect(connector.getTransportType()).toBe(null);
    });

    it("should return streamable-http after streamable HTTP connection", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      expect(connector.getTransportType()).toBe("streamable-http");
    });

    it("should return sse after SSE connection", async () => {
      connector = new HttpConnector("http://localhost:3000", {
        preferSse: true,
      });
      await connector.connect();
      expect(connector.getTransportType()).toBe("sse");
    });
  });

  describe("Disconnection", () => {
    it("should disconnect successfully", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      await connector.disconnect();
      expect(connector.isClientConnected).toBe(false);
    });

    it("should terminate session on disconnect for streamable HTTP", async () => {
      connector = new HttpConnector("http://localhost:3000");
      await connector.connect();
      const mockTransport = (connector as any).streamableTransport;

      await connector.disconnect();
      if (mockTransport) {
        expect(mockTransport.terminateSession).toHaveBeenCalled();
      }
    });
  });

  describe("Error Handling", () => {
    it("should cleanup resources on connection failure", async () => {
      connector = new HttpConnector("http://localhost:3000");
      vi.mocked(StreamableHTTPClientTransport.prototype.connect).mockRejectedValueOnce(
        new Error("Connection failed")
      );
      vi.mocked(SseConnectionManager.prototype.start).mockRejectedValueOnce(
        new Error("SSE failed")
      );

      await expect(connector.connect()).rejects.toThrow();
      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Authentication", () => {
    it("should include auth token in headers", async () => {
      connector = new HttpConnector("http://localhost:3000", {
        authToken: "bearer-token",
      });

      await connector.connect();
      expect(StreamableHTTPClientTransport).toHaveBeenCalled();
      const callArgs = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
      expect(callArgs[1]?.requestInit?.headers?.Authorization).toBe("Bearer bearer-token");
    });

    it("should include custom headers", async () => {
      connector = new HttpConnector("http://localhost:3000", {
        headers: { "X-Custom": "value" },
      });

      await connector.connect();
      expect(StreamableHTTPClientTransport).toHaveBeenCalled();
      const callArgs = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
      expect(callArgs[1]?.requestInit?.headers?.["X-Custom"]).toBe("value");
    });
  });
});
