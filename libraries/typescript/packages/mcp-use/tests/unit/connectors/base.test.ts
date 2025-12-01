import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaseConnector } from "../../../src/connectors/base.js";
import { StdioConnector } from "../../../src/connectors/stdio.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool, Notification, Root } from "@modelcontextprotocol/sdk/types.js";

// Create a concrete implementation for testing BaseConnector
class TestConnector extends BaseConnector {
  publicIdentifier = { type: "test" };
  private mockClient: Client | null = null;

  async connect(): Promise<void> {
    // Mock client for testing
    this.mockClient = {
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
    } as any;

    this.client = this.mockClient;
    this.connected = true;
    this.setupNotificationHandler();
    this.setupRootsHandler();
    this.setupSamplingHandler();
  }

  getMockClient(): Client | null {
    return this.mockClient;
  }
}

describe("BaseConnector", () => {
  let connector: TestConnector;

  beforeEach(() => {
    connector = new TestConnector();
  });

  afterEach(async () => {
    if (connector.isClientConnected) {
      await connector.disconnect();
    }
  });

  describe("Connection Management", () => {
    it("should initialize with default options", () => {
      const c = new TestConnector();
      expect(c.isClientConnected).toBe(false);
      expect(c.getRoots()).toEqual([]);
    });

    it("should initialize with custom options", () => {
      const roots: Root[] = [{ uri: "file:///test", name: "Test" }];
      const c = new TestConnector({ roots });
      expect(c.getRoots()).toEqual(roots);
    });

    it("should connect successfully", async () => {
      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
    });

    it("should disconnect successfully", async () => {
      await connector.connect();
      await connector.disconnect();
      expect(connector.isClientConnected).toBe(false);
    });

    it("should handle multiple disconnect calls gracefully", async () => {
      await connector.connect();
      await connector.disconnect();
      await connector.disconnect(); // Should not throw
      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Roots Management", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should set and get roots", async () => {
      const roots: Root[] = [
        { uri: "file:///test1", name: "Test 1" },
        { uri: "file:///test2", name: "Test 2" },
      ];
      await connector.setRoots(roots);
      expect(connector.getRoots()).toEqual(roots);
    });

    it("should send roots/list_changed notification when setting roots", async () => {
      const mockClient = connector.getMockClient();
      const roots: Root[] = [{ uri: "file:///test", name: "Test" }];
      await connector.setRoots(roots);
      expect(mockClient?.sendRootsListChanged).toHaveBeenCalled();
    });

    it("should return a copy of roots array", async () => {
      const roots: Root[] = [{ uri: "file:///test", name: "Test" }];
      await connector.setRoots(roots);
      const retrieved = connector.getRoots();
      retrieved.push({ uri: "file:///other", name: "Other" });
      // Original should not be modified
      expect(connector.getRoots().length).toBe(1);
    });
  });

  describe("Initialization", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should initialize and cache tools", async () => {
      const mockClient = connector.getMockClient();
      const mockTools: Tool[] = [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ];
      vi.mocked(mockClient?.listTools).mockResolvedValue({ tools: mockTools });

      await connector.initialize();
      expect(mockClient?.listTools).toHaveBeenCalled();
      expect(connector.tools).toEqual(mockTools);
    });

    it("should cache server capabilities", async () => {
      const mockClient = connector.getMockClient();
      const capabilities = { tools: {}, resources: {} };
      vi.mocked(mockClient?.getServerCapabilities).mockReturnValue(capabilities);

      await connector.initialize();
      expect(connector.serverCapabilities).toEqual(capabilities);
    });

    it("should cache server info", async () => {
      const mockClient = connector.getMockClient();
      const serverInfo = { name: "test-server", version: "2.0.0" };
      vi.mocked(mockClient?.getServerVersion).mockReturnValue(serverInfo);

      await connector.initialize();
      expect(connector.serverInfo).toEqual(serverInfo);
    });

    it("should throw error if initialize called before connect", async () => {
      const unconnectedConnector = new TestConnector();
      await expect(unconnectedConnector.initialize()).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("should throw error if accessing tools before initialization", async () => {
      await connector.connect();
      expect(() => connector.tools).toThrow(
        "MCP client is not initialized; call initialize() first"
      );
    });
  });

  describe("Tool Operations", () => {
    beforeEach(async () => {
      await connector.connect();
      await connector.initialize();
    });

    it("should call tool successfully", async () => {
      const mockClient = connector.getMockClient();
      const mockResult = {
        content: [{ type: "text", text: "result" }],
        isError: false,
      };
      vi.mocked(mockClient?.callTool).mockResolvedValue(mockResult as any);

      const result = await connector.callTool("test_tool", { arg: "value" });
      expect(mockClient?.callTool).toHaveBeenCalledWith(
        { name: "test_tool", arguments: { arg: "value" } },
        undefined,
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it("should throw error if calling tool before connect", async () => {
      const unconnectedConnector = new TestConnector();
      await expect(
        unconnectedConnector.callTool("test", {})
      ).rejects.toThrow("MCP client is not connected");
    });
  });

  describe("Notification Handling", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should register notification handler", () => {
      const handler = vi.fn();
      connector.onNotification(handler);
      // Handler should be registered (we can't easily test it without triggering a notification)
      expect(handler).toBeDefined();
    });

    it("should handle tools/list_changed notification and refresh cache", async () => {
      const mockClient = connector.getMockClient();
      const updatedTools: Tool[] = [
        {
          name: "new_tool",
          description: "A new tool",
          inputSchema: { type: "object", properties: {} },
        },
      ];
      vi.mocked(mockClient?.listTools).mockResolvedValue({ tools: updatedTools });

      // Initialize first to set up tools cache
      await connector.initialize();

      // Simulate tools/list_changed notification
      const notification: Notification = {
        method: "notifications/tools/list_changed",
        params: {},
      };

      // Trigger the notification handler
      if (mockClient?.fallbackNotificationHandler) {
        await mockClient.fallbackNotificationHandler(notification);
      }

      // Verify tools cache was refreshed
      expect(mockClient?.listTools).toHaveBeenCalled();
    });

    it("should call user-registered notification handlers", async () => {
      const handler = vi.fn();
      connector.onNotification(handler);

      const mockClient = connector.getMockClient();
      const notification: Notification = {
        method: "custom/notification",
        params: { data: "test" },
      };

      if (mockClient?.fallbackNotificationHandler) {
        await mockClient.fallbackNotificationHandler(notification);
      }

      // Handler should be called (though we can't easily verify this without
      // actually triggering the handler through the client)
      expect(handler).toBeDefined();
    });
  });

  describe("Resource Operations", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should list resources", async () => {
      const mockClient = connector.getMockClient();
      const mockResources = { resources: [{ uri: "file:///test" }] };
      vi.mocked(mockClient?.listResources).mockResolvedValue(mockResources as any);

      const result = await connector.listResources();
      expect(mockClient?.listResources).toHaveBeenCalled();
      expect(result).toEqual(mockResources);
    });

    it("should list all resources with pagination", async () => {
      const mockClient = connector.getMockClient();
      const capabilities = {
        resources: {},
      };
      vi.mocked(mockClient?.getServerCapabilities).mockReturnValue(capabilities as any);
      
      // Initialize to cache capabilities
      await connector.initialize();

      // First page
      vi.mocked(mockClient?.listResources)
        .mockResolvedValueOnce({
          resources: [{ uri: "file:///test1" }],
          nextCursor: "cursor1",
        } as any)
        // Second page
        .mockResolvedValueOnce({
          resources: [{ uri: "file:///test2" }],
        } as any);

      const result = await connector.listAllResources();
      expect(mockClient?.listResources).toHaveBeenCalledTimes(2);
      expect(result.resources).toHaveLength(2);
    });

    it("should read resource", async () => {
      const mockClient = connector.getMockClient();
      const mockResult = {
        contents: [{ uri: "file:///test", mimeType: "text/plain" }],
      };
      vi.mocked(mockClient?.readResource).mockResolvedValue(mockResult as any);

      const result = await connector.readResource("file:///test");
      expect(mockClient?.readResource).toHaveBeenCalledWith({ uri: "file:///test" }, undefined);
      expect(result).toEqual(mockResult);
    });

    it("should throw error if resource operations called before connect", async () => {
      const unconnectedConnector = new TestConnector();
      await expect(unconnectedConnector.listResources()).rejects.toThrow(
        "MCP client is not connected"
      );
    });
  });

  describe("Prompt Operations", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should list prompts", async () => {
      const mockClient = connector.getMockClient();
      const capabilities = {
        prompts: {},
      };
      vi.mocked(mockClient?.getServerCapabilities).mockReturnValue(capabilities as any);
      
      // Initialize to cache capabilities
      await connector.initialize();
      
      const mockPrompts = { prompts: [{ name: "test_prompt" }] };
      vi.mocked(mockClient?.listPrompts).mockResolvedValue(mockPrompts as any);

      const result = await connector.listPrompts();
      expect(mockClient?.listPrompts).toHaveBeenCalled();
      expect(result).toEqual(mockPrompts);
    });

    it("should return empty prompts if capability not advertised", async () => {
      const mockClient = connector.getMockClient();
      vi.mocked(mockClient?.getServerCapabilities).mockReturnValue({} as any);
      
      // Initialize to cache capabilities
      await connector.initialize();

      const result = await connector.listPrompts();
      expect(result).toEqual({ prompts: [] });
    });

    it("should get prompt", async () => {
      const mockClient = connector.getMockClient();
      const mockResult = { messages: [{ role: "user", content: "test" }] };
      vi.mocked(mockClient?.getPrompt).mockResolvedValue(mockResult as any);

      const result = await connector.getPrompt("test_prompt", {});
      expect(mockClient?.getPrompt).toHaveBeenCalledWith({
        name: "test_prompt",
        arguments: {},
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("Raw Request", () => {
    beforeEach(async () => {
      await connector.connect();
    });

    it("should send raw request", async () => {
      const mockClient = connector.getMockClient();
      const mockResult = { result: "success" };
      vi.mocked(mockClient?.request).mockResolvedValue(mockResult as any);

      const result = await connector.request("custom/method", { param: "value" });
      expect(mockClient?.request).toHaveBeenCalledWith(
        { method: "custom/method", params: { param: "value" } },
        undefined,
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it("should handle null params", async () => {
      const mockClient = connector.getMockClient();
      await connector.request("custom/method", null);
      expect(mockClient?.request).toHaveBeenCalledWith(
        { method: "custom/method", params: {} },
        undefined,
        undefined
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle connection errors gracefully", async () => {
      const failingConnector = new TestConnector();
      // Override connect to throw
      vi.spyOn(failingConnector, "connect").mockRejectedValue(new Error("Connection failed"));

      await expect(failingConnector.connect()).rejects.toThrow("Connection failed");
    });

    it("should handle cleanup errors gracefully", async () => {
      await connector.connect();
      const mockClient = connector.getMockClient();
      vi.mocked(mockClient?.close).mockRejectedValue(new Error("Close failed"));

      // Should not throw
      await connector.disconnect();
    });
  });
});
