import { describe, it, expect } from "vitest";
import {
  createAppsSdkResource,
  createMcpAppResource,
} from "../../../src/server/widgets/mcp-ui-adapter.js";
import { processWidgetHtml } from "../../../src/server/widgets/widget-helpers.js";

describe("Widget Environment Injection", () => {
  describe("createAppsSdkResource", () => {
    it("should inject env vars into HTML template", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = { API_KEY: "test-key-123", DEBUG: true };

      const result = createAppsSdkResource(
        "ui://widget/test.html",
        html,
        undefined,
        undefined,
        env
      );

      expect(result.resource.text).toContain("window.mcpUse.env");
      expect(result.resource.text).toContain('"API_KEY":"test-key-123"');
      expect(result.resource.text).toContain('"DEBUG":true');
    });

    it("should inject both hostType and env when both provided", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = { KEY: "value" };

      const result = createAppsSdkResource(
        "ui://widget/test.html",
        html,
        undefined,
        "apps-sdk",
        env
      );

      expect(result.resource.text).toContain(
        'window.mcpUse.hostType = "apps-sdk"'
      );
      expect(result.resource.text).toContain("window.mcpUse.env");
      expect(result.resource.text).toContain('"KEY":"value"');
    });

    it("should not inject env script when env is empty", () => {
      const html = "<html><head></head><body>Test</body></html>";

      const result = createAppsSdkResource(
        "ui://widget/test.html",
        html,
        undefined,
        undefined,
        {}
      );

      expect(result.resource.text).not.toContain("window.mcpUse");
    });

    it("should handle complex env values with JSON serialization", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = {
        STRING: "hello",
        NUMBER: 42,
        BOOLEAN: false,
        OBJECT: { nested: "value" },
        ARRAY: [1, 2, 3],
      };

      const result = createAppsSdkResource(
        "ui://widget/test.html",
        html,
        undefined,
        undefined,
        env
      );

      expect(result.resource.text).toContain('"STRING":"hello"');
      expect(result.resource.text).toContain('"NUMBER":42');
      expect(result.resource.text).toContain('"BOOLEAN":false');
      expect(result.resource.text).toContain('"nested":"value"');
      expect(result.resource.text).toContain("[1,2,3]");
    });

    it("should escape special characters to prevent XSS", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = {
        MALICIOUS: '</script><script>alert("xss")</script>',
      };

      const result = createAppsSdkResource(
        "ui://widget/test.html",
        html,
        undefined,
        undefined,
        env
      );

      // JSON.stringify should escape the string properly
      expect(result.resource.text).not.toContain(
        '</script><script>alert("xss")'
      );
      expect(result.resource.text).toContain("\\u003c/script\\u003e");
    });
  });

  describe("createMcpAppResource", () => {
    it("should inject env vars into HTML template", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = { MCP_KEY: "mcp-value" };

      const result = createMcpAppResource(
        "ui://widget/test.html",
        html,
        undefined,
        "mcp-app",
        env
      );

      expect(result.resource.text).toContain("window.mcpUse.env");
      expect(result.resource.text).toContain('"MCP_KEY":"mcp-value"');
    });

    it("should always inject hostType for mcpApp (defaults to mcp-app)", () => {
      const html = "<html><head></head><body>Test</body></html>";

      const result = createMcpAppResource(
        "ui://widget/test.html",
        html,
        undefined,
        undefined,
        {}
      );

      expect(result.resource.text).toContain(
        'window.mcpUse.hostType = "mcp-app"'
      );
    });
  });

  describe("processWidgetHtml", () => {
    it("should inject env vars when processing widget HTML", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = { WIDGET_KEY: "widget-value" };

      const result = processWidgetHtml(
        html,
        "test-widget",
        "http://localhost:3000",
        undefined,
        env
      );

      expect(result).toContain("window.mcpUse.env");
      expect(result).toContain('"WIDGET_KEY":"widget-value"');
    });

    it("should inject both hostType and env when both provided", () => {
      const html = "<html><head></head><body>Test</body></html>";
      const env = { KEY: "value" };

      const result = processWidgetHtml(
        html,
        "test-widget",
        "http://localhost:3000",
        "standalone",
        env
      );

      expect(result).toContain('window.mcpUse.hostType = "standalone"');
      expect(result).toContain("window.mcpUse.env");
    });

    it("should not inject mcpUse globals when neither hostType nor env provided", () => {
      const html = "<html><head></head><body>Test</body></html>";

      const result = processWidgetHtml(
        html,
        "test-widget",
        "http://localhost:3000",
        undefined,
        undefined
      );

      // Should still have __getFile but no mcpUse.hostType or mcpUse.env
      expect(result).toContain("window.__getFile");
      expect(result).not.toContain("window.mcpUse.hostType");
      expect(result).not.toContain("window.mcpUse.env");
    });

    it("should inject env into head tag", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>Content</body>
</html>`;
      const env = { TEST: "value" };

      const result = processWidgetHtml(
        html,
        "test-widget",
        "http://localhost:3000",
        undefined,
        env
      );

      // The script should be injected in the head section
      const headMatch = result.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      expect(headMatch).toBeTruthy();
      expect(headMatch![1]).toContain("window.mcpUse.env");
    });
  });
});
