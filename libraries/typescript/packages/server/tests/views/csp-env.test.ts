import { afterEach, describe, expect, it } from "vitest";

import {
  buildMergedResourceCsp,
  mergeDomainLists,
  parseDomainList,
} from "../../src/views/csp-env.js";

describe("parseDomainList", () => {
  it("splits comma-separated domains", () => {
    expect(parseDomainList("https://a.com, https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("mergeDomainLists", () => {
  it("keeps first occurrence on duplicate", () => {
    expect(
      mergeDomainLists(
        ["https://csp.example.com"],
        ["https://csp.example.com", "https://mcp.example.com"]
      )
    ).toEqual(["https://csp.example.com", "https://mcp.example.com"]);
  });
});

describe("buildMergedResourceCsp", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("merges author, CSP_URLS, and MCP auto-append with precedence", () => {
    delete process.env.CSP_CONNECT_DOMAINS;
    delete process.env.CSP_RESOURCE_DOMAINS;
    delete process.env.CSP_FRAME_DOMAINS;
    delete process.env.CSP_BASE_URI_DOMAINS;
    process.env.CSP_URLS = "https://platform.example.com";

    const csp = buildMergedResourceCsp(
      {
        csp: {
          resourceDomains: ["https://images.example.com"],
        },
      },
      {
        serverOrigin: "https://platform.example.com",
        assetsOrigin: "https://platform.example.com",
        explicitAssetsBase: false,
      }
    );

    expect(csp.resourceDomains).toEqual([
      "https://images.example.com",
      "https://platform.example.com",
    ]);
    expect(csp.connectDomains).toEqual(["https://platform.example.com"]);
    expect(csp.frameDomains).toEqual(["https://platform.example.com"]);
    expect(csp.baseUriDomains).toEqual(["https://platform.example.com"]);
  });

  it("uses per-category env instead of CSP_URLS for that category", () => {
    process.env.CSP_URLS = "https://a.com,https://b.com";
    process.env.CSP_CONNECT_DOMAINS = "https://connect-only.example.com";

    const csp = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://cdn.example.com",
      explicitAssetsBase: true,
    });

    expect(csp.connectDomains).toEqual([
      "https://connect-only.example.com",
      "https://server.example.com",
    ]);
    expect(csp.resourceDomains).toEqual([
      "https://a.com",
      "https://b.com",
      "https://cdn.example.com",
    ]);
  });

  it("appends assets origin to resourceDomains when MCP_ASSETS_URL is explicit", () => {
    delete process.env.CSP_URLS;
    delete process.env.CSP_CONNECT_DOMAINS;
    delete process.env.CSP_RESOURCE_DOMAINS;
    delete process.env.CSP_FRAME_DOMAINS;
    delete process.env.CSP_BASE_URI_DOMAINS;
    const csp = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://cdn.example.com",
      explicitAssetsBase: true,
    });

    expect(csp.connectDomains).toEqual(["https://server.example.com"]);
    expect(csp.resourceDomains).toEqual(["https://cdn.example.com"]);
  });

  it("uses server origin for resourceDomains when assets not explicit", () => {
    delete process.env.CSP_URLS;
    const csp = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://server.example.com",
      explicitAssetsBase: false,
    });

    expect(csp.resourceDomains).toEqual(["https://server.example.com"]);
  });

  it("allows the Vite eval runtime only when HMR is enabled", () => {
    delete process.env.CSP_URLS;
    const regular = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://server.example.com",
      explicitAssetsBase: false,
    }) as { scriptDirectives?: string[] };
    const hmr = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://server.example.com",
      explicitAssetsBase: false,
      hmrWs: true,
    }) as { scriptDirectives?: string[] };

    expect(regular.scriptDirectives).toBeUndefined();
    expect(hmr.scriptDirectives).toEqual(["'unsafe-eval'"]);
  });
});
