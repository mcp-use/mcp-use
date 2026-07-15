import { describe, expect, it } from "vitest";
import {
  buildSandboxProxyBlobHtml,
  SANDBOX_PROXY_HTML,
} from "@/shared/sandbox-proxy-html";

describe("buildSandboxProxyBlobHtml", () => {
  it("injects __SANDBOX_SEARCH__ immediately after <body>", () => {
    const search = "?csp_mode=permissive&v=1";
    const html = buildSandboxProxyBlobHtml(search);
    const bodyIdx = html.indexOf("<body>");
    const injectIdx = html.indexOf("window.__SANDBOX_SEARCH__");
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(injectIdx).toBeGreaterThan(bodyIdx);
    expect(html).toContain(
      `<script>window.__SANDBOX_SEARCH__ = ${JSON.stringify(search)};</script>`
    );
    // Main proxy script still present after the inject.
    expect(html.indexOf("sandbox-proxy-ready")).toBeGreaterThan(injectIdx);
  });

  it("JSON-escapes < so it cannot break out of the script tag", () => {
    const search = "?x=<script>alert(1)</script>&csp_mode=permissive";
    const html = buildSandboxProxyBlobHtml(search);
    expect(html).toContain("\\u003c");
    expect(html).not.toMatch(/window\.__SANDBOX_SEARCH__ = "[^"]*<script>/);
  });

  it("leaves the base SANDBOX_PROXY_HTML without a blob inject script", () => {
    expect(SANDBOX_PROXY_HTML).not.toContain(
      "<script>window.__SANDBOX_SEARCH__ ="
    );
    expect(SANDBOX_PROXY_HTML).toContain("location.search");
  });

  it("documents __SANDBOX_SEARCH__ precedence over location.search", () => {
    // The proxy script must prefer the injected search when present.
    expect(SANDBOX_PROXY_HTML).toContain(
      'typeof window.__SANDBOX_SEARCH__ === "string"'
    );
    expect(SANDBOX_PROXY_HTML).toMatch(
      /window\.__SANDBOX_SEARCH__[\s\S]*location\.search/
    );
  });
});
