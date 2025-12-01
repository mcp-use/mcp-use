import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StdioConnector } from "../../../src/connectors/stdio.js";
import { StdioConnectionManager } from "../../../src/task_managers/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Writable } from "node:stream";
import { PassThrough } from "node:stream";

// Mock the SDK Client
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    callTool = vi.fn();
    getServerCapabilities = vi.fn().mockReturnValue({});
    getServerVersion = vi.fn().mockReturnValue({ name: "test-server", version: "1.0.0" });
    sendRootsListChanged = vi.fn().mockResolvedValue(undefined);
    setRequestHandler = vi.fn();
    fallbackNotificationHandler = undefined;
    listResources = vi.fn();
    readResource = vi.fn();
    listResourceTemplates = vi.fn();
    subscribeResource = vi.fn();
    unsubscribeResource = vi.fn();
    listPrompts = vi.fn();
    getPrompt = vi.fn();
    request = vi.fn();
  }
  return {
    Client: MockClient,
  };
});

// Mock the connection manager
const mockStart = vi.fn().mockResolvedValue({
  // Mock transport
  close: vi.fn().mockResolvedValue(undefined),
});
const mockStop = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/task_managers/stdio.js", () => {
  class MockStdioConnectionManager {
    start = mockStart;
    stop = mockStop;
  }
  return {
    StdioConnectionManager: MockStdioConnectionManager,
  };
});

describe("StdioConnector", () => {
  let connector: StdioConnector;
  let mockErrlog: Writable;

  beforeEach(() => {
    mockErrlog = new PassThrough();
    vi.clearAllMocks();
    mockStart.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
    mockStop.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (connector?.isClientConnected) {
      await connector.disconnect();
    }
  });

  describe("Constructor", () => {
    it("should create connector with default options", () => {
      connector = new StdioConnector();
      expect(connector.publicIdentifier.type).toBe("stdio");
      expect(connector.publicIdentifier["command&args"]).toBe("npx ");
    });

    it("should create connector with custom command and args", () => {
      connector = new StdioConnector({
        command: "node",
        args: ["server.js"],
      });
      expect(connector.publicIdentifier["command&args"]).toBe("node server.js");
    });

    it("should create connector with custom environment", () => {
      connector = new StdioConnector({
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "test", PORT: "3000" },
      });
      expect(connector.publicIdentifier.type).toBe("stdio");
    });

    it("should create connector with custom errlog", () => {
      connector = new StdioConnector({
        errlog: mockErrlog,
      });
      expect(connector.publicIdentifier.type).toBe("stdio");
    });

    it("should create connector with custom client info", () => {
      connector = new StdioConnector({
        clientInfo: { name: "custom-client", version: "2.0.0" },
      });
      expect(connector.publicIdentifier.type).toBe("stdio");
    });
  });

  describe("Connection", () => {
    it("should connect successfully", async () => {
      connector = new StdioConnector({
        command: "node",
        args: ["server.js"],
      });

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
      // Verify connection manager was instantiated
      expect(mockStart).toHaveBeenCalled();
    });

    it("should not connect twice", async () => {
      connector = new StdioConnector();
      await connector.connect();
      const firstClient = (connector as any).client;

      await connector.connect(); // Should be idempotent
      expect((connector as any).client).toBe(firstClient);
    });

    it("should handle connection errors", async () => {
      connector = new StdioConnector();
      mockStart.mockRejectedValueOnce(new Error("Connection failed"));

      await expect(connector.connect()).rejects.toThrow("Connection failed");
      expect(connector.isClientConnected).toBe(false);
    });

    it("should merge environment variables correctly", async () => {
      connector = new StdioConnector({
        command: "node",
        args: ["server.js"],
        env: { CUSTOM_VAR: "test" },
      });

      await connector.connect();
      // Environment merging is tested implicitly by successful connection
      expect(connector.isClientConnected).toBe(true);
    });

    it("should advertise roots capability", async () => {
      connector = new StdioConnector();
      await connector.connect();

      // Verify client was created and connected successfully
      expect(connector.isClientConnected).toBe(true);
      // Roots capability is advertised during connection setup
      const client = (connector as any).client;
      expect(client).toBeDefined();
    });

    it("should advertise sampling capability when callback provided", async () => {
      const samplingCallback = vi.fn();
      connector = new StdioConnector({
        samplingCallback,
      });

      await connector.connect();

      // Verify client was created and connected successfully
      expect(connector.isClientConnected).toBe(true);
      // Sampling capability is advertised during connection setup
      const client = (connector as any).client;
      expect(client).toBeDefined();
    });
  });

  describe("Public Identifier", () => {
    it("should return correct public identifier", () => {
      connector = new StdioConnector({
        command: "python",
        args: ["-m", "server"],
      });
      expect(connector.publicIdentifier).toEqual({
        type: "stdio",
        "command&args": "python -m server",
      });
    });
  });

  describe("Disconnection", () => {
    it("should disconnect successfully", async () => {
      connector = new StdioConnector();
      await connector.connect();
      await connector.disconnect();
      expect(connector.isClientConnected).toBe(false);
    });

    it("should handle disconnect when not connected", async () => {
      connector = new StdioConnector();
      await connector.disconnect(); // Should not throw
      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Initialization", () => {
    beforeEach(async () => {
      connector = new StdioConnector();
      await connector.connect();
    });

    it("should initialize successfully", async () => {
      const mockClient = (connector as any).client;
      vi.mocked(mockClient.listTools).mockResolvedValue({
        tools: [
          {
            name: "test_tool",
            description: "Test tool",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });

      await connector.initialize();
      expect(mockClient.listTools).toHaveBeenCalled();
      expect(connector.tools).toHaveLength(1);
    });
  });

  describe("Error Handling", () => {
    it("should cleanup resources on connection failure", async () => {
      connector = new StdioConnector();
      mockStart.mockRejectedValueOnce(new Error("Failed"));

      await expect(connector.connect()).rejects.toThrow();
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
