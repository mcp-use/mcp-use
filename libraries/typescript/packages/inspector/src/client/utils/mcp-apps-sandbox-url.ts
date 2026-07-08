/**
 * Build the MCP Apps sandbox-proxy URL for AppFrame.
 *
 * Origin derivation matches the former SandboxedIframe logic verbatim
 * (`__MCP_SANDBOX_ORIGIN__`, localhost/dev same-origin, else sandbox-inspector.*).
 *
 * CSP / permissions are carried as query params (not SandboxConfig.csp) so they
 * survive AppFrame's `buildSandboxUrl` (which only appends a `csp` search param
 * when SandboxConfig.csp is set). We intentionally omit SandboxConfig.csp and
 * let the proxy read `csp_mode`, `permissions`, and optional `widget_csp` from
 * the URL; AppFrame still sends `{ html, csp }` in sandbox-resource-ready
 * (csp will be undefined without SandboxConfig.csp).
 */

import { inspectorApi } from "@/client/utils/basePath";

export type McpAppsSandboxUrlOptions = {
  cspMode: "permissive" | "widget-declared";
  permissions?: {
    camera?: object;
    microphone?: object;
    geolocation?: object;
    clipboardWrite?: object;
  };
  /** Declared widget CSP — used by the proxy when csp_mode=widget-declared. */
  widgetCsp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
    scriptDirectives?: string[];
  };
};

/**
 * Returns a URL pointing at our sandbox-proxy with cache-buster + CSP query params.
 */
export function buildMcpAppsSandboxUrl(
  options: McpAppsSandboxUrlOptions
): URL {
  const { cspMode, permissions, widgetCsp } = options;
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const protocol = window.location.protocol;

  let base: string;

  // Priority 1: Check for configured sandbox origin (injected at build time or runtime)
  const configuredSandboxOrigin = (window as any).__MCP_SANDBOX_ORIGIN__;
  if (configuredSandboxOrigin) {
    base = `${configuredSandboxOrigin}${inspectorApi("mcp-apps/sandbox-proxy")}`;
  } else {
    let sandboxHost: string;

    // Priority 2: Local development or dev mode - use same origin
    const isDevMode = (window as any).__MCP_DEV_MODE__ === true;
    if (
      currentHost === "localhost" ||
      currentHost === "127.0.0.1" ||
      isDevMode
    ) {
      sandboxHost = currentHost;
    } else {
      // Priority 3: Production - preserve the inspector namespace when deriving
      // the sandbox host. Cloud embeds run on apex hosts such as manufact.com,
      // while direct inspector pages run on inspector.{domain}; both should
      // resolve to sandbox-inspector.{domain}.
      if (currentHost.startsWith("dev.")) {
        const rest = currentHost.slice(4); // "dev.".length
        sandboxHost = `sandbox-inspector.dev.${rest}`;
      } else if (currentHost.startsWith("inspector.")) {
        sandboxHost = `sandbox-${currentHost}`;
      } else {
        sandboxHost = `sandbox-inspector.${currentHost}`;
      }
    }

    const portSuffix = currentPort ? `:${currentPort}` : "";
    base = `${protocol}//${sandboxHost}${portSuffix}${inspectorApi("mcp-apps/sandbox-proxy")}`;
  }

  const url = new URL(base);
  url.searchParams.set("v", String(Date.now()));
  url.searchParams.set("csp_mode", cspMode);
  if (permissions && Object.keys(permissions).length > 0) {
    url.searchParams.set("permissions", JSON.stringify(permissions));
  }
  if (widgetCsp && Object.keys(widgetCsp).length > 0) {
    url.searchParams.set("widget_csp", JSON.stringify(widgetCsp));
  }
  return url;
}
