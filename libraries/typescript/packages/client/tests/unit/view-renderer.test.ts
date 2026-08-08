import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
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

  it("builds widget-declared CSP with eval and only declared domains", () => {
    const dom = new JSDOM(
      buildSandboxProxyBlobHtml("?csp_mode=widget-declared"),
      { runScripts: "dangerously", url: "https://sandbox.example" }
    );

    try {
      const { window } = dom;
      window.dispatchEvent(
        new window.MessageEvent("message", {
          source: window.parent,
          data: {
            method: "ui/notifications/sandbox-resource-ready",
            params: {
              html: "<html><head></head><body></body></html>",
              csp: {
                connectDomains: ["https://api.example.com"],
                frameDomains: ["https://frames.example.com"],
                resourceDomains: ["https://cdn.example.com"],
              },
              permissive: false,
            },
          },
        })
      );

      const srcdoc = window.document.querySelector("iframe")?.srcdoc;
      expect(srcdoc).toContain(
        "script-src 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.example.com"
      );
      expect(srcdoc).toContain("connect-src https://api.example.com");
      expect(srcdoc).toContain("frame-src https://frames.example.com");
      expect(srcdoc).toContain("img-src data: blob: https://cdn.example.com");
      expect(srcdoc).not.toContain("connect-src *");
      expect(srcdoc).not.toContain("frame-src *");
    } finally {
      dom.window.close();
    }
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
