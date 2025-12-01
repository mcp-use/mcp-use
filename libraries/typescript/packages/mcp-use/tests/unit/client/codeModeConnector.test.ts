import { describe, it, expect, beforeEach } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { CodeModeConnector } from "../../../src/client/connectors/codeMode.js";

describe("CodeModeConnector", () => {
  let client: MCPClient;
  let connector: CodeModeConnector;

  beforeEach(() => {
    client = new MCPClient({}, { codeMode: true });
    connector = new CodeModeConnector(client);
  });

  describe("constructor", () => {
    it("creates connector with client reference", () => {
      expect(connector).toBeInstanceOf(CodeModeConnector);
      expect(connector.connected).toBe(true);
    });

    it("is immediately connected (no connection phase needed)", () => {
      expect(connector.connected).toBe(true);
    });

    it("has correct public identifier", () => {
      const identifier = connector.publicIdentifier;
      expect(identifier.name).toBe("code_mode");
      expect(identifier.version).toBe("1.0.0");
    });
  });

  describe("tools", () => {
    it("exposes execute_code tool", () => {
      const tools = connector.tools;
      const executeCodeTool = tools.find((t) => t.name === "execute_code");
      expect(executeCodeTool).toBeDefined();
      expect(executeCodeTool?.description).toContain(
        "Execute JavaScript/TypeScript code"
      );
      expect(executeCodeTool?.inputSchema).toBeDefined();
    });

    it("exposes search_tools tool", () => {
      const tools = connector.tools;
      const searchToolsTool = tools.find((t) => t.name === "search_tools");
      expect(searchToolsTool).toBeDefined();
      expect(searchToolsTool?.description).toContain(
        "Search and discover available MCP tools"
      );
      expect(searchToolsTool?.inputSchema).toBeDefined();
    });

    it("has correct input schema for execute_code", () => {
      const tools = connector.tools;
      const executeCodeTool = tools.find((t) => t.name === "execute_code");
      const schema = executeCodeTool?.inputSchema;

      expect(schema?.type).toBe("object");
      expect(schema?.properties?.code).toBeDefined();
      expect(schema?.properties?.code?.type).toBe("string");
      expect(schema?.properties?.timeout).toBeDefined();
      expect(schema?.properties?.timeout?.type).toBe("number");
      expect(schema?.required).toContain("code");
    });

    it("has correct input schema for search_tools", () => {
      const tools = connector.tools;
      const searchToolsTool = tools.find((t) => t.name === "search_tools");
      const schema = searchToolsTool?.inputSchema;

      expect(schema?.type).toBe("object");
      expect(schema?.properties?.query).toBeDefined();
      expect(schema?.properties?.query?.type).toBe("string");
      expect(schema?.properties?.detail_level).toBeDefined();
      expect(schema?.properties?.detail_level?.enum).toEqual([
        "names",
        "descriptions",
        "full",
      ]);
    });
  });

  describe("connect()", () => {
    it("sets connected to true", async () => {
      connector.connected = false;
      await connector.connect();
      expect(connector.connected).toBe(true);
    });
  });

  describe("disconnect()", () => {
    it("sets connected to false", async () => {
      await connector.disconnect();
      expect(connector.connected).toBe(false);
    });
  });

  describe("initialize()", () => {
    it("initializes successfully", async () => {
      const result = await connector.initialize();
      expect(result).toBeDefined();
      expect(result.capabilities).toBeDefined();
      expect(result.version).toBe("1.0.0");
    });

    it("caches tools after initialization", async () => {
      await connector.initialize();
      expect(connector.toolsCache).toBeDefined();
      expect(connector.toolsCache?.length).toBeGreaterThan(0);
    });
  });

  describe("callTool()", () => {
    it("calls execute_code tool successfully", async () => {
      const result = await connector.callTool("execute_code", {
        code: "return 42;",
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result).toBe(42);
      expect(parsed.error).toBeNull();
    });

    it("calls execute_code with timeout", async () => {
      const result = await connector.callTool("execute_code", {
        code: "return 'test';",
        timeout: 5000,
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result).toBe("test");
    });

    it("calls search_tools tool successfully", async () => {
      const result = await connector.callTool("search_tools", {
        query: "",
        detail_level: "names",
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("results");
      expect(parsed).toHaveProperty("meta");
      expect(Array.isArray(parsed.results)).toBe(true);
    });

    it("calls search_tools with query filter", async () => {
      const result = await connector.callTool("search_tools", {
        query: "test",
        detail_level: "full",
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("results");
      expect(parsed).toHaveProperty("meta");
    });

    it("throws error for unknown tool", async () => {
      await expect(connector.callTool("unknown_tool", {})).rejects.toThrow(
        "Unknown tool: unknown_tool"
      );
    });

    it("handles execute_code errors gracefully", async () => {
      const result = await connector.callTool("execute_code", {
        code: "throw new Error('Test error');",
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeTruthy();
      expect(parsed.error).toContain("Test error");
    });
  });
});
