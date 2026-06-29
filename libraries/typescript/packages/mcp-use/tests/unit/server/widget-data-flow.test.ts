import { describe, it, expect, beforeEach } from "vitest";
import { MCPServer } from "../../../src/server/mcp-server.js";
import {
  view,
  text,
  object,
} from "../../../src/server/utils/response-helpers.js";
import { z } from "zod";

type ToolCallResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

type RegisteredTool =
  MCPServer["registrations"]["tools"] extends Map<string, infer T> ? T : never;
type ToolContextArg = Parameters<RegisteredTool["handler"]>[1];

async function callRegisteredTool(
  server: MCPServer,
  name: string,
  params: Record<string, unknown>
): Promise<ToolCallResult> {
  const toolHandler = server.registrations.tools.get(name);
  expect(toolHandler).toBeDefined();
  return (await toolHandler!.handler(
    params,
    {} as ToolContextArg
  )) as ToolCallResult;
}

function firstText(result: ToolCallResult): string | undefined {
  return result.content[0]?.text;
}

function outputTemplateFor(server: MCPServer, toolName: string): unknown {
  return server.registrations.tools.get(toolName)?.config._meta?.[
    "openai/outputTemplate"
  ];
}

describe("Widget Data Flow", () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });
  });

  describe("Auto-registered widget", () => {
    it("should use toolInput as props for auto-registered widget", async () => {
      // Create a simple widget that would be auto-registered
      const mockWidgetDef = {
        name: "test-widget",
        description: "Test widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Test</div>",
        appsSdkMetadata: {},
      };

      // Register widget definition
      server.widgetDefinitions.set("test-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool that returns widget
      server.tool(
        {
          name: "get-weather",
          description: "Get weather for a city",
          schema: z.object({
            city: z.string(),
            temp: z.number(),
          }),
          widget: {
            name: "test-widget",
            invoking: "Loading weather...",
            invoked: "Weather loaded",
          },
        },
        async ({ city, temp }) => {
          return {
            content: [{ type: "text", text: `Weather in ${city}: ${temp}°C` }],
          };
        }
      );

      await callRegisteredTool(server, "get-weather", {
        city: "London",
        temp: 15,
      });

      // Per SEP-1865: outputTemplate is on tool definition, not on result
      const outputTemplate = outputTemplateFor(server, "get-weather");
      expect(outputTemplate).toBeDefined();
      expect(outputTemplate).toEqual(
        expect.stringMatching(/ui:\/\/widget\/test-widget/)
      );
    });
  });

  describe("Helper widget with text output", () => {
    it("should separate widget data from output", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "table-widget",
        description: "Display table",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Table</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("table-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool that uses widget() helper
      server.tool(
        {
          name: "get-table-data",
          description: "Get table data",
          schema: z.object({
            tableName: z.string(),
          }),
          widget: {
            name: "table-widget",
            invoking: "Loading table...",
            invoked: "Table loaded",
          },
        },
        async ({ tableName }) => {
          // Simulate fetching 100 rows
          const rows = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            name: `User ${i + 1}`,
          }));

          return view({
            props: {
              rows,
              tableName,
            },
            output: text(
              `Retrieved ${rows.length} rows from ${tableName} table`
            ),
          });
        }
      );

      const result = await callRegisteredTool(server, "get-table-data", {
        tableName: "users",
      });

      // Verify response structure
      expect(firstText(result)).toBe("Retrieved 100 rows from users table");
      // Per SEP-1865: widget props go in structuredContent, outputTemplate on tool definition
      const structuredContent = result.structuredContent as
        | { rows: unknown[]; tableName: string }
        | undefined;
      expect(structuredContent).toBeDefined();
      expect(structuredContent?.rows).toHaveLength(100);
      expect(structuredContent?.tableName).toBe("users");

      const outputTemplate = outputTemplateFor(server, "get-table-data");
      expect(outputTemplate).toEqual(
        expect.stringMatching(/ui:\/\/widget\/table-widget/)
      );
    });
  });

  describe("Helper widget with message", () => {
    it("should support message parameter", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "items-widget",
        description: "Display items",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Items</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("items-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool that uses widget() helper with message
      server.tool(
        {
          name: "get-items",
          description: "Get items",
          schema: z.object({
            category: z.string(),
          }),
          widget: {
            name: "items-widget",
            invoking: "Loading items...",
            invoked: "Items loaded",
          },
        },
        async ({ category }) => {
          const items = [1, 2, 3];
          const total = 100;

          return view({
            props: { items, total, category },
            message: `Found ${total} items in ${category}`,
          });
        }
      );

      const result = await callRegisteredTool(server, "get-items", {
        category: "electronics",
      });

      // Verify response structure
      expect(firstText(result)).toBe("Found 100 items in electronics");
      // Per SEP-1865: widget props go in structuredContent
      expect(result.structuredContent).toEqual({
        items: [1, 2, 3],
        total: 100,
        category: "electronics",
      });
    });
  });

  describe("Helper widget with object output", () => {
    it("should support object() helper as output", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "search-widget",
        description: "Display search results",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Search</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("search-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool that uses widget() helper with object output
      server.tool(
        {
          name: "search",
          description: "Search for items",
          schema: z.object({
            query: z.string(),
          }),
          widget: {
            name: "search-widget",
            invoking: "Searching...",
            invoked: "Search complete",
          },
        },
        async ({ query }) => {
          return view({
            props: {
              results: ["result1", "result2"],
              metadata: { page: 1, total: 50 },
            },
            output: object({
              summary: `Search for "${query}" returned 50 results`,
              count: 50,
            }),
          });
        }
      );

      const result = await callRegisteredTool(server, "search", {
        query: "test query",
      });

      // Verify response structure - object should be stringified in content
      const parsedOutput = JSON.parse(firstText(result) || "{}") as {
        summary?: string;
        count?: number;
      };
      expect(parsedOutput.summary).toBe(
        'Search for "test query" returned 50 results'
      );
      expect(parsedOutput.count).toBe(50);

      // When output has structuredContent, it takes precedence over props
      expect(result.structuredContent).toEqual({
        summary: 'Search for "test query" returned 50 results',
        count: 50,
      });
    });
  });

  describe("Backward compatibility with message", () => {
    it("should still support deprecated message parameter", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "legacy-widget",
        description: "Legacy widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Legacy</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("legacy-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool using message parameter
      server.tool(
        {
          name: "legacy-tool",
          description: "Legacy tool",
          schema: z.object({
            id: z.string(),
          }),
          widget: {
            name: "legacy-widget",
          },
        },
        async ({ id }) => {
          return view({
            props: { id, value: "test" },
            message: "Legacy message format", // Deprecated but should still work
          });
        }
      );

      const result = await callRegisteredTool(server, "legacy-tool", {
        id: "123",
      });

      // Verify response structure
      expect(firstText(result)).toBe("Legacy message format");
      // Per SEP-1865: widget props go in structuredContent
      expect(result.structuredContent).toEqual({
        id: "123",
        value: "test",
      });
    });

    it("should prefer output over message when both are provided", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "priority-widget",
        description: "Priority widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Priority</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("priority-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool with both message and output
      server.tool(
        {
          name: "priority-tool",
          description: "Priority tool",
          schema: z.object({
            value: z.number(),
          }),
          widget: {
            name: "priority-widget",
          },
        },
        async ({ value }) => {
          return view({
            props: { value },
            message: "This should be used (message takes precedence)",
            output: text("This should be ignored"),
          });
        }
      );

      const result = await callRegisteredTool(server, "priority-tool", {
        value: 42,
      });

      // Verify message takes precedence over output.content
      expect(firstText(result)).toBe(
        "This should be used (message takes precedence)"
      );
    });
  });

  describe("Helper functions as output", () => {
    it("should support text() helper as output", async () => {
      const mockWidgetDef = {
        name: "text-helper-widget",
        description: "Text helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Text</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("text-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "text-tool",
          description: "Text tool",
          schema: z.object({ count: z.number() }),
          widget: { name: "text-helper-widget" },
        },
        async ({ count }) => {
          return view({
            props: { items: Array(count).fill(0), count },
            output: text(`Found ${count} items`),
          });
        }
      );

      const result = await callRegisteredTool(server, "text-tool", {
        count: 5,
      });

      expect(firstText(result)).toBe("Found 5 items");
      expect(result.structuredContent?.count).toBe(5);
    });

    it("should support object() helper as output", async () => {
      const mockWidgetDef = {
        name: "object-helper-widget",
        description: "Object helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Object</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("object-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "object-tool",
          description: "Object tool",
          schema: z.object({ id: z.string() }),
          widget: { name: "object-helper-widget" },
        },
        async ({ id }) => {
          return view({
            props: { fullData: { id, value: "data" } },
            output: object({ summary: `ID: ${id}`, status: "success" }),
          });
        }
      );

      const result = await callRegisteredTool(server, "object-tool", {
        id: "abc123",
      });

      const parsedOutput = JSON.parse(firstText(result) || "{}") as {
        summary?: string;
        status?: string;
      };
      expect(parsedOutput.summary).toBe("ID: abc123");
      expect(parsedOutput.status).toBe("success");
      // When output has structuredContent, it takes precedence over props
      expect(result.structuredContent).toEqual({
        summary: "ID: abc123",
        status: "success",
      });
    });

    it("should support function generating output dynamically", async () => {
      const mockWidgetDef = {
        name: "function-helper-widget",
        description: "Function helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Function</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("function-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "function-tool",
          description: "Function tool",
          schema: z.object({ type: z.string() }),
          widget: { name: "function-helper-widget" },
        },
        async ({ type }) => {
          const data = { records: [1, 2, 3], type };
          // Generate output based on data
          return view({
            props: data,
            output: text(`${data.type}: ${data.records.length} records`),
          });
        }
      );

      const result = await callRegisteredTool(server, "function-tool", {
        type: "users",
      });

      expect(firstText(result)).toBe("users: 3 records");
      expect(result.structuredContent?.type).toBe("users");
    });
  });
});
