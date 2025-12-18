import { describe, it, expect, beforeEach } from "vitest";
import { MCPServer } from "../../../src/server/mcp-server.js";
import {
  widget,
  text,
  object,
} from "../../../src/server/utils/response-helpers.js";
import { z } from "zod";

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

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-weather");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler(
        { city: "London", temp: 15 },
        {} as any
      );

      // Verify it added widget metadata
      expect((result as any)._meta).toBeDefined();
      expect((result as any)._meta["openai/outputTemplate"]).toMatch(
        /ui:\/\/widget\/test-widget/
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

          return widget({
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

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-table-data");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler(
        { tableName: "users" },
        {} as any
      );

      // Verify response structure
      expect((result.content as any)[0]?.text).toBe(
        "Retrieved 100 rows from users table"
      );
      // Widget data is available in _meta["mcp-use/props"]
      expect((result as any)._meta).toBeDefined();
      expect((result as any)._meta["mcp-use/props"]).toBeDefined();
      expect((result as any)._meta["mcp-use/props"].rows).toHaveLength(100);
      expect((result as any)._meta["mcp-use/props"].tableName).toBe("users");
      expect((result as any)._meta["openai/outputTemplate"]).toMatch(
        /ui:\/\/widget\/table-widget/
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

          return widget({
            props: { items, total, category },
            message: `Found ${total} items in ${category}`,
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-items");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler(
        { category: "electronics" },
        {} as any
      );

      // Verify response structure
      expect((result.content as any)[0]?.text).toBe(
        "Found 100 items in electronics"
      );
      expect((result as any)._meta["mcp-use/props"]).toEqual({
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
          return widget({
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

      // Call the tool
      const toolHandler = server.registrations.tools.get("search");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler(
        { query: "test query" },
        {} as any
      );

      // Verify response structure - object should be stringified in content
      const parsedOutput = JSON.parse((result.content as any)[0]?.text);
      expect(parsedOutput.summary).toBe(
        'Search for "test query" returned 50 results'
      );
      expect(parsedOutput.count).toBe(50);

      // Verify widget props in metadata
      expect((result as any)._meta["mcp-use/props"].results).toEqual([
        "result1",
        "result2",
      ]);
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
          return widget({
            props: { id, value: "test" },
            message: "Legacy message format", // Deprecated but should still work
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("legacy-tool");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ id: "123" }, {} as any);

      // Verify response structure
      expect((result.content as any)[0]?.text).toBe("Legacy message format");
      // structuredContent should contain the data when no output is provided
      expect((result as any).structuredContent).toEqual({
        id: "123",
        value: "test",
      });

      // Verify widget props in metadata
      expect((result as any)._meta["mcp-use/props"]).toEqual({
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
          return widget({
            props: { value },
            message: "This should be used (message takes precedence)",
            output: text("This should be ignored"),
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("priority-tool");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ value: 42 }, {} as any);

      // Verify message takes precedence over output.content
      expect((result.content as any)[0]?.text).toBe(
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
          return widget({
            props: { items: Array(count).fill(0), count },
            output: text(`Found ${count} items`),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("text-tool");
      const result = await toolHandler!.handler({ count: 5 }, {} as any);

      expect((result.content as any)[0]?.text).toBe("Found 5 items");
      expect((result as any)._meta["mcp-use/props"].count).toBe(5);
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
          return widget({
            props: { fullData: { id, value: "data" } },
            output: object({ summary: `ID: ${id}`, status: "success" }),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("object-tool");
      const result = await toolHandler!.handler({ id: "abc123" }, {} as any);

      const parsedOutput = JSON.parse((result.content as any)[0]?.text);
      expect(parsedOutput.summary).toBe("ID: abc123");
      expect(parsedOutput.status).toBe("success");
      expect((result as any)._meta["mcp-use/props"].fullData.id).toBe("abc123");
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
          return widget({
            props: data,
            output: text(`${data.type}: ${data.records.length} records`),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("function-tool");
      const result = await toolHandler!.handler({ type: "users" }, {} as any);

      expect((result.content as any)[0]?.text).toBe("users: 3 records");
      expect((result as any)._meta["mcp-use/props"].type).toBe("users");
    });
  });
});
