import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const CSP_ENV_VARS = [
  "CSP_URLS",
  "CSP_CONNECT_DOMAINS",
  "CSP_RESOURCE_DOMAINS",
  "CSP_FRAME_DOMAINS",
  "CSP_BASE_URI_DOMAINS",
];

describe("buildMergedResourceCsp", () => {
  beforeEach(() => {
    for (const name of CSP_ENV_VARS) {
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges author, CSP_URLS, and MCP auto-append with precedence", () => {
    vi.stubEnv("CSP_URLS", "https://platform.example.com");

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
    expect(csp.frameDomains).toEqual([]);
    expect(csp.baseUriDomains).toEqual([]);
  });

  it("only uses explicit env vars for frame and base-uri domains", () => {
    vi.stubEnv("CSP_URLS", "https://platform.example.com");
    vi.stubEnv("CSP_FRAME_DOMAINS", "https://embed.example.com");
    vi.stubEnv("CSP_BASE_URI_DOMAINS", "https://base.example.com");

    const csp = buildMergedResourceCsp(
      { csp: { frameDomains: ["https://author-embed.example.com"] } },
      {
        serverOrigin: "https://server.example.com",
        assetsOrigin: "https://server.example.com",
        explicitAssetsBase: false,
      }
    );

    expect(csp.frameDomains).toEqual([
      "https://author-embed.example.com",
      "https://embed.example.com",
    ]);
    expect(csp.baseUriDomains).toEqual(["https://base.example.com"]);
  });

  it("uses per-category env instead of CSP_URLS for that category", () => {
    vi.stubEnv("CSP_URLS", "https://a.com,https://b.com");
    vi.stubEnv("CSP_CONNECT_DOMAINS", "https://connect-only.example.com");

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
    const csp = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://cdn.example.com",
      explicitAssetsBase: true,
    });

    expect(csp.connectDomains).toEqual(["https://server.example.com"]);
    expect(csp.resourceDomains).toEqual(["https://cdn.example.com"]);
  });

  it("uses server origin for resourceDomains when assets not explicit", () => {
    const csp = buildMergedResourceCsp(undefined, {
      serverOrigin: "https://server.example.com",
      assetsOrigin: "https://server.example.com",
      explicitAssetsBase: false,
    });

    expect(csp.resourceDomains).toEqual(["https://server.example.com"]);
  });

  it("allows the Vite eval runtime only when HMR is enabled", () => {
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
