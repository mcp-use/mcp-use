/**
 * CSP (Content Security Policy) helpers for dynamic domain injection
 *
 * These utilities enable lazy metadata evaluation by extracting the request origin
 * from HTTP headers and injecting it into tool metadata's CSP configuration.
 * This allows widgets to connect to dynamically determined origins (e.g., ngrok tunnels).
 */

/**
 * Headers interface matching SDK's extra.requestInfo.headers structure
 */
interface RequestHeaders {
  get?: (name: string) => string | null | undefined;
  [key: string]: unknown;
}

/**
 * Extract request origin from HTTP headers (proxy-aware)
 *
 * Checks for proxy headers (X-Forwarded-Proto, X-Forwarded-Host) first,
 * then falls back to Host header.
 *
 * @param headers - Request headers from SDK's extra.requestInfo
 * @returns Request origin (e.g., "https://myapp.ngrok.io") or null if unavailable
 */
export function getRequestOriginFromHeaders(
  headers?: RequestHeaders
): string | null {
  if (!headers) return null;

  // Helper to get header value (handles both get() method and direct access)
  const getHeader = (name: string): string | undefined => {
    if (typeof headers.get === "function") {
      return headers.get(name) ?? undefined;
    }
    // Direct access for plain objects (case-insensitive)
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName && typeof value === "string") {
        return value;
      }
    }
    return undefined;
  };

  const proto =
    getHeader("X-Forwarded-Proto") ||
    getHeader("X-Forwarded-Protocol") ||
    "https"; // Default to https for security

  const host =
    getHeader("X-Forwarded-Host") || getHeader("Host") || getHeader("host");

  if (!host) return null;

  // Remove port from host if it's a standard port
  const cleanHost = host.replace(/:443$|:80$/, "");

  return `${proto}://${cleanHost}`;
}

/**
 * CSP configuration within tool metadata
 */
interface ToolMetaCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  baseUriDomains?: string[];
}

/**
 * Widget UI metadata structure (MCP Apps protocol)
 */
interface ToolMetaUi {
  csp?: ToolMetaCsp;
  [key: string]: unknown;
}

/**
 * Tool metadata structure
 */
interface ToolMeta {
  ui?: ToolMetaUi;
  "openai/widgetCSP"?: {
    connect_domains?: string[];
    resource_domains?: string[];
    base_uri_domains?: string[];
  };
  [key: string]: unknown;
}

/**
 * Inject dynamic request origin into tool metadata's CSP configuration
 *
 * Adds the origin to both protocols:
 * - MCP Apps: `ui.csp.connectDomains` and `ui.csp.resourceDomains`
 * - Apps SDK: `openai/widgetCSP.connect_domains` and `openai/widgetCSP.resource_domains`
 *
 * This enables lazy metadata evaluation where the actual request origin
 * is injected at tools/list time rather than at registration time.
 *
 * @param meta - Original tool metadata
 * @param requestOrigin - Dynamic request origin to inject
 * @returns New metadata object with injected origin (or original if no changes needed)
 */
export function injectDynamicOriginIntoMeta(
  meta: ToolMeta | undefined,
  requestOrigin: string | null
): ToolMeta | undefined {
  if (!requestOrigin || !meta) return meta;

  let needsUpdate = false;

  // Check MCP Apps protocol (ui.csp)
  const uiCsp = meta.ui?.csp;
  if (uiCsp) {
    if (!uiCsp.connectDomains?.includes(requestOrigin)) {
      needsUpdate = true;
    }
    if (!uiCsp.resourceDomains?.includes(requestOrigin)) {
      needsUpdate = true;
    }
  }

  // Check Apps SDK protocol (openai/widgetCSP)
  const widgetCSP = meta["openai/widgetCSP"];
  if (widgetCSP) {
    if (!widgetCSP.connect_domains?.includes(requestOrigin)) {
      needsUpdate = true;
    }
    if (!widgetCSP.resource_domains?.includes(requestOrigin)) {
      needsUpdate = true;
    }
  }

  if (!needsUpdate) return meta;

  // Create new metadata with injected origin
  const newMeta: ToolMeta = { ...meta };

  // Inject into MCP Apps protocol
  if (meta.ui?.csp) {
    newMeta.ui = {
      ...meta.ui,
      csp: {
        ...meta.ui.csp,
        connectDomains: meta.ui.csp.connectDomains?.includes(requestOrigin)
          ? meta.ui.csp.connectDomains
          : meta.ui.csp.connectDomains
            ? [...meta.ui.csp.connectDomains, requestOrigin]
            : [requestOrigin],
        resourceDomains: meta.ui.csp.resourceDomains?.includes(requestOrigin)
          ? meta.ui.csp.resourceDomains
          : meta.ui.csp.resourceDomains
            ? [...meta.ui.csp.resourceDomains, requestOrigin]
            : [requestOrigin],
      },
    };
  }

  // Inject into Apps SDK protocol
  if (meta["openai/widgetCSP"]) {
    newMeta["openai/widgetCSP"] = {
      ...meta["openai/widgetCSP"],
      connect_domains: meta["openai/widgetCSP"].connect_domains?.includes(
        requestOrigin
      )
        ? meta["openai/widgetCSP"].connect_domains
        : meta["openai/widgetCSP"].connect_domains
          ? [...meta["openai/widgetCSP"].connect_domains, requestOrigin]
          : [requestOrigin],
      resource_domains: meta["openai/widgetCSP"].resource_domains?.includes(
        requestOrigin
      )
        ? meta["openai/widgetCSP"].resource_domains
        : meta["openai/widgetCSP"].resource_domains
          ? [...meta["openai/widgetCSP"].resource_domains, requestOrigin]
          : [requestOrigin],
    };
  }

  return newMeta;
}
