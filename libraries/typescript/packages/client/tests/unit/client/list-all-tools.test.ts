import { describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "@modelcontextprotocol/client";
import { BaseConnector } from "../../../src/transport/base.js";
import { MCPConnection } from "../../../src/core/session.js";
import { CodeModeConnector } from "../../../src/code-mode/connector.js";
import type { MCPClient } from "../../../src/core/node.js";

class TestConnector extends BaseConnector {
  async connect(): Promise<void> {
    this.connected = true;
  }

  get publicIdentifier(): Record<string, string> {
    return { type: "test" };
  }
}

describe("tools/list pagination and listAllTools", () => {
  describe("BaseConnector.listAllTools", () => {
    it("paginates over multiple pages and returns all tools", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      const listToolsMock = vi
        .fn()
        .mockResolvedValueOnce({
          tools: [{ name: "tool-1" }, { name: "tool-2" }],
          nextCursor: "cursor-2",
        })
        .mockResolvedValueOnce({
          tools: [{ name: "tool-3" }],
          nextCursor: "cursor-3",
        })
        .mockResolvedValueOnce({
          tools: [{ name: "tool-4" }],
          nextCursor: undefined,
        });

      connector.client = { listTools: listToolsMock };

      const result = await connector.listAllTools();

      expect(result).toEqual({
        tools: [
          { name: "tool-1" },
          { name: "tool-2" },
          { name: "tool-3" },
          { name: "tool-4" },
        ],
      });
      expect(listToolsMock).toHaveBeenCalledTimes(3);
      // Clean initial parameter check
      expect(listToolsMock).toHaveBeenNthCalledWith(1, undefined, undefined);
      expect(listToolsMock).toHaveBeenNthCalledWith(
        2,
        { cursor: "cursor-2" },
        undefined
      );
      expect(listToolsMock).toHaveBeenNthCalledWith(
        3,
        { cursor: "cursor-3" },
        undefined
      );
    });

    it("passes request options on each page request", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      const listToolsMock = vi
        .fn()
        .mockResolvedValueOnce({
          tools: [{ name: "t1" }],
          nextCursor: "p2",
        })
        .mockResolvedValueOnce({
          tools: [{ name: "t2" }],
          nextCursor: undefined,
        });

      connector.client = { listTools: listToolsMock };
      const options: RequestOptions = { timeout: 5000 };

      const result = await connector.listAllTools(options);

      expect(result.tools).toHaveLength(2);
      expect(listToolsMock).toHaveBeenNthCalledWith(1, undefined, options);
      expect(listToolsMock).toHaveBeenNthCalledWith(
        2,
        { cursor: "p2" },
        options
      );
    });

    it("detects repeated cursor and throws error to prevent infinite loop", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      connector.client = {
        listTools: vi
          .fn()
          .mockResolvedValueOnce({
            tools: [{ name: "tool-1" }],
            nextCursor: "loop-cursor",
          })
          .mockResolvedValueOnce({
            tools: [{ name: "tool-2" }],
            nextCursor: "loop-cursor",
          }),
      };

      await expect(connector.listAllTools()).rejects.toThrow(
        "tools/list returned a repeated pagination cursor"
      );
    });

    it("handles falsy empty-string cursor without premature loop exit", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      const listToolsMock = vi
        .fn()
        .mockResolvedValueOnce({
          tools: [{ name: "t1" }],
          nextCursor: "",
        })
        .mockResolvedValueOnce({
          tools: [{ name: "t2" }],
          nextCursor: undefined,
        });

      connector.client = { listTools: listToolsMock };

      const result = await connector.listAllTools();

      expect(result.tools).toHaveLength(2);
      expect(listToolsMock).toHaveBeenCalledTimes(2);
      expect(listToolsMock).toHaveBeenNthCalledWith(1, undefined, undefined);
      expect(listToolsMock).toHaveBeenNthCalledWith(
        2,
        { cursor: "" },
        undefined
      );
    });

    it("respects abort signal and aborts pagination loop", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      const controller = new AbortController();
      controller.abort();

      connector.client = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: "t1" }],
          nextCursor: "p2",
        }),
      };

      await expect(
        connector.listAllTools({ signal: controller.signal })
      ).rejects.toThrow();
    });

    it("surfaces transport error when a disconnect lands between pages", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      let page = 0;
      let connected = true;
      connector.client = {
        async listTools() {
          if (!connected) throw new Error("Not connected");
          page += 1;
          connected = false;
          connector.client = null;
          return { tools: [{ name: `tool-${page}` }], nextCursor: "next" };
        },
      };

      await expect(connector.listAllTools()).rejects.toThrow("Not connected");
    });

    it("throws when client is not connected", async () => {
      const connector = new TestConnector();
      await expect(connector.listAllTools()).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("handles -32601 (method not found) gracefully by returning empty tools", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      const methodNotFoundError = new Error("Method not found") as Error & {
        code: number;
      };
      methodNotFoundError.code = -32601;
      connector.client = {
        listTools: vi.fn().mockRejectedValue(methodNotFoundError),
      };

      const result = await connector.listAllTools();
      expect(result).toEqual({ tools: [] });
    });
  });

  describe("BaseConnector.listTools backwards compatibility", () => {
    it("returns flat Tool[] array with all tools across all pages", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      connector.client = {
        listTools: vi
          .fn()
          .mockResolvedValueOnce({
            tools: [{ name: "tool-page1" }],
            nextCursor: "next",
          })
          .mockResolvedValueOnce({
            tools: [{ name: "tool-page2" }],
            nextCursor: undefined,
          }),
      };

      const tools = await connector.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.map((t) => t.name)).toEqual(["tool-page1", "tool-page2"]);
    });

    it("throws when listTools() is called on disconnected connector", async () => {
      const connector = new TestConnector();
      await expect(connector.listTools()).rejects.toThrow(
        "MCP client is not connected"
      );
    });
  });

  describe("BaseConnector.initialize and refreshToolsCache", () => {
    it("populates toolsCache across all pages during initialize", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
      };

      connector.client = {
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        getServerVersion: vi.fn().mockReturnValue({
          name: "test-server",
          version: "1.0.0",
        }),
        listTools: vi
          .fn()
          .mockResolvedValueOnce({
            tools: [{ name: "init-tool-1" }],
            nextCursor: "p2",
          })
          .mockResolvedValueOnce({
            tools: [{ name: "init-tool-2" }],
            nextCursor: undefined,
          }),
      };

      await connector.initialize();
      expect(connector.tools.map((t) => t.name)).toEqual([
        "init-tool-1",
        "init-tool-2",
      ]);
    });

    it("refreshes toolsCache across all pages during refreshToolsCache", async () => {
      const connector = new TestConnector() as BaseConnector & {
        client: unknown;
        refreshToolsCache: () => Promise<void>;
      };

      connector.client = {
        listTools: vi
          .fn()
          .mockResolvedValueOnce({
            tools: [{ name: "refreshed-1" }],
            nextCursor: "p2",
          })
          .mockResolvedValueOnce({
            tools: [{ name: "refreshed-2" }],
            nextCursor: undefined,
          }),
      };

      await connector.refreshToolsCache();
      expect(connector.tools.map((t) => t.name)).toEqual([
        "refreshed-1",
        "refreshed-2",
      ]);
    });
  });

  describe("MCPConnection delegation", () => {
    it("delegates listAllTools to connector", async () => {
      const connector = {
        listAllTools: vi.fn().mockResolvedValue({
          tools: [{ name: "tool-from-session" }],
        }),
      };
      const session = new MCPConnection(connector as never);
      const options = { timeout: 1000 };

      const result = await session.listAllTools(options);
      expect(result).toEqual({ tools: [{ name: "tool-from-session" }] });
      expect(connector.listAllTools).toHaveBeenCalledWith(options);
    });

    it("delegates listTools to connector", async () => {
      const connector = {
        listTools: vi.fn().mockResolvedValue([{ name: "tool-from-session" }]),
      };
      const session = new MCPConnection(connector as never);
      const options = { timeout: 1000 };

      const tools = await session.listTools(options);
      expect(tools).toEqual([{ name: "tool-from-session" }]);
      expect(connector.listTools).toHaveBeenCalledWith(options);
    });
  });

  describe("CodeModeConnector.listAllTools", () => {
    function createMockMcpClient() {
      return {} as MCPClient;
    }

    it("returns synthetic code mode tools", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const result = await connector.listAllTools();

      expect(result.tools.map((t) => t.name)).toEqual([
        "execute_code",
        "search_tools",
      ]);
      // Should be defensive clone
      expect(result.tools).not.toBe(connector.tools);
    });

    it("throws when disconnected", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      await connector.disconnect();

      await expect(connector.listAllTools()).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("respects abort signal", async () => {
      const connector = new CodeModeConnector(createMockMcpClient());
      const controller = new AbortController();
      controller.abort();

      await expect(
        connector.listAllTools({ signal: controller.signal })
      ).rejects.toThrow();
    });
  });
});
