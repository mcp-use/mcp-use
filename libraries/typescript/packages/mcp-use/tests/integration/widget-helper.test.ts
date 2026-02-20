import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/server/index.js";
import { widget } from "../../src/server/utils/response-helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("Widget Helper Integration Tests", () => {
  let server: any;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const TEST_PORT = 3098;
  const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

  beforeAll(async () => {
    // Create test server
    server = new MCPServer({
      name: "test-widget-server",
      version: "1.0.0",
    });

    // Register widgets for testing
    // Widget with exposeAsTool: false (not auto-registered as tool)
    server.uiResource({
      type: "appsSdk",
      name: "manual-widget",
      title: "Manual Widget",
      description: "Widget not auto-registered as tool",
      htmlTemplate: "<div>Test</div>",
      props: {
        message: {
          type: "string",
          description: "A message",
        },
      },
      exposeAsTool: false,
    });

    // Widget without exposeAsTool (should default to true)
    server.uiResource({
      type: "appsSdk",
      name: "auto-widget",
      title: "Auto Widget",
      description: "Widget auto-registered as tool",
      htmlTemplate: "<div>Test</div>",
      props: {
        message: {
          type: "string",
          description: "A message",
        },
      },
    });

    // Widget with exposeAsTool: true (explicitly)
    server.uiResource({
      type: "appsSdk",
      name: "explicit-auto-widget",
      title: "Explicit Auto Widget",
      description: "Widget explicitly auto-registered as tool",
      htmlTemplate: "<div>Test</div>",
      props: {
        message: {
          type: "string",
          description: "A message",
        },
      },
      exposeAsTool: true,
    });

    // Widget with tool annotations
    server.uiResource({
      type: "appsSdk",
      name: "annotated-widget",
      title: "Annotated Widget",
      description: "Widget with tool annotations",
      htmlTemplate: "<div>Test</div>",
      props: {},
      toolAnnotations: {
        readOnlyHint: true,
      },
    });

    // Widget with multiple annotations
    server.uiResource({
      type: "appsSdk",
      name: "multi-annotated-widget",
      title: "Multi-Annotated Widget",
      description: "Widget with multiple tool annotations",
      htmlTemplate: "<div>Test</div>",
      props: {},
      toolAnnotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
    });

    // Widget for manual tool testing
    server.uiResource({
      type: "appsSdk",
      name: "comparison-widget",
      title: "Comparison Widget",
      description: "Widget for comparing outputs",
      htmlTemplate: "<div>Test</div>",
      props: {
        message: {
          type: "string",
          description: "A message",
        },
      },
      exposeAsTool: false,
    });

    // Manual tool that uses widget() helper with widget config
    server.tool(
      {
        name: "manual-comparison-tool",
        description: "Manual tool using widget() helper",
        schema: z.object({
          message: z.string().describe("A message"),
        }),
        widget: {
          name: "comparison-widget",
        },
      },
      async (params: { message: string }) => {
        return widget({
          props: params,
          message: "Displaying comparison-widget",
        });
      }
    );

    // Tool with custom metadata in widget config
    server.tool(
      {
        name: "manual-custom-metadata-tool",
        description: "Manual tool with custom metadata",
        inputs: {},
        widget: {
          name: "comparison-widget",
          invoking: "Custom invoking...",
          invoked: "Custom invoked",
          widgetAccessible: false,
          resultCanProduceWidget: true,
        },
      },
      async () => {
        return widget({
          props: { foo: "bar" },
          message: "Custom message",
        });
      }
    );

    // Start server
    await server.listen(TEST_PORT);

    // Give server a moment to fully start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create client
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("exposeAsTool functionality", () => {
    it("should not be callable as tool when exposeAsTool is false", async () => {
      // Attempt to call the manual-widget tool (should return error)
      const result = await client.callTool({
        name: "manual-widget",
        arguments: { message: "test" },
      });

      // Tool call returns error response
      expect(result.isError).toBe(true);
      expect((result.content as any)[0]?.text).toContain("not found");
    });

    it("should be callable as tool when exposeAsTool is undefined (default)", async () => {
      // Call the auto-widget tool (should succeed)
      const result = await client.callTool({
        name: "auto-widget",
        arguments: { message: "test" },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it("should be callable as tool when exposeAsTool is true", async () => {
      // Call the explicit-auto-widget tool (should succeed)
      const result = await client.callTool({
        name: "explicit-auto-widget",
        arguments: { message: "test" },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe("Comparing auto-registration vs manual widget() helper", () => {
    it("should produce similar output structure", async () => {
      // Call manual tool that uses widget() helper
      const manualResult = await client.callTool({
        name: "manual-comparison-tool",
        arguments: { message: "test" },
      });

      // Call auto-registered widget tool
      const autoResult = await client.callTool({
        name: "auto-widget",
        arguments: { message: "test" },
      });

      // Per SEP-1865: protocol metadata (outputTemplate, widgetAccessible, etc.)
      // belongs on the tool definition (tools/list), not on the tool call result.
      // Tool results only have content, structuredContent, and optional app-specific _meta.

      // Check content structure for both
      expect(manualResult).toHaveProperty("content");
      expect(autoResult).toHaveProperty("content");

      expect(manualResult.content).toHaveLength(1);
      expect((manualResult.content as any)[0]).toHaveProperty("type", "text");
      expect((manualResult.content as any)[0]).toHaveProperty("text");
      expect((manualResult.content as any)[0].text).toBe(
        "Displaying comparison-widget"
      );

      expect(autoResult.content).toHaveLength(1);
      expect((autoResult.content as any)[0]).toHaveProperty("type", "text");
      expect((autoResult.content as any)[0]).toHaveProperty("text");

      // Verify widget metadata is on tool definitions (tools/list), not on results
      const { tools } = await client.listTools();
      const manualTool = tools.find((t) => t.name === "manual-comparison-tool");
      const autoTool = tools.find((t) => t.name === "auto-widget");

      expect(manualTool).toBeDefined();
      expect(manualTool!._meta).toBeDefined();
      expect(manualTool!._meta).toHaveProperty("openai/outputTemplate");
      expect(manualTool!._meta).toHaveProperty("openai/widgetAccessible");
      expect(manualTool!._meta).toHaveProperty("openai/resultCanProduceWidget");

      expect(autoTool).toBeDefined();
      // auto-registered tools may not expose _meta in tools/list (host/SDK dependent)
      if (autoTool!._meta) {
        expect(autoTool!._meta).toHaveProperty("openai/outputTemplate");
        const autoUri = (autoTool!._meta as Record<string, unknown>)?.[
          "openai/outputTemplate"
        ] as string;
        expect(autoUri).toMatch(/^ui:\/\/widget\/auto-widget/);
      }

      const manualUri = (manualTool!._meta as Record<string, unknown>)?.[
        "openai/outputTemplate"
      ] as string;
      expect(manualUri).toMatch(/^ui:\/\/widget\/comparison-widget.*\.html$/);
    });

    it("should allow custom metadata in manual widget() calls", async () => {
      // Call the tool with custom metadata
      const result = await client.callTool({
        name: "manual-custom-metadata-tool",
        arguments: {},
      });

      // Verify tool result content
      expect((result.content as any)[0]?.text).toBe("Custom message");

      // Per SEP-1865: invoking, invoked, widgetAccessible, resultCanProduceWidget
      // belong on the tool definition (tools/list), not on the tool call result
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "manual-custom-metadata-tool");
      const meta = tool?._meta as Record<string, unknown> | undefined;

      expect(meta?.["openai/toolInvocation/invoking"]).toBe(
        "Custom invoking..."
      );
      expect(meta?.["openai/toolInvocation/invoked"]).toBe("Custom invoked");
      expect(meta?.["openai/widgetAccessible"]).toBe(false);
      expect(meta?.["openai/resultCanProduceWidget"]).toBe(true);
    });
  });
});
