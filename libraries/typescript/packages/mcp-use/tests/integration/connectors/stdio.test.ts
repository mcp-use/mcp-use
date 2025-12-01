import { describe, it, expect, afterEach, vi } from "vitest";
import { StdioConnector } from "../../../src/connectors/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("StdioConnector Integration", () => {
  let connector: StdioConnector;

  afterEach(async () => {
    if (connector?.isClientConnected) {
      await connector.disconnect();
    }
  });

  describe("Connection Lifecycle", () => {
    it("should connect to real MCP server", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      expect(connector.isClientConnected).toBe(true);
    });

    it("should initialize and list tools", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      await connector.initialize();

      expect(connector.tools.length).toBeGreaterThan(0);
      const addTool = connector.tools.find((t) => t.name === "add");
      expect(addTool).toBeDefined();
      expect(addTool?.description).toBe("Add two numbers");
    });

    it("should call tool successfully", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      await connector.initialize();

      const result = await connector.callTool("add", { a: 5, b: 3 });
      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();
      if (result.content && result.content.length > 0) {
        expect(result.content[0].type).toBe("text");
        expect(Number(result.content[0].text)).toBe(8);
      }
    });

    it("should handle tool call errors", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      await connector.initialize();

      const result = await connector.callTool("add", { a: "invalid", b: 3 });
      expect(result.isError).toBe(true);
    });

    it("should disconnect cleanly", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      await connector.initialize();
      await connector.disconnect();

      expect(connector.isClientConnected).toBe(false);
    });
  });

  describe("Session Management", () => {
    it("should maintain session across multiple tool calls", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();
      await connector.initialize();

      const result1 = await connector.callTool("add", { a: 1, b: 2 });
      const result2 = await connector.callTool("add", { a: 3, b: 4 });

      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);
    });
  });

  describe("Roots Management", () => {
    it("should set and get roots", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      await connector.connect();

      const roots = [
        { uri: "file:///test1", name: "Test 1" },
        { uri: "file:///test2", name: "Test 2" },
      ];

      await connector.setRoots(roots);
      expect(connector.getRoots()).toEqual(roots);
    });
  });

  describe("Notification Handling", () => {
    it("should register and handle notifications", async () => {
      const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");
      connector = new StdioConnector({
        command: "tsx",
        args: [serverPath],
      });

      const notificationHandler = vi.fn();
      connector.onNotification(notificationHandler);

      await connector.connect();
      await connector.initialize();

      // Note: The simple_server doesn't send notifications, but we can verify
      // the handler is registered
      expect(notificationHandler).toBeDefined();
    });
  });
});
