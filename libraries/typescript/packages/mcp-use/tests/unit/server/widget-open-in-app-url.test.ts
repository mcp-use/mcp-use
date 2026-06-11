/**
 * Tests for the ChatGPT-only "Open in app" URL (window.openai.setOpenInAppUrl)
 * support on the server side:
 *
 * - `metadata.openai.openInAppUrl` is NOT serialized into the resource `_meta`
 *   by either protocol adapter (it is a runtime directive, not host passthrough).
 * - Other unified metadata fields (e.g. prefersBorder) are still serialized,
 *   proving the exclusion is surgical.
 * - `processWidgetHtml` injects `window.__mcpOpenInAppUrl` into the widget HTML
 *   head when an `openInAppUrl` is provided, escaping the value safely, and
 *   omits it otherwise.
 */

import { describe, it, expect } from "vitest";
import { AppsSdkAdapter } from "../../../src/server/widgets/adapters/apps-sdk.js";
import { McpAppsAdapter } from "../../../src/server/widgets/adapters/mcp-apps.js";
import { processWidgetHtml } from "../../../src/server/widgets/widget-helpers.js";

// Minimal UIResourceDefinition-shaped object for adapter tests.
function makeDefinition(metadata: Record<string, unknown>) {
  return {
    type: "mcpApps",
    name: "demo-widget",
    htmlTemplate: "<div>demo</div>",
    metadata,
  } as any;
}

describe("openInAppUrl is excluded from resource _meta", () => {
  it("Apps SDK adapter does not emit an openai/* key for openInAppUrl", () => {
    const adapter = new AppsSdkAdapter();
    const { _meta } = adapter.buildResourceMetadata(
      makeDefinition({
        prefersBorder: true,
        openai: { openInAppUrl: "https://app.example.com/item/42" },
      })
    );

    const keys = Object.keys(_meta ?? {});
    // The runtime directive must not leak into host-read metadata.
    expect(keys).not.toContain("openai");
    expect(keys).not.toContain("openai/openai");
    expect(JSON.stringify(_meta)).not.toContain("openInAppUrl");
    // Genuine passthrough fields are still transformed and serialized.
    expect(_meta).toHaveProperty("openai/widgetPrefersBorder", true);
  });

  it("MCP Apps adapter does not emit openInAppUrl under _meta.ui", () => {
    const adapter = new McpAppsAdapter();
    const { _meta } = adapter.buildResourceMetadata(
      makeDefinition({
        prefersBorder: true,
        openai: { openInAppUrl: "https://app.example.com/item/42" },
      })
    );

    expect(JSON.stringify(_meta)).not.toContain("openInAppUrl");
    expect(JSON.stringify(_meta)).not.toContain("openai");
    // Genuine passthrough fields are still serialized under the ui namespace.
    expect((_meta as any)?.ui).toHaveProperty("prefersBorder", true);
  });
});

describe("processWidgetHtml injects window.__mcpOpenInAppUrl", () => {
  const html = "<html><head></head><body></body></html>";
  const baseUrl = "http://localhost:3000";

  it("injects the global when an openInAppUrl is provided", () => {
    const out = processWidgetHtml(
      html,
      "demo-widget",
      baseUrl,
      "https://app.example.com/item/42"
    );
    expect(out).toContain(
      'window.__mcpOpenInAppUrl = "https://app.example.com/item/42";'
    );
  });

  it("omits the global when no openInAppUrl is provided", () => {
    const out = processWidgetHtml(html, "demo-widget", baseUrl);
    expect(out).not.toContain("__mcpOpenInAppUrl");
  });

  it("escapes the URL so it cannot break out of the inline script", () => {
    const nasty = "https://evil.example.com/x</script><script>alert(1)";
    const out = processWidgetHtml(html, "demo-widget", baseUrl, nasty);
    // The injected <script> must not be terminable by the value.
    expect(out).not.toContain("</script><script>alert(1)");
    // < and > are unicode-escaped inside the JS string literal.
    expect(out).toContain("\\u003c/script\\u003e");
    expect(out).toContain("evil.example.com");
  });
});
