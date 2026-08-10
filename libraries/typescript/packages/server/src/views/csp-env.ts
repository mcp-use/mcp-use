import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

import type { ViewResourceFacts } from "./types.js";

type CspCategory =
  | "connectDomains"
  | "resourceDomains"
  | "frameDomains"
  | "baseUriDomains";

const CATEGORY_ENV: Record<CspCategory, string> = {
  connectDomains: "CSP_CONNECT_DOMAINS",
  resourceDomains: "CSP_RESOURCE_DOMAINS",
  frameDomains: "CSP_FRAME_DOMAINS",
  baseUriDomains: "CSP_BASE_URI_DOMAINS",
};

/** Parse a comma-separated env var into trimmed non-empty domain strings. */
export function parseDomainList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readEnvDomains(name: string): string[] | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return parseDomainList(raw);
}

/** Domains from `CSP_URLS` (shortcut for all categories). */
function readCspUrlsShortcut(): string[] {
  return readEnvDomains("CSP_URLS") ?? [];
}

/** Per-category env override, or `CSP_URLS` when the category var is unset. */
function readEnvDomainsForCategory(category: CspCategory): string[] {
  const perCategory = readEnvDomains(CATEGORY_ENV[category]);
  if (perCategory !== undefined) {
    return perCategory;
  }
  return readCspUrlsShortcut();
}

/**
 * Merge domain lists: earlier segments win on duplicate (higher priority).
 */
export function mergeDomainLists(...segments: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const segment of segments) {
    for (const domain of segment) {
      if (!seen.has(domain)) {
        seen.add(domain);
        out.push(domain);
      }
    }
  }
  return out;
}

/**
 * Resolved origins and flags used when merging author, env, and MCP CSP domains.
 *
 * @internal
 */
export interface BuildCspOptions {
  /** Public server origin from `MCP_URL` or forwarded request headers. */
  serverOrigin: string;
  /** Assets origin derived from `MCP_ASSETS_URL` or the server origin. */
  assetsOrigin: string;
  /** When false, server origin is appended to resourceDomains (same-origin assets). */
  explicitAssetsBase: boolean;
  /** When true, append the server origin's websocket variant for Vite HMR. */
  hmrWs?: boolean;
}

function toWebSocketOrigin(serverOrigin: string): string {
  if (serverOrigin.startsWith("https://")) {
    return `wss://${serverOrigin.slice("https://".length)}`;
  }
  if (serverOrigin.startsWith("http://")) {
    return `ws://${serverOrigin.slice("http://".length)}`;
  }
  return serverOrigin;
}

/**
 * Build final `_meta.ui.csp` from author facts, env vars, and MCP auto-append.
 *
 * Precedence (high → low): author → env (`CSP_*_DOMAINS` or `CSP_URLS`) →
 * MCP auto-append (lowest).
 */
export function buildMergedResourceCsp(
  authorFacts: ViewResourceFacts | undefined,
  options: BuildCspOptions
): McpUiResourceCsp {
  const author = authorFacts?.csp;

  const mcpConnectAuto: string[] = [];
  if (options.serverOrigin !== "") {
    mcpConnectAuto.push(options.serverOrigin);
    if (options.hmrWs === true) {
      mcpConnectAuto.push(toWebSocketOrigin(options.serverOrigin));
    }
  }

  const mcpResourceAuto: string[] = [];
  const resourceOrigin = options.explicitAssetsBase
    ? options.assetsOrigin
    : options.serverOrigin;
  if (resourceOrigin !== "") {
    mcpResourceAuto.push(resourceOrigin);
  }

  const connectDomains = mergeDomainLists(
    author?.connectDomains ?? [],
    readEnvDomainsForCategory("connectDomains"),
    mcpConnectAuto
  );

  const resourceDomains = mergeDomainLists(
    author?.resourceDomains ?? [],
    readEnvDomainsForCategory("resourceDomains"),
    mcpResourceAuto
  );

  const frameDomains = mergeDomainLists(
    author?.frameDomains ?? [],
    readEnvDomainsForCategory("frameDomains")
  );

  const baseUriDomains = mergeDomainLists(
    author?.baseUriDomains ?? [],
    readEnvDomainsForCategory("baseUriDomains")
  );

  return {
    ...author,
    connectDomains,
    resourceDomains,
    frameDomains,
    baseUriDomains,
  };
}
