import { describe, expect, it } from "vitest";
import {
  augmentDefinitionForRequest,
  processWidgetHtml,
} from "../../../src/server/widgets/widget-helpers.js";
import { OriginResolver } from "../../../src/server/utils/origin-resolver.js";
import type { UIResourceDefinition } from "../../../src/server/types/index.js";

function fakeRequest(host: string, url = `https://${host}/mcp`) {
  return new Request(url, { headers: { Host: host } });
}

describe("processWidgetHtml", () => {
  it("injects <base> and window.__getFile for the given origin", () => {
    const raw = `<!doctype html><html><head></head><body></body></html>`;
    const out = processWidgetHtml(raw, "my-widget", "https://app.example.com");
    expect(out).toContain('<base href="https://app.example.com" />');
    expect(out).toContain(
      `window.__getFile = (filename) => { return "https://app.example.com/mcp-use/widgets/my-widget/"+filename }`
    );
    expect(out).toContain(
      `window.__mcpPublicUrl = "https://app.example.com/mcp-use/public"`
    );
  });

  it("rewrites absolute widget asset URLs", () => {
    const raw = `<html><head><script src="/mcp-use/widgets/my-widget/index.js"></script></head><body></body></html>`;
    const out = processWidgetHtml(raw, "my-widget", "https://app.example.com");
    expect(out).toContain(
      'src="https://app.example.com/mcp-use/widgets/my-widget/index.js"'
    );
  });
});

describe("augmentDefinitionForRequest", () => {
  const staticDef: UIResourceDefinition = {
    type: "mcpApps",
    name: "weather",
    title: "Weather",
    description: "Show weather",
    htmlTemplate: "<html><head></head><body>weather</body></html>",
    metadata: {
      description: "Show weather",
      csp: {
        resourceDomains: ["https://cdn.example.com"],
        connectDomains: [],
        baseUriDomains: [],
      },
    },
  };

  it("rewrites <base> per-request when raw HTML is available", () => {
    const resolver = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const req = fakeRequest("app.example.com");
    const raw = `<html><head></head><body>hi</body></html>`;

    const out = augmentDefinitionForRequest({
      definition: staticDef,
      request: req,
      resolver,
      rawHtml: raw,
      fallbackBaseUrl: "http://localhost:3000",
      serverHost: "localhost",
      serverPort: 3000,
    });

    expect((out as any).htmlTemplate).toContain(
      '<base href="https://app.example.com" />'
    );
  });

  it("falls back to baseUrl when Host is not allow-listed", () => {
    const resolver = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const req = fakeRequest("evil.com");
    const raw = `<html><head></head><body></body></html>`;

    const out = augmentDefinitionForRequest({
      definition: staticDef,
      request: req,
      resolver,
      rawHtml: raw,
      fallbackBaseUrl: "http://localhost:3000",
      serverHost: "localhost",
      serverPort: 3000,
    });

    const html = (out as any).htmlTemplate as string;
    expect(html).toContain('<base href="http://localhost:3000" />');
    expect(html).not.toContain("evil.com");
  });

  it("unions allow-list into metadata.csp for mcpApps", () => {
    const resolver = new OriginResolver(
      ["https://app.example.com", "https://*.preview.example.com"],
      { fallbackOrigin: "http://localhost:3000" }
    );
    const req = fakeRequest("pr-42.preview.example.com");

    const out = augmentDefinitionForRequest({
      definition: staticDef,
      request: req,
      resolver,
      fallbackBaseUrl: "http://localhost:3000",
      serverHost: "localhost",
      serverPort: 3000,
    });

    const csp = (out as any).metadata.csp;
    // Widget-declared entry retained.
    expect(csp.resourceDomains).toContain("https://cdn.example.com");
    // Effective request origin added.
    expect(csp.resourceDomains).toContain("https://pr-42.preview.example.com");
    // Wildcard pattern passed through as-is.
    expect(csp.resourceDomains).toContain("https://*.preview.example.com");
    // connectDomains / baseUriDomains populated with same union.
    expect(csp.connectDomains).toContain("https://pr-42.preview.example.com");
    expect(csp.baseUriDomains).toContain("https://pr-42.preview.example.com");
  });

  it("populates appsSdkMetadata widgetCSP for appsSdk widgets", () => {
    const appsSdkDef: UIResourceDefinition = {
      type: "appsSdk",
      name: "appsdk-widget",
      title: "AppsSDK",
      description: "SDK widget",
      htmlTemplate: "<html></html>",
      appsSdkMetadata: {
        "openai/widgetCSP": {
          connect_domains: [],
          resource_domains: ["https://*.oaistatic.com"],
        },
      },
    };

    const resolver = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const req = fakeRequest("app.example.com");

    const out = augmentDefinitionForRequest({
      definition: appsSdkDef,
      request: req,
      resolver,
      fallbackBaseUrl: "http://localhost:3000",
      serverHost: "localhost",
      serverPort: 3000,
    });

    const csp = (out as any).appsSdkMetadata["openai/widgetCSP"];
    expect(csp.resource_domains).toContain("https://*.oaistatic.com");
    expect(csp.resource_domains).toContain("https://app.example.com");
    expect(csp.connect_domains).toContain("https://app.example.com");
    expect(csp.base_uri_domains).toContain("https://app.example.com");
  });

  it("is a structural clone — does not mutate the input definition", () => {
    const resolver = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const before = JSON.parse(JSON.stringify(staticDef));
    const out = augmentDefinitionForRequest({
      definition: staticDef,
      request: fakeRequest("app.example.com"),
      resolver,
      fallbackBaseUrl: "http://localhost:3000",
      serverHost: "localhost",
      serverPort: 3000,
    });
    expect(staticDef).toEqual(before);
    expect(out).not.toBe(staticDef);
  });
});
