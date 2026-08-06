import { describe, expect, it } from "vitest";
import { resolveViewResource } from "../../src/react/view/resolve-view-resource.js";
import {
  buildViewSandboxBlobUrl,
  buildSandboxProxyBlobHtml,
  buildViewSandboxUrl,
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

  it("allows eval while retaining widget-declared domain restrictions", () => {
    const sandboxHtml = buildSandboxProxyBlobHtml("?csp_mode=widget-declared");

    expect(sandboxHtml).toContain(
      `const scriptSrcParts = ["'unsafe-inline'", "'unsafe-eval'", resourceSrc];`
    );
    expect(sandboxHtml).toContain(
      `const connectSrc = connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";`
    );
  });
});

describe("buildViewSandboxUrl", () => {
  it("preserves a distinct document origin and appends sandbox policy", () => {
    const url = buildViewSandboxUrl(
      new URL("https://sandbox.example/inspector/sandbox"),
      {
        cspMode: "widget-declared",
        permissions: { clipboardWrite: {} },
        widgetCsp: { connectDomains: ["https://api.example"] },
      }
    );

    expect(url.origin).toBe("https://sandbox.example");
    expect(url.searchParams.get("csp_mode")).toBe("widget-declared");
    expect(url.searchParams.get("permissions")).toContain("clipboardWrite");
    expect(url.searchParams.get("widget_csp")).toContain("https://api.example");
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
