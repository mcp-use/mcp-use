import { describe, expect, it } from "vitest";
import {
  computeContentHash,
  createWidgetRegistration,
} from "../../../src/server/widgets/widget-helpers.js";

describe("Widget Content Hash", () => {
  describe("computeContentHash", () => {
    it("should return a 12-character hex string", async () => {
      const hash = await computeContentHash("<html><body>Test</body></html>");

      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should be deterministic - same content produces same hash", async () => {
      const content = "<html><body>Hello World</body></html>";

      const hash1 = await computeContentHash(content);
      const hash2 = await computeContentHash(content);
      const hash3 = await computeContentHash(content);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should produce different hashes for different content", async () => {
      const hash1 = await computeContentHash(
        "<html><body>Content A</body></html>"
      );
      const hash2 = await computeContentHash(
        "<html><body>Content B</body></html>"
      );

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty content", async () => {
      const hash = await computeContentHash("");

      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should handle unicode content", async () => {
      const hash = await computeContentHash(
        "<html><body>こんにちは 🎉</body></html>"
      );

      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should handle large content", async () => {
      const largeContent =
        "<html><body>" + "x".repeat(100000) + "</body></html>";
      const hash = await computeContentHash(largeContent);

      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe("createWidgetRegistration with contentHash", () => {
    const serverConfig = {
      serverBaseUrl: "http://localhost:3000",
      cspUrls: [],
    };

    it("should include contentHash in _meta for appsSdk type", () => {
      const registration = createWidgetRegistration(
        "test-widget",
        { title: "Test Widget", description: "A test widget" },
        "<html><body>Test</body></html>",
        serverConfig,
        false,
        "abc123def456"
      );

      expect(registration.type).toBe("appsSdk");
      const widgetMeta = registration._meta["mcp-use/widget"] as Record<
        string,
        unknown
      >;
      expect(widgetMeta.contentHash).toBe("abc123def456");
    });

    it("should include contentHash in _meta for mcpApp type", () => {
      const registration = createWidgetRegistration(
        "test-widget",
        { title: "Test Widget", description: "A test widget", type: "mcpApp" },
        "<html><body>Test</body></html>",
        serverConfig,
        false,
        "xyz789abc012"
      );

      expect(registration.type).toBe("mcpApp");
      const widgetMeta = registration._meta["mcp-use/widget"] as Record<
        string,
        unknown
      >;
      expect(widgetMeta.contentHash).toBe("xyz789abc012");
    });

    it("should handle undefined contentHash gracefully", () => {
      const registration = createWidgetRegistration(
        "test-widget",
        { title: "Test Widget" },
        "<html><body>Test</body></html>",
        serverConfig,
        false,
        undefined
      );

      const widgetMeta = registration._meta["mcp-use/widget"] as Record<
        string,
        unknown
      >;
      expect(widgetMeta.contentHash).toBeUndefined();
    });
  });

  describe("Content hash consistency", () => {
    it("same HTML should always produce the same hash", async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Widget</title>
  <script src="/assets/index-abc123.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

      // Simulate multiple server restarts / deployments
      const hashes = await Promise.all([
        computeContentHash(html),
        computeContentHash(html),
        computeContentHash(html),
      ]);

      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
    });

    it("changing JS asset hash should change widget hash", async () => {
      const html1 = `<html><head><script src="/assets/index-abc123.js"></script></head></html>`;
      const html2 = `<html><head><script src="/assets/index-def456.js"></script></head></html>`;

      const hash1 = await computeContentHash(html1);
      const hash2 = await computeContentHash(html2);

      expect(hash1).not.toBe(hash2);
    });

    it("changing CSS asset hash should change widget hash", async () => {
      const html1 = `<html><head><link href="/assets/style-abc123.css" rel="stylesheet"></head></html>`;
      const html2 = `<html><head><link href="/assets/style-def456.css" rel="stylesheet"></head></html>`;

      const hash1 = await computeContentHash(html1);
      const hash2 = await computeContentHash(html2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
