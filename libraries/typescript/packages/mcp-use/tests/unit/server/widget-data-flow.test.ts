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
        { city: "Tokyo", temp: 25 },
        {} as any
      );

      // Verify result structure
      expect(result.content[0].text).toBe("Weather in Tokyo: 25°C");
      expect((result as any)._meta).toBeDefined();
      expect((result as any)._meta["openai/outputTemplate"]).toMatch(
        /ui:\/\/widget\/test-widget/
      );

      // For auto-registered widgets, there should be NO widgetProps in _meta
      // The toolInput (tool args) will be used as props directly
      expect((result as any)._meta["mcp-use/widgetProps"]).toBeUndefined();
    });
  });

  describe("Helper widget with string toolOutput", () => {
    it("should separate widget data from toolOutput", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "table-widget",
        description: "Display table data",
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
            data: {
              rows,
              tableName,
            },
            toolOutput: `Retrieved ${rows.length} rows from ${tableName} table`,
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
      expect(result.content[0].text).toBe(
        "Retrieved 100 rows from users table"
      );
      expect((result as any).structuredContent).toBeUndefined(); // Should NOT have structuredContent

      // Verify metadata
      expect((result as any)._meta).toBeDefined();
      expect((result as any)._meta["mcp-use/widgetProps"]).toBeDefined();
      expect((result as any)._meta["mcp-use/widgetProps"].rows).toHaveLength(
        100
      );
      expect((result as any)._meta["mcp-use/widgetProps"].tableName).toBe(
        "users"
      );
      expect((result as any)._meta["openai/outputTemplate"]).toMatch(
        /ui:\/\/widget\/table-widget/
      );
    });
  });

  describe("Helper widget with function toolOutput", () => {
    it("should support function toolOutput", async () => {
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

      // Register a tool that uses widget() helper with function
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
            data: { items, total, category },
            toolOutput: (data) =>
              `Found ${data.total} items in ${data.category}`,
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
      expect(result.content[0].text).toBe("Found 100 items in electronics");
      expect((result as any).structuredContent).toBeUndefined();

      // Verify widget props in metadata
      expect((result as any)._meta["mcp-use/widgetProps"]).toBeDefined();
      expect((result as any)._meta["mcp-use/widgetProps"].items).toEqual([
        1, 2, 3,
      ]);
      expect((result as any)._meta["mcp-use/widgetProps"].total).toBe(100);
      expect((result as any)._meta["mcp-use/widgetProps"].category).toBe(
        "electronics"
      );
    });
  });

  describe("Helper widget with object toolOutput", () => {
    it("should support object toolOutput (JSON.stringify)", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "summary-widget",
        description: "Display summary",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Summary</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("summary-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool that uses widget() helper with object output
      server.tool(
        {
          name: "get-summary",
          description: "Get summary",
          schema: z.object({
            query: z.string(),
          }),
          widget: {
            name: "summary-widget",
            invoking: "Loading summary...",
            invoked: "Summary loaded",
          },
        },
        async ({ query }) => {
          return widget({
            data: {
              results: ["result1", "result2"],
              metadata: { page: 1, total: 50 },
            },
            toolOutput: {
              summary: `Search for "${query}" returned 50 results`,
              count: 50,
            },
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-summary");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler(
        { query: "test query" },
        {} as any
      );

      // Verify response structure - object should be stringified
      const parsedOutput = JSON.parse(result.content[0].text);
      expect(parsedOutput.summary).toBe(
        'Search for "test query" returned 50 results'
      );
      expect(parsedOutput.count).toBe(50);
      expect((result as any).structuredContent).toBeUndefined();

      // Verify widget props in metadata
      expect((result as any)._meta["mcp-use/widgetProps"]).toBeDefined();
      expect((result as any)._meta["mcp-use/widgetProps"].results).toEqual([
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

      // Register a tool that uses deprecated message parameter
      server.tool(
        {
          name: "get-legacy-data",
          description: "Get legacy data",
          schema: z.object({
            id: z.string(),
          }),
          widget: {
            name: "legacy-widget",
            invoking: "Loading...",
            invoked: "Loaded",
          },
        },
        async ({ id }) => {
          return widget({
            data: { id, value: "test" },
            message: "Legacy message format", // Deprecated but should still work
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-legacy-data");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ id: "123" }, {} as any);

      // Verify response structure
      expect(result.content[0].text).toBe("Legacy message format");
      expect((result as any).structuredContent).toBeUndefined();

      // Verify widget props in metadata
      expect((result as any)._meta["mcp-use/widgetProps"]).toBeDefined();
      expect((result as any)._meta["mcp-use/widgetProps"].id).toBe("123");
      expect((result as any)._meta["mcp-use/widgetProps"].value).toBe("test");
    });

    it("should prefer toolOutput over message when both are provided", async () => {
      // Create a widget definition
      const mockWidgetDef = {
        name: "mixed-widget",
        description: "Mixed widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Mixed</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("mixed-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      // Register a tool with both message and toolOutput
      server.tool(
        {
          name: "get-mixed-data",
          description: "Get mixed data",
          schema: z.object({
            value: z.number(),
          }),
          widget: {
            name: "mixed-widget",
            invoking: "Loading...",
            invoked: "Loaded",
          },
        },
        async ({ value }) => {
          return widget({
            data: { value },
            message: "This should be ignored",
            toolOutput: "This should be used",
          });
        }
      );

      // Call the tool
      const toolHandler = server.registrations.tools.get("get-mixed-data");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ value: 42 }, {} as any);

      // Verify toolOutput takes precedence
      expect(result.content[0].text).toBe("This should be used");
      expect(result.content[0].text).not.toBe("This should be ignored");
    });
  });

  describe("Helper functions as toolOutput", () => {
    it("should support text() helper as toolOutput", async () => {
      const mockWidgetDef = {
        name: "text-helper-widget",
        description: "Text helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Text Helper</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("text-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "get-text-helper",
          description: "Get text helper",
          schema: z.object({ count: z.number() }),
          widget: {
            name: "text-helper-widget",
            invoking: "Loading...",
            invoked: "Loaded",
          },
        },
        async ({ count }) => {
          return widget({
            data: { items: Array(count).fill(0), count },
            toolOutput: text(`Found ${count} items`),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("get-text-helper");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ count: 5 }, {} as any);

      expect(result.content[0].text).toBe("Found 5 items");
      expect((result as any)._meta["mcp-use/widgetProps"].count).toBe(5);
    });

    it("should support object() helper as toolOutput", async () => {
      const mockWidgetDef = {
        name: "object-helper-widget",
        description: "Object helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Object Helper</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("object-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "get-object-helper",
          description: "Get object helper",
          schema: z.object({ id: z.string() }),
          widget: {
            name: "object-helper-widget",
            invoking: "Loading...",
            invoked: "Loaded",
          },
        },
        async ({ id }) => {
          return widget({
            data: { fullData: { id, value: "data" } },
            toolOutput: object({ summary: `ID: ${id}`, status: "success" }),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("get-object-helper");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ id: "abc123" }, {} as any);

      const parsedOutput = JSON.parse(result.content[0].text);
      expect(parsedOutput.summary).toBe("ID: abc123");
      expect(parsedOutput.status).toBe("success");
      expect((result as any)._meta["mcp-use/widgetProps"].fullData.id).toBe(
        "abc123"
      );
    });

    it("should support function returning helper as toolOutput", async () => {
      const mockWidgetDef = {
        name: "function-helper-widget",
        description: "Function helper widget",
        type: "appsSdk" as const,
        props: {},
        htmlTemplate: "<div>Function Helper</div>",
        appsSdkMetadata: {},
      };

      server.widgetDefinitions.set("function-helper-widget", {
        "mcp-use/widget": mockWidgetDef,
      });

      server.tool(
        {
          name: "get-function-helper",
          description: "Get function helper",
          schema: z.object({ type: z.string() }),
          widget: {
            name: "function-helper-widget",
            invoking: "Loading...",
            invoked: "Loaded",
          },
        },
        async ({ type }) => {
          return widget({
            data: { records: [1, 2, 3], type },
            toolOutput: (data) =>
              text(`${data.type}: ${data.records.length} records`),
          });
        }
      );

      const toolHandler = server.registrations.tools.get("get-function-helper");
      expect(toolHandler).toBeDefined();

      const result = await toolHandler!.handler({ type: "users" }, {} as any);

      expect(result.content[0].text).toBe("users: 3 records");
      expect((result as any)._meta["mcp-use/widgetProps"].type).toBe("users");
    });
  });
});
