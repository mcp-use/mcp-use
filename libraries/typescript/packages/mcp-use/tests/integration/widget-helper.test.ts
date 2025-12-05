import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/server/index.js";
import { widget } from "../../src/server/utils/response-helpers.js";
import type { WidgetMetadata } from "../../src/server/types/widget.js";
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

    // Manual tool that uses widget() helper
    server.tool(
      {
        name: "manual-comparison-tool",
        description: "Manual tool using widget() helper",
        inputs: {
          message: {
            type: "string",
            description: "A message",
          },
        },
      },
      async (params) => {
        return widget({
          name: "comparison-widget",
          data: params,
          message: "Displaying comparison-widget",
        });
      }
    );

    // Tool with custom metadata
    server.tool(
      {
        name: "manual-custom-metadata-tool",
        description: "Manual tool with custom metadata",
        inputs: {},
      },
      async () => {
        return widget({
          name: "comparison-widget",
          data: { foo: "bar" },
          message: "Custom message",
          invoking: "Custom invoking...",
          invoked: "Custom invoked",
          widgetAccessible: false,
          resultCanProduceWidget: true,
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
      expect(result.content[0].text).toContain("not found");
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

      // Compare structure (not exact values due to random URIs)
      expect(manualResult).toHaveProperty("_meta");
      expect(manualResult).toHaveProperty("content");

      expect(autoResult).toHaveProperty("_meta");
      expect(autoResult).toHaveProperty("content");

      // Check metadata fields exist on manual result
      expect(manualResult._meta).toHaveProperty("openai/outputTemplate");
      expect(manualResult._meta).toHaveProperty("openai/widgetAccessible");
      expect(manualResult._meta).toHaveProperty(
        "openai/resultCanProduceWidget"
      );

      // Auto result also has outputTemplate
      expect(autoResult._meta).toHaveProperty("openai/outputTemplate");

      // Check content structure
      expect(manualResult.content).toHaveLength(1);
      expect(manualResult.content[0]).toHaveProperty("type", "text");
      expect(manualResult.content[0]).toHaveProperty("text");
      expect(manualResult.content[0].text).toBe("Displaying comparison-widget");

      expect(autoResult.content).toHaveLength(1);
      expect(autoResult.content[0]).toHaveProperty("type", "text");
      expect(autoResult.content[0]).toHaveProperty("text");

      // Both should have valid widget URIs
      const manualUri = manualResult._meta?.["openai/outputTemplate"];
      const autoUri = autoResult._meta?.["openai/outputTemplate"];
      expect(manualUri).toMatch(
        /^ui:\/\/widget\/comparison-widget-[a-z0-9]+\.html$/
      );
      expect(autoUri).toMatch(/^ui:\/\/widget\/auto-widget/);
    });

    it("should allow custom metadata in manual widget() calls", async () => {
      // Call the tool with custom metadata
      const result = await client.callTool({
        name: "manual-custom-metadata-tool",
        arguments: {},
      });

      // Verify custom metadata
      expect(result.content[0].text).toBe("Custom message");
      expect(result._meta?.["openai/toolInvocation/invoking"]).toBe(
        "Custom invoking..."
      );
      expect(result._meta?.["openai/toolInvocation/invoked"]).toBe(
        "Custom invoked"
      );
      expect(result._meta?.["openai/widgetAccessible"]).toBe(false);
      expect(result._meta?.["openai/resultCanProduceWidget"]).toBe(true);
    });
  });
});
