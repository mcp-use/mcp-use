import { describe, expect, it } from "vitest";
import { resolveViewResource } from "../../src/react/view/resolve-view-resource.js";
import {
  buildViewSandboxBlobUrl,
  buildSandboxProxyBlobHtml,
} from "../../src/react/view/sandbox-blob-url.js";
import {
  getViewResourceUri,
  isViewTool,
} from "../../src/react/view/view-detection.js";

describe("buildViewSandboxBlobUrl", () => {
  it("returns blob: URLs and stable sandbox search params", () => {
    const options = { cspMode: "permissive" as const };
    const url = buildViewSandboxBlobUrl(options);

    expect(url.protocol).toBe("blob:");

    const params = new URLSearchParams();
    params.set(
      "v",
      JSON.stringify({
        cspMode: options.cspMode,
        permissions: undefined,
        widgetCsp: undefined,
      })
    );
    params.set("csp_mode", options.cspMode);
    const search = `?${params.toString()}`;
    expect(buildSandboxProxyBlobHtml(search)).toBe(
      buildSandboxProxyBlobHtml(search)
    );
  });
});

describe("resolveViewResource", () => {
  it("accepts valid MCP App MIME type and extracts HTML", () => {
    const resolved = resolveViewResource({
      resourceResult: {
        contents: [
          {
            mimeType: "text/html;profile=mcp-app",
            text: "<html><body>hi</body></html>",
          },
        ],
      },
      cspMode: "widget-declared",
    });

    expect(resolved.mimeTypeValid).toBe(true);
    expect(resolved.html).toContain("hi");
  });

  it("rejects invalid MIME types", () => {
    const resolved = resolveViewResource({
      resourceResult: {
        contents: [{ mimeType: "text/html", text: "<html></html>" }],
      },
      cspMode: "widget-declared",
    });

    expect(resolved.mimeTypeValid).toBe(false);
    expect(resolved.mimeTypeWarning).toContain("Invalid MIME type");
  });
});

describe("view detection", () => {
  it("detects view tools by _meta.ui.resourceUri", () => {
    expect(isViewTool({ ui: { resourceUri: "ui://app/widget.html" } })).toBe(
      true
    );
    expect(getViewResourceUri({ ui: { resourceUri: "ui://x" } })).toBe(
      "ui://x"
    );
    expect(isViewTool({})).toBe(false);
  });
});
